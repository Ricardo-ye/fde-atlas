/**
 * 测试套件入口。
 *
 * 覆盖五块最容易在重构中悄悄坏掉的东西：
 *   1. 评分引擎 —— 纯函数，逐条规则断言；
 *   2. schema 校验器 —— 既要能抓错，也不能对合法数据误报；
 *   3. 搜索与筛选 —— 前端逻辑抽成纯函数后可在 Node 里直接测；
 *   4. URL 状态同步 —— 序列化/反序列化必须往返无损；
 *   5. 国际化 —— 语言包 key 对齐、占位符插值、语言中立枚举本地化。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, assert, run } from './harness.mjs';
import { SchemaValidator } from '../scripts/lib/schema-validator.mjs';
import { calculateDetail } from '../src/core/rubric.js';
import {
  DETAIL_LEVEL_KEYS, DIMENSION_KEYS, DUPLICATE_BLOCK_THRESHOLD,
  DIRECTNESS_LEVELS, evidenceLabel,
} from '../src/core/taxonomy.js';
import { buildIndex, applyFilters, DEFAULT_FILTERS, getFacets, enrichIndex } from '../src/core/search.js';
import { writeToUrl, readFromUrl, countActive } from '../src/core/url-state.js';
import { createTranslator, missingKeys } from '../src/i18n/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cases.json'), 'utf8'));
const enCases = JSON.parse(fs.readFileSync(path.join(root, 'data', 'cases.en.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'data', 'case.schema.json'), 'utf8'));

/* ------------------------------------------------------------------ *
 * 评分引擎
 * ------------------------------------------------------------------ */

