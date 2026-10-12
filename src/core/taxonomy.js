/**
 * �ܿشʱ���ά�ȶ��塣
 *
 * ����ļ�ͬʱ�� Node �����ű���������� import������ֻ�������ִ����ݣ�
 * ���������κ� Node ����ģ��� DOM API��
 */

/** ��ϸ�ȷּ���ֵ�� */
export const DETAIL_THRESHOLDS = Object.freeze({ deep: 10, standard: 7 });

/** ��������ά�ȣ�key �� { zh, en }��˳�򼴱����� UI �е�չʾ˳�� */
export const DIMENSIONS = Object.freeze([
  { key: 'business_context', zh: 'ҵ�񱳾�', en: 'Business context' },
  { key: 'solution_workflow', zh: '��������', en: 'Transformation workflow' },
  { key: 'technical_workflow', zh: '����������', en: 'Technical workflow' },
  { key: 'human_governance', zh: '�˻�������', en: 'Human roles & governance' },
  { key: 'measured_outcome', zh: '�������', en: 'Measured outcomes' },
  { key: 'source_traceability', zh: '��Դ�ɶ�λ��', en: 'Source traceability' },
]);

export const DIMENSION_KEYS = Object.freeze(DIMENSIONS.map((d) => d.key));

/** ֤�ݵȼ�������"��Դ�ܷ񱻶�λ����"����������ʵ�����֡� */
export const EVIDENCE_LEVELS = Object.freeze({
  A: { zh: '������ֱ����Դ', en: 'Direct case-level source' },
  B: { zh: '�ٷ�������Դ', en: 'Official aggregate source' },
  C: { zh: '���Ŷ��β���', en: 'Credible secondary material' },
  D: { zh: '����������', en: 'Lead awaiting verification' },
});

/**
 * ��Դֱ���� �� ��Ӧ��֤�ݵȼ���
 *
 * �������������ļ���ֵ���������Ķ������ ����˫�������ܹ���ͬһ��
 * schema ��ǰ�ᡣ�����Ѵʱ���д�����Ķ�����Ӣ������������
 * "Direct sources at the case level"��schema У��ֱ�ӱ���127 ������
 *
 * ��ǩ�� i18n ��������� i18n/index.js �� t.directness()��
 */
export const DIRECTNESS_LEVELS = Object.freeze({
  case_level: 'A',
  company_level: 'A',
  aggregate: 'B',
  secondary: 'C',
  lead: 'D',
});

/** ֱ����ö�ٵ����ı�ǩ��i18n ��ʹ�ã��� */
export const DIRECTNESS_ZH = Object.freeze({
  case_level: '������ֱ����Դ',
  company_level: '��ҵ��ֱ����Դ',
  aggregate: '����ҳ��స������',
  secondary: '���Ŷ��β���',
  lead: '����������',
});

/** ֱ����ö�ٵ�Ӣ�ı�ǩ�� */
export const DIRECTNESS_EN = Object.freeze({
  case_level: 'Direct case-level source',
  company_level: 'Direct company-level source',
  aggregate: 'Aggregate or multi-case report',
  secondary: 'Credible secondary material',
  lead: 'Lead awaiting verification',
});

/** ֤�ݵȼ� �� �õȼ����Ƽ���Ĭ��ֱ���ԡ� */
export const DEFAULT_DIRECTNESS = Object.freeze({
  A: 'case_level',
  B: 'aggregate',
  C: 'secondary',
  D: 'lead',
});

/** ֤�ݱ�ǩ����"A����������ֱ����Դ"����������������ֹд�����ݡ� */
export const evidenceLabel = (level, locale = 'zh') => {
  const entry = EVIDENCE_LEVELS[level];
  if (!entry) return level;
  const label = entry[locale] ?? entry.zh;
  const prefix = locale === 'zh' ? `${level}����` : `Level ${level} | `;
  return prefix + label;
};

/** ����Ƚ׶Ρ�ö�����������ܿأ���ǩ�� UI ���� i18n�� */
export const MATURITY_STAGES = Object.freeze({
  ��֤�׶�: { en: 'Validation' },
  ������: { en: 'Live' },
  ��ģ��: { en: 'Scaled' },
  �Ե�: { en: 'Pilot' },
  δ��ȷ: { en: 'Unspecified' },
});

/** ��ϸ�ȷּ��� i18n ��ǩ������ src/i18n ������ */
export const DETAIL_LEVEL_KEYS = Object.freeze({
  deep: 'detail.level.deep',
  standard: 'detail.level.standard',
  overview: 'detail.level.overview',
});

/**
 * �ظ����ݼ����ֵ��
 *
 * ���� 127 ���������� 14 �� architecture ������ȫ��ͬ�����һ���ظ� 14 �Σ���
 * ˵���൱һ����"����������"��ģ�������ǰ�������ԭ��
 * ��������ֵ������ɿɼ��Ĺ����澯�������ǲ��� AUDIT.md �����ȥ����
 */
export const DUPLICATE_BLOCK_THRESHOLD = 3;