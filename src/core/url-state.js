/**
 * URL ״̬ͬ����
 *
 * ��ɸѡ����ӳ�䵽 query string���ô���������
 *   1. ɸѡ�������ֱ�ӷ�����"��� + ���� + A��" �Ǹ��������״̬����
 *   2. �����ǰ��/�����ܻص���һ��ɸѡ��
 *   3. ҳ��ˢ�º�״̬������
 *
 * Լ����
 *   - ֻ�ѷ�Ĭ��ֵд�� URL���������Ӷ̣�
 *   - д���� replaceState ������Ⱦ��ʷջ���������������ʲ��ò�����ʮ����ʷ����
 *     ��ɸѡ��������� pushState����"���˻ص���һ��ɸѡ"����ֱ����
 */

import { DEFAULT_FILTERS } from './search.js';

/** ɸѡ�ֶ� �� URL ���������������������ӳ��ȣ��� */
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

/** �� location.search ������ɸѡ״̬������δ֪������ */
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
 * ��ɸѡ״̬���л�Ϊ query string��
 * ��ֵ��Ĭ��ֵ��д�룬���� "?q=&d=" �����������ӡ�
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

/** ��ǰ��Ч��ɸѡ������������ʾ"�� N ��ɸѡ"���� */
export const countActive = (filters) =>
  Object.keys(PARAMS).filter((key) => {
    const value = filters[key];
    return value !== undefined && value !== null && value !== '' && value !== false;
  }).length;

/**
 * ��״̬д���ַ����
 * @param {object} filters
 * @param {'push'|'replace'} mode
 */
export const syncUrl = (filters, mode = 'replace') => {
  if (typeof history === 'undefined' || !history.replaceState) return;
  const url = `${location.pathname}${writeToUrl(filters)}`;
  // ͬ URL ���ظ�д�룬�������������ʷ��¼
  if (url === `${location.pathname}${location.search}`) return;
  if (mode === 'push') history.pushState(null, '', url);
  else history.replaceState(null, '', url);
};

/** ���������ǰ��/���ˡ� */
export const onUrlChange = (handler) => {
  if (typeof addEventListener === 'undefined') return () => {};
  const listener = () => handler(readFromUrl());
  addEventListener('popstate', listener);
  return () => removeEventListener('popstate', listener);
};