describe('评分引擎 · 六维规则', () => {
  const base = {
    problem: 'x'.repeat(60),
    solution: 'x'.repeat(70),
    architecture: Array.from({ length: 6 }, (_, i) => `step-${i}`),
    components: ['a', 'b', 'c', 'd', 'e'],
    human: 'x'.repeat(40),
    fde_actions: ['a', 'b', 'c', 'd', 'e'],
    result: '效率提升 30%',
    evidence_level: 'A',
  };

  it('满分六维得 12 分并判为 deep', () => {
    const detail = calculateDetail(base);
    assert.equal(detail.detail_score, 12);
    assert.equal(detail.detail_level, 'deep');
    assert.deepEqual(detail.missing_details, []);
  });

  it('业务背景按长度分三档：>=50 满分、>=25 一分、其余零分', () => {
    assert.equal(calculateDetail({ ...base, problem: 'x'.repeat(50) }).detail_dimensions.business_context, 2);
    assert.equal(calculateDetail({ ...base, problem: 'x'.repeat(25) }).detail_dimensions.business_context, 1);
    assert.equal(calculateDetail({ ...base, problem: 'x'.repeat(24) }).detail_dimensions.business_context, 0);
  });

  it('技术工作流要求链路与组件同时达标才给满分', () => {
    assert.equal(calculateDetail(base).detail_dimensions.technical_workflow, 2);
    // 组件不足 5项，即使链路够长也只有 1 分
    assert.equal(
      calculateDetail({ ...base, components: ['a', 'b'] }).detail_dimensions.technical_workflow, 1,
    );
    // 链路只有 4 步时降到 1 分
    assert.equal(
      calculateDetail({ ...base, architecture: ['a', 'b', 'c', 'd'] }).detail_dimensions.technical_workflow, 1,
    );
    assert.equal(calculateDetail({ ...base, architecture: ['a'] }).detail_dimensions.technical_workflow, 0);
  });

  it('人机治理要求人工描述与FDE 动作同时达标', () => {
    assert.equal(calculateDetail(base).detail_dimensions.human_governance, 2);
    assert.equal(
      calculateDetail({ ...base, fde_actions: ['a'] }).detail_dimensions.human_governance, 1,
    );
    assert.equal(calculateDetail({ ...base, human: 'short' }).detail_dimensions.human_governance, 0);
  });

  it('量化结果识别数字+单位，也识别货币符号前缀', () => {
    assert.equal(calculateDetail({ ...base, result: '成本下降 40%' }).detail_dimensions.measured_outcome, 2);
    assert.equal(calculateDetail({ ...base, result: '节省 $1.2M' }).detail_dimensions.measured_outcome, 2);
    assert.equal(calculateDetail({ ...base, result: '12万欧元' }).detail_dimensions.measured_outcome, 2);
  });

  it('纯定性描述只给 1 分，不误判为量化', () => {
    // 长度必须 >=20 才有资格拿 1 分；这段话没有任何数字+单位组合
    const qualitative = '整体效率有较明显改善，业务部门反馈使用体验良好，覆盖范围逐步扩大。';
    assert.ok([...qualitative].length >= 20, '前置条件：描述需达到 20 字门槛');
    assert.equal(
      calculateDetail({ ...base, result: qualitative }).detail_dimensions.measured_outcome,
      1,
    );
  });

  it('来源可定位性直接由证据等级映射：A=2，B/C=1，D=0', () => {
    assert.equal(calculateDetail({ ...base, evidence_level: 'A' }).detail_dimensions.source_traceability, 2);
    assert.equal(calculateDetail({ ...base, evidence_level: 'B' }).detail_dimensions.source_traceability, 1);
    assert.equal(calculateDetail({ ...base, evidence_level: 'C' }).detail_dimensions.source_traceability, 1);
    assert.equal(calculateDetail({ ...base, evidence_level: 'D' }).detail_dimensions.source_traceability, 0);
  });

  it('分级阈值：>=10 deep、>=7 standard、其余 overview', () => {
    /** 构造恰好拿到 target 分的用例：逐维累加，每维满分 2 分。 */
    const at = (target) => {
      const item = {
        problem: '', solution: '', architecture: [], components: [],
        human: '', fde_actions: [], result: '', evidence_level: 'D',
      };
      let remaining = target;
      // 按 DIMENSION_KEYS 顺序填满前若干维，直到凑够 target 分
      for (const key of DIMENSION_KEYS) {
        if (remaining <= 0) break;
        if (key === 'business_context') item.problem = 'x'.repeat(60);
        if (key === 'solution_workflow') item.solution = 'x'.repeat(70);
        if (key === 'technical_workflow') {
          item.architecture = ['a', 'b', 'c', 'd', 'e', 'f'];
          item.components = ['a', 'b', 'c', 'd', 'e'];
        }
        if (key === 'human_governance') {
          item.human = 'x'.repeat(40);
          item.fde_actions = ['a', 'b', 'c', 'd', 'e'];
        }
        if (key === 'measured_outcome') item.result = '提升 30%';
        if (key === 'source_traceability') item.evidence_level = 'A';
        remaining -= 2;
      }
      const detail = calculateDetail(item);
      // 确认构造出的分数确实等于目标值，避免测试自身写错却通过
      assert.equal(detail.detail_score, target, `构造 ${target} 分的用例失败`);
      return detail.detail_level;
    };
    assert.equal(at(12), 'deep');
    assert.equal(at(10), 'deep');
    assert.equal(at(8), 'standard');
    assert.equal(at(6), 'overview');
  });

  it('缺字段时不得抛异常，按0 分处理', () => {
    const detail = calculateDetail({});
    assert.equal(detail.detail_score, 0);
    assert.equal(detail.detail_level, 'overview');
    assert.deepEqual(Object.keys(detail.detail_dimensions).sort(), [...DIMENSION_KEYS].sort());
  });

  it('评分是纯函数，不修改入参', () => {
    const snapshot = JSON.stringify(base);
    calculateDetail(base);
    assert.equal(JSON.stringify(base), snapshot);
  });

  it('每个维度的满分都是2 分，总分上限 12', () => {
    for (const item of cases) {
      const { detail_score: score, detail_dimensions: dims } = calculateDetail(item);
      assert.ok(score >= 0 && score <= 12, `${item.id} 总分越界：${score}`);
      for (const key of DIMENSION_KEYS) {
        assert.ok(dims[key] >= 0 && dims[key] <= 2, `${item.id}.${key} 维度越界：${dims[key]}`);
      }
    }
  });

  it('missing_details 只列出未满分的维度，且标签键可解析', () => {
    const detail = calculateDetail(cases[0]);
    const expected = DIMENSION_KEYS.filter((k) => detail.detail_dimensions[k] < 2);
    assert.deepEqual(detail.missing_details, expected);
    assert.ok(DETAIL_LEVEL_KEYS[detail.detail_level]);
  });
});

