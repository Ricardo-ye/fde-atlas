/**
 * URL 状态同步。
 *
 * 把筛选条件映射到 query string，好处有三个：
 *   1. 筛选结果可以直接分享（"深度 + 金融 + A级" 是个有意义的状态）；
 *   2. 浏览器前进/后退能回到上一个筛选；
 *   3. 页面刷新后状态不丢。
 *
 * 约定：
 *   - 只把非默认值写入 URL，保持链接短；
 *   - 写入用 replaceState 避免污染历史栈（连续输入搜索词不该产生几十条历史），
 *     但筛选条件变更用 pushState，让"后退回到上一个筛选"符合直觉。
 */

import { DEFAULT_FILTERS } from './search.js';

/** 筛选字段 → URL 参数名（短名，减少链接长度）。 */
const PARAMS = Object.freeze({
  search: 'q',
  detailLevel: 'd',
  source: 's',
  industryGroup: 'i',
  evidenceLevel: 'e',
  fde: 'd2',
  maturityStage: 'm',
  technicalOnly: 't',
});

const REVERSE = Object.fromEntries(Object.entries(PARAMS).map(([key, param]) => [param, key]));

/** 从 location.search 解析出筛选状态，忽略未知参数。 */
export const readFromUrl = (search = globalThis.location?.search) => {
  const params = new URLSearchParams(search || '');
  const filters = { ...DEFAULT_FILTERS };
  for (const [param, key] of Object.entries(REVERSE)) {
    const value = params.get(param);
    if (value === null) continue;
    filters[key] = key === 'technicalOnly' ? value === '1' : value;
  }
  return filters;
};

/**
 * 把筛选状态序列化为 query string。
 * 空值与默认值不写入，避免 "?q=&d=" 这种噪音链接。
 */
export const writeToUrl = (filters) => {
  const params = new URLSearchParams();
  for (const [key, param] of Object.entries(PARAMS)) {
    const value = filters[key];
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (DEFAULT_FILTERS[key] === value) continue;
    params.set(param, value === true ? '1' : String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
};

/** 当前生效的筛选数量（用于提示"有 N 项筛选"）。 */
export const countActive = (filters) =>
  Object.keys(PARAMS).filter((key) => {
    const value = filters[key];
    return value !== undefined && value !== null && value !== '' && value !== false;
  }).length;

/**
 * 把状态写入地址栏。
 * @param {object} filters
 * @param {'push'|'replace'} mode
 */
export const syncUrl = (filters, mode = 'replace') => {
  if (typeof history === 'undefined' || !history.replaceState) return;
  const url = `${location.pathname}${writeToUrl(filters)}`;
  // 同 URL 不重复写入，避免无意义的历史记录
  if (url === `${location.pathname}${location.search}`) return;
  if (mode === 'push') history.pushState(null, '', url);
  else history.replaceState(null, '', url);
};

/** 订阅浏览器前进/后退。 */
export const onUrlChange = (handler) => {
  if (typeof addEventListener === 'undefined') return () => {};
  const listener = () => handler(readFromUrl());
  addEventListener('popstate', listener);
  return () => removeEventListener('popstate', listener);
};