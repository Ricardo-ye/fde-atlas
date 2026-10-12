#!/usr/bin/env node
/**
 * ҳ����ģ���Լ졣
 *
 * ���� check-html.mjs ���ַ��� includes ���ҳ�������Щ��ǣ�
 * ���� vm.Script ��������ű��﷨��������ͬ�����£�����չ��
 * "ģ���ܷ���ļ��ز�����Ԥ�ڷ���" ���� ������ץס��������
 * "�﷨û���� import ·��д��������ʱ�Ű���"�����⡣
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const notes = [];
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

/* ---------------- 1. HTML �Ǽ������� ---------------- */

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
  if (!html.includes(marker)) errors.push(`index.html ȱ�ٹؼ���ǣ�${marker}`);
}

// ���ݽű���������ģ��֮ǰ���أ�ֻ�Ƚ���ʵ�� script ��ǩλ�ã�
// ����ȫ������ ���� ע�����ᵽ�ļ�����������У�
if (html.indexOf('<script src="dist/atlas.core.js">') > html.indexOf('<script type="module" src="src/main.js">')) {
  errors.push('index.html: ���ݽű���������ģ��֮ǰ����');
}

// ҳ�治�������������ʽ��ԭʼ��Ŀ�� 1677 ������ CSS��
const inlineStyleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
for (const [index, block] of inlineStyleBlocks.entries()) {
  if (block[1].trim().length > 200) {
    errors.push(`index.html ������ʽ�� ${index + 1} ������${block[1].trim().length} �ַ�����Ӧ���� src/styles/`);
  }
}

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
for (const [index, block] of inlineScripts.entries()) {
  if (block[1].trim().length > 200) {
    errors.push(`index.html �����ű� ${index + 1} ������Ӧ���� src/main.js`);
  }
}

/* ---------------- 2. ģ��ɼ����ҵ���Ԥ�ڷ��� ---------------- */

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

// dom.js / render.js ������ document��ֻ����̬���ż�飬��ʵ��ִ��
const DOM_FREE_MODULES = new Set(['src/core/taxonomy.js', 'src/core/rubric.js', 'src/core/search.js',
  'src/i18n/index.js', 'src/i18n/zh.js', 'src/i18n/en.js']);