/* ------------------------------------------------------------------ *
 * Schema 校验器
 * ------------------------------------------------------------------ */

describe('Schema 校验器', () => {
  const validator = new SchemaValidator(schema);

  it('全部 127 条中文案例通过结构校验', () => {
    const errors = validator.validate(cases, { basePath: 'cases.json' });
    assert.deepEqual(errors, [], `不应有结构错误，实际 ${errors.length} 项`);
  });

  it('英文镜像同样通过结构校验', () => {
    const errors = validator.validate(enCases, { basePath: 'cases.en.json' });
    assert.deepEqual(errors, []);
  });

  it('捕获必填字段缺失', () => {
    const broken = { ...cases[0] };
    delete broken.source_record;
    const errors = validator.validate([broken]);
    assert.ok(errors.some((e) => e.includes('source_record')));
  });

  it('捕获类型错误', () => {
    const errors = validator.validate([{ ...cases[0], url: 12345 }]);
    assert.ok(errors.some((e) => e.includes('类型应为 string')));
  });

  it('捕获未声明的额外字段（additionalProperties: false）', () => {
    const errors = validator.validate([{ ...cases[0], detail_score_stub: 1 }]);
    assert.ok(errors.some((e) => e.includes('不允许的额外字段')));
  });

  it('捕获 evidence_level 非法取值', () => {
    const errors = validator.validate([{ ...cases[0], evidence_level: 'Z' }]);
    assert.ok(errors.some((e) => e.includes('evidence_level')));
  });

  it('捕获非 HTTPS 主链接', () => {
    const errors = validator.validate([{ ...cases[0], url: 'http://example.com' }]);
    assert.ok(errors.some((e) => e.includes('httpsUrl') || e.includes('不匹配格式')));
  });

  it('捕获日期格式错误', () => {
    const broken = { ...cases[0], source_record: { ...cases[0].source_record, accessed_at: '2026/09/19' } };
    const errors = validator.validate([broken]);
    assert.ok(errors.some((e) => e.includes('accessed_at')));
  });

  it('捕获嵌套数组中的非法元素（additional_sources）', () => {
    const broken = { ...cases[0], additional_sources: [{ title: 'ok' }] };
    const errors = validator.validate([broken]);
    assert.ok(errors.some((e) => e.includes('additional_sources[0]') && e.includes('url')));
  });

  it('空数组不触发 minItems 之外的误报', () => {
    const errors = validator.validate([{ ...cases[0], additional_sources: [] }]);
    assert.deepEqual(errors, []);
  });

  it('minLength 按码点计数，中文字符不被算成两个', () => {
    // problem 要求 >=10 字符；10 个中文字符恰好通过
    const exactly10 = '一二三四五六七八九十';
    assert.equal([...exactly10].length, 10);
    const errors = validator.validate([{ ...cases[0], problem: exactly10 }]);
    assert.deepEqual(errors, []);
  });

  it('schema 里出现未支持关键字时构造器直接抛错，不静默放过', () => {
    assert.throws(
      () => new SchemaValidator({ type: 'object', oneOf: [{ type: 'string' }] }),
      'oneOf 应触发抛错',
    );
    assert.throws(
      () => new SchemaValidator({ type: 'object', $ref: 'https://remote/schema.json' }),
      '远程 $ref 应触发抛错',
    );
  });
});

/* ------------------------------------------------------------------ *
 * 搜索与筛选
 * ------------------------------------------------------------------ */

