#!/usr/bin/env node
/**
 * UI ���ϵͳ�Լ졣
 *
 * ����ļ��£�ÿһ������Ӧһ��ᾲĬ�ӻ������⣺
 *   1. ���������� ���� ���Ʋ����õ� primitive ������ʵ���ڣ�
 *      ���� var() ����Ϊ��Чֵ����ɫ��͸�������������������ű�¶��
 *   2. ���Խ�� ���� ����ﲻӦ���� --p-*��primitive����
 *      Խ�����"������ֻ�� semantic"�����ŵʧЧ��
 *   3. ����һ���� ���� HTML/JS ���õ��� CSS δ�������ᾲĬʧЧ��
 *   4. ���Ƹ��� ���� �ĸ�������붨��ͬһ�� semantic ���ƣ�
 *      ©һ������ζ�Ÿ�������������Ի��˵� light ��ֵ��
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

/* ---------------- �ռ� CSS �ļ� ---------------- */

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : (entry.name.endsWith('.css') ? [full] : []);
});

const cssFiles = walk(uiDir);
const rel = (file) => path.relative(root, file).replace(/\\/g, '/');

/* ---------------- 1. ���������� ---------------- */

const primitiveCss = fs.readFileSync(path.join(uiDir, 'tokens', 'primitive.css'), 'utf8');
const primitiveTokens = new Set(
  [...primitiveCss.matchAll(/^\s*(--p-[a-z0-9-]+)\s*:/gim)].map((m) => m[1]),
);

/** primitive ���������õı��������Ǳ����Ѷ���ģ��������� semantic���� */
const missingInPrimitive = [];
for (const [, name] of primitiveCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
  if (!primitiveTokens.has(name)) missingInPrimitive.push(name);
}
// ע����� `var(--semantic-*)` ֻ�Ǿ���˵����������ʵ����
const realMissing = missingInPrimitive.filter((name) => !name.endsWith('-') && !name.startsWith('--semantic-'));
if (realMissing.length) {
  errors.push(`tokens/primitive.css ������δ�ڱ��㶨������ƣ�${[...new Set(realMissing)].join(', ')}`);
}

/* ---------------- 2. semantic ������ӳ�� ---------------- */

const semanticCss = fs.readFileSync(path.join(uiDir, 'tokens', 'semantic.css'), 'utf8');

