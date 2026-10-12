#!/usr/bin/env node
/**
 * 统一校验 + 构建入口。
 *
 * 相比上游 build-data.mjs 的改进：
 *   1. 分三层输出：errors / warnings / info，问题分级明确，不再混在一起；
 *   2. 结构约束交给 data/case.schema.json + 零依赖校验器，不再手写重复一遍；
 *   3. 跨字段一致性规则独立成层（rule-* 函数），可单独测试；
 *   4. 新增模板化检测：上游有 14 组 architecture 完全重复，最大一组重复 14 次，
 *      这里按 DUPLICATE_BLOCK_THRESHOLD 变成构建告警；
 *   5. 派生字段（detail_*）在构建期计算并写入 dist/manifest.json，
 *      事实数据 cases.json 里不允许出现，从根上消除"分类过期"类错误；
 *   6. 双语校验从"数量+ID顺序"升级为逐字段类型与非空检查。
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
 * 规则层：单条记录的跨字段一致性
 * ------------------------------------------------------------------ */

const ruleStableId = (item, label) => {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.id)) {
    errors.push(`${label}: id 必须是小写短横线分段格式`);
    return;
  }
  // 纯序号 ID（openai-034）最紧凑；语义 ID（enterprise-bayer-prince-001）
  // 自解释性更强、对引用友好。两种都接受，但鼓励后者。
  if (/^[a-z]+-\d{3}$/.test(item.id)) {
    info.push(`${label}: 使用纯序号 id，若案例有明确名称建议补充语义段以便引用`);
  }
};

const ruleNoDerivedFields = (item, label) => {
  const present = DERIVED_FIELDS.filter((field) => field in item);
  if (present.length) {
    errors.push(`${label}: 事实数据中不应出现派生字段 ${present.join(', ')}（它们由构建期计算）`);
  }
};

const ruleEvidenceLevel = (item, label) => {
  if (!(item.evidence_level in EVIDENCE_LEVELS)) {
    errors.push(`${label}: evidence_level 必须是 ${Object.keys(EVIDENCE_LEVELS).join('/')} 之一`);
    return;
  }
  // directness 与 evidence_level 必须一致。
  // 这条交叉校验替代了原先对 evidence_label 的措辞检查 ——
  // 后者曾在数据里积累了 14 种自由措辞，只能产出噪音告警。
  const directness = item.source_record?.directness;
  const expectedLevel = DIRECTNESS_LEVELS[directness];
  if (!expectedLevel) {
    errors.push(`${label}: source_record.directness「${directness}」不在受控词表内`);
  } else if (expectedLevel !== item.evidence_level) {
    errors.push(
      `${label}: directness「${directness}」对应 ${expectedLevel} 级，与 evidence_level ${item.evidence_level} 冲突`,
    );
  }
};

const ruleTechnicalReference = (item, label, detail) => {
  if (item.technical_reference === undefined) return;
  if (typeof item.technical_reference !== 'boolean') {
    errors.push(`${label}: technical_reference 必须是布尔值`);
    return;
  }
  if (!item.technical_reference) return;
  if (detail.detail_dimensions.technical_workflow !== 2) {
    errors.push(`${label}: 技术方案参考案例的 technical_workflow 必须满分`);
  }
  if (item.analysis_boundary?.architecture === '公开信息与编辑推演混合') {
    errors.push(`${label}: 技术方案参考案例不能仅依据编辑推演标记`);
  }
};

const ruleSourceLedger = (item, label) => {
  if (item.source_record?.url !== item.url) {
    errors.push(`${label}: 主 url 与 source_record.url 不一致`);
  }
  if (item.source_record?.independently_verified === true && !item.additional_sources?.length) {
    warnings.push(`${label}: 标记为独立核验但没有补充来源，无法交叉复核`);
  }
  const ids = new Set([item.url, ...(item.additional_sources || []).map((s) => s.url)]);
  if (ids.size < (item.additional_sources || []).length + 1) {
    warnings.push(`${label}: 补充来源与主来源存在重复链接`);
  }
};

const ruleDatawhalePdf = (item, label) => {
  if (item.source !== 'Datawhale') return;
  if (!item.url.startsWith(DATAWHALE_PDF)) {
    errors.push(`${label}: Datawhale 主来源必须指向官方 PDF 的具体页码`);
  }
  const { pdf_page: pdfPage, printed_page: printedPage } = item.source_record || {};
  if (!Number.isInteger(pdfPage) || !Number.isInteger(printedPage)) {
    errors.push(`${label}: Datawhale 案例必须记录 pdf_page 与 printed_page`);
  } else if (pdfPage !== printedPage + 1) {
    errors.push(`${label}: PDF 物理页码应比印刷页码大 1（封面不编号）`);
  }
  if (!(item.additional_sources || []).some((s) => s.url.startsWith('https://fde100.datawhale.cn/cases/'))) {
    errors.push(`${label}: Datawhale 案例必须在补充来源中保留原单案例网页`);
  }
};

const ruleNotOverstated = (item, label) => {
  // 已标记"架构为纯编辑推演"就不应同时声称技术方案参考
  if (
    item.analysis_boundary?.architecture === '公开信息与编辑推演混合' &&
    item.evidence_level === 'A' &&
    !item.verification_notes?.some((note) => note.includes('推演'))
  ) {
    warnings.push(`${label}: 架构标注含编辑推演，但核验记录未提示推演部分`);
  }
};

