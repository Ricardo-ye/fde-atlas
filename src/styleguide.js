/**
 * Styleguide 页面的交互逻辑。
 *
 * 这个页面的价值在于：把设计系统的每一项都变成"可以直接看到"的，
 * 而不是一份需要读者自己想象的规范文档。
 *
 * 三件事：
 *   1. 从计算样式里读出真实生效的令牌值（而不是硬编码一份副本）——
 *      这样令牌改了页面会跟着变，文档不会变成第二事实源；
 *   2. 主题切换与主应用共用 localStorage key，切过去是连贯的；
 *   3. 演示弹窗/提示条，验证焦点陷阱等交互确实工作。
 */

const $ = (id) => document.getElementById(id);

/**
 * 安全绑定：元素不存在就跳过并告警，不让一处缺失拖垮整页交互。
 * 这不是防御性冗余 —— 绑定一个不存在的 id 会静默失败，
 * 表现为"某个按钮点了没反应"，极难定位。
 */
const on = (id, event, handler) => {
  const element = $(id);
  if (!element) {
    console.warn(`[styleguide] 缺少元素 #${id}，已跳过 ${event} 绑定`);
    return;
  }
  element.addEventListener(event, handler);
};

const THEME_KEY = 'fde_atlas_theme';
const THEMES = ['system', 'light', 'dark', 'contrast'];
const THEME_ICONS = { system: '◐', light: '☀', dark: '☾', contrast: '◑' };
const THEME_LABELS = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
  contrast: '高对比度',
};

const state = { theme: 'system' };

try {
  const saved = localStorage.getItem(THEME_KEY);
  if (THEMES.includes(saved)) state.theme = saved;
} catch { /* 隐私模式 */ }

const resolveTheme = (theme) => {
  if (theme !== 'system') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const applyTheme = () => {
  const resolved = resolveTheme(state.theme);
  document.documentElement.setAttribute('data-theme', resolved);
  $('themeIcon').textContent = THEME_ICONS[state.theme];
  $('themeLabel').textContent = THEME_LABELS[state.theme];
  // 令牌取值随主题变化，色板必须重绘
  requestAnimationFrame(() => {
    renderSemanticSwatches();
    renderThemeCompare();
  });
};

/* ------------------------------------------------------------------ *
 * 色板
 * ------------------------------------------------------------------ */

/** 主题相关的语义令牌（用于展示"同一语义在不同主题下的实际值"）。 */
const SEMANTIC_GROUPS = [
  ['背景', ['--semantic-bg-canvas', '--semantic-bg-surface', '--semantic-bg-sunken', '--semantic-hover-bg']],
  ['文本', ['--semantic-text-primary', '--semantic-text-secondary', '--semantic-text-tertiary', '--semantic-text-link']],
  ['主色', ['--semantic-accent-bg', '--semantic-accent-subtle-bg', '--semantic-accent-subtle-text']],
  ['状态', ['--semantic-success-subtle-text', '--semantic-warning-subtle-text', '--semantic-danger-subtle-text', '--semantic-info-subtle-text']],
  ['分级', ['--semantic-grade-a', '--semantic-grade-b', '--semantic-grade-c', '--semantic-grade-d']],
];

const readToken = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const renderSemanticSwatches = () => {
  const root = $('semanticSwatches');
  root.innerHTML = SEMANTIC_GROUPS.map(([group, tokens]) => `
    <div class="app-sg-swatch-group">
      <p class="ui-label">${group}</p>
      ${tokens.map((token) => {
    const value = readToken(token);
    return `
        <div class="app-sg-swatch">
          <span class="app-sg-swatch__chip" style="background:${value}"></span>
          <code class="app-sg-swatch__name">${token.replace('--semantic-', '')}</code>
          <code class="app-sg-swatch__value">${value}</code>
        </div>`;
  }).join('')}
    </div>`).join('');
};

/** primitive 色板：一次性生成，之后只需跟随主题更新文字颜色。 */
const PRIMITIVE_HUES = ['blue', 'neutral', 'green', 'amber', 'red', 'violet', 'cyan'];
const PRIMITIVE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];

