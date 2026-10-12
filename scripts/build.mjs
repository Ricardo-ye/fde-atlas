#!/usr/bin/env node
/**
 * ����������ʵ���� + �������ִ�������������ֲ���أ���
 *
 * ������ƣ�
 *   dist/atlas.stats.js      ͳ����Ϣ�������Թ��ã���С
 *   dist/atlas.core.js       �������� ���� ��Ƭ�ֶ� + case_summary + ����
 *   dist/atlas.search.zh.js  ������ ���� �û��״�����������ʱ����
 *   dist/atlas.detail.zh.js  ����� ���� �򿪵���ʱ�������
 *   dist/atlas.*.en.js       Ӣ�Ķ�Ӧ���㣬�л�����ʱ�ż���
 *
 * �ֲ�����ݣ�ʵ�� 127 ���������ݵ�����ֲ�����
 *   ��Ƭ�ֶ� 53KB + case_summary 21KB  = 74KB��ռȫ�� 18%���� ����ֻ����Щ
 *   �����ֶ� 216 KB��ռ 54%��           �� ֻ���������ʱ����Ҫ
 *   ����Ϊ�����ֶ�                      �� �����������
 *
 * ÿ�㶼�� .js �ҵ� window �����ռ���� .json��
 *   �ȱ���"����Ҫ����������"���ص㣬Ҳ���� fetch �� file:// �µ� CORS ���⡣
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

/** ������Ƭ����ı����ֶΡ� */
const CARD_FIELDS = [
  'id', 'company', 'industry', 'industry_group', 'scenario', 'source',
  'fde', 'fde_relation', 'maturity', 'maturity_stage', 'evidence_level',
  'url', 'technical_reference', 'case_summary',
];

/** �������ֶΣ�ֻ���û�����������ʱ���ء� */
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
  const content = `/* �� scripts/build.mjs ���ɣ�${comment}���������ָġ�npm run build */\n`
    + `window.${globalName} = ${JSON.stringify(payload)};\n`;
  fs.writeFileSync(path.join(root, 'dist', name), content);
  const bytes = Buffer.byteLength(content, 'utf8');
  built.push([name, bytes]);
  return bytes;
};

write('atlas.stats.js', 'ͳ��', 'FDE_ATLAS_STATS', {
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

  write(`atlas.core${suffix}.js`, `���� ${locale}`, `FDE_ATLAS_CORE${suffix ? '_EN' : ''}`, {
    locale,
    version,
    dimensions: DIMENSIONS,
    evidence_levels: EVIDENCE_LEVELS,
    directness: dirTable,
    cases: records.map((record) => ({ ...pick(record, CARD_FIELDS), detail: detailOf(record) })),
  });

  write(`atlas.search${suffix}.js`, `���� ${locale}`, `FDE_ATLAS_SEARCH_${upper}`, {
    ids: records.map((r) => r.id),
    fields: records.map((record) => pick(record, SEARCH_FIELDS)),
  });

  write(`atlas.detail${suffix}.js`, `���� ${locale}`, `FDE_ATLAS_DETAIL_${upper}`,
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

console.log('������ɣ��ֲ���أ���');
for (const [name, size] of built) console.log(`  ${name.padEnd(24)} ${kb(size).padStart(8)}`);
console.log(`  ${'�ϼ�'.padEnd(22)} ${kb(total).padStart(8)}`);
console.log(
  `\n�������� atlas.stats.js + atlas.core.js��${kb(firstScreen)}����`
  + `���ȫ�� ${kb(total)} ���� ${Math.round((1 - firstScreen / total) * 100)}%`,
);