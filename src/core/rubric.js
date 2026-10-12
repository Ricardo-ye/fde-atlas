/**
 * 六维详细度评分引擎。
 *
 * 单一实现，Node 构建期与浏览器端共用同一份代码 ——
 * 浏览器里展示的维度分数和构建时写进 manifest 的是同一个函数算出来的，
 * 不存在"页面上写死的标签"和"数据里的分数"对不上的可能。
 *
 * 评分是纯函数：只读 case，不改 case。
 */

import { DETAIL_THRESHOLDS, DIMENSION_KEYS } from './taxonomy.js';

/**
 * 结果数字是否可定位。
 *
 * 注意：中文正文里写"提升 30%"、"节省 12 万美元"都应命中；
 * 而"数十个团队"这类模糊表述不应命中 —— 数字必须是紧邻单位或紧邻货币符号。
 */
const QUANTIFIED = /(?:\d[\d,.]*\s*(?:%|倍|万|亿|小时|分钟|天|周|月|年|人|家|个|条|美元|英镑|欧元|新元|SGD|USD|M|B)|[$€£]\s*\d)/i;

/** 按码点长度打分：full 满分、partial 半分、其余 0 分。 */
const lengthScore = (value, full, partial) => {
  const length = [...String(value ?? '').trim()].length;
  if (length >= full) return 2;
  if (length >= partial) return 1;
  return 0;
};

const arrayLength = (value) => (Array.isArray(value) ? value.length : 0);

/**
 * 技术工作流：要求能还原数据→检索/推理→规则→系统→反馈的链路。
 * 满分要求 architecture ≥6 步且 components ≥5 项 —— 只有层没有组件，
 * 或者只有组件没有链路，都不足以说明别人能照着复现。
 */
const technicalWorkflow = (item) => {
  const architecture = arrayLength(item.architecture);
  const components = arrayLength(item.components);
  if (architecture >= 6 && components >= 5) return 2;
  if (architecture >= 4) return 1;
  return 0;
};

/** 人机与治理：既要说清人的责任，也要说清落地后的治理动作。 */
const humanGovernance = (item) => {
  const humanLength = [...String(item.human ?? '')].length;
  const actions = arrayLength(item.fde_actions);
  if (humanLength >= 35 && actions >= 5) return 2;
  if (humanLength >= 18) return 1;
  return 0;
};

/** 量化结果：有可核对数字得满分，只有定性描述得 1 分。 */
const measuredOutcome = (item) => {
  const result = String(item.result ?? '');
  if (QUANTIFIED.test(result)) return 2;
  return result.trim().length >= 20 ? 1 : 0;
};

/** 来源可定位性直接由证据等级映射，等级语义见 taxonomy.js。 */
const sourceTraceability = (item) => {
  if (item.evidence_level === 'A') return 2;
  if (item.evidence_level === 'B' || item.evidence_level === 'C') return 1;
  return 0;
};

const SCORERS = Object.freeze({
  business_context: (item) => lengthScore(item.problem, 50, 25),
  solution_workflow: (item) => lengthScore(item.solution, 60, 30),
  technical_workflow: technicalWorkflow,
  human_governance: humanGovernance,
  measured_outcome: measuredOutcome,
  source_traceability: sourceTraceability,
});

/**
 * 计算一条案例的详细度。
 * @returns {{detail_score:number, detail_level:string, detail_dimensions:Record<string,number>, missing_details:string[]}}
 */
export const calculateDetail = (item) => {
  const dimensions = {};
  for (const key of DIMENSION_KEYS) dimensions[key] = SCORERS[key](item);

  const score = DIMENSION_KEYS.reduce((sum, key) => sum + dimensions[key], 0);
  const level =
    score >= DETAIL_THRESHOLDS.deep ? 'deep'
      : score >= DETAIL_THRESHOLDS.standard ? 'standard'
        : 'overview';

  return {
    detail_score: score,
    detail_level: level,
    detail_dimensions: dimensions,
    missing_details: DIMENSION_KEYS.filter((key) => dimensions[key] < 2),
  };
};

/**
 * 判断某案例是否够格标为"技术方案参考"。
 *
 * 沿用上游的两条硬条件（技术工作流满分、架构不是纯编辑推演），
 * 额外加一条：必须至少有一条案例级来源 —— 没有可定位来源的"技术方案"不可复核。
 */
export const resolveTechnicalReference = (item, detail) => {
  if (item.technical_reference !== true) return false;
  const supported =
    detail.detail_dimensions.technical_workflow === 2 &&
    item.analysis_boundary?.architecture !== '公开信息与编辑推演混合' &&
    Boolean(item.source_record?.url);
  if (!supported) {
    throw new Error(
      `technical_reference=true 但不满足条件（需 technical_workflow=2、架构非纯推演、有 source_record.url）：${item.id}`,
    );
  }
  return true;
};