const renderPrimitiveSwatches = () => {
  const root = $('primitiveSwatches');
  root.innerHTML = PRIMITIVE_HUES.map((hue) => {
    const steps = PRIMITIVE_STEPS
      .map((step) => ({ step, value: readToken(`--p-${hue}-${step}`) }))
      .filter((s) => s.value);
    return `
    <div class="app-sg-ramp">
      <p class="ui-label">--p-${hue}-*</p>
      <div class="app-sg-ramp__strip">
        ${steps.map(({ step, value }) => `
        <div class="app-sg-ramp__cell" style="background:${value}" title="${value}">
          <span class="app-sg-ramp__step">${step}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
};

/* ------------------------------------------------------------------ *
 * 排版与间距刻度
 * ------------------------------------------------------------------ */

const TYPE_SCALE = [
  ['--p-font-size-xs', '角标 11px'],
  ['--p-font-size-sm', '小号 13px'],
  ['--p-font-size-md', '正文辅助 14px'],
  ['--p-font-size-base', '正文 15px'],
  ['--p-font-size-lg', '大号 18px'],
  ['--p-font-size-xl', '标题 22px'],
  ['--p-font-size-2xl', '标题 28px'],
  ['--p-font-size-3xl', '标题 36px'],
  ['--p-font-size-4xl', '展示 48px'],
];

const renderTypeScale = () => {
  $('typeScale').innerHTML = TYPE_SCALE.map(([token, label]) => {
    const size = readToken(token);
    return `
    <div class="app-sg-type-row">
      <div class="app-sg-type-row__sample" style="font-size:${size};line-height:1.25">
        ${label}
      </div>
      <code class="app-sg-swatch__value">${token.replace('--p-font-', 'size-')} · ${size}</code>
    </div>`;
  }).join('');
};

const SPACE_STEPS = ['0', '1', '2', '3', '4', '5', '6', '7', '8'];

const renderSpaceScale = () => {
  $('spaceScale').innerHTML = SPACE_STEPS.map((step) => {
    const value = readToken(`--p-space-${step}`);
    // rem 转 px 便于直观对比
    const px = (parseFloat(value) || 0) * 16;
    return `
    <div class="app-sg-space-row">
      <code class="app-sg-swatch__name">--p-space-${step}</code>
      <span class="app-sg-space-bar" style="width:${Math.max(px, 2)}px"></span>
      <code class="app-sg-swatch__value">${value} · ${px}px</code>
    </div>`;
  }).join('');
};

/* ------------------------------------------------------------------ *
 * 主题对比表
 * ------------------------------------------------------------------ */

const COMPARE_TOKENS = [
  ['--semantic-bg-canvas', '页面背景'],
  ['--semantic-bg-surface', '容器背景'],
  ['--semantic-text-primary', '主要文本'],
  ['--semantic-text-secondary', '次要文本'],
  ['--semantic-border-default', '默认边框'],
  ['--semantic-accent-bg', '主色'],
  ['--semantic-accent-subtle-bg', '主色（浅）'],
  ['--semantic-grade-a', 'A 级色'],
  ['--semantic-hover-bg', '悬停背景'],
];

const renderThemeCompare = () => {
  const current = document.documentElement.getAttribute('data-theme');
  const values = {};
  for (const theme of ['light', 'dark', 'contrast']) {
    document.documentElement.setAttribute('data-theme', theme);
    values[theme] = Object.fromEntries(
      COMPARE_TOKENS.map(([token]) => [token, readToken(token)]),
    );
  }
  document.documentElement.setAttribute('data-theme', current);

  $('themeCompare').innerHTML = COMPARE_TOKENS.map(([token, label]) => `
    <tr>
      <td><code>${token.replace('--semantic-', '')}</code><br><span class="ui-muted">${label}</span></td>
      ${['light', 'dark', 'contrast'].map((theme) => {
    const value = values[theme][token];
    return `
        <td>
          <span class="app-sg-inline-swatch">
            <span class="app-sg-swatch__chip" style="background:${value}"></span>
            <code class="ui-mono">${value}</code>
          </span>
        </td>`;
  }).join('')}
    </tr>`).join('');
};

/* ------------------------------------------------------------------ *
 * 交互演示
 * ------------------------------------------------------------------ */

const demoModal = $('sgModal');
let demoLastFocused = null;

const openDemoModal = () => {
  demoLastFocused = document.activeElement;
  demoModal.dataset.open = 'true';
  document.body.style.overflow = 'hidden';
  $('sgModalClose').focus();
};

const closeDemoModal = () => {
  demoModal.dataset.open = 'false';
  document.body.style.overflow = '';
  if (demoLastFocused?.focus) demoLastFocused.focus();
};

let toastTimer = null;
const showDemoToast = () => {
  const toast = $('sgToast');
  toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.dataset.visible = 'false'; }, 2000);
};