describe('搜索与筛选', () => {
  const enriched = cases.map((item) => ({ ...item, detail: calculateDetail(item) }));
  const index = buildIndex(enriched);

  /**
   * 回归用例：搜索层必须能处理"构建产物形态"。
   * 曾经的真实缺陷 —— build.mjs 挂的是 { score, level, dimensions, missing }，
   * 而 search.js 读的是 detail_level / detail_dimensions，
   * 结果：Node 单测（传 calculateDetail 输出）全绿，浏览器里"深度案例"筛选恒为 0 条。
   * 这组用例专门锁死"两种形态必须行为一致"。
   */
  const browserShape = cases.map((item) => {
    const d = calculateDetail(item);
    return {
      ...item,
      detail: {
        score: d.detail_score,
        level: d.detail_level,
        dimensions: d.detail_dimensions,
        missing: d.missing_details,
      },
    };
  });
  const browserIndex = buildIndex(browserShape);

  it('两种 detail 形态的索引产出完全等价', () => {
    assert.equal(browserIndex.length, index.length);
    browserIndex.forEach((entry, i) => {
      assert.equal(entry.detail.level, index[i].detail.level, `第 ${i} 条 level 不一致`);
      assert.equal(entry.detail.score, index[i].detail.score, `第 ${i} 条 score 不一致`);
      assert.deepEqual(entry.detail.dimensions, index[i].detail.dimensions);
    });
  });

  it('构建产物形态下详细度筛选可用（回归：曾恒为 0 条）', () => {
    const deepHits = applyFilters(browserIndex, { detailLevel: 'deep' });
    const expected = cases.filter((c) => calculateDetail(c).detail_level === 'deep').length;
    assert.equal(deepHits.length, expected);
    assert.ok(deepHits.length > 0, '深度筛选不应返回空集');
  });

  it('构建产物形态下 getFacets 覆盖三种详细度', () => {
    const facets = getFacets(browserShape);
    assert.deepEqual(Object.keys(facets.byDetailLevel).sort(), ['deep', 'overview', 'standard']);
  });

  it('索引覆盖全部案例且附带搜索文本', () => {
    assert.equal(index.length, enriched.length);
    assert.ok(index.every((entry) => typeof entry.haystack === 'string' && entry.haystack.length > 0));
  });

  it('搜索文本已小写化，查询无需再转换', () => {
    const first = index[0];
    assert.equal(first.haystack, first.haystack.toLowerCase());
  });

  it('按公司名搜索能命中对应案例', () => {
    const target = enriched[0].company;
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, search: target });
    assert.ok(hits.length > 0, `应命中 ${target}`);
    assert.ok(hits.some((hit) => hit.record.company === target));
  });

  it('搜索无结果时返回空数组而非报错', () => {
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, search: 'zzz-不存在的公司-zzz' });
    assert.deepEqual(hits, []);
  });

  it('多条件为 AND 关系：同时指定行业与证据等级', () => {
    const sample = enriched[0];
    const hits = applyFilters(index, {
      ...DEFAULT_FILTERS,
      industryGroup: sample.industry_group,
      evidenceLevel: sample.evidence_level,
    });
    assert.ok(hits.length > 0);
    assert.ok(hits.every((hit) => hit.record.industry_group === sample.industry_group
      && hit.record.evidence_level === sample.evidence_level));
  });

  it('技术参考开关只返回 technical_reference=true 的案例', () => {
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, technicalOnly: true });
    assert.ok(hits.length > 0);
    assert.ok(hits.every((hit) => hit.record.technical_reference === true));
  });

  it('默认按详细度降序，同分按 id 升序（结果稳定可复现）', () => {
    const hits = applyFilters(index, DEFAULT_FILTERS);
    for (let i = 1; i < hits.length; i += 1) {
      const prev = hits[i - 1];
      const curr = hits[i];
      // 用 normalizeDetail 后的字段名（score），不是 calculateDetail 的 detail_score
      if (prev.detail.score === curr.detail.score) {
        assert.ok(
          prev.record.id.localeCompare(curr.record.id) <= 0,
          `同分时 id 应升序：${prev.record.id} > ${curr.record.id}`,
        );
      } else {
        assert.ok(prev.detail.score > curr.detail.score,
          `分数应降序：${prev.detail.score} < ${curr.detail.score}`);
      }
    }
  });

  /**
   * 回归：排序曾静默退化。
   *
   * sort 里写的是 detail.detail_score（calculateDetail 的旧字段名），
   * 而 buildIndex 归一化后的字段是 detail.score —— 分数差恒为 NaN，
   * 而 NaN || x 永远走 fallback，于是排序退化成"只按 id 排"。
   *
   * 为什么之前的单测没抓到：那条用例比较的是 deep/detail_level 这类字符串，
   * 在分数差为 0 的比较里同样落到 id 分支，看起来一切正常。
   * 只有直接断言"分数序列必须单调不增"才能暴露。
   */
  it('排序真的按分数降序，而不是退化（回归）', () => {
    const hits = applyFilters(index, {});
    const scores = hits.map((h) => h.detail.score);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(
        scores[i - 1] >= scores[i],
        `第 ${i} 条出现分数逆序：${scores[i - 1]} < ${scores[i]}`
          + `（${hits[i - 1].record.id} / ${hits[i].record.id}）`,
      );
    }
    // 最高分必须排在最前 —— 若排序完全失效，这里会失败
    const maxScore = Math.max(...cases.map((c) => calculateDetail(c).detail_score));
    assert.equal(scores[0], maxScore, `首条应为最高分 ${maxScore}，实际 ${scores[0]}`);
  });

  it('分面统计与全量数据的实际分布一致', () => {
    const facets = getFacets(enriched);
    const sourceTotal = Object.values(facets.bySource).reduce((sum, n) => sum + n, 0);
    assert.equal(sourceTotal, enriched.length);
    assert.deepEqual(Object.keys(facets.byDetailLevel).sort(), ['deep', 'overview', 'standard']);
  });

  it('facet 计数随筛选条件收敛，且总数不超过全量', () => {
    const sample = enriched[0];
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, industryGroup: sample.industry_group });
    const facets = getFacets(hits.map((hit) => hit.record));
    const industryTotal = Object.values(facets.byIndustryGroup).reduce((sum, n) => sum + n, 0);
    assert.ok(industryTotal > 0);
    assert.ok(industryTotal <= enriched.length);
  });
});

