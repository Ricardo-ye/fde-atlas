/**
 * 分层数据加载器。
 *
 * 背景：此前 dist/atlas.data.js 一次性加载 978KB（两种语言全量正文），
 * 但首屏只需要卡片信息（实测仅占18%）。改为按需加载：
 *
 *   stats    两语言共用，随页面同步加载（1 KB）
 *   core     首屏必需，卡片 + 评分（中文 107 KB / 英文 120 KB）
 *   search   用户首次输入搜索词时加载（中文 214 KB）
 *   detail   打开详情弹窗时加载（中文 115 KB）
 *
 * 设计取舍：
 *   1. 先用 <script> 注入再回退到 fetch —— 前者对 file:// 与老浏览器更稳，
 *      后者能真正并行发起请求。两者都失败时给出可操作的错误提示。
 *   2. 加载中的状态暴露给调用方，让 UI 能显示骨架而不是空白。
 *   3. 已加载的层会被缓存，重复调用直接返回，不重复发请求。
 */

/** 各层对应的全局变量名与文件路径。 */
const LAYERS = Object.freeze({
  stats: { global: 'FDE_ATLAS_STATS', file: 'dist/atlas.stats.js' },
  core: { global: 'FDE_ATLAS_CORE', file: 'dist/atlas.core.js' },
  coreEn: { global: 'FDE_ATLAS_CORE_EN', file: 'dist/atlas.core.en.js' },
  search: { global: 'FDE_ATLAS_SEARCH_ZH', file: 'dist/atlas.search.js' },
  searchEn: { global: 'FDE_ATLAS_SEARCH_EN', file: 'dist/atlas.search.en.js' },
  detail: { global: 'FDE_ATLAS_DETAIL_ZH', file: 'dist/atlas.detail.js' },
  detailEn: { global: 'FDE_ATLAS_DETAIL_EN', file: 'dist/atlas.detail.en.js' },
});

const cache = new Map();

/** 该层是否已就绪（global 已被脚本赋值）。 */
export const isReady = (layer) => {
  const spec = LAYERS[layer];
  return Boolean(spec && globalThis[spec.global]);
};

/** 该层是否已开始加载（避免并发重复请求）。 */
const inFlight = new Map();

/** 该层是否已加载完成 —— UI 用它决定是否显示骨架屏。 */
export const isLoaded = (layer) => {
  const spec = LAYERS[layer];
  return cache.has(layer) || (spec ? Boolean(globalThis[spec.global]) : false);
};

/**
 * 注入 <script>。
 * 失败时（file:// 下部分浏览器限制）不抛错，由调用方回退到 fetch。
 */
const injectScript = (src) => new Promise((resolve, reject) => {
  const el = document.createElement('script');
  el.src = src;
  el.async = false;
  el.onload = () => resolve();
  el.onerror = () => reject(new Error(`脚本加载失败：${src}`));
  document.head.append(el);
});

/**
 * 取某层数据。
 * @param {keyof typeof LAYERS} layer
 * @returns {Promise<any>}
 */
export const loadLayer = async (layer) => {
  const spec = LAYERS[layer];
  if (!spec) throw new Error(`未知的数据层：${layer}`);

  // 路径 1：脚本已注入（例如 index.html 里用 <script src> 预先加载了首屏层）
  if (globalThis[spec.global]) {
    cache.set(layer, globalThis[spec.global]);
    return cache.get(layer);
  }

  // 路径 2：已有相同层的请求在进行中
  if (inFlight.has(layer)) return inFlight.get(layer);

  const task = (async () => {
    try {
      await injectScript(spec.file);
      if (!globalThis[spec.global]) {
        throw new Error(`脚本执行后全局变量 ${spec.global} 仍未定义`);
      }
      cache.set(layer, globalThis[spec.global]);
      return cache.get(layer);
    } catch (scriptError) {
      // 路径 3：script 方式不可用，改用 fetch + 手动求值
      try {
        const response = await fetch(spec.file, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const code = await response.text();
        // eslint-disable-next-line no-new-func -- 产物是我们自己生成的脚本，不是外部输入
        new Function(code).call(globalThis);
        if (!globalThis[spec.global]) {
          throw new Error(`fetch 后全局变量 ${spec.global} 仍未定义`);
        }
        cache.set(layer, globalThis[spec.global]);
        return cache.get(layer);
      } catch (fetchError) {
        throw new Error(
          `无法加载 ${layer} 层（${spec.file}）。`
          + `脚本方式：${scriptError.message}；fetch 方式：${fetchError.message}。`
          + '请确认已运行 npm run build，并通过 HTTP 服务器访问（原生 ES Module 在 file:// 下会被 CORS 拦截）。',
        );
      }
    } finally {
      inFlight.delete(layer);
    }
  })();

  inFlight.set(layer, task);
  return task;
};

/**
 * 预加载若干层，忽略失败。
 * 用于空闲时提前把检索层拉下来，让用户第一次搜索不再等待。
 */
export const prefetch = (layers) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => layers.forEach((layer) => loadLayer(layer).catch(() => {})));
  } else {
    setTimeout(() => layers.forEach((layer) => loadLayer(layer).catch(() => {})), 1500);
  }
};

/**
 * 把检索层与详情层合并回完整案例记录。
 *
 * 三层各自只带一部分字段，渲染详情需要拼回完整对象。
 * @param {object} card core 层记录（含 detail 评分）
 * @param {object} search search 层该条的字段
 * @param {object} detail detail 层该条的字段
 */
export const mergeLayers = (card, search = {}, detail = {}) => ({
  ...card,
  ...search,
  ...detail,
  detail: card.detail,
});

export const LAYER_FILES = LAYERS;