/** ÿ��������ڶ���� semantic ���ơ� */
const THEMES = ['light', 'dark', 'contrast'];
const themeTokens = {};
for (const theme of THEMES) {
  // light д�� ":root,\n:root[data-theme=\"light\"]" ��
  const pattern = theme === 'light'
    ? /:root,\s*:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/
    : new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`);
  const block = semanticCss.match(pattern);
  if (!block) {
    errors.push(`tokens/semantic.css �Ҳ��� ${theme} �����`);
    continue;
  }
  themeTokens[theme] = new Set([...block[1].matchAll(/^\s*(--semantic-[a-z0-9-]+)\s*:/gim)].map((m) => m[1]));
}

const baseTheme = themeTokens.light ?? new Set();
for (const theme of THEMES) {
  if (theme === 'light') continue;
  const missing = [...baseTheme].filter((token) => !themeTokens[theme]?.has(token));
  if (missing.length) {
    errors.push(`${theme} ����ȱ�� ${missing.length} �� semantic ���ƣ�${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' ��' : ''}`);
  }
  const extra = [...(themeTokens[theme] ?? [])].filter((token) => !baseTheme.has(token));
  if (extra.length) {
    warnings.push(`${theme} ������ light �в����ڵ����ƣ�${extra.join(', ')}`);
  }
}

const semanticTokens = new Set([
  ...baseTheme,
  ...THEMES.flatMap((theme) => [...(themeTokens[theme] ?? [])]),
]);

/* semantic ���õ�Ŀ������� primitive �� semantic ���� */
const badSemanticRefs = new Set();
for (const [, name] of semanticCss.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
  if (!primitiveTokens.has(name) && !semanticTokens.has(name)) badSemanticRefs.add(name);
}
if (badSemanticRefs.size) {
  errors.push(`tokens/semantic.css �����˲����ڵ����ƣ�${[...badSemanticRefs].join(', ')}`);
}

/* ---------------- 3. ����㲻��Խ������ primitive ---------------- */

const componentFiles = cssFiles.filter((file) => !file.includes(`${path.sep}tokens${path.sep}`));

/**
 * �ֲ�Լ��ֻ�ԡ���ɫ���ơ�������
 *
 * ��ɫ��Ψһ��"��������Ҫ���廻��"�����һ�࣬������������� semantic��
 * ����� / �ֺ� / Բ�� / ��Ч / z-index ��Щ���ĸ�������ȡֵ��ͬ ����
 * �������Ƶ� semantic ֻ��� semantic ��� primitive �ľ���
 * ��һ����ȴ�������κ���������ԡ�����ֱ���������á�
 */
const COLOR_PRIMITIVE = /^--p-(?:blue|neutral|green|amber|red|violet|cyan)-\d+$/;

for (const file of componentFiles) {
  const css = fs.readFileSync(file, 'utf8');
  const used = new Set([...css.matchAll(/var\(\s*(--p-[a-z0-9-]+)/g)].map((m) => m[1]));
  const violations = [...used].filter((name) => COLOR_PRIMITIVE.test(name));
  if (violations.length) {
    errors.push(`${rel(file)} ֱ����������ɫ primitive ���ƣ�${violations.join(', ')}����ɫӦ�� semantic��`);
  }

  // ��������õ� semantic ���Ʊ������
  const bad = [...new Set([...css.matchAll(/var\(\s*(--semantic-[a-z0-9-]+)/g)].map((m) => m[1]))]
    .filter((name) => !semanticTokens.has(name));
  if (bad.length) {
    errors.push(`${rel(file)} ������δ����� semantic ���ƣ�${bad.join(', ')}`);
  }
}

/* ---------------- 4. ����������ʹ�õ�һ���� ---------------- */

const definedClasses = new Set();
for (const file of componentFiles) {
  const css = fs.readFileSync(file, 'utf8');
  for (const [, cls] of css.matchAll(/\.((?:ui-)[a-z0-9_-]+)/g)) definedClasses.add(cls);
}

const jsFiles = walkJs(path.join(root, 'src'));
const usedClasses = new Set();

/*
 * �ռ�"ʹ���е�����"��
 *
 * ֻ��������Դ������������ץ��
 *   1. HTML �� class="..." ���ԣ���� HTML �ļ���
 *   2. JS ģ���ַ�������ֵ� ui-* ��ʶ��
 *
 * ���ȹ��Ŀӣ������� /\bui-[\w-]+/g ȫ��ɨ JS��
 * ����� CSS �ı�Ƭ�Ρ�CSS ��ѡ�����ַ���Ҳ����"ʹ���е���"��
 * �������������ԡ��������ȡ�������һ��"�����ǺϷ�����"�Ĺ��ˡ�
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

// JS ģ�����������render.js / styleguide.js ��ƴ class="ui-badge ui-badge--accent"��
for (const file of jsFiles) {
  const js = fs.readFileSync(file, 'utf8');
  // ֻȡ class="..." ������ݣ�����ȫ��ɨ��
  for (const [, value] of js.matchAll(/\bclass="([^"{}]+)"/g)) {
    for (const cls of value.split(/\s+/)) {
      if (VALID_CLASS.test(cls)) usedClasses.add(cls);
    }
  }
  // ģ���ﳣ���� class="${...}" ƴ�ӣ�ֻ��ȡ�����ڵľ�̬Ƭ��
  for (const [, value] of js.matchAll(/\bui-[a-z0-9_-]+/g)) {
    const cls = value;
    if (VALID_CLASS.test(cls)) usedClasses.add(cls);
  }
}

const undefinedClasses = [...usedClasses].filter(
  (cls) => typeof cls === 'string' && cls.startsWith('ui-') && !definedClasses.has(cls),
);

if (undefinedClasses.length) {
  errors.push(`HTML/JS �õ��� UI ϵͳδ������ࣺ${undefinedClasses.join(', ')}`);
}

/* �����飺�����˵���δʹ�õ��ࣨ������������ */
const unused = [...definedClasses].filter((cls) => !usedClasses.has(cls));
if (unused.length) {
  notes.push(`UI ϵͳ�����˵���ǰҳ��δʹ�õ��ࣺ${unused.slice(0, 8).join(', ')}${unused.length > 8 ? ` �� ${unused.length} ��` : ''}`);
}

/* ---------------- 5. ����嵥 ---------------- */

const COMPONENT_GROUPS = {
  '��ť��ͼ�갴ť': ['ui-button', 'ui-icon-button'],
  �����ؼ�: ['ui-field', 'ui-input', 'ui-search', 'ui-select', 'ui-checkbox', 'ui-radio', 'ui-switch'],
  ��ʶ: ['ui-badge', 'ui-tag'],
  ����: ['ui-card', 'ui-stat', 'ui-empty', 'ui-skeleton', 'ui-keyvalue', 'ui-source'],
  ����: ['ui-modal', 'ui-toast', 'ui-tooltip', 'ui-alert'],
  ����: ['ui-table', 'ui-tabs', 'ui-steps', 'ui-score', 'ui-prose'],
};

for (const [group, classes] of Object.entries(COMPONENT_GROUPS)) {
  const missing = classes.filter((cls) => !definedClasses.has(cls));
  if (missing.length) errors.push(`����嵥��${group}��ȱ�ٶ��壺${missing.join(', ')}`);
}

/* ---------------- ��� ---------------- */

const summary = [
  `primitive ���ƣ�${primitiveTokens.size}`,
  `semantic ���ƣ�${semanticTokens.size} �� ${THEMES.length} ����`,
  `UI ����ࣺ${definedClasses.size}`,
  `CSS �ļ���${cssFiles.length}`,
].join(' �� ');

if (errors.length) {
  console.error(`UI ϵͳ�Լ�ʧ�ܣ�${errors.length} ����󣩣�`);
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length) {
    console.error(`\n���棨${warnings.length} ���`);
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log(`UI ϵͳ�Լ�ͨ����${summary}`);
for (const note of notes) console.warn(`��ʾ��${note}`);
for (const warning of warnings) console.warn(`���棺${warning}`);

/** �ռ� src ������ JS���������ļ������ظ�ʵ�֣��� */
function walkJs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkJs(full) : (entry.name.endsWith('.js') ? [full] : []);
  });
}
/** �ռ���Ŀ������ HTML �ļ������� dist �� .git���� */
function walkHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', 'node_modules', 'dist'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walkHtml(full) : (entry.name.endsWith('.html') ? [full] : []);
  });
}
