/**
 * 受控词表与维度定义。
 *
 * 这个文件同时被 Node 构建脚本和浏览器端 import，所以只允许出现纯数据，
 * 不得引用任何 Node 内置模块或 DOM API。
 */

/** 详细度分级阈值。 */
export const DETAIL_THRESHOLDS = Object.freeze({ deep: 10, standard: 7 });

/** 六个评分维度：key → { zh, en }。顺序即报告与 UI 中的展示顺序。 */
export const DIMENSIONS = Object.freeze([
  { key: 'business_context', zh: '业务背景', en: 'Business context' },
  { key: 'solution_workflow', zh: '改造流程', en: 'Transformation workflow' },
  { key: 'technical_workflow', zh: '技术工作流', en: 'Technical workflow' },
  { key: 'human_governance', zh: '人机与治理', en: 'Human roles & governance' },
  { key: 'measured_outcome', zh: '量化结果', en: 'Measured outcomes' },
  { key: 'source_traceability', zh: '来源可定位性', en: 'Source traceability' },
]);

export const DIMENSION_KEYS = Object.freeze(DIMENSIONS.map((d) => d.key));

/** 证据等级：衡量"来源能否被定位复核"，不等于真实性评分。 */
export const EVIDENCE_LEVELS = Object.freeze({
  A: { zh: '案例级直接来源', en: 'Direct case-level source' },
  B: { zh: '官方汇总来源', en: 'Official aggregate source' },
  C: { zh: '可信二次材料', en: 'Credible secondary material' },
  D: { zh: '线索待核验', en: 'Lead awaiting verification' },
});

/**
 * 来源直接性 → 对应的证据等级。
 *
 * 键是语言中立的技术值（不是中文短语）—— 这是双语数据能共用同一份
 * schema 的前提。曾经把词表键写成中文短语，结果英文数据里存的是
 * "Direct sources at the case level"，schema 校验直接报出127 条错误。
 *
 * 标签在 i18n 层解析，见 i18n/index.js 的 t.directness()。
 */
export const DIRECTNESS_LEVELS = Object.freeze({
  case_level: 'A',
  company_level: 'A',
  aggregate: 'B',
  secondary: 'C',
  lead: 'D',
});

/** 直接性枚举的中文标签（i18n 层使用）。 */
export const DIRECTNESS_ZH = Object.freeze({
  case_level: '案例级直接来源',
  company_level: '企业级直接来源',
  aggregate: '汇总页或多案例报告',
  secondary: '可信二次材料',
  lead: '线索待核验',
});

/** 直接性枚举的英文标签。 */
export const DIRECTNESS_EN = Object.freeze({
  case_level: 'Direct case-level source',
  company_level: 'Direct company-level source',
  aggregate: 'Aggregate or multi-case report',
  secondary: 'Credible secondary material',
  lead: 'Lead awaiting verification',
});

/** 证据等级 → 该等级下推荐的默认直接性。 */
export const DEFAULT_DIRECTNESS = Object.freeze({
  A: 'case_level',
  B: 'aggregate',
  C: 'secondary',
  D: 'lead',
});

/** 证据标签（如"A级｜案例级直接来源"）——纯派生，禁止写进数据。 */
export const evidenceLabel = (level, locale = 'zh') => {
  const entry = EVIDENCE_LEVELS[level];
  if (!entry) return level;
  const label = entry[locale] ?? entry.zh;
  const prefix = locale === 'zh' ? `${level}级｜` : `Level ${level} | `;
  return prefix + label;
};

/** 成熟度阶段。枚举在数据里受控，标签在 UI 层做 i18n。 */
export const MATURITY_STAGES = Object.freeze({
  验证阶段: { en: 'Validation' },
  已上线: { en: 'Live' },
  规模化: { en: 'Scaled' },
  试点: { en: 'Pilot' },
  未明确: { en: 'Unspecified' },
});

/** 详细度分级的 i18n 标签键，由 src/i18n 解析。 */
export const DETAIL_LEVEL_KEYS = Object.freeze({
  deep: 'detail.level.deep',
  standard: 'detail.level.standard',
  overview: 'detail.level.overview',
});

/**
 * 重复内容检测阈值。
 *
 * 上游 127 条案例里有 14 组 architecture 数组完全相同（最大一组重复 14 次），
 * 说明相当一部分"技术工作流"是模板填充而非案例级还原。
 * 这里设阈值把它变成可见的构建告警，而不是藏在 AUDIT.md 里等人去看。
 */
export const DUPLICATE_BLOCK_THRESHOLD = 3;