for (const [relative, expectedExports] of MODULE_EXPECTATIONS) {
  const filePath = path.join(root, relative);
  if (!fs.existsSync(filePath)) {
    errors.push(`ȱ��ģ�飺${relative}`);
    continue;
  }
  const source = read(relative);

  for (const symbol of expectedExports) {
    if (!new RegExp(`export\\s+(const|function|class)\\s+${symbol}\\b`).test(source)
      && !new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b`).test(source)) {
      errors.push(`${relative} δ���� ${symbol}`);
    }
  }

  // �� DOM ������ģ��ֱ�� import ��֤��ȷ�� import ·����ѭ��������ȷ
  if (DOM_FREE_MODULES.has(relative)) {
    try {
      const loaded = await import(pathToFileURL(filePath).href);
      for (const symbol of expectedExports) {
        if (!(symbol in loaded)) errors.push(`${relative} ����ʱδ���� ${symbol}`);
      }
    } catch (error) {
      errors.push(`${relative} ����ʧ�ܣ�${error.message}`);
    }
  }
}

/*
 * 3. CSS ����һ�������ƽ� scripts/check-ui.mjs��
 *    ����ļ����������ֲ�Լ���������⸲�ǡ�����һ���ԣ���
 *    �˴�ֻȷ��Ӧ�ò���ʽû�����ò����ڵ� ui-* ����ࡣ
 */
const appCss = read('src/styles/app.css');
const uiIndex = read('src/ui/index.css');
const uiClasses = new Set(
  [...`${uiIndex}\n${read('src/ui/components/controls.css')}\n${read('src/ui/components/display.css')}\n${read('src/ui/components/composite.css')}\n${read('src/ui/utilities/utilities.css')}`
    .matchAll(/\.((?:ui-)[a-z0-9_-]+)/g)].map((m) => m[1]),
);
for (const [, cls] of appCss.matchAll(/\.((?:ui-)[a-z0-9_-]+)/g)) {
  // ���ѡ������.a.b����������ֻץ�����Σ�����ֻ�������Լ��
  if (!uiClasses.has(cls)) errors.push(`src/styles/app.css ������ UI ϵͳδ������ࣺ${cls}`);
}

/* ---------------- 4. ȫ�� JS ģ���﷨��Ч ----------------
 * ��������м�ֵ��styleguide.js ����"��ͨ�������ö��� await"
 * ���� SyntaxError�������ļ���Ĭ��ִ�У�ҳ��ֻʣ��ɫ�壬
 * �� Node ������ȫ���ֲ��ˣ�����������������ļ�����
 *
 * �ؼ��������� ES Module ��������
 * vm.Script �ߵ��ǽű��﷨������ import/export �ᱨ
 * "Cannot use import statement outside a module"�������ٴ���
 * ��ȷ������ vm.SourceTextModule���� --experimental-vm-modules����
 * ��ֻ�����������ӣ���ִ�ж�����롣
 */

const allJs = [...walkJs(path.join(root, 'src')), ...walkJs(path.join(root, 'scripts'))];

if (typeof vm.SourceTextModule === 'function') {
  const context = vm.createContext({});
  for (const file of allJs) {
    try {
      // eslint-disable-next-line no-new -- ֻ��������ִ��
      new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), {
        identifier: rel(file),
        context,
      });
    } catch (error) {
      errors.push(`${rel(file)} �﷨����${error.message}`);
    }
  }
} else {
  // δ���� --experimental-vm-modules ʱ��������������ȷ��֪��
  // ��������һ����Ȼ�󱨵� vm.Script ȥ����ٴ���
  notes.push(
    'JS �﷨��������������� node --experimental-vm-modules ���� check-page.mjs��'
    + '��ֱ������ npm run check:page��package.json �������ø� flag����',
  );
}

/* ---------------- 4b. JS �� $('id') ���õ�Ԫ�ر����� HTML �д��� ----------------
 * ʵ���ֵ��styleguide.js ��д�� $('demoModalClose')���� HTML ����
 * id="sgModalClose"���󶨲����ڵ�Ԫ�ز�������ֻ��"����û��Ӧ"��
 * ҳ�����ಿ���ճ����� ���� ���� bug ���˹���������ȶ����֡�
 */

const HTML_FILES = ['index.html', 'styleguide.html'];

for (const htmlFile of HTML_FILES) {
  const filePath = path.join(root, htmlFile);
  if (!fs.existsSync(filePath)) continue;
  const source = fs.readFileSync(filePath, 'utf8');

  // �ռ���ҳ��������ȫ�� id
  const htmlIds = new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  // �ҳ�������ҳ��Ľű�
  const scriptSrc = [...source.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of scriptSrc) {
    const scriptPath = path.join(root, src);
    if (!fs.existsSync(scriptPath)) continue;
    const js = fs.readFileSync(scriptPath, 'utf8');
    for (const [, id] of js.matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
      if (!htmlIds.has(id)) {
        errors.push(`${htmlFile} �Ľű� ${src} �����˲����ڵ�Ԫ�� #$(${id})`);
      }
    }
    for (const [, id] of js.matchAll(/\bon\(\s*'([^']+)'/g)) {
      if (!htmlIds.has(id)) {
        errors.push(`${htmlFile} �Ľű� ${src} �󶨵������ڵ�Ԫ�� #${id}`);
      }
    }
  }
}

/* ---------------- 5. ������������ҽṹ��ȷ ---------------- */

