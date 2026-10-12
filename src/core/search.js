/**
 * 搜索索引与筛选 —— 纯函数，无 DOM 依赖。
 *
 * 抽出来有两个好处：
 *   1. 浏览器端渲染时不再为每次按键重新拼接全文（上游每次 render 都把所有字段
 *      join 一次，127 条 ×每次按键 = 可观的重复字符串分配）；
 *   2. 逻辑可在 Node 里直接断言，测试不依赖浏览器。
 */

/** 默认筛选状态。 */
export const DEFAULT_FILTERS = Object.freeze({
  search: '',
  detailLevel: '',
  source: '',
  industryGroup: '',
  evidenceLevel: '',
  fde: '',
  maturityStage: '',
  technicalOnly: false,
});

/**
 * 归一化 detail 结构。
 *
 * 两种来源的字段名不同，必须在这里统一，否则下游筛选会在
 * "单测用的评分器输出"和"浏览器用的构建产物"之间出现行为差异：
 *   - calculateDetail() 输出：{ detail_score, detail_level, detail_dimensions, missing_details }
 *   - dist/atlas.data.js 中：{ score, level, dimensions, missing }
 */
const normalizeDetail = (record) => {
  const raw = record.detail ?? record;
  return {
    score: raw.score ?? raw.detail_score ?? 0,
    level: raw.level ?? raw.detail_level ?? 'overview',
    dimensions: raw.dimensions ?? raw.detail_dimensions ?? {},
    missing: raw.missing ?? raw.missing_details ?? [],
  };
};

/**
 * 预建搜索索引：每条案例预先拼好一份小写化的检索文本。
 * @param {Array<object>} records 可带 detail 字段，也可直接是 calculateDetail 的输出
 * @returns {Array<{record: object, detail: object, haystack: string}>}
 */
export const buildIndex = (records) =>
  records.map((record) => {
    const detail = normalizeDetail(record);
    return {
      record,
      detail,
      haystack: joinHaystack(record),
    };
  });

/**
 * 拼接检索文本。
 *
 * 拆成独立函数是为了支持分层数据：core 层只有卡片字段，
 * 检索层到达后再用 enrichIndex 补全 haystack —— 这样首屏不必等检索层。
 */
const joinHaystack = (record) => [
  record.company, record.industry, record.industry_group, record.scenario,
  record.problem, record.solution, record.fde, record.fde_relation,
  record.result, record.maturity, record.evidence,
  ...(record.architecture || []),
  ...(record.components || []),
  ...(record.fde_actions || []),
  ...(record.reusable || []),
].filter(Boolean).join(' ').toLowerCase();

/**
 * 用检索层数据补全索引的 haystack。
 *
 * 分层加载下这是必需的：core 层先建索引保证卡片可用，
 * 检索层到位后调用本函数升级为全文索引，用户几乎无感。
 *
 * @param {Array<{record: object, detail: object, haystack: string}>} index
 * @param {{ids: string[], fields: object[]}} payload 检索层产物
 * @returns {number} 被补全的条数
 */
export const enrichIndex = (index, payload) => {
  if (!payload?.ids || !Array.isArray(payload.fields)) return 0;
  const byId = new Map(index.map((entry) => [entry.record.id, entry]));
  let enriched = 0;
  payload.ids.forEach((id, position) => {
    const entry = byId.get(id);
    const fields = payload.fields[position];
    if (!entry || !fields) return;
    entry.search = fields;
    entry.haystack = joinHaystack({ ...entry.record, ...fields });
    enriched += 1;
  });
  return enriched;
};

/** 某条筛选字段是否生效。空字符串 / false 视为不筛选。 */
const active = (value) => value !== '' && value !== false && value !== null && value !== undefined;

/**
 * 应用筛选。
 * 多个条件之间是 AND；结果按详细度降序、同分按 id 升序 —— 保证翻页与
 * "下一个案例"导航在任何数据顺序下都稳定可复现。
 */
export const applyFilters = (index, filters) => {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const query = String(f.search || '').trim().toLowerCase();

  const hits = index.filter(({ record, detail, haystack }) => {
    if (query && !haystack.includes(query)) return false;
    if (active(f.detailLevel) && detail.level !== f.detailLevel) return false;
    if (active(f.source) && record.source !== f.source) return false;
    if (active(f.industryGroup) && record.industry_group !== f.industryGroup) return false;
    if (active(f.evidenceLevel) && record.evidence_level !== f.evidenceLevel) return false;
    if (active(f.fde) && record.fde !== f.fde) return false;
    if (active(f.maturityStage) && record.maturity_stage !== f.maturityStage) return false;
    if (f.technicalOnly && record.technical_reference !== true) return false;
    return true;
  });

  return hits.sort((a, b) => (
    // 必须用 detail.score（normalizeDetail 的输出），
    // 不能用 detail.detail_score —— 那是 calculateDetail 的旧字段名，
    // 写错会让分数差变成 NaN，NaN || x 恒走 fallback，
    // 结果排序静默退化为"只按 id 排"。
    b.detail.score - a.detail.score
    || a.record.id.localeCompare(b.record.id)
  ));
};

/**
 * 分面统计：给筛选器生成选项与计数。
 * @param {Array<object>} records
 */
export const getFacets = (records) => {
  const count = (pick) => records.reduce((acc, item) => {
    const key = pick(item);
    if (key) acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    bySource: count((c) => c.source),
    byIndustryGroup: count((c) => c.industry_group),
    byEvidenceLevel: count((c) => c.evidence_level),
    byFde: count((c) => c.fde),
    byMaturityStage: count((c) => c.maturity_stage),
    byDetailLevel: count((c) => normalizeDetail(c).level),
  };
};

/** 统计面板用的汇总数字。 */
export const getSummary = (records) => ({
  total: records.length,
  technical: records.filter((c) => c.technical_reference === true).length,
  deep: records.filter((c) => normalizeDetail(c).level === 'deep').length,
  evidenceA: records.filter((c) => c.evidence_level === 'A').length,
});