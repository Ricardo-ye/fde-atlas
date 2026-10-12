/**
 * DOM 辅助：安全 HTML 转义与元素创建。
 *
 * 所有案例内容都会进innerHTML，因此转义不是可选的防御性代码 ——
 * 数据来自外部网页摘录，不做转义等于给页面留一个 XSS 口子。
 * 上游用同样的 esc()，但散落在 8 处模板里；这里集中一处。
 */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML 文本转义。传入非字符串按空处理。 */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);

/**
 * 从可信的静态片段数组构建 HTML。
 * 调用方负责保证片段本身不含用户数据；用户数据一律先过 esc()。
 */
export const html = (strings, ...values) =>
  strings.reduce((acc, str, index) => acc + str + (index < values.length ? values[index] : ''), '');

/** 数组 → 无序列表 HTML；空数组回退到占位文案。 */
export const renderList = (items, emptyLabel) => {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="section__body">${esc(emptyLabel)}</p>`;
  }
  return `<ul class="list">${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
};

/** 数组 → 编号步骤流（技术工作流用）。 */
export const renderSteps = (steps, emptyLabel) => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return `<p class="section__body">${esc(emptyLabel)}</p>`;
  }
  return `<ol class="steps">${steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>`;
};

/** 数组 → 标签云。 */
export const renderChips = (items, emptyLabel) => {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="section__body">${esc(emptyLabel)}</p>`;
  }
  return `<div class="chips">${items.map((item) => `<span class="tag">${esc(item)}</span>`).join('')}</div>`;
};

/** 批量插入 DOM：用 DocumentFragment 一次性挂载，避免逐个 append 触发多次重排。 */
export const mountAll = (container, nodes) => {
  const fragment = document.createDocumentFragment();
  fragment.append(...nodes);
  container.replaceChildren(fragment);
};

/**
 * 构建 <select> 的 <option> 列表。
 * @param {Array<[string, string, number]>} options [value, label, count]
 */
export const renderOptions = (options, allLabel) => {
  const head = `<option value="">${esc(allLabel)}</option>`;
  return head + options
    .map(([value, label, count]) => `<option value="${esc(value)}">${esc(label)} (${count})</option>`)
    .join('');
};

/** 防抖：用于搜索输入，避免每次按键都重排 127 张卡片。 */
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