/**
 * 应用入口：装配数据、状态、渲染与事件。
 *
 * 与上游 app 逻辑的关键差异：
 *   1. 模块化 —— 状态、筛选、渲染、弹窗、i18n 分离，各自可独立测试；
 *   2. 单一状态源 —— 所有视图从 state 派生，不存在"弹窗里的索引"和
 *      "网格里的索引"两套可能不同步的变量；
 *   3. 分层加载 —— 首屏只取卡片层（107KB），检索层与详情层按需拉取；
 *   4. URL 同步 —— 筛选条件进 query string，可分享、可前进后退；
 *   5. 运行时 i18n —— 单页双语言，不存在"英文页忘了重新生成"。
 */

import { createTranslator, missingKeys } from './i18n/index.js';
import {
  buildIndex, enrichIndex, applyFilters, getFacets, DEFAULT_FILTERS,
} from './core/search.js';
import { esc, debounce, renderOptions } from './core/dom.js';
import { renderCard, renderEmpty, renderDetail, buildSummaryText, renderSkeleton } from './views/render.js';
import { loadLayer, isReady, prefetch, mergeLayers } from './core/data-loader.js';
import { readFromUrl, syncUrl, onUrlChange, countActive } from './core/url-state.js';

const $ = (id) => document.getElementById(id);
const THEME_KEY = 'fde_atlas_theme';
const LANG_KEY = 'fde_atlas_lang';

/** 每种语言对应的三层。 */
const LAYER_SETS = {
  zh: { core: 'core', search: 'search', detail: 'detail' },
  en: { core: 'coreEn', search: 'searchEn', detail: 'detailEn' },
};

const els = {
  grid: $('grid'),
  count: $('count'),
  search: $('search'),
  searchClear: $('searchClear'),
  source: $('source'),
  industry: $('industry'),
  evidence: $('evidence'),
  fde: $('fde'),
  maturity: $('maturity'),
  detailLevel: $('detailLevel'),
  technicalOnly: $('technicalOnly'),
  resetBtn: $('resetBtn'),
  modal: $('modal'),
  modalTitle: $('modalTitle'),
  modalScenario: $('modalScenario'),
  modalCounter: $('modalCounter'),
  modalBadges: $('modalBadges'),
  modalBody: $('modalBody'),
  modalPrev: $('modalPrev'),
  modalNext: $('modalNext'),
  modalClose: $('modalClose'),
  modalCopy: $('modalCopy'),
  toast: $('toast'),
  langToggle: $('langToggle'),
  themeToggle: $('themeToggle'),
  themeLabel: $('themeLabel'),
  navCount: $('navCount'),
  heroStats: $('heroStats'),
};

/* ------------------------------------------------------------------ *
 * 状态
 * ------------------------------------------------------------------ */

const state = {
  locale: readInitialLocale(),
  theme: readInitialTheme(),
  filters: { ...DEFAULT_FILTERS },
  hits: [],
  /** 弹窗打开时的命中快照，导航只在该快照上进行 */
  modalHits: [],
  modalIndex: -1,
  /** 各语言的数据层缓存 */
  data: { zh: null, en: null },
  /** 检索层是否已并入索引 */
  searchReady: false,
  detailReady: false,
  loadingDetail: false,
  searchHint: '',
};

function readInitialLocale() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* 隐私模式下 localStorage 可能不可用 */ }
  return 'zh';
}

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (['system', 'light', 'dark', 'contrast'].includes(saved)) return saved;
  } catch { /* 同上 */ }
  return 'system';
}

let t = createTranslator(state.locale);
let index = [];
let lastFocused = null;
let toastTimer = null;
let detailRequest = 0;

/* ------------------------------------------------------------------ *
 * 主题
 * ------------------------------------------------------------------ */

const resolveTheme = (theme) => {
  if (theme === 'dark' || theme === 'light') return theme;
  if (theme === 'contrast') return 'contrast';
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = () => {
  const resolved = resolveTheme(state.theme);
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-pref', state.theme);

  const icon = $('themeIcon');
  if (icon) icon.textContent = { system: '◐', light: '☀', dark: '☾', contrast: '◑' }[state.theme] ?? '◐';
  if (els.themeLabel) {
    const key = { system: 'nav.theme.system', light: 'nav.theme.light', dark: 'nav.theme.dark', contrast: 'nav.theme.contrast' }[state.theme];
    els.themeLabel.textContent = t(key);
  }
};

/** 把文案写入 [data-i18n] 节点。 */
const applyStaticText = () => {
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-attr]')) {
    // 格式：data-i18n-attr="aria-label:nav.langAria;title:filter.search"
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) node.setAttribute(attr, t(key));
    }
  }
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
  document.title = t('meta.title');
};

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

