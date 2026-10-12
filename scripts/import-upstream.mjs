#!/usr/bin/env node
/**
 * ����Ǩ�ƽű���һ���ԣ���
 *
 * ������ FDE-case-library ���밸��������ȫ�������ֶΡ�
 *
 * ΪʲôҪ���룺
 *   ���ΰ� detail_score / detail_level / detail_label / detail_dimensions /
 *   missing_details ��Щ"�����ļ���ó�"���ֶ�һ��д���� cases.json��
 *   ����ÿ�θ����Ķ�Ҫ�� npm run classify:detail ��д�����ļ��������ļ�ͬʱ
 *   �е���"��ʵ"��"������"����ְ���κ�©�ܶ������¹��ڷ���
 *   ������ build-data.mjs ��ר����һ�������"��ϸ�ȷ����ѹ���"�����ף���
 *
 *   ����Ŀ����Щ�ֶ�ȫ���Ƶ������ڼ��㣬cases.json ֻ�����˹�ά������ʵ�ֶΡ�
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstreamRoot = path.resolve(root, '..', 'FDE-case-library-zip', 'FDE-case-library-main');

/** �����ֶΣ������������ڹ��������������д����ʵ���ݡ� */
const DERIVED_FIELDS = [
  'detail_score',
  'detail_level',
  'detail_label',
  'detail_dimensions',
  'missing_details',
];

/** ��Ӣ˫��ļ���֤һ�£����ﶨ����ʵ�ֶεĹ淶˳�� */
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
  throw new Error(`��Ӣ��������һ�£�${upstreamZh.length} / ${upstreamEn.length}`);
}

const zh = strip(upstreamZh);
const en = strip(upstreamEn);

fs.writeFileSync(path.join(root, 'data', 'cases.json'), `${JSON.stringify(zh, null, 2)}\n`);
fs.writeFileSync(path.join(root, 'data', 'cases.en.json'), `${JSON.stringify(en, null, 2)}\n`);

const bytes = (records) => Buffer.byteLength(JSON.stringify(records), 'utf8');
console.log(`��Ǩ�� ${zh.length} ����������/Ӣ��`);
console.log(`���������ֶΣ�${DERIVED_FIELDS.join(', ')}`);
console.log(`  data/cases.json     ${(bytes(zh) / 1024).toFixed(0)} KB`);
console.log(`  data/cases.en.json  ${(bytes(en) / 1024).toFixed(0)} KB`);