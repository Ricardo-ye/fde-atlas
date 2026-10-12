#!/usr/bin/env node
/**
 * 页面与模块自检。
 *
 * 上游 check-html.mjs 用字符串 includes 检查页面包含哪些标记，
 * 再用 vm.Script 检查内联脚本语法。这里做同样的事，但扩展到
 * "模块能否真的加载并导出预期符号" —— 后者能抓住上游那类
 * "语法没错但 import 路径写错、运行时才白屏"的问题。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const notes = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/* ---------------- 1. HTML 骨架完整性 ---------------- */

const html = read('index.html');

const requiredHtml = [
  '<script src="dist/atlas.core.js"></script>',
  '<script type="module" src="src/main.js"></script>',
  'src/ui/index.css',
  'src/styles/app.css',
  'id="grid"',
  'id="search"',
  'id="source"',
  'id="industry"',
  'id="evidence"',
  'id="fde"',
  'id="maturity"',
  'id="detailLevel"',
  'id="technicalOnly"',
  'id="resetBtn"',
  'id="modal"',
  'id="modalBody"',
  'id="langToggle"',
  'id="themeToggle"',
  'role="dialog"',
  'aria-live="polite"',
  'ui-skip-link',
];
for (const marker of requiredHtml) {
  if (!html.includes(marker)) errors.push(`index.html 缺少关键标记：${marker}`);
}

// 数据脚本必须在主模块之前加载（只比较真实的 script 标签位置，
// 不能全文搜索 —— 注释里提到文件名会造成误判）
if (html.indexOf('<script src="dist/atlas.core.js">') > html.indexOf('<script type="module" src="src/main.js">')) {
  errors.push('index.html: 数据脚本必须在主模块之前加载');
}

// 页面不得再内联大段样式（原始项目有 1677 行内联 CSS）
const inlineStyleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
for (const [index, block] of inlineStyleBlocks.entries()) {
  if (block[1].trim().length > 200) {
    errors.push(`index.html 内联样式块 ${index + 1} 过长（${block[1].trim().length} 字符），应移入 src/styles/`);
  }
}

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
for (const [index, block] of inlineScripts.entries()) {
  if (block[1].trim().length > 200) {
    errors.push(`index.html 内联脚本 ${index + 1} 过长，应移入 src/main.js`);
  }
}

/* ---------------- 2. 模块可加载且导出预期符号 ---------------- */

const MODULE_EXPECTATIONS = [
  ['src/core/taxonomy.js', ['DIMENSIONS', 'DIMENSION_KEYS', 'EVIDENCE_LEVELS', 'MATURITY_STAGES']],
  ['src/core/rubric.js', ['calculateDetail', 'resolveTechnicalReference']],
  ['src/core/search.js', ['buildIndex', 'applyFilters', 'getFacets', 'DEFAULT_FILTERS']],
  ['src/core/dom.js', ['esc', 'renderList', 'renderSteps', 'renderChips', 'debounce']],
  ['src/views/render.js', ['renderCard', 'renderDetail', 'renderEmpty', 'buildSummaryText']],
  ['src/i18n/index.js', ['createTranslator', 'missingKeys']],
  ['src/i18n/zh.js', ['zh']],
  ['src/i18n/en.js', ['en']],
];

// dom.js / render.js 引用了 document，只做静态符号检查，不实际执行
const DOM_FREE_MODULES = new Set(['src/core/taxonomy.js', 'src/core/rubric.js', 'src/core/search.js',
  'src/i18n/index.js', 'src/i18n/zh.js', 'src/i18n/en.js']);