const showToast = (message) => {
  els.toast.textContent = message;
  els.toast.dataset.visible = 'true';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.dataset.visible = 'false'; }, 2400);
};

const renderStats = () => {
  const stats = state.data[state.locale]?.stats;
  const summary = stats?.summary;
  if (!summary) return;
  els.heroStats.textContent = t('hero.stats', {
    total: stats.total,
    deep: summary.by_detail_level.deep || 0,
    technical: summary.technical_reference_count || 0,
  });
  els.navCount.textContent = t('footer.count', { n: stats.total });
};

const renderFilters = () => {
  const core = state.data[state.locale]?.core;
  if (!core) return;
  const facets = getFacets(core.cases);
  const byCount = (map) => Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  els.source.innerHTML = renderOptions(byCount(facets.bySource).map(([value, count]) => [value, value, count]), t('filter.all'));
  els.industry.innerHTML = renderOptions(byCount(facets.byIndustryGroup).map(([value, count]) => [value, value, count]), t('filter.all'));
  els.evidence.innerHTML = renderOptions(
    byCount(facets.byEvidenceLevel).map(([k, v]) => [k, t.evidence(k), v]),
    t('filter.all'),
  );
  els.fde.innerHTML = renderOptions(byCount(facets.byFde).map(([value, count]) => [value, value, count]), t('filter.all'));
  els.maturity.innerHTML = renderOptions(byCount(facets.byMaturityStage).map(([value, count]) => [value, value, count]), t('filter.all'));
  els.detailLevel.innerHTML = renderOptions(
    byCount(facets.byDetailLevel).map(([k, v]) => [k, t(`detail.level.${k}`), v]),
    t('filter.all'),
  );
};

const renderGrid = () => {
  if (!index.length) {
    els.grid.innerHTML = renderSkeleton(6);
    return;
  }

  const hits = applyFilters(index, state.filters);
  state.hits = hits;

  const total = state.data[state.locale]?.stats?.total ?? index.length;
  els.count.textContent = t('result.showing', { shown: hits.length, total });
  els.searchClear.dataset.visible = state.filters.search ? 'true' : 'false';
  els.search.placeholder = state.searchReady
    ? t('filter.search')
    : t('filter.searchHint');

  if (!hits.length) {
    els.grid.innerHTML = renderEmpty(t);
    return;
  }
  els.grid.innerHTML = hits.map((hit) => renderCard(hit.record, t)).join('');
};

const render = () => {
  applyStaticText();
  applyTheme();
  renderStats();
  renderFilters();
  syncControls();
  renderGrid();
};

/* ------------------------------------------------------------------ *
 * 弹窗
 * ------------------------------------------------------------------ */

/** 弹窗内可聚焦元素，用于焦点陷阱。 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const trapFocus = (event) => {
  if (event.key !== 'Tab') return;
  const focusable = [...els.modal.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

const paintDetail = (record, position) => {
  els.modalTitle.textContent = record.company;
  els.modalScenario.textContent = record.scenario;
  els.modalCounter.textContent = t('modal.counter', {
    index: position + 1,
    total: state.modalHits.length,
  });
  els.modalBadges.innerHTML = `
    <span class="ui-badge ui-badge--${({deep:'grade-a',standard:'grade-b',overview:'grade-c'})[record.detail.level] || 'neutral'}">${esc(t(`detail.level.${record.detail.level}`))}</span>
    ${record.technical_reference ? `<span class="ui-badge ui-badge--accent">${esc(t('card.technical'))}</span>` : ''}
    <span class="ui-badge ui-badge--grade-${esc(record.evidence_level.toLowerCase())}">${esc(t.evidence(record.evidence_level))}</span>
    <span class="app-case__id">${esc(record.id)}</span>`;
  els.modalBody.innerHTML = renderDetail(record, t);
  els.modalPrev.disabled = position <= 0;
  els.modalNext.disabled = position >= state.modalHits.length - 1;
};

/**
 * 打开弹窗。
 * 详情层数据按需加载：先用 core + search 拼出可用内容，
 * 详情层到位后再补齐（证据账本、来源边界等只在详情层里的字段）。
 */