const bindEvents = () => {
  $('themeToggle').addEventListener('click', () => {
    state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* 隐私模式 */ }
    applyTheme();
  });

  for (const button of document.querySelectorAll('[data-theme-set]')) {
    button.addEventListener('click', () => {
      state.theme = button.dataset.themeSet;
      try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* 隐私模式 */ }
      applyTheme();
    });
  }

  on('demoModal', 'click', openDemoModal);
  on('sgModalClose', 'click', closeDemoModal);
  on('sgModalCancel', 'click', closeDemoModal);
  on('demoToast', 'click', showDemoToast);

  const modal = $('sgModal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeDemoModal();
    });
  }

  // 焦点陷阱
  document.addEventListener('keydown', (event) => {
    const activeModal = $('sgModal');
    if (!activeModal || activeModal.dataset.open !== 'true') return;
    if (event.key === 'Escape') { closeDemoModal(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...activeModal.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
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
  });

  // 选项卡
  for (const tab of document.querySelectorAll('.ui-tabs__tab')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.ui-tabs__tab')) {
        other.setAttribute('aria-selected', String(other === tab));
      }
    });
  }

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system') applyTheme();
  });

  // 目录高亮
  const links = [...document.querySelectorAll('.app-sg-link')];
  const sections = links
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of links) {
        link.classList.toggle('app-sg-link--active',
          link.getAttribute('href') === `#${entry.target.id}`);
      }
    }
  }, { rootMargin: '-80px 0px -70% 0px' });

  sections.forEach((section) => observer.observe(section));
};

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */

/**
 * 启动。
 *
 * 必须是 async —— 顶层 await 只在模块里合法，
 * 而这里要等样式表加载完成后才能读到真实的计算值。
 */
const init = async () => {
  // 样式必须真正加载后才能读到计算值
  const waitForStyles = async (timeoutMs = 6000) => {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = links.every((link) => {
        if (!link.sheet) return false;
        try { return link.sheet.cssRules.length > 0; } catch { return false; }
      });
      if (ready) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  try {
    await waitForStyles();
    applyTheme();
    renderSemanticSwatches();
    renderPrimitiveSwatches();
    renderTypeScale();
    renderSpaceScale();
    renderThemeCompare();
    bindEvents();
  } catch (error) {
    // 令牌读不到时页面一片空白，必须让错误可见而不是静默
    console.error('[styleguide] 初始化失败', error);
    const banner = document.createElement('div');
    banner.className = 'ui-alert ui-alert--danger';
    banner.innerHTML = `<span class="ui-alert__icon" aria-hidden="true">✕</span>
      <div class="ui-alert__content">设计系统页面初始化失败：${error.message}</div>`;
    document.querySelector('.ui-container')?.append(banner);
  }
};

init();