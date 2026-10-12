#!/usr/bin/env node
/**
 * 数据迁移脚本（一次性）。
 *
 * 从上游 FDE-case-library 导入案例，剥离全部派生字段。
 *
 * 为什么要剥离：
 *   上游把 detail_score / detail_level / detail_label / detail_dimensions /
 *   missing_details 这些"由正文计算得出"的字段一起写进了 cases.json，
 *   于是每次改正文都要跑 npm run classify:detail 回写数据文件，数据文件同时
 *   承担了"事实"和"计算结果"两种职责，任何漏跑都会留下过期分类
 *   （上游 build-data.mjs 里专门有一条错误叫"详细度分类已过期"来兜底）。
 *
 *   本项目把这些字段全部移到构建期计算，cases.json 只保留人工维护的事实字段。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamRoot = path.resolve(root, '..', 'FDE-case-library-zip', 'FDE-case-library-main');

/** 派生字段：由评分引擎在构建期算出，绝不写回事实数据。 */
const DERIVED_FIELDS = [
  'detail_score',
  'detail_level',
  'detail_label',
  'detail_dimensions',
  'missing_details',
];

/** 中英双语的键序保证一致，这里定义事实字段的规范顺序。 */
const FIELD_ORDER = [
  'id',
  'source',
  'company',
  'industry',
  'industry_group',
  'scenario',
  'fde',
  'fde_relation',
  'problem',
  'solution',
  'human',
  'result',
  'maturity',
  'maturity_stage',
  'technical_reference',
  'url',
  'architecture',
  'components',
  'fde_actions',
  'reusable',
  'evidence',
  'case_summary',
  'evidence_level',
  'evidence_label',
  'source_record',
  'analysis_boundary',
  'verification_notes',
  'additional_sources',
];

const reorder = (record) => {
  const out = {};
  for (const field of FIELD_ORDER) {
    if (record[field] !== undefined) out[field] = record[field];
  }
  for (const [key, value] of Object.entries(record)) {
    if (out[key] === undefined && !DERIVED_FIELDS.includes(key)) out[key] = value;
  }
  return out;
};

const strip = (records) =>
  records.map((record) => {
    const copy = { ...record };
    for (const field of DERIVED_FIELDS) delete copy[field];
    return reorder(copy);
  });

const upstreamZh = JSON.parse(
  fs.readFileSync(path.join(upstreamRoot, 'data', 'cases.json'), 'utf8'),
);
const upstreamEn = JSON.parse(
  fs.readFileSync(path.join(upstreamRoot, 'data', 'cases.en.json'), 'utf8'),
);

if (upstreamZh.length !== upstreamEn.length) {
  throw new Error(`中英文数量不一致：${upstreamZh.length} / ${upstreamEn.length}`);
}

const zh = strip(upstreamZh);
const en = strip(upstreamEn);

fs.writeFileSync(path.join(root, 'data', 'cases.json'), `${JSON.stringify(zh, null, 2)}\n`);
fs.writeFileSync(path.join(root, 'data', 'cases.en.json'), `${JSON.stringify(en, null, 2)}\n`);

const bytes = (records) => Buffer.byteLength(JSON.stringify(records), 'utf8');
console.log(`已迁移 ${zh.length} 条案例（中/英）`);
console.log(`剥离派生字段：${DERIVED_FIELDS.join(', ')}`);
console.log(`  data/cases.json     ${(bytes(zh) / 1024).toFixed(0)} KB`);
console.log(`  data/cases.en.json  ${(bytes(en) / 1024).toFixed(0)} KB`);