const openModal = async (position) => {
  if (position < 0 || position >= state.modalHits.length) return;
  const hit = state.modalHits[position];
  const card = hit.record;
  const locale = state.locale;
  const request = ++detailRequest;
  const slot = state.data[locale];
  const active = () => request === detailRequest && state.locale === locale
    && state.modalIndex === position && els.modal.dataset.open === 'true';

  if (els.modal.dataset.open !== 'true') lastFocused = document.activeElement;
  state.modalIndex = position;
  paintDetail(mergeLayers(card, hit.search || {}, slot.detail?.[card.id] || {}), position);
  els.modal.dataset.open = 'true';
  els.modal.dataset.loading = 'true';
  els.modal.setAttribute('aria-busy', 'true');
  els.modalCopy.disabled = true;
  document.body.style.overflow = 'hidden';
  els.modalClose.focus();
  try {
    const [search, detail] = await Promise.all([
      loadLayer(LAYER_SETS[locale].search), loadLayer(LAYER_SETS[locale].detail),
    ]);
    slot.search = search;
    slot.detail = detail;
    if (!active()) return;
    enrichIndex(index, search);
    state.searchReady = true;
    state.detailReady = true;
    paintDetail(mergeLayers(card, hit.search || {}, detail[card.id] || {}), position);
    els.modalCopy.disabled = false;
  } catch (error) {
    if (active()) showToast(t('result.error'));
    console.error('[atlas] 详情层加载失败', error);
  } finally {
    if (active()) {
      els.modal.dataset.loading = 'false';
      els.modal.setAttribute('aria-busy', 'false');
    }
  }
};

const closeModal = () => {
  detailRequest += 1;
  els.modal.dataset.open = 'false';
  document.body.style.overflow = '';
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  state.modalIndex = -1;
};

const openModalById = (caseId) => {
  state.modalHits = state.hits;
  const position = state.modalHits.findIndex((hit) => hit.record.id === caseId);
  if (position >= 0) openModal(position);
};

/**
 * 复制摘要。
 * 用 Markdown 链接语法让来源可点 —— 直接贴 URL 到聊天窗口时，
 * 多数编辑器会自动识别，但 Markdown 链接在任何地方都不会丢。
 */
const copySummary = () => {
  const hit = state.modalHits[state.modalIndex];
  if (!hit) return;
  const record = mergeLayers(
    hit.record,
    hit.search || {},
    state.data[state.locale]?.detail?.[hit.record.id] || {},
  );
  const text = buildSummaryText(record, t);

  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    showToast(ok ? t('modal.copied') : t('modal.copyFailed'));
  };

  if (navigator.clipboard?.writeText && globalThis.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => showToast(t('modal.copied')))
      .catch(fallback);
  } else {
    fallback();
  }
};

/* ------------------------------------------------------------------ *
 * 数据层
 * ------------------------------------------------------------------ */

/** Load into the captured locale; a late request must not enrich another language. */
const ensureSearchLayer = async () => {
  const locale = state.locale;
  const slot = state.data[locale];
  if (!slot) return;
  try {
    const payload = slot.search || await loadLayer(LAYER_SETS[locale].search);
    slot.search = payload;
    if (state.locale !== locale) return;
    enrichIndex(index, payload);
    state.searchReady = true;
    if (state.filters.search) renderGrid();
  } catch (error) {
    if (state.locale === locale) showToast(t('result.error'));
    console.warn('[atlas] 检索层加载失败，搜索将仅覆盖卡片字段', error);
  }
};

const ensureLanguage = async () => {
  const locale = state.locale;
  const core = await loadLayer(LAYER_SETS[locale].core);
  const stats = await loadLayer('stats');
  const slot = state.data[locale] ||= { core, search: null, detail: null, stats };
  if (state.locale !== locale) return core;
  index = buildIndex(slot.core.cases);
  if (slot.search) enrichIndex(index, slot.search);
  state.searchReady = Boolean(slot.search);
  state.detailReady = Boolean(slot.detail);
  if (state.filters.search) await ensureSearchLayer();
  return core;
};

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */

const debouncedRender = debounce(renderGrid, 160);

const setFilter = (key, value, { push = true } = {}) => {
  state.filters[key] = value;
  syncUrl(state.filters, push ? 'push' : 'replace');
  renderGrid();
};

/** 把 state.filters 写回各控件（用于 URL 恢复与重置）。 */
const syncControls = () => {
  els.search.value = state.filters.search;
  els.source.value = state.filters.source;
  els.industry.value = state.filters.industryGroup;
  els.evidence.value = state.filters.evidenceLevel;
  els.fde.value = state.filters.fde;
  els.maturity.value = state.filters.maturityStage;
  els.detailLevel.value = state.filters.detailLevel;
  els.technicalOnly.checked = Boolean(state.filters.technicalOnly);
};

