/**
 * ����������ɸѡ ���� ���������� DOM ������
 *
 * ������������ô���
 *   1. ���������Ⱦʱ����Ϊÿ�ΰ�������ƴ��ȫ�ģ�����ÿ�� render ���������ֶ�
 *      join һ�Σ�127 �� ��ÿ�ΰ��� = �ɹ۵��ظ��ַ������䣩��
 *   2. �߼����� Node ��ֱ�Ӷ��ԣ����Բ������������
 */

/** Ĭ��ɸѡ״̬�� */
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
 * ��һ�� detail �ṹ��
 *
 * ������Դ���ֶ�����ͬ������������ͳһ����������ɸѡ����
 * "�����õ����������"��"������õĹ�������"֮�������Ϊ���죺
 *   - calculateDetail() �����{ detail_score, detail_level, detail_dimensions, missing_details }
 *   - dist/atlas.data.js �У�{ score, level, dimensions, missing }
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
 * Ԥ������������ÿ������Ԥ��ƴ��һ��Сд���ļ����ı���
 * @param {Array<object>} records �ɴ� detail �ֶΣ�Ҳ��ֱ���� calculateDetail �����
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
 * ƴ�Ӽ����ı���
 *
 * ��ɶ���������Ϊ��֧�ֲַ����ݣ�core ��ֻ�п�Ƭ�ֶΣ�
 * �����㵽������� enrichIndex ��ȫ haystack ���� �����������صȼ����㡣
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
 * �ü��������ݲ�ȫ������ haystack��
 *
 * �ֲ���������Ǳ���ģ�core ���Ƚ�������֤��Ƭ���ã�
 * �����㵽λ����ñ���������Ϊȫ���������û������޸С�
 *
 * @param {Array<{record: object, detail: object, haystack: string}>} index
 * @param {{ids: string[], fields: object[]}} payload ���������
 * @returns {number} ����ȫ������
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

/** ĳ��ɸѡ�ֶ��Ƿ���Ч�����ַ��� / false ��Ϊ��ɸѡ�� */
const active = (value) => value !== '' && value !== false && value !== null && value !== undefined;

/**
 * Ӧ��ɸѡ��
 * �������֮���� AND���������ϸ�Ƚ���ͬ�ְ� id ���� ���� ��֤��ҳ��
 * "��һ������"�������κ�����˳���¶��ȶ��ɸ��֡�
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
    // ������ detail.score��normalizeDetail ���������
    // ������ detail.detail_score ���� ���� calculateDetail �ľ��ֶ�����
    // д�����÷������� NaN��NaN || x ���� fallback��
    // �������Ĭ�˻�Ϊ"ֻ�� id ��"��
    b.detail.score - a.detail.score
    || a.record.id.localeCompare(b.record.id)
  ));
};

/**
 * ����ͳ�ƣ���ɸѡ������ѡ���������
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

/** ͳ������õĻ������֡� */
export const getSummary = (records) => ({
  total: records.length,
  technical: records.filter((c) => c.technical_reference === true).length,
  deep: records.filter((c) => normalizeDetail(c).level === 'deep').length,
  evidenceA: records.filter((c) => c.evidence_level === 'A').length,
});