/** �ֲ�����嵥��ÿ���Ӧ��ȫ�ֱ������� */
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
    errors.push(`ȱ�ٹ������� dist/${file}���������� npm run build`);
    continue;
  }
  const source = read(`dist/${file}`);
  const match = new RegExp(`window\\.${globalName} = ([\\s\\S]+);\\s*$`).exec(source);
  if (!match) {
    errors.push(`dist/${file} ��ʽ����ȷ��δ�ҵ� window.${globalName} ��ֵ`);
    continue;
  }
  let payload = null;
  try {
    payload = JSON.parse(match[1]);
  } catch (error) {
    errors.push(`dist/${file} �е� JSON �޷�������${error.message}`);
    continue;
  }
  layerPayloads[globalName] = payload;

  if (shape) {
    for (const [key, type] of Object.entries(shape)) {
      const actual = Array.isArray(payload?.[key]) ? 'array' : typeof payload?.[key];
      if (actual !== type) errors.push(`dist/${file} �� ${key} ӦΪ ${type}��ʵ��Ϊ ${actual}`);
    }
  }
}

// ���һ���ԣ�core �İ����������� search / detail ����Ŀ�����룬
// ����㿪ĳ������ʱ�Ҳ������顣
const coreCases = layerPayloads.FDE_ATLAS_CORE?.cases ?? [];
const coreCount = coreCases.length;
const searchZh = layerPayloads.FDE_ATLAS_SEARCH_ZH;
const searchEn = layerPayloads.FDE_ATLAS_SEARCH_EN;

if (searchZh && searchZh.ids.length !== coreCount) {
  errors.push(`����������Ĳ㰸������һ�£�${searchZh.ids.length} / ${coreCount}`);
}
if (searchEn && searchEn.ids.length !== coreCount) {
  errors.push(`Ӣ�ļ���������Ĳ㰸������һ�£�${searchEn.ids.length} / ${coreCount}`);
}
// ��Ӣ ID ����һ�£�˫���л��� ID ���룩
if (searchZh && searchEn && JSON.stringify(searchZh.ids) !== JSON.stringify(searchEn.ids)) {
  errors.push('��Ӣ�ļ�����İ��� ID ��˳��һ��');
}
// ÿ�����������������������
const missingDetail = coreCases.filter((c) => typeof c.detail?.score !== 'number');
if (missingDetail.length) {
  errors.push(`���Ĳ��� ${missingDetail.length} ������ȱ�ٹ���������`);
}
// �������븲��ȫ�� ID
const detailZh = layerPayloads.FDE_ATLAS_DETAIL_ZH;
if (detailZh) {
  const missingDetailLayer = coreCases.filter((c) => !(c.id in detailZh));
  if (missingDetailLayer.length) {
    errors.push(`�����ȱ�� ${missingDetailLayer.length} ��������${missingDetailLayer.slice(0, 3).map((c) => c.id).join(', ')}`);
  }
}

/* ---------------- 5. i18n key ���� ---------------- */

try {
  const { missingKeys } = await import(pathToFileURL(path.join(root, 'src/i18n/index.js')).href);
  for (const locale of ['zh', 'en']) {
    const missing = missingKeys(locale);
    if (missing.length) {
      errors.push(`i18n ${locale} ȱ�� ${missing.length} ���İ� key��${missing.slice(0, 5).join(', ')}`);
    }
  }
} catch (error) {
  errors.push(`i18n key ���Ǽ��ʧ�ܣ�${error.message}`);
}

/* ---------------- ��� ---------------- */

if (errors.length) {
  console.error(`ҳ���Լ�ʧ�ܣ�${errors.length} ���`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `ҳ���Լ�ͨ����${MODULE_EXPECTATIONS.length} ��ģ�鵼��������`
  + `${layerPayloads.FDE_ATLAS_CORE?.cases.length ?? 0} �������� ${Object.keys(layerPayloads).length} �����ݲ�ṹһ�£�`
  + `i18n key ������HTML �޴��������ʽ��`,
);
/** �ռ�Ŀ¼������ .js �ļ��� */
function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkJs(full) : (entry.name.endsWith('.js') ? [full] : []);
  });
}

/* �ú����������� const ���� ����������������
 * const ������ʱ��������ǰ����� rel() ���� ReferenceError�� */
function rel(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}