const bindEvents = () => {
  els.search.addEventListener('input', () => {
    state.filters.search = els.search.value.trim();
    // 输入搜索词时才拉检索层：首屏不必为可能不用的功能付代价
    if (state.filters.search) ensureSearchLayer();
    els.searchClear.dataset.visible = state.filters.search ? 'true' : 'false';
    syncUrl(state.filters, 'replace');
    debouncedRender();
  });

  els.searchClear.addEventListener('click', () => {
    els.search.value = '';
    state.filters.search = '';
    syncUrl(state.filters, 'push');
    renderGrid();
    els.search.focus();
  });

  for (const [element, key] of [
    [els.source, 'source'],
    [els.industry, 'industryGroup'],
    [els.evidence, 'evidenceLevel'],
    [els.fde, 'fde'],
    [els.maturity, 'maturityStage'],
    [els.detailLevel, 'detailLevel'],
  ]) {
    element.addEventListener('change', () => setFilter(key, element.value));
  }

  els.technicalOnly.addEventListener('change', () => {
    setFilter('technicalOnly', els.technicalOnly.checked);
  });

  els.resetBtn.addEventListener('click', () => {
    state.filters = { ...DEFAULT_FILTERS };
    syncControls();
    syncUrl(state.filters, 'push');
    renderGrid();
  });

  // 事件委托：卡片在 grid 内整体重绘，无需为每张卡片挂监听
  els.grid.addEventListener('click', (event) => {
    const link = event.target.closest('[data-case-id]');
    if (!link) return;
    event.preventDefault();
    openModalById(link.dataset.caseId);
  });

  els.modalPrev.addEventListener('click', () => openModal(state.modalIndex - 1));
  els.modalNext.addEventListener('click', () => openModal(state.modalIndex + 1));
  els.modalClose.addEventListener('click', closeModal);
  els.modalCopy?.addEventListener('click', copySummary);
  els.modal.addEventListener('click', (event) => {
    if (event.target === els.modal) closeModal();
  });

  els.langToggle.addEventListener('click', async () => {
    const previous = state.locale;
    const previousFilters = { ...state.filters };
    debouncedRender.cancel();
    if (els.modal.dataset.open === 'true') closeModal();
    els.langToggle.disabled = true;
    state.locale = previous === 'zh' ? 'en' : 'zh';
    // Free-text facets are language-specific; retain language-neutral filters.
    for (const key of ['industryGroup', 'maturityStage', 'fde', 'source']) state.filters[key] = '';
    t = createTranslator(state.locale);
    try {
      await ensureLanguage();
      try { localStorage.setItem(LANG_KEY, state.locale); } catch { /* private mode */ }
      syncUrl(state.filters, 'replace');
      render();
    } catch (error) {
      state.locale = previous;
      state.filters = previousFilters;
      t = createTranslator(previous);
      await ensureLanguage();
      render();
      showToast(t('result.error'));
      console.error('[atlas] 语言切换失败', error);
    } finally {
      els.langToggle.disabled = false;
    }
  });

  els.themeToggle.addEventListener('click', () => {
    const order = ['system', 'light', 'dark', 'contrast'];
    state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
    try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* 隐私模式 */ }
    applyTheme();
  });

  globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (state.theme === 'system') applyTheme(); });

  // 浏览器前进/后退恢复筛选
  onUrlChange((filters) => {
    state.filters = filters;
    syncControls();
    if (state.filters.search) ensureSearchLayer();
    renderGrid();
  });

  document.addEventListener('keydown', (event) => {
    const isOpen = els.modal.dataset.open === 'true';
    if (event.key === 'Escape' && isOpen) { closeModal(); return; }
    if (isOpen) {
      trapFocus(event);
      if (event.key === 'ArrowLeft' || event.key === 'p') { event.preventDefault(); openModal(state.modalIndex - 1); }
      if (event.key === 'ArrowRight' || event.key === 'n') { event.preventDefault(); openModal(state.modalIndex + 1); }
      return;
    }
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault(); els.search.focus(); els.search.select(); return;
    }
    if (event.key === '/' && !typing) { event.preventDefault(); els.search.focus(); }
  });
};

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

const showFatal = (message) => {
  els.grid.innerHTML = `<div class="ui-empty"><p class="ui-empty__title">${esc(t('result.error'))}</p><p class="ui-empty__hint">${esc(message)}</p></div>`;
  els.count.textContent = '';
};

const init = async () => {
  for (const locale of ['zh', 'en']) {
    const missing = missingKeys(locale);
    if (missing.length) console.warn(`[i18n] ${locale} 缺少 ${missing.length} 个文案：${missing.join(', ')}`);
  }

  // URL 里的筛选优先于默认值
  state.filters = readFromUrl();

  try {
    await ensureLanguage();
  } catch (error) {
    console.error('[atlas] 启动失败', error);
    showFatal(error.message);
    return;
  }

  bindEvents();
  render();

  // 空闲时预取检索层，让用户第一次输入搜索词不必等待
  prefetch([LAYER_SETS[state.locale].search]);
};

init();