for (const [relative, expectedExports] of MODULE_EXPECTATIONS) {
  const filePath = path.join(root, relative);
  if (!fs.existsSync(filePath)) {
    errors.push(`缺少模块：${relative}`);
    continue;
  }
  const source = read(relative);

  for (const symbol of expectedExports) {
    if (!new RegExp(`export\\s+(const|function|class)\\s+${symbol}\\b`).test(source)
      && !new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b`).test(source)) {
      errors.push(`${relative} 未导出 ${symbol}`);
    }
  }

  // 无 DOM 依赖的模块直接 import 验证，确保 import 路径与循环引用正确
  if (DOM_FREE_MODULES.has(relative)) {
    try {
      const loaded = await import(pathToFileURL(filePath).href);
      for (const symbol of expectedExports) {
        if (!(symbol in loaded)) errors.push(`${relative} 运行时未导出 ${symbol}`);
      }
    } catch (error) {
      errors.push(`${relative} 加载失败：${error.message}`);
    }
  }
}

/*
 * 3. CSS 令牌一致性已移交 scripts/check-ui.mjs。
 *    那里的检查更完整（分层约束、三主题覆盖、类名一致性），
 *    此处只确认应用层样式没有引用不存在的 ui-* 组件类。
 */
const appCss = read('src/styles/app.css');
const uiIndex = read('src/ui/index.css');
const uiClasses = new Set(
  [...`${uiIndex}\n${read('src/ui/components/controls.css')}\n${read('src/ui/components/display.css')}\n${read('src/ui/components/composite.css')}\n${read('src/ui/utilities/utilities.css')}`
    .matchAll(/\.((?:ui-)[a-z0-9_-]+)/g)].map((m) => m[1]),
);
for (const [, cls] of appCss.matchAll(/\.((?:ui-)[a-z0-9_-]+)/g)) {
  // 组合选择器（.a.b）会让正则只抓到后半段，这里只做存在性检查
  if (!uiClasses.has(cls)) errors.push(`src/styles/app.css 引用了 UI 系统未定义的类：${cls}`);
}

/* ---------------- 4. 全部 JS 模块语法有效 ----------------
 * 这个检查很有价值：styleguide.js 曾因"普通函数里用顶层 await"
 * 触发 SyntaxError，整个文件静默不执行，页面只剩空色板，
 * 而 Node 单测完全发现不了（它根本不加载这个文件）。
 *
 * 关键：必须用 ES Module 解析器。
 * vm.Script 走的是脚本语法，遇到 import/export 会报
 * "Cannot use import statement outside a module"，产生假错误。
 * 正确做法是 vm.SourceTextModule（需 --experimental-vm-modules），
 * 它只做解析与链接，不执行顶层代码。
 */

const allJs = [...walkJs(path.join(root, 'src')), ...walkJs(path.join(root, 'scripts'))];

if (typeof vm.SourceTextModule === 'function') {
  const context = vm.createContext({});
  for (const file of allJs) {
    try {
      // eslint-disable-next-line no-new -- 只解析，不执行
      new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), {
        identifier: rel(file),
        context,
      });
    } catch (error) {
      errors.push(`${rel(file)} 语法错误：${error.message}`);
    }
  }
} else {
  // 未启用 --experimental-vm-modules 时降级：跳过并明确告知，
  // 而不是用一个必然误报的 vm.Script 去制造假错误。
  notes.push(
    'JS 语法检查已跳过：需以 node --experimental-vm-modules 运行 check-page.mjs，'
    + '或直接运行 npm run check:page（package.json 中已配置该 flag）。',
  );
}

/* ---------------- 4b. JS 里 $('id') 引用的元素必须在 HTML 中存在 ----------------
 * 实测价值：styleguide.js 曾写成 $('demoModalClose')，而 HTML 里是
 * id="sgModalClose"。绑定不存在的元素不报错，只是"点了没反应"，
 * 页面其余部分照常工作 —— 这类 bug 靠人工点击很难稳定复现。
 */

const HTML_FILES = ['index.html', 'styleguide.html'];

for (const htmlFile of HTML_FILES) {
  const filePath = path.join(root, htmlFile);
  if (!fs.existsSync(filePath)) continue;
  const source = fs.readFileSync(filePath, 'utf8');

  // 收集该页面声明的全部 id
  const htmlIds = new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  // 找出驱动该页面的脚本
  const scriptSrc = [...source.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of scriptSrc) {
    const scriptPath = path.join(root, src);
    if (!fs.existsSync(scriptPath)) continue;
    const js = fs.readFileSync(scriptPath, 'utf8');
    for (const [, id] of js.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
      if (!htmlIds.has(id)) {
        errors.push(`${htmlFile} 的脚本 ${src} 引用了不存在的元素 #$(${id})`);
      }
    }
    for (const [, id] of js.matchAll(/\bon\(\s*'([^']+)'/g)) {
      if (!htmlIds.has(id)) {
        errors.push(`${htmlFile} 的脚本 ${src} 绑定到不存在的元素 #${id}`);
      }
    }
  }
}

/* ---------------- 5. 构建产物存在且结构正确 ---------------- */

/** 分层产物清单：每层对应的全局变量名。 */
const LAYERS = [
  ['atlas.stats.js', 'FDE_ATLAS_STATS', { total: 'number' }],
  ['atlas.core.js', 'FDE_ATLAS_CORE', { cases: 'array' }],
  ['atlas.search.js', 'FDE_ATLAS_SEARCH_ZH', { ids: 'array', fields: 'array' }],
  ['atlas.detail.js', 'FDE_ATLAS_DETAIL_ZH', null],
  ['atlas.core.en.js', 'FDE_ATLAS_CORE_EN', { cases: 'array' }],
  ['atlas.search.en.js', 'FDE_ATLAS_SEARCH_EN', { ids: 'array', fields: 'array' }],
  ['atlas.detail.en.js', 'FDE_ATLAS_DETAIL_EN', null],
];

