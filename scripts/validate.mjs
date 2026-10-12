#!/usr/bin/env node
/**
 * ͳһУ�� + ������ڡ�
 *
 * ������� build-data.mjs �ĸĽ���
 *   1. �����������errors / warnings / info������ּ���ȷ�����ٻ���һ��
 *   2. �ṹԼ������ data/case.schema.json + ������У������������д�ظ�һ�飻
 *   3. ���ֶ�һ���Թ�������ɲ㣨rule-* ���������ɵ������ԣ�
 *   4. ����ģ�廯��⣺������ 14 �� architecture ��ȫ�ظ������һ���ظ� 14 �Σ�
 *      ���ﰴ DUPLICATE_BLOCK_THRESHOLD ��ɹ����澯��
 *   5. �����ֶΣ�detail_*���ڹ����ڼ��㲢д�� dist/manifest.json��
 *      ��ʵ���� cases.json �ﲻ�������֣��Ӹ�������"�������"�����
 *   6. ˫��У���"����+ID˳��"����Ϊ���ֶ�������ǿռ�顣
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SchemaValidator } from './lib/schema-validator.mjs';
import { calculateDetail, resolveTechnicalReference } from '../src/core/rubric.js';
import {
  DIMENSIONS,
  DIMENSION_KEYS,
  EVIDENCE_LEVELS,
  DIRECTNESS_LEVELS,
  DETAIL_LEVEL_KEYS,
  DUPLICATE_BLOCK_THRESHOLD,
} from '../src/core/taxonomy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

const DATAWHALE_PDF = 'https://assets.datawhale.cn/Datawhale%20FDE%E6%A1%88%E4%BE%8B100.pdf#page=';
const DERIVED_FIELDS = [
  'detail_score',
  'detail_level',
  'detail_label',
  'detail_dimensions',
  'missing_details',
  'evidence_label',
];

const errors = [];
const warnings = [];
const info = [];

/* ------------------------------------------------------------------ *
 * ����㣺������¼�Ŀ��ֶ�һ����
 * ------------------------------------------------------------------ */

const ruleStableId = (item, label) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.id)) {
    errors.push(`${label}: id ������Сд�̺��߷ֶθ�ʽ`);
    return;
  }
  // ����� ID��openai-034������գ����� ID��enterprise-bayer-prince-001��
  // �Խ����Ը�ǿ���������Ѻá����ֶ����ܣ����������ߡ�
  if (/^[a-z]+-\d{3}$/.test(item.id)) {
    info.push(`${label}: ʹ�ô���� id������������ȷ���ƽ��鲹��������Ա�����`);
  }
};

const ruleNoDerivedFields = (item, label) => {
  const present = DERIVED_FIELDS.filter((field) => field in item);
  if (present.length) {
    errors.push(`${label}: ��ʵ�����в�Ӧ���������ֶ� ${present.join(', ')}�������ɹ����ڼ��㣩`);
  }
};

const ruleEvidenceLevel = (item, label) => {
  if (!(item.evidence_level in EVIDENCE_LEVELS)) {
    errors.push(`${label}: evidence_level ������ ${Object.keys(EVIDENCE_LEVELS).join('/')} ֮һ`);
    return;
  }
  // directness �� evidence_level ����һ�¡�
  // ��������У�������ԭ�ȶ� evidence_label �Ĵ�Ǽ�� ����
  // ������������������� 14 �����ɴ�ǣ�ֻ�ܲ��������澯��
  const directness = item.source_record?.directness;
  const expectedLevel = DIRECTNESS_LEVELS[directness];
  if (!expectedLevel) {
    errors.push(`${label}: source_record.directness��${directness}�������ܿشʱ���`);
  } else if (expectedLevel !== item.evidence_level) {
    errors.push(
      `${label}: directness��${directness}����Ӧ ${expectedLevel} ������ evidence_level ${item.evidence_level} ��ͻ`,
    );
  }
};

const ruleTechnicalReference = (item, label, detail) => {
  if (item.technical_reference === undefined) return;
  if (typeof item.technical_reference !== 'boolean') {
    errors.push(`${label}: technical_reference �����ǲ���ֵ`);
    return;
  }
  if (!item.technical_reference) return;
  if (detail.detail_dimensions.technical_workflow !== 2) {
    errors.push(`${label}: ���������ο������� technical_workflow ��������`);
  }
  if (item.analysis_boundary?.architecture === '������Ϣ��༭���ݻ��') {
    errors.push(`${label}: ���������ο��������ܽ����ݱ༭���ݱ��`);
  }
};

const ruleSourceLedger = (item, label) => {
  if (item.source_record?.url !== item.url) {
    errors.push(`${label}: �� url �� source_record.url ��һ��`);
  }
  if (item.source_record?.independently_verified === true && !item.additional_sources?.length) {
    warnings.push(`${label}: ���Ϊ�������鵫û�в�����Դ���޷����渴��`);
  }
  const ids = new Set([item.url, ...(item.additional_sources || []).map((s) => s.url)]);
  if (ids.size < (item.additional_sources || []).length + 1) {
    warnings.push(`${label}: ������Դ������Դ�����ظ�����`);
  }
};

const ruleDatawhalePdf = (item, label) => {
  if (item.source !== 'Datawhale') return;
  if (!item.url.startsWith(DATAWHALE_PDF)) {
    errors.push(`${label}: Datawhale ����Դ����ָ��ٷ� PDF �ľ���ҳ��`);
  }
  const { pdf_page: pdfPage, printed_page: printedPage } = item.source_record || {};
  if (!Number.isInteger(pdfPage) || !Number.isInteger(printedPage)) {
    errors.push(`${label}: Datawhale ���������¼ pdf_page �� printed_page`);
  } else if (pdfPage !== printedPage + 1) {
    errors.push(`${label}: PDF ����ҳ��Ӧ��ӡˢҳ��� 1�����治��ţ�`);
  }
  if (!(item.additional_sources || []).some((s) => s.url.startsWith('https://fde100.datawhale.cn/cases/'))) {
    errors.push(`${label}: Datawhale ���������ڲ�����Դ�б���ԭ��������ҳ`);
  }
};

const ruleNotOverstated = (item, label) => {
  // �ѱ��"�ܹ�Ϊ���༭����"�Ͳ�Ӧͬʱ���Ƽ��������ο�
  if (
    item.analysis_boundary?.architecture === '������Ϣ��༭���ݻ��' &&
    item.evidence_level === 'A' &&
    !item.verification_notes?.some((note) => note.includes('����'))
  ) {
    warnings.push(`${label}: �ܹ���ע���༭���ݣ��������¼δ��ʾ���ݲ���`);
  }
};

/* ------------------------------------------------------------------ *
 * ���ϲ����
 * ------------------------------------------------------------------ */

const ruleUniqueIds = (cases) => {
  const seen = new Map();
  cases.forEach((item, index) => {
    if (seen.has(item.id)) {
      errors.push(`#${index + 1} ${item.id}: id �� #${seen.get(item.id) + 1} �ظ�`);
    } else {
      seen.set(item.id, index);
    }
  });
};

const ruleDatawhaleSourceCount = (cases) => {
  const official = cases.filter((item) => item.source === 'Datawhale')
    .filter((item) => item.url.startsWith(DATAWHALE_PDF));
  if (official.length && official.length !== cases.filter((i) => i.source === 'Datawhale').length) {
    errors.push(`Datawhale ������ ${cases.filter((i) => i.source === 'Datawhale').length} �������� ${official.length} ��ָ��ٷ� PDF`);
  }
};

/** ģ�廯��⣺ͬһ�μ������������������������á� */
const ruleNoTemplatedBlocks = (cases) => {
  for (const field of ['architecture', 'fde_actions', 'reusable']) {
    const groups = new Map();
    cases.forEach((item) => {
      const key = JSON.stringify(item[field] || []);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item.id);
    });
    for (const [key, ids] of groups) {
      if (ids.length >= DUPLICATE_BLOCK_THRESHOLD) {
        warnings.push(
          `�ֶ� ${field} �� ${ids.length} ������������ȫ��ͬ��${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ' ��' : ''}��������ģ�����`,
        );
      }
    }
  }
};

/** �������ӱ����స������ �� �޷���λ�����������ϡ� */
const ruleNoLinkFarming = (cases) => {
  const usage = new Map();
  for (const item of cases) usage.set(item.url, (usage.get(item.url) || 0) + 1);
  for (const [url, count] of usage) {
    if (count >= DUPLICATE_BLOCK_THRESHOLD) {
      warnings.push(`��Դ���ӱ� ${count} ���������ã�Ӧ�滻Ϊ�����������ӣ�${url}`);
    }
  }
};

const ruleBilingualParity = (zh, en) => {
  if (zh.length !== en.length) {
    errors.push(`��Ӣ�İ���������һ�£�${zh.length} / ${en.length}`);
    return;
  }
  const zhIds = zh.map((i) => i.id);
  const enIds = en.map((i) => i.id);
  if (JSON.stringify(zhIds) !== JSON.stringify(enIds)) {
    errors.push('��Ӣ�İ��� ID ��˳��һ�£�Ӣ��ҳ���� ID ������������');
    return;
  }
  const mirroredFields = ['company', 'scenario', 'problem', 'solution', 'human', 'result', 'case_summary'];
  const idMismatch = new Set();
  zh.forEach((item, index) => {
    const mirror = en[index];
    for (const field of mirroredFields) {
      const zhValue = String(item[field] ?? '').trim();
      const enValue = String(mirror[field] ?? '').trim();
      if (!enValue) errors.push(`#${index + 1} ${item.id}: Ӣ���ֶ� ${field} Ϊ��`);
      else if (zhValue === enValue && field !== 'scenario') idMismatch.add(field);
    }
    if (Array.isArray(item.architecture) && item.architecture.length !== (mirror.architecture || []).length) {
      warnings.push(`#${index + 1} ${item.id}: ��Ӣ�� architecture ������һ�£�${item.architecture.length} / ${(mirror.architecture || []).length}��`);
    }
  });
  if (idMismatch.size) {
    warnings.push(`��Ӣ��������ȫ��ͬ���ֶΣ�${[...idMismatch].join(', ')}��������©����`);
  }
};

/* ------------------------------------------------------------------ *
 * ������
 * ------------------------------------------------------------------ */

const schema = readJson('data/case.schema.json');
const recordSchema = { $defs: schema.$defs, $ref: '#/$defs/case' };

const zhCases = readJson('data/cases.json');
const enCases = readJson('data/cases.en.json');

/**
 * У���������飨schema ���ڵ㼴type: array����
 * ����·����������� ID������ֱ�Ӷ�λ�� cases.json �ĵڼ�����
 */
const validateArray = (records, label) =>
  new SchemaValidator(schema).validate(records, { basePath: label });

errors.push(...validateArray(zhCases, 'cases.json'));
errors.push(...validateArray(enCases, 'cases.en.json'));

// 2) ��¼�㣺���ֶι��� + ��������
const manifest = zhCases.map((item, index) => {
  const label = `#${index + 1} ${item.id || '(�� id)'}`;
  ruleStableId(item, label);
  ruleNoDerivedFields(item, label);
  ruleEvidenceLevel(item, label);
  ruleSourceLedger(item, label);
  ruleDatawhalePdf(item, label);
  ruleNotOverstated(item, label);

  const detail = calculateDetail(item);
  ruleTechnicalReference(item, label, detail);

  return {
    id: item.id,
    detail_score: detail.detail_score,
    detail_level: detail.detail_level,
    detail_dimensions: detail.detail_dimensions,
    missing_details: detail.missing_details,
  };
});

// 3) ���ϲ�
ruleUniqueIds(zhCases);
ruleDatawhaleSourceCount(zhCases);
ruleNoTemplatedBlocks(zhCases);
ruleNoLinkFarming(zhCases);
ruleBilingualParity(zhCases, enCases);

/* ------------------------------------------------------------------ *
 * ����
 * ------------------------------------------------------------------ */

const tally = (records, pick) =>
  records.reduce((acc, item) => {
    const key = pick(item);
    if (key !== undefined) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const manifestPayload = {
  generated_from: 'data/cases.json',
  total: zhCases.length,
  by_detail_level: tally(manifest, (m) => m.detail_level),
  by_evidence_level: tally(zhCases, (c) => c.evidence_level),
  by_industry_group: tally(zhCases, (c) => c.industry_group),
  by_source: tally(zhCases, (c) => c.source),
  by_maturity_stage: tally(zhCases, (c) => c.maturity_stage),
  technical_reference_count: zhCases.filter((c) => c.technical_reference === true).length,
  independently_verified_count: zhCases.filter((c) => c.source_record?.independently_verified === true).length,
  dimensions: DIMENSIONS,
  detail_level_keys: DETAIL_LEVEL_KEYS,
  cases: manifest,
};

const emit = (title, list) => {
  if (!list.length) return;
  console.error(`\n${title}��${list.length} ���`);
  for (const line of list) console.error(`  - ${line}`);
};

if (errors.length) {
  console.error(`У��ʧ�ܣ�${errors.length} �����${warnings.length} ���`);
  emit('����', errors);
  emit('����', warnings);
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'dist', 'manifest.json'),
  `${JSON.stringify(manifestPayload, null, 2)}\n`,
);

console.log(`У��ͨ����${zhCases.length} ��������������ʵԴ + Ӣ�ľ���`);
console.log(`  ��ϸ�ȷֲ�     ${JSON.stringify(manifestPayload.by_detail_level)}`);
console.log(`  ֤�ݵȼ�       ${JSON.stringify(manifestPayload.by_evidence_level)}`);
console.log(`  ���������ο�   ${manifestPayload.technical_reference_count} ��`);
console.log(`  ��������       ${manifestPayload.independently_verified_count} ��`);
console.log(`  ��д��         dist/manifest.json����������ά���֣�`);
emit('����', warnings);
if (info.length) emit('��ʾ', info);