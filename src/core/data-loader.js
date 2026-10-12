/**
 * �ֲ����ݼ�������
 *
 * ��������ǰ dist/atlas.data.js һ���Լ��� 978KB����������ȫ�����ģ���
 * ������ֻ��Ҫ��Ƭ��Ϣ��ʵ���ռ18%������Ϊ������أ�
 *
 *   stats    �����Թ��ã���ҳ��ͬ�����أ�1 KB��
 *   core     �������裬��Ƭ + ���֣����� 107 KB / Ӣ�� 120 KB��
 *   search   �û��״�����������ʱ���أ����� 214 KB��
 *   detail   �����鵯��ʱ���أ����� 115 KB��
 *
 * ���ȡ�᣺
 *   1. ���� <script> ע���ٻ��˵� fetch ���� ǰ�߶� file:// ������������ȣ�
 *      �������������з����������߶�ʧ��ʱ�����ɲ����Ĵ�����ʾ��
 *   2. �����е�״̬��¶�����÷����� UI ����ʾ�Ǽܶ����ǿհס�
 *   3. �Ѽ��صĲ�ᱻ���棬�ظ�����ֱ�ӷ��أ����ظ�������
 */

/** �����Ӧ��ȫ�ֱ��������ļ�·���� */
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

/** �ò��Ƿ��Ѿ�����global �ѱ��ű���ֵ���� */
export const isReady = (layer) => {
  const spec = LAYERS[layer];
  return Boolean(spec && globalThis[spec.global]);
};

/** �ò��Ƿ��ѿ�ʼ���أ����Ⲣ���ظ����󣩡� */
const inFlight = new Map();

/** �ò��Ƿ��Ѽ������ ���� UI ���������Ƿ���ʾ�Ǽ����� */
export const isLoaded = (layer) => {
  const spec = LAYERS[layer];
  return cache.has(layer) || (spec ? Boolean(globalThis[spec.global]) : false);
};

/**
 * ע�� <script>��
 * ʧ��ʱ��file:// �²�����������ƣ����״����ɵ��÷����˵� fetch��
 */
const injectScript = (src) => new Promise((resolve, reject) => {
  const el = document.createElement('script');
  el.src = src;
  el.async = false;
  el.onload = () => resolve();
  el.onerror = () => reject(new Error(`�ű�����ʧ�ܣ�${src}`));
  document.head.append(el);
});

/**
 * ȡĳ�����ݡ�
 * @param {keyof typeof LAYERS} layer
 * @returns {Promise<any>}
 */
export const loadLayer = async (layer) => {
  const spec = LAYERS[layer];
  if (!spec) throw new Error(`δ֪�����ݲ㣺${layer}`);

  // ·�� 1���ű���ע�루���� index.html ���� <script src> Ԥ�ȼ����������㣩
  if (globalThis[spec.global]) {
    cache.set(layer, globalThis[spec.global]);
    return cache.get(layer);
  }

  // ·�� 2��������ͬ��������ڽ�����
  if (inFlight.has(layer)) return inFlight.get(layer);

  const task = (async () => {
    try {
      await injectScript(spec.file);
      if (!globalThis[spec.global]) {
        throw new Error(`�ű�ִ�к�ȫ�ֱ��� ${spec.global} ��δ����`);
      }
      cache.set(layer, globalThis[spec.global]);
      return cache.get(layer);
    } catch (scriptError) {
      // ·�� 3��script ��ʽ�����ã����� fetch + �ֶ���ֵ
      try {
        const response = await fetch(spec.file, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const code = await response.text();
        // eslint-disable-next-line no-new-func -- �����������Լ����ɵĽű��������ⲿ����
        new Function(code).call(globalThis);
        if (!globalThis[spec.global]) {
          throw new Error(`fetch ��ȫ�ֱ��� ${spec.global} ��δ����`);
        }
        cache.set(layer, globalThis[spec.global]);
        return cache.get(layer);
      } catch (fetchError) {
        throw new Error(
          `�޷����� ${layer} �㣨${spec.file}����`
          + `�ű���ʽ��${scriptError.message}��fetch ��ʽ��${fetchError.message}��`
          + '��ȷ�������� npm run build����ͨ�� HTTP ���������ʣ�ԭ�� ES Module �� file:// �»ᱻ CORS ���أ���',
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
 * Ԥ�������ɲ㣬����ʧ�ܡ�
 * ���ڿ���ʱ��ǰ�Ѽ����������������û���һ���������ٵȴ���
 */
export const prefetch = (layers) => {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => layers.forEach((layer) => loadLayer(layer).catch(() => {})));
  } else {
    setTimeout(() => layers.forEach((layer) => loadLayer(layer).catch(() => {})), 1500);
  }
};

/**
 * �Ѽ������������ϲ�������������¼��
 *
 * �������ֻ��һ�����ֶΣ���Ⱦ������Ҫƴ����������
 * @param {object} card core ���¼���� detail ���֣�
 * @param {object} search search ��������ֶ�
 * @param {object} detail detail ��������ֶ�
 */
export const mergeLayers = (card, search = {}, detail = {}) => ({
  ...card,
  ...search,
  ...detail,
  detail: card.detail,
});

export const LAYER_FILES = LAYERS;