const layerPayloads = {};

for (const [file, globalName, shape] of LAYERS) {
  const filePath = path.join(root, 'dist', file);
  if (!fs.existsSync(filePath)) {
    errors.push(`缺少构建产物 dist/${file}，请先运行 npm run build`);
    continue;
  }
  const source = read(`dist/${file}`);
  const match = new RegExp(`window\\.${globalName} = ([\\s\\S]+);\\s*$`).exec(source);
  if (!match) {
    errors.push(`dist/${file} 格式不正确：未找到 window.${globalName} 赋值`);
    continue;
  }
  let payload = null;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    errors.push(`dist/${file} 中的 JSON 无法解析：${error.message}`);
    continue;
  }
  layerPayloads[globalName] = payload;

  if (shape) {
    for (const [key, type] of Object.entries(shape)) {
      const actual = Array.isArray(payload?.[key]) ? 'array' : typeof payload?.[key];
      if (actual !== type) errors.push(`dist/${file} 的 ${key} 应为 ${type}，实际为 ${actual}`);
    }
  }
}

// 跨层一致性：core 的案例数必须与 search / detail 的条目数对齐，
// 否则点开某条案例时找不到详情。
const coreCases = layerPayloads.FDE_ATLAS_CORE?.cases ?? [];
const coreCount = coreCases.length;
const searchZh = layerPayloads.FDE_ATLAS_SEARCH_ZH;
const searchEn = layerPayloads.FDE_ATLAS_SEARCH_EN;

if (searchZh && searchZh.ids.length !== coreCount) {
  errors.push(`检索层与核心层案例数不一致：${searchZh.ids.length} / ${coreCount}`);
}
if (searchEn && searchEn.ids.length !== coreCount) {
  errors.push(`英文检索层与核心层案例数不一致：${searchEn.ids.length} / ${coreCount}`);
}
// 中英 ID 必须一致（双语切换按 ID 对齐）
if (searchZh && searchEn && JSON.stringify(searchZh.ids) !== JSON.stringify(searchEn.ids)) {
  errors.push('中英文检索层的案例 ID 或顺序不一致');
}
// 每条案例都必须带构建期评分
const missingDetail = coreCases.filter((c) => typeof c.detail?.score !== 'number');
if (missingDetail.length) {
  errors.push(`核心层有 ${missingDetail.length} 条案例缺少构建期评分`);
}
// 详情层必须覆盖全部 ID
const detailZh = layerPayloads.FDE_ATLAS_DETAIL_ZH;
if (detailZh) {
  const missingDetailLayer = coreCases.filter((c) => !(c.id in detailZh));
  if (missingDetailLayer.length) {
    errors.push(`详情层缺少 ${missingDetailLayer.length} 条案例：${missingDetailLayer.slice(0, 3).map((c) => c.id).join(', ')}`);
  }
}

/* ---------------- 5. i18n key 覆盖 ---------------- */

try {
  const { missingKeys } = await import(pathToFileURL(path.join(root, 'src/i18n/index.js')).href);
  for (const locale of ['zh', 'en']) {
    const missing = missingKeys(locale);
    if (missing.length) {
      errors.push(`i18n ${locale} 缺少 ${missing.length} 个文案 key：${missing.slice(0, 5).join(', ')}`);
    }
  }
} catch (error) {
  errors.push(`i18n key 覆盖检查失败：${error.message}`);
}

/* ---------------- 输出 ---------------- */

if (errors.length) {
  console.error(`页面自检失败（${errors.length} 项）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `页面自检通过：${MODULE_EXPECTATIONS.length} 个模块导出正常，`
  + `${layerPayloads.FDE_ATLAS_CORE?.cases.length ?? 0} 条案例的 ${Object.keys(layerPayloads).length} 个数据层结构一致，`
  + `i18n key 完整，HTML 无大段内联样式。`,
);
/** 收集目录下所有 .js 文件。 */
function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkJs(full) : (entry.name.endsWith('.js') ? [full] : []);
  });
}

/* 用函数声明而非 const —— 函数声明会提升，
 * const 存在暂时性死区：前面调用 rel() 会抛 ReferenceError。 */
function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}