/* ------------------------------------------------------------------ *
 * 数据完整性
 * ------------------------------------------------------------------ */

describe('数据完整性', () => {
  it('ID 全局唯一', () => {
    const ids = cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('中英文 ID 与顺序严格一致', () => {
    assert.deepEqual(cases.map((c) => c.id), enCases.map((c) => c.id));
  });

  it('事实数据中不存在派生字段', () => {
    const derived = ['detail_score', 'detail_level', 'detail_label', 'detail_dimensions', 'missing_details'];
    for (const item of cases) {
      for (const field of derived) {
        assert.ok(!(field in item), `${item.id} 不应包含派生字段 ${field}`);
      }
    }
  });

  it('evidence_label 已完全派生化，数据中不应出现', () => {
    for (const item of cases) {
      assert.ok(!('evidence_label' in item),
        `${item.id} 不应包含 evidence_label —— 它应由 evidence_level 计算得出`);
    }
  });

  it('directness 使用语言中立枚举，中英数据完全对齐', () => {
    const allowed = new Set(Object.keys(DIRECTNESS_LEVELS));
    const zhValues = cases.map((c) => c.source_record.directness);
    const enValues = enCases.map((c) => c.source_record.directness);
    for (const value of zhValues) {
      assert.ok(allowed.has(value), `directness「${value}」不在受控词表内`);
    }
    // 这是双语数据能共用一份 schema 的前提：两边必须存同样的技术值
    assert.deepEqual(enValues, zhValues, '中英 directness 必须逐条一致');
  });

  it('directness 与 evidence_level 不冲突', () => {
    for (const item of cases) {
      const expected = DIRECTNESS_LEVELS[item.source_record.directness];
      assert.equal(expected, item.evidence_level,
        `${item.id}：directness ${item.source_record.directness} 与 evidence_level ${item.evidence_level} 冲突`);
    }
  });

  it('所有主链接均为 HTTPS', () => {
    assert.ok(cases.every((c) => c.url.startsWith('https://')));
  });

  it('技术方案参考案例的技术工作流维度均为满分', () => {
    for (const item of cases.filter((c) => c.technical_reference === true)) {
      assert.equal(calculateDetail(item).detail_dimensions.technical_workflow, 2, `${item.id} 应满分`);
    }
  });

  it('模板化内容不超过阈值上限（作为已知债务的可回归基线）', () => {
    const groups = new Map();
    for (const item of cases) {
      const key = JSON.stringify(item.architecture);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    const worst = Math.max(...groups.values());
    assert.ok(worst <= 14, `当前最大重复组为 ${worst}，超过记录的基线 14`);
    assert.ok(DUPLICATE_BLOCK_THRESHOLD <= worst, '阈值应能捕捉到当前已知的模板化组');
  });

  it('Datawhale 案例的PDF 物理页码 = 印刷页码 + 1', () => {
    for (const item of cases.filter((c) => c.source === 'Datawhale')) {
      assert.equal(item.source_record.pdf_page, item.source_record.printed_page + 1, `${item.id} 页码映射错误`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * URL 状态同步
 * ------------------------------------------------------------------ */

describe('URL 状态同步', () => {
  it('默认状态下不产生任何 query', () => {
    assert.equal(writeToUrl(DEFAULT_FILTERS), '');
  });

  it('非默认值写入短参数名', () => {
    const query = writeToUrl({ ...DEFAULT_FILTERS, search: 'Palantir', detailLevel: 'deep' });
    assert.equal(query, '?q=Palantir&d=deep');
  });

  it('布尔值序列化为 1 而不是 true', () => {
    const query = writeToUrl({ ...DEFAULT_FILTERS, technicalOnly: true });
    assert.equal(query, '?t=1');
  });

  it('读回后与原状态一致（往返无损）', () => {
    const original = {
      ...DEFAULT_FILTERS,
      search: '知识库',
      detailLevel: 'deep',
      source: 'Datawhale',
      industryGroup: '制造与工业',
      evidenceLevel: 'A',
      fde: '明确FDE',
      maturityStage: '已上线',
      technicalOnly: true,
    };
    assert.deepEqual(readFromUrl(writeToUrl(original)), original);
  });

  it('中文参数正确编码与解码', () => {
    const filters = { ...DEFAULT_FILTERS, search: '制造与工业' };
    assert.deepEqual(readFromUrl(writeToUrl(filters)), filters);
  });

  it('忽略未知参数，不污染状态', () => {
    const filters = readFromUrl('?unknown=xxx&q=abc');
    assert.equal(filters.search, 'abc');
    assert.ok(!('unknown' in filters));
  });

  it('空参数值被忽略（不让 ?q= 变成一个有效搜索）', () => {
    assert.equal(readFromUrl('?q=').search, '');
  });

  it('countActive 正确统计生效的筛选数', () => {
    assert.equal(countActive(DEFAULT_FILTERS), 0);
    assert.equal(countActive({ ...DEFAULT_FILTERS, search: 'x' }), 1);
    assert.equal(countActive({ ...DEFAULT_FILTERS, search: 'x', detailLevel: 'deep', technicalOnly: true }), 3);
  });
});

/* ------------------------------------------------------------------ *
 * i18n 增强
 * ------------------------------------------------------------------ */

describe('国际化', () => {
  it('中英文案key 完全对齐', () => {
    assert.deepEqual(missingKeys('en'), []);
    assert.deepEqual(missingKeys('zh'), []);
  });

  it('翻译函数支持占位符插值', () => {
    const t = createTranslator('zh');
    const rendered = t('result.showing', { shown: 5, total: 127 });
    assert.ok(rendered.includes('5'), `插值失败：${rendered}`);
    assert.ok(rendered.includes('127'), `插值失败：${rendered}`);
    assert.ok(!rendered.includes('{shown}'), '占位符未被替换');
  });

  it('缺key 时返回 key 本身而不是空串（便于定位）', () => {
    const t = createTranslator('zh');
    assert.equal(t('definitely.missing.key'), 'definitely.missing.key');
  });

  it('directness 标签随语言切换（语言中立枚举 → 本地化短语）', () => {
    const zh = createTranslator('zh');
    const en = createTranslator('en');
    assert.equal(zh.directness('case_level'), '案例级直接来源');
    assert.equal(en.directness('case_level'), 'Direct case-level source');
    // 同一枚举键，两种语言都能解析出非空标签
    for (const key of ['case_level', 'company_level', 'aggregate', 'secondary', 'lead']) {
      assert.ok(zh.directness(key).length > 0 && en.directness(key).length > 0, `${key} 标签缺失`);
    }
  });

  it('英文数据的成熟度值能被英文翻译器解析', () => {
    const en = createTranslator('en');
    for (const stage of ['In production', 'Scaled', 'Validation', 'Pilot']) {
      assert.equal(en.maturity(stage), stage, `英文成熟度值 ${stage} 应原样返回`);
    }
  });

  it('证据标签按语言生成前缀', () => {
    assert.equal(evidenceLabel('A', 'zh'), 'A级｜案例级直接来源');
    assert.equal(evidenceLabel('B', 'en'), 'Level B | Official aggregate source');
  });
});

await run();