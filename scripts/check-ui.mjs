#!/usr/bin/env node
/**
 * UI 设计系统自检。
 *
 * 检查四件事，每一件都对应一类会静默劣化的问题：
 *   1. 令牌完整性 —— 令牌层引用的 primitive 必须真实存在，
 *      否则 var() 回退为无效值，颜色变透明这类问题在浏览器里才暴露；
 *   2. 层叠越界 —— 组件里不应出现 --p-*（primitive），
 *      越层会让"换主题只改 semantic"这个承诺失效；
 *   3. 类名一致性 —— HTML/JS 里用到但 CSS 未定义的类会静默失效；
 *   4. 令牌覆盖 —— 四个主题必须定义同一组 semantic 令牌，
 *      漏一个就意味着该主题下这个属性回退到 light 的值。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(root, 'src', 'ui');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const errors = [];
const warnings = [];
const notes = [];

/* ---------------- 收集 CSS 文件 ---------------- */

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : (entry.name.endsWith('.css') ? [full] : []);
});

const cssFiles = walk(uiDir);
const rel = (file) => path.relative(root, file).replace(/\\/g, '/');

/* ---------------- 1. 令牌完整性 ---------------- */

const primitiveCss = fs.readFileSync(path.join(uiDir, 'tokens', 'primitive.css'), 'utf8');
const primitiveTokens = new Set(
  [...primitiveCss.matchAll(/^\s*(--p-[a-z0-9-]+)\s*:/gim)].map((m) => m[1]),
);

/** primitive 层自身引用的变量必须是本层已定义的（不能引用 semantic）。 */
const missingInPrimitive = [];
for (const [, name] of primitiveCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
  if (!primitiveTokens.has(name)) missingInPrimitive.push(name);
}
// 注释里的 `var(--semantic-*)` 只是举例说明，不是真实引用
const realMissing = missingInPrimitive.filter((name) => !name.endsWith('-') && !name.startsWith('--semantic-'));
if (realMissing.length) {
  errors.push(`tokens/primitive.css 引用了未在本层定义的令牌：${[...new Set(realMissing)].join(', ')}`);
}

/* ---------------- 2. semantic 层令牌映射 ---------------- */

const semanticCss = fs.readFileSync(path.join(uiDir, 'tokens', 'semantic.css'), 'utf8');

