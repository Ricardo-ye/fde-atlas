#!/usr/bin/env node
/**
 * 构建：把事实数据 + 派生评分打包成浏览器产物（分层加载）。
 *
 * 产物设计：
 *   dist/atlas.stats.js      统计信息，两语言共用，极小
 *   dist/atlas.core.js       首屏必需 —— 卡片字段 + case_summary + 评分
 *   dist/atlas.search.zh.js  检索层 —— 用户首次输入搜索词时加载
 *   dist/atlas.detail.zh.js  详情层 —— 打开弹窗时按需加载
 *   dist/atlas.*.en.js       英文对应三层，切换语言时才加载
 *
 * 分层的依据（实测 127 条中文数据的体积分布）：
 *   卡片字段 53KB + case_summary 21KB  = 74KB（占全量 18%）→ 首屏只需这些
 *   搜索字段 216 KB（占 54%）           → 只在真的搜索时才需要
 *   其余为详情字段                      → 按条随机访问
 *
 * 每层都用 .js 挂到 window 命名空间而非 .json：
 *   既保留"不需要构建服务器"的特点，也避免 fetch 在 file:// 下的 CORS 问题。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateDetail } from '../src/core/rubric.js';
import { DIMENSIONS, EVIDENCE_LEVELS, DIRECTNESS_ZH, DIRECTNESS_EN } from '../src/core/taxonomy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

const zh = readJson('data/cases.json');
const en = readJson('data/cases.en.json');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'manifest.json'), 'utf8'));
const version = readJson('package.json').version;

const scoreById = new Map(manifest.cases.map((entry) => [entry.id, entry]));

const detailOf = (record) => {
  const scored = scoreById.get(record.id) ?? calculateDetail(record);
  return {
    score: scored.detail_score,
    level: scored.detail_level,
    dimensions: scored.detail_dimensions,
    missing: scored.missing_details,
  };
};

/** 首屏卡片所需的标量字段。 */
const CARD_FIELDS = [
  'id', 'company', 'industry', 'industry_group', 'scenario', 'source',
  'fde', 'fde_relation', 'maturity', 'maturity_stage', 'evidence_level',
  'url', 'technical_reference', 'case_summary',
];

/** 检索层字段：只在用户输入搜索词时加载。 */
const SEARCH_FIELDS = [
  'problem', 'solution', 'architecture', 'components',
  'fde_actions', 'reusable', 'human', 'result', 'evidence',
];

const pick = (record, fields) => Object.fromEntries(
  fields.filter((f) => record[f] !== undefined).map((f) => [f, record[f]]),
);

const pickRest = (record) => {
  const rest = { ...record };
  for (const field of [...CARD_FIELDS, ...SEARCH_FIELDS, 'technical_reference']) delete rest[field];
  return rest;
};

const built = [];
const write = (name, comment, globalName, payload) => {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const content = `/* 由 scripts/build.mjs 生成（${comment}），请勿手改。npm run build */\n`
    + `window.${globalName} = ${JSON.stringify(payload)};\n`;
  fs.writeFileSync(path.join(root, 'dist', name), content);
  const bytes = Buffer.byteLength(content, 'utf8');
  built.push([name, bytes]);
  return bytes;
};

write('atlas.stats.js', '统计', 'FDE_ATLAS_STATS', {
  version,
  total: zh.length,
  summary: {
    by_detail_level: manifest.by_detail_level,
    by_evidence_level: manifest.by_evidence_level,
    by_source: manifest.by_source,
    by_industry_group: manifest.by_industry_group,
    technical_reference_count: manifest.technical_reference_count,
    independently_verified_count: manifest.independently_verified_count,
  },
});

for (const [locale, records, dirTable, suffix] of [
  ['zh', zh, DIRECTNESS_ZH, ''],
  ['en', en, DIRECTNESS_EN, '.en'],
]) {
  const upper = locale.toUpperCase();

  write(`atlas.core${suffix}.js`, `核心 ${locale}`, `FDE_ATLAS_CORE${suffix ? '_EN' : ''}`, {
    locale,
    version,
    dimensions: DIMENSIONS,
    evidence_levels: EVIDENCE_LEVELS,
    directness: dirTable,
    cases: records.map((record) => ({ ...pick(record, CARD_FIELDS), detail: detailOf(record) })),
  });

  write(`atlas.search${suffix}.js`, `检索 ${locale}`, `FDE_ATLAS_SEARCH_${upper}`, {
    ids: records.map((r) => r.id),
    fields: records.map((record) => pick(record, SEARCH_FIELDS)),
  });

  write(`atlas.detail${suffix}.js`, `详情 ${locale}`, `FDE_ATLAS_DETAIL_${upper}`,
    Object.fromEntries(records.map((record) => [record.id, pickRest(record)])));
}

fs.writeFileSync(
  path.join(root, 'dist', 'atlas.index.json'),
  `${JSON.stringify({
    version,
    files: Object.fromEntries(built.map(([name, bytes]) => [name, { bytes }])),
  }, null, 2)}\n`,
);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const total = built.reduce((sum, [, size]) => sum + size, 0);
const firstScreen = built.find(([name]) => name === 'atlas.core.js')[1];

console.log('构建完成（分层加载）：');
for (const [name, size] of built) console.log(`  ${name.padEnd(24)} ${kb(size).padStart(8)}`);
console.log(`  ${'合计'.padEnd(22)} ${kb(total).padStart(8)}`);
console.log(
  `\n首屏仅需 atlas.stats.js + atlas.core.js（${kb(firstScreen)}），`
  + `相比全量 ${kb(total)} 减少 ${Math.round((1 - firstScreen / total) * 100)}%`,
);