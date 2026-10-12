/**
 * 运行时国际化。
 *
 * 上游做法：build-english-page.mjs 用 157 条 replaceAll 从 index.html 生成
 * index.en.html。问题在于 replaceAll 静默失败 —— 改一句中文文案，对应的英文
 * 就悄悄留着中文，而 CI 只检查"页面包含某些标记"，发现不了漏翻。
 *
 * 本项目做法：单页 + 查表。语言切换只换数据源与文案，不重新生成 HTML，
 * 因此不存在"英文页与中文页不同步"这个失效模式。
 */

import { zh } from './zh.js';
import { en } from './en.js';
import { MATURITY_STAGES, EVIDENCE_LEVELS, DIRECTNESS_ZH, DIRECTNESS_EN } from '../core/taxonomy.js';

const DICTIONARIES = { zh, en };
export const LOCALES = Object.keys(DICTIONARIES);

/** 中文数据用中文词表；英文数据的 maturity_stage 已是英文字面值。 */
const STAGE_TO_KEY = Object.freeze({
  验证阶段: 'Validation',
  已上线: 'Live',
  规模化: 'Scaled',
  试点: 'Pilot',
  未明确: 'Unspecified',
});

const STAGE_LABELS = Object.freeze({
  zh: Object.fromEntries(Object.entries(MATURITY_STAGES).map(([k, v]) => [k, k])),
  en: Object.fromEntries(Object.entries(MATURITY_STAGES).map(([k, v]) => [k, v.en])),
  // 英文数据里直接就是英文值，用 STAGE_TO_KEY 反查即可
  enRaw: Object.fromEntries(
    Object.entries(MATURITY_STAGES).map(([k, v]) => [v.en, v.en]),
  ),
});

/**
 * 创建一个绑定语言的翻译函数。
 * @param {'zh'|'en'} locale
 */
export const createTranslator = (locale) => {
  const dict = DICTIONARIES[locale] ?? zh;
  const fallback = DICTIONARIES.zh;

  /** 带 {placeholder} 插值。 */
  const t = (key, vars) => {
    let value = dict[key] ?? fallback[key];
    if (value === undefined) {
      // 缺 key 是可维护性 bug（新增文案漏了英文），必须显式暴露
      if (typeof console !== 'undefined') console.warn(`[i18n] 缺少文案：${key}`);
      return key;
    }
    if (vars) {
      for (const [name, replacement] of Object.entries(vars)) {
        value = value.replaceAll(`{${name}}`, String(replacement));
      }
    }
    return value;
  };

  /** 证据等级标签。 */
  t.evidence = (level) => t(`evidence.level.${level}`) || EVIDENCE_LEVELS[level]?.zh || level;

  /**
   * 来源直接性标签。
   * 数据里存的是语言中立枚举（case_level / aggregate ...），
   * 这里解析为当前语言的短语 —— 这样中英数据可以共用同一份 schema。
   */
  t.directness = (key) => {
    const table = locale === 'zh' ? DIRECTNESS_ZH : DIRECTNESS_EN;
    return table[key] || key;
  };

  /** 成熟度标签：中文数据查词表，英文数据直接取值。 */
  t.maturity = (stage) => {
    if (locale === 'zh') return STAGE_LABELS.zh[stage] || stage;
    return STAGE_LABELS.enRaw[stage] || STAGE_LABELS.en[stage] || stage;
  };

  /** 维度分数条。 */
  t.dimension = (key) => t(`detail.dim.${key}`);

  return t;
};

/** 英文 ↔ 中文成熟度值互转（用于筛选器下拉对齐两套数据）。 */
export const normalizeStage = (stage) => STAGE_TO_KEY[stage] ?? stage;

/** 校验两个语言包的 key 是否一致（供测试使用）。 */
export const missingKeys = (locale) => {
  const base = Object.keys(zh);
  const dict = DICTIONARIES[locale];
  return base.filter((key) => !(key in dict));
};