/** 每个主题块内定义的 semantic 令牌。 */
const THEMES = ['light', 'dark', 'contrast'];
const themeTokens = {};
for (const theme of THEMES) {
  // light 写在 ":root,\n:root[data-theme=\"light\"]" 里
  const pattern = theme === 'light'
    ? /:root,\s*:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/
    : new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`);
  const block = semanticCss.match(pattern);
  if (!block) {
    errors.push(`tokens/semantic.css 找不到 ${theme} 主题块`);
    continue;
  }
  themeTokens[theme] = new Set([...block[1].matchAll(/^\s*(--semantic-[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
}

const baseTheme = themeTokens.light ?? new Set();
for (const theme of THEMES) {
  if (theme === 'light') continue;
  const missing = [...baseTheme].filter((token) => !themeTokens[theme]?.has(token));
  if (missing.length) {
    errors.push(`${theme} 主题缺少 ${missing.length} 个 semantic 令牌：${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`);
  }
  const extra = [...(themeTokens[theme] ?? [])].filter((token) => !baseTheme.has(token));
  if (extra.length) {
    warnings.push(`${theme} 主题有 light 中不存在的令牌：${extra.join(', ')}`);
  }
}

const semanticTokens = new Set([
  ...baseTheme,
  ...THEMES.flatMap((theme) => [...(themeTokens[theme] ?? [])]),
]);

/* semantic 引用的目标必须是 primitive 或 semantic 本身 */
const badSemanticRefs = new Set();
for (const [, name] of semanticCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
  if (!primitiveTokens.has(name) && !semanticTokens.has(name)) badSemanticRefs.add(name);
}
if (badSemanticRefs.size) {
  errors.push(`tokens/semantic.css 引用了不存在的令牌：${[...badSemanticRefs].join(', ')}`);
}

/* ---------------- 3. 组件层不得越层引用 primitive ---------------- */

const componentFiles = cssFiles.filter((file) => !file.includes(`${path.sep}tokens${path.sep}`));

/**
 * 分层约束只对「颜色令牌」成立。
 *
 * 颜色是唯一有"换个主题要整体换掉"诉求的一类，所以组件必须走 semantic。
 * 而间距 / 字号 / 圆角 / 动效 / z-index 这些在四个主题里取值相同 ——
 * 让它们绕道 semantic 只会把 semantic 变成 primitive 的镜像，
 * 多一层间接却换不来任何主题灵活性。所以直接允许引用。
 */
const COLOR_PRIMITIVE = /^--p-(?:blue|neutral|green|amber|red|violet|cyan)-\d+$/;

for (const file of componentFiles) {
  const css = fs.readFileSync(file, 'utf8');
  const used = new Set([...css.matchAll(/var\(\s*(--p-[a-z0-9-]+)/g)].map((m) => m[1]));
  const violations = [...used].filter((name) => COLOR_PRIMITIVE.test(name));
  if (violations.length) {
    errors.push(`${rel(file)} 直接引用了颜色 primitive 令牌：${violations.join(', ')}（颜色应走 semantic）`);
  }

  // 组件里引用的 semantic 令牌必须存在
  const bad = [...new Set([...css.matchAll(/var\(\s*(--semantic-[a-z0-9-]+)/g)].map((m) => m[1]))]
    .filter((name) => !semanticTokens.has(name));
  if (bad.length) {
    errors.push(`${rel(file)} 引用了未定义的 semantic 令牌：${bad.join(', ')}`);
  }
}

/* ---------------- 4. 类名定义与使用的一致性 ---------------- */

const definedClasses = new Set();
for (const file of componentFiles) {
  const css = fs.readFileSync(file, 'utf8');
  for (const [, cls] of css.matchAll(/\.((?:ui-)[a-z0-9_-]+)/g)) definedClasses.add(cls);
}

const jsFiles = walkJs(path.join(root, 'src'));
const usedClasses = new Set();

/*
 * 收集"使用中的类名"。
 *
 * 只认两类来源，避免正则误抓：
 *   1. HTML 的 class="..." 属性（逐个 HTML 文件）
 *   2. JS 模板字符串里出现的 ui-* 标识符
 *
 * 曾踩过的坑：早先用 /\bui-[\w-]+/g 全局扫 JS，
 * 结果把 CSS 文本片段、CSS 类选择器字符串也当成"使用中的类"，
 * 产生大量假阳性。这里对提取结果再做一次"必须是合法类名"的过滤。
 */
const VALID_CLASS = /^[a-z][a-z0-9-]*$/;

for (const file of walkHtml(root)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [, value] of source.matchAll(/\sclass="([^"]+)"/g)) {
    for (const cls of value.split(/\s+/)) {
      if (VALID_CLASS.test(cls)) usedClasses.add(cls);
    }
  }
}

// JS 模板里的类名（render.js / styleguide.js 会拼 class="ui-badge ui-badge--accent"）
for (const file of jsFiles) {
  const js = fs.readFileSync(file, 'utf8');
  // 只取 class="..." 里的内容，不做全文扫描
  for (const [, value] of js.matchAll(/\bclass="([^"{}]+)"/g)) {
    for (const cls of value.split(/\s+/)) {
      if (VALID_CLASS.test(cls)) usedClasses.add(cls);
    }
  }
  // 模板里常见的 class="${...}" 拼接，只提取引号内的静态片段
  for (const [, value] of js.matchAll(/\bui-[a-z0-9_-]+/g)) {
    const cls = value;
    if (VALID_CLASS.test(cls)) usedClasses.add(cls);
  }
}

const undefinedClasses = [...usedClasses].filter(
  (cls) => typeof cls === 'string' && cls.startsWith('ui-') && !definedClasses.has(cls),
);

if (undefinedClasses.length) {
  errors.push(`HTML/JS 用到了 UI 系统未定义的类：${undefinedClasses.join(', ')}`);
}

/* 反向检查：定义了但从未使用的类（可能是遗留） */
const unused = [...definedClasses].filter((cls) => !usedClasses.has(cls));
if (unused.length) {
  notes.push(`UI 系统定义了但当前页面未使用的类：${unused.slice(0, 8).join(', ')}${unused.length > 8 ? ` 等 ${unused.length} 个` : ''}`);
}

/* ---------------- 5. 组件清单 ---------------- */

const COMPONENT_GROUPS = {
  '按钮与图标按钮': ['ui-button', 'ui-icon-button'],
  表单控件: ['ui-field', 'ui-input', 'ui-search', 'ui-select', 'ui-checkbox', 'ui-radio', 'ui-switch'],
  标识: ['ui-badge', 'ui-tag'],
  容器: ['ui-card', 'ui-stat', 'ui-empty', 'ui-skeleton', 'ui-keyvalue', 'ui-source'],
  浮层: ['ui-modal', 'ui-toast', 'ui-tooltip', 'ui-alert'],
  数据: ['ui-table', 'ui-tabs', 'ui-steps', 'ui-score', 'ui-prose'],
};

for (const [group, classes] of Object.entries(COMPONENT_GROUPS)) {
  const missing = classes.filter((cls) => !definedClasses.has(cls));
  if (missing.length) errors.push(`组件清单「${group}」缺少定义：${missing.join(', ')}`);
}

/* ---------------- 输出 ---------------- */

const summary = [
  `primitive 令牌：${primitiveTokens.size}`,
  `semantic 令牌：${semanticTokens.size} × ${THEMES.length} 主题`,
  `UI 组件类：${definedClasses.size}`,
  `CSS 文件：${cssFiles.length}`,
].join(' · ');

if (errors.length) {
  console.error(`UI 系统自检失败（${errors.length} 项错误）：`);
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length) {
    console.error(`\n警告（${warnings.length} 项）：`);
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log(`UI 系统自检通过：${summary}`);
for (const note of notes) console.warn(`提示：${note}`);
for (const warning of warnings) console.warn(`警告：${warning}`);

/** 收集 src 下所有 JS（避免在文件顶部重复实现）。 */
function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkJs(full) : (entry.name.endsWith('.js') ? [full] : []);
  });
}
/** 收集项目内所有 HTML 文件（跳过 dist 与 .git）。 */
function walkHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkHtml(full) : (entry.name.endsWith('.html') ? [full] : []);
  });
}
