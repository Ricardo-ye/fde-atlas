/**
 * DOM ��������ȫ HTML ת����Ԫ�ش�����
 *
 * ���а������ݶ����innerHTML�����ת�岻�ǿ�ѡ�ķ����Դ��� ����
 * ���������ⲿ��ҳժ¼������ת����ڸ�ҳ����һ�� XSS ���ӡ�
 * ������ͬ���� esc()����ɢ���� 8 ��ģ������Ｏ��һ����
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML �ı�ת�塣������ַ������մ����� */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);

/**
 * �ӿ��ŵľ�̬Ƭ�����鹹�� HTML��
 * ���÷�����֤Ƭ�α��������û����ݣ��û�����һ���ȹ� esc()��
 */
export const html = (strings, ...values) =>
  strings.reduce((acc, str, index) => acc + str + (index < values.length ? values[index] : ''), '');

/** ���� �� �����б� HTML����������˵�ռλ�İ��� */
export const renderList = (items, emptyLabel) => {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="section__body">${esc(emptyLabel)}</p>`;
  }
  return `<ul class="list">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
};

/** ���� �� ��Ų������������������ã��� */
export const renderSteps = (steps, emptyLabel) => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return `<p class="section__body">${esc(emptyLabel)}</p>`;
  }
  return `<ol class="steps">${steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>`;
};

/** ���� �� ��ǩ�ơ� */
export const renderChips = (items, emptyLabel) => {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="section__body">${esc(emptyLabel)}</p>`;
  }
  return `<div class="chips">${items.map((item) => `<span class="tag">${esc(item)}</span>`).join('')}</div>`;
};

/** �������� DOM���� DocumentFragment һ���Թ��أ�������� append ����������š� */
export const mountAll = (container, nodes) => {
  const fragment = document.createDocumentFragment();
  fragment.append(...nodes);
  container.replaceChildren(fragment);
};

/**
 * ���� <select> �� <option> �б���
 * @param {Array<[string, string, number]>} options [value, label, count]
 */
export const renderOptions = (options, allLabel) => {
  const head = `<option value="">${esc(allLabel)}</option>`;
  return head + options
    .map(([value, label, count]) => `<option value="${esc(value)}">${esc(label)} (${count})</option>`)
    .join('');
};

/** �����������������룬����ÿ�ΰ��������� 127 �ſ�Ƭ�� */
export const debounce = (fn, wait = 160) => {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
};