/* ------------------------------------------------------------------ *
 * 集合层规则
 * ------------------------------------------------------------------ */

const ruleUniqueIds = (cases) => {
  const seen = new Map();
  cases.forEach((item, index) => {
    if (seen.has(item.id)) {
      errors.push(`#${index + 1} ${item.id}: id 与 #${seen.get(item.id) + 1} 重复`);
    } else {
      seen.set(item.id, index);
    }
  });
};

const ruleDatawhaleSourceCount = (cases) => {
  const official = cases.filter((item) => item.source === 'Datawhale')
    .filter((item) => item.url.startsWith(DATAWHALE_PDF));
  if (official.length && official.length !== cases.filter((i) => i.source === 'Datawhale').length) {
    errors.push(`Datawhale 案例共 ${cases.filter((i) => i.source === 'Datawhale').length} 条，其中 ${official.length} 条指向官方 PDF`);
  }
};

/** 模板化检测：同一段技术工作流被多少条案例复用。 */
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
          `字段 ${field} 有 ${ids.length} 条案例内容完全相同（${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ' 等' : ''}），疑似模板填充`,
        );
      }
    }
  }
};

/** 单条链接被过多案例复用 → 无法定位到案例级材料。 */
const ruleNoLinkFarming = (cases) => {
  const usage = new Map();
  for (const item of cases) usage.set(item.url, (usage.get(item.url) || 0) + 1);
  for (const [url, count] of usage) {
    if (count >= DUPLICATE_BLOCK_THRESHOLD) {
      warnings.push(`来源链接被 ${count} 条案例复用，应替换为案例级深链接：${url}`);
    }
  }
};

const ruleBilingualParity = (zh, en) => {
  if (zh.length !== en.length) {
    errors.push(`中英文案例数量不一致：${zh.length} / ${en.length}`);
    return;
  }
  const zhIds = zh.map((i) => i.id);
  const enIds = en.map((i) => i.id);
  if (JSON.stringify(zhIds) !== JSON.stringify(enIds)) {
    errors.push('中英文案例 ID 或顺序不一致（英文页依赖 ID 对齐做导航）');
    return;
  }
  const mirroredFields = ['company', 'scenario', 'problem', 'solution', 'human', 'result', 'case_summary'];
  const idMismatch = new Set();
  zh.forEach((item, index) => {
    const mirror = en[index];
    for (const field of mirroredFields) {
      const zhValue = String(item[field] ?? '').trim();
      const enValue = String(mirror[field] ?? '').trim();
      if (!enValue) errors.push(`#${index + 1} ${item.id}: 英文字段 ${field} 为空`);
      else if (zhValue === enValue && field !== 'scenario') idMismatch.add(field);
    }
    if (Array.isArray(item.architecture) && item.architecture.length !== (mirror.architecture || []).length) {
      warnings.push(`#${index + 1} ${item.id}: 中英文 architecture 步数不一致（${item.architecture.length} / ${(mirror.architecture || []).length}）`);
    }
  });
  if (idMismatch.size) {
    warnings.push(`中英文内容完全相同的字段：${[...idMismatch].join(', ')}（可能是漏翻）`);
  }
};

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

const schema = readJson('data/case.schema.json');
const recordSchema = { $defs: schema.$defs, $ref: '#/$defs/case' };

const zhCases = readJson('data/cases.json');
const enCases = readJson('data/cases.en.json');

/**
 * 校验整个数组（schema 根节点即type: array），
 * 错误路径带上序号与 ID，便于直接定位到 cases.json 的第几条。
 */
const validateArray = (records, label) =>
  new SchemaValidator(schema).validate(records, { basePath: label });

errors.push(...validateArray(zhCases, 'cases.json'));
errors.push(...validateArray(enCases, 'cases.en.json'));

// 2) 记录层：跨字段规则 + 派生计算
const manifest = zhCases.map((item, index) => {
  const label = `#${index + 1} ${item.id || '(无 id)'}`;
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

// 3) 集合层
ruleUniqueIds(zhCases);
ruleDatawhaleSourceCount(zhCases);
ruleNoTemplatedBlocks(zhCases);
ruleNoLinkFarming(zhCases);
ruleBilingualParity(zhCases, enCases);

/* ------------------------------------------------------------------ *
 * 产出
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
  console.error(`\n${title}（${list.length} 项）：`);
  for (const line of list) console.error(`  - ${line}`);
};

if (errors.length) {
  console.error(`校验失败：${errors.length} 项错误，${warnings.length} 项警告`);
  emit('错误', errors);
  emit('警告', warnings);
  process.exit(1);
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'dist', 'manifest.json'),
  `${JSON.stringify(manifestPayload, null, 2)}\n`,
);

console.log(`校验通过：${zhCases.length} 条案例（中文事实源 + 英文镜像）`);
console.log(`  详细度分布     ${JSON.stringify(manifestPayload.by_detail_level)}`);
console.log(`  证据等级       ${JSON.stringify(manifestPayload.by_evidence_level)}`);
console.log(`  技术方案参考   ${manifestPayload.technical_reference_count} 条`);
console.log(`  独立核验       ${manifestPayload.independently_verified_count} 条`);
console.log(`  已写出         dist/manifest.json（含逐条六维评分）`);
emit('警告', warnings);
if (info.length) emit('提示', info);