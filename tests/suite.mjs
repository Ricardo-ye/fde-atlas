/**
 * �����׼���ڡ�
 *
 * ����������������ع������Ļ����Ķ�����
 *   1. �������� ���� ������������������ԣ�
 *   2. schema У���� ���� ��Ҫ��ץ����Ҳ���ܶԺϷ������󱨣�
 *   3. ������ɸѡ ���� ǰ���߼���ɴ���������� Node ��ֱ�Ӳ⣻
 *   4. URL ״̬ͬ�� ���� ���л�/�����л�������������
 *   5. ���ʻ� ���� ���԰� key ���롢ռλ����ֵ����������ö�ٱ��ػ���
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
 * ��������
 * ------------------------------------------------------------------ */

describe('�������� �� ��ά����', () => {
  const base = {
    problem: 'x'.repeat(60),
    solution: 'x'.repeat(70),
    architecture: Array.from({ length: 6 }, (_, i) => `step-${i}`),
    components: ['a', 'b', 'c', 'd', 'e'],
    human: 'x'.repeat(40),
    fde_actions: ['a', 'b', 'c', 'd', 'e'],
    result: 'Ч������ 30%',
    evidence_level: 'A',
  };

  it('������ά�� 12 �ֲ���Ϊ deep', () => {
    const detail = calculateDetail(base);
    assert.equal(detail.detail_score, 12);
    assert.equal(detail.detail_level, 'deep');
    assert.deepEqual(detail.missing_details, []);
  });

  it('ҵ�񱳾������ȷ�������>=50 ���֡�>=25 һ�֡��������', () => {
    assert.equal(calculateDetail({ ...base, problem: 'x'.repeat(50) }).detail_dimensions.business_context, 2);
    assert.equal(calculateDetail({ ...base, problem: 'x'.repeat(25) }).detail_dimensions.business_context, 1);
    assert.equal(calculateDetail({ ...base, problem: 'x'.repeat(24) }).detail_dimensions.business_context, 0);
  });

  it('����������Ҫ����·�����ͬʱ���Ÿ�����', () => {
    assert.equal(calculateDetail(base).detail_dimensions.technical_workflow, 2);
    // ������� 5���ʹ��·����Ҳֻ�� 1 ��
    assert.equal(
      calculateDetail({ ...base, components: ['a', 'b'] }).detail_dimensions.technical_workflow, 1,
    );
    // ��·ֻ�� 4 ��ʱ���� 1 ��
    assert.equal(
      calculateDetail({ ...base, architecture: ['a', 'b', 'c', 'd'] }).detail_dimensions.technical_workflow, 1,
    );
    assert.equal(calculateDetail({ ...base, architecture: ['a'] }).detail_dimensions.technical_workflow, 0);
  });

  it('�˻�����Ҫ���˹�������FDE ����ͬʱ���', () => {
    assert.equal(calculateDetail(base).detail_dimensions.human_governance, 2);
    assert.equal(
      calculateDetail({ ...base, fde_actions: ['a'] }).detail_dimensions.human_governance, 1,
    );
    assert.equal(calculateDetail({ ...base, human: 'short' }).detail_dimensions.human_governance, 0);
  });

  it('�������ʶ������+��λ��Ҳʶ����ҷ���ǰ׺', () => {
    assert.equal(calculateDetail({ ...base, result: '�ɱ��½� 40%' }).detail_dimensions.measured_outcome, 2);
    assert.equal(calculateDetail({ ...base, result: '��ʡ $1.2M' }).detail_dimensions.measured_outcome, 2);
    assert.equal(calculateDetail({ ...base, result: '12��ŷԪ' }).detail_dimensions.measured_outcome, 2);
  });

  it('����������ֻ�� 1 �֣�������Ϊ����', () => {
    // ���ȱ��� >=20 �����ʸ��� 1 �֣���λ�û���κ�����+��λ���
    const qualitative = '����Ч���н����Ը��ƣ�ҵ���ŷ���ʹ���������ã����Ƿ�Χ������';
    assert.ok([...qualitative].length >= 20, 'ǰ��������������ﵽ 20 ���ż�');
    assert.equal(
      calculateDetail({ ...base, result: qualitative }).detail_dimensions.measured_outcome,
      1,
    );
  });

  it('��Դ�ɶ�λ��ֱ����֤�ݵȼ�ӳ�䣺A=2��B/C=1��D=0', () => {
    assert.equal(calculateDetail({ ...base, evidence_level: 'A' }).detail_dimensions.source_traceability, 2);
    assert.equal(calculateDetail({ ...base, evidence_level: 'B' }).detail_dimensions.source_traceability, 1);
    assert.equal(calculateDetail({ ...base, evidence_level: 'C' }).detail_dimensions.source_traceability, 1);
    assert.equal(calculateDetail({ ...base, evidence_level: 'D' }).detail_dimensions.source_traceability, 0);
  });

  it('�ּ���ֵ��>=10 deep��>=7 standard������ overview', () => {
    /** ����ǡ���õ� target �ֵ���������ά�ۼӣ�ÿά���� 2 �֡� */
    const at = (target) => {
      const item = {
        problem: '', solution: '', architecture: [], components: [],
        human: '', fde_actions: [], result: '', evidence_level: 'D',
      };
      let remaining = target;
      // �� DIMENSION_KEYS ˳������ǰ����ά��ֱ���չ� target ��
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
        if (key === 'measured_outcome') item.result = '���� 30%';
        if (key === 'source_traceability') item.evidence_level = 'A';
        remaining -= 2;
      }
      const detail = calculateDetail(item);
      // ȷ�Ϲ�����ķ���ȷʵ����Ŀ��ֵ�������������д��ȴͨ��
      assert.equal(detail.detail_score, target, `���� ${target} �ֵ�����ʧ��`);
      return detail.detail_level;
    };
    assert.equal(at(12), 'deep');
    assert.equal(at(10), 'deep');
    assert.equal(at(8), 'standard');
    assert.equal(at(6), 'overview');
  });

  it('ȱ�ֶ�ʱ�������쳣����0 �ִ���', () => {
    const detail = calculateDetail({});
    assert.equal(detail.detail_score, 0);
    assert.equal(detail.detail_level, 'overview');
    assert.deepEqual(Object.keys(detail.detail_dimensions).sort(), [...DIMENSION_KEYS].sort());
  });

  it('�����Ǵ����������޸����', () => {
    const snapshot = JSON.stringify(base);
    calculateDetail(base);
    assert.equal(JSON.stringify(base), snapshot);
  });

  it('ÿ��ά�ȵ����ֶ���2 �֣��ܷ����� 12', () => {
    for (const item of cases) {
      const { detail_score: score, detail_dimensions: dims } = calculateDetail(item);
      assert.ok(score >= 0 && score <= 12, `${item.id} �ܷ�Խ�磺${score}`);
      for (const key of DIMENSION_KEYS) {
        assert.ok(dims[key] >= 0 && dims[key] <= 2, `${item.id}.${key} ά��Խ�磺${dims[key]}`);
      }
    }
  });

  it('missing_details ֻ�г�δ���ֵ�ά�ȣ��ұ�ǩ���ɽ���', () => {
    const detail = calculateDetail(cases[0]);
    const expected = DIMENSION_KEYS.filter((k) => detail.detail_dimensions[k] < 2);
    assert.deepEqual(detail.missing_details, expected);
    assert.ok(DETAIL_LEVEL_KEYS[detail.detail_level]);
  });
});

/* ------------------------------------------------------------------ *
 * Schema У����
 * ------------------------------------------------------------------ */

describe('Schema У����', () => {
  const validator = new SchemaValidator(schema);

  it('ȫ�� 127 �����İ���ͨ���ṹУ��', () => {
    const errors = validator.validate(cases, { basePath: 'cases.json' });
    assert.deepEqual(errors, [], `��Ӧ�нṹ����ʵ�� ${errors.length} ��`);
  });

  it('Ӣ�ľ���ͬ��ͨ���ṹУ��', () => {
    const errors = validator.validate(enCases, { basePath: 'cases.en.json' });
    assert.deepEqual(errors, []);
  });

  it('��������ֶ�ȱʧ', () => {
    const broken = { ...cases[0] };
    delete broken.source_record;
    const errors = validator.validate([broken]);
    assert.ok(errors.some((e) => e.includes('source_record')));
  });

  it('�������ʹ���', () => {
    const errors = validator.validate([{ ...cases[0], url: 12345 }]);
    assert.ok(errors.some((e) => e.includes('����ӦΪ string')));
  });

  it('����δ�����Ķ����ֶΣ�additionalProperties: false��', () => {
    const errors = validator.validate([{ ...cases[0], detail_score_stub: 1 }]);
    assert.ok(errors.some((e) => e.includes('�������Ķ����ֶ�')));
  });

  it('���� evidence_level �Ƿ�ȡֵ', () => {
    const errors = validator.validate([{ ...cases[0], evidence_level: 'Z' }]);
    assert.ok(errors.some((e) => e.includes('evidence_level')));
  });

  it('����� HTTPS ������', () => {
    const errors = validator.validate([{ ...cases[0], url: 'http://example.com' }]);
    assert.ok(errors.some((e) => e.includes('httpsUrl') || e.includes('��ƥ���ʽ')));
  });

  it('�������ڸ�ʽ����', () => {
    const broken = { ...cases[0], source_record: { ...cases[0].source_record, accessed_at: '2026/09/19' } };
    const errors = validator.validate([broken]);
    assert.ok(errors.some((e) => e.includes('accessed_at')));
  });

  it('����Ƕ�������еķǷ�Ԫ�أ�additional_sources��', () => {
    const broken = { ...cases[0], additional_sources: [{ title: 'ok' }] };
    const errors = validator.validate([broken]);
    assert.ok(errors.some((e) => e.includes('additional_sources[0]') && e.includes('url')));
  });

  it('�����鲻���� minItems ֮�����', () => {
    const errors = validator.validate([{ ...cases[0], additional_sources: [] }]);
    assert.deepEqual(errors, []);
  });

  it('minLength ���������������ַ������������', () => {
    // problem Ҫ�� >=10 �ַ���10 �������ַ�ǡ��ͨ��
    const exactly10 = 'һ�����������߰˾�ʮ';
    assert.equal([...exactly10].length, 10);
    const errors = validator.validate([{ ...cases[0], problem: exactly10 }]);
    assert.deepEqual(errors, []);
  });

  it('schema �����δ֧�ֹؼ���ʱ������ֱ���״�������Ĭ�Ź�', () => {
    assert.throws(
      () => new SchemaValidator({ type: 'object', oneOf: [{ type: 'string' }] }),
      'oneOf Ӧ�����״�',
    );
    assert.throws(
      () => new SchemaValidator({ type: 'object', $ref: 'https://remote/schema.json' }),
      'Զ�� $ref Ӧ�����״�',
    );
  });
});

/* ------------------------------------------------------------------ *
 * ������ɸѡ
 * ------------------------------------------------------------------ */

describe('������ɸѡ', () => {
  const enriched = cases.map((item) => ({ ...item, detail: calculateDetail(item) }));
  const index = buildIndex(enriched);

  /**
   * �ع�����������������ܴ���"����������̬"��
   * ��������ʵȱ�� ���� build.mjs �ҵ��� { score, level, dimensions, missing }��
   * �� search.js ������ detail_level / detail_dimensions��
   * �����Node ���⣨�� calculateDetail �����ȫ�̣��������"��Ȱ���"ɸѡ��Ϊ 0 ����
   * ��������ר������"������̬������Ϊһ��"��
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

  it('���� detail ��̬������������ȫ�ȼ�', () => {
    assert.equal(browserIndex.length, index.length);
    browserIndex.forEach((entry, i) => {
      assert.equal(entry.detail.level, index[i].detail.level, `�� ${i} �� level ��һ��`);
      assert.equal(entry.detail.score, index[i].detail.score, `�� ${i} �� score ��һ��`);
      assert.deepEqual(entry.detail.dimensions, index[i].detail.dimensions);
    });
  });

  it('����������̬����ϸ��ɸѡ���ã��ع飺����Ϊ 0 ����', () => {
    const deepHits = applyFilters(browserIndex, { detailLevel: 'deep' });
    const expected = cases.filter((c) => calculateDetail(c).detail_level === 'deep').length;
    assert.equal(deepHits.length, expected);
    assert.ok(deepHits.length > 0, '���ɸѡ��Ӧ���ؿռ�');
  });

  it('����������̬�� getFacets ����������ϸ��', () => {
    const facets = getFacets(browserShape);
    assert.deepEqual(Object.keys(facets.byDetailLevel).sort(), ['deep', 'overview', 'standard']);
  });

  it('��������ȫ�������Ҹ��������ı�', () => {
    assert.equal(index.length, enriched.length);
    assert.ok(index.every((entry) => typeof entry.haystack === 'string' && entry.haystack.length > 0));
  });

  it('�����ı���Сд������ѯ������ת��', () => {
    const first = index[0];
    assert.equal(first.haystack, first.haystack.toLowerCase());
  });

  it('����˾�����������ж�Ӧ����', () => {
    const target = enriched[0].company;
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, search: target });
    assert.ok(hits.length > 0, `Ӧ���� ${target}`);
    assert.ok(hits.some((hit) => hit.record.company === target));
  });

  it('�����޽��ʱ���ؿ�������Ǳ���', () => {
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, search: 'zzz-�����ڵĹ�˾-zzz' });
    assert.deepEqual(hits, []);
  });

  it('������Ϊ AND ��ϵ��ͬʱָ����ҵ��֤�ݵȼ�', () => {
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

  it('�����ο�����ֻ���� technical_reference=true �İ���', () => {
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, technicalOnly: true });
    assert.ok(hits.length > 0);
    assert.ok(hits.every((hit) => hit.record.technical_reference === true));
  });

  it('Ĭ�ϰ���ϸ�Ƚ���ͬ�ְ� id ���򣨽���ȶ��ɸ��֣�', () => {
    const hits = applyFilters(index, DEFAULT_FILTERS);
    for (let i = 1; i < hits.length; i += 1) {
      const prev = hits[i - 1];
      const curr = hits[i];
      // �� normalizeDetail ����ֶ�����score�������� calculateDetail �� detail_score
      if (prev.detail.score === curr.detail.score) {
        assert.ok(
          prev.record.id.localeCompare(curr.record.id) <= 0,
          `ͬ��ʱ id Ӧ����${prev.record.id} > ${curr.record.id}`,
        );
      } else {
        assert.ok(prev.detail.score > curr.detail.score,
          `����Ӧ����${prev.detail.score} < ${curr.detail.score}`);
      }
    }
  });

  /**
   * �ع飺��������Ĭ�˻���
   *
   * sort ��д���� detail.detail_score��calculateDetail �ľ��ֶ�������
   * �� buildIndex ��һ������ֶ��� detail.score ���� �������Ϊ NaN��
   * �� NaN || x ��Զ�� fallback�����������˻���"ֻ�� id ��"��
   *
   * Ϊʲô֮ǰ�ĵ���ûץ�������������Ƚϵ��� deep/detail_level �����ַ�����
   * �ڷ�����Ϊ 0 �ıȽ���ͬ���䵽 id ��֧��������һ��������
   * ֻ��ֱ�Ӷ���"�������б��뵥������"���ܱ�¶��
   */
  it('������İ��������򣬶������˻����ع飩', () => {
    const hits = applyFilters(index, {});
    const scores = hits.map((h) => h.detail.score);
    for (let i = 1; i < scores.length; i += 1) {
      assert.ok(
        scores[i - 1] >= scores[i],
        `�� ${i} �����ַ�������${scores[i - 1]} < ${scores[i]}`
          + `��${hits[i - 1].record.id} / ${hits[i].record.id}��`,
      );
    }
    // ��߷ֱ���������ǰ ���� ��������ȫʧЧ�������ʧ��
    const maxScore = Math.max(...cases.map((c) => calculateDetail(c).detail_score));
    assert.equal(scores[0], maxScore, `����ӦΪ��߷� ${maxScore}��ʵ�� ${scores[0]}`);
  });

  it('����ͳ����ȫ�����ݵ�ʵ�ʷֲ�һ��', () => {
    const facets = getFacets(enriched);
    const sourceTotal = Object.values(facets.bySource).reduce((sum, n) => sum + n, 0);
    assert.equal(sourceTotal, enriched.length);
    assert.deepEqual(Object.keys(facets.byDetailLevel).sort(), ['deep', 'overview', 'standard']);
  });

  it('facet ������ɸѡ����������������������ȫ��', () => {
    const sample = enriched[0];
    const hits = applyFilters(index, { ...DEFAULT_FILTERS, industryGroup: sample.industry_group });
    const facets = getFacets(hits.map((hit) => hit.record));
    const industryTotal = Object.values(facets.byIndustryGroup).reduce((sum, n) => sum + n, 0);
    assert.ok(industryTotal > 0);
    assert.ok(industryTotal <= enriched.length);
  });
});

/* ------------------------------------------------------------------ *
 * ����������
 * ------------------------------------------------------------------ */

describe('����������', () => {
  it('ID ȫ��Ψһ', () => {
    const ids = cases.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('��Ӣ�� ID ��˳���ϸ�һ��', () => {
    assert.deepEqual(cases.map((c) => c.id), enCases.map((c) => c.id));
  });

  it('��ʵ�����в����������ֶ�', () => {
    const derived = ['detail_score', 'detail_level', 'detail_label', 'detail_dimensions', 'missing_details'];
    for (const item of cases) {
      for (const field of derived) {
        assert.ok(!(field in item), `${item.id} ��Ӧ���������ֶ� ${field}`);
      }
    }
  });

  it('evidence_label ����ȫ�������������в�Ӧ����', () => {
    for (const item of cases) {
      assert.ok(!('evidence_label' in item),
        `${item.id} ��Ӧ���� evidence_label ���� ��Ӧ�� evidence_level ����ó�`);
    }
  });

  it('directness ʹ����������ö�٣���Ӣ������ȫ����', () => {
    const allowed = new Set(Object.keys(DIRECTNESS_LEVELS));
    const zhValues = cases.map((c) => c.source_record.directness);
    const enValues = enCases.map((c) => c.source_record.directness);
    for (const value of zhValues) {
      assert.ok(allowed.has(value), `directness��${value}�������ܿشʱ���`);
    }
    // ����˫�������ܹ���һ�� schema ��ǰ�᣺���߱����ͬ���ļ���ֵ
    assert.deepEqual(enValues, zhValues, '��Ӣ directness ��������һ��');
  });

  it('directness �� evidence_level ����ͻ', () => {
    for (const item of cases) {
      const expected = DIRECTNESS_LEVELS[item.source_record.directness];
      assert.equal(expected, item.evidence_level,
        `${item.id}��directness ${item.source_record.directness} �� evidence_level ${item.evidence_level} ��ͻ`);
    }
  });

  it('���������Ӿ�Ϊ HTTPS', () => {
    assert.ok(cases.every((c) => c.url.startsWith('https://')));
  });

  it('���������ο������ļ���������ά�Ⱦ�Ϊ����', () => {
    for (const item of cases.filter((c) => c.technical_reference === true)) {
      assert.equal(calculateDetail(item).detail_dimensions.technical_workflow, 2, `${item.id} Ӧ����`);
    }
  });

  it('ģ�廯���ݲ�������ֵ���ޣ���Ϊ��֪ծ��Ŀɻع���ߣ�', () => {
    const groups = new Map();
    for (const item of cases) {
      const key = JSON.stringify(item.architecture);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    const worst = Math.max(...groups.values());
    assert.ok(worst <= 14, `��ǰ����ظ���Ϊ ${worst}��������¼�Ļ��� 14`);
    assert.ok(DUPLICATE_BLOCK_THRESHOLD <= worst, '��ֵӦ�ܲ�׽����ǰ��֪��ģ�廯��');
  });

  it('Datawhale ������PDF ����ҳ�� = ӡˢҳ�� + 1', () => {
    for (const item of cases.filter((c) => c.source === 'Datawhale')) {
      assert.equal(item.source_record.pdf_page, item.source_record.printed_page + 1, `${item.id} ҳ��ӳ�����`);
    }
  });
});

/* ------------------------------------------------------------------ *
 * URL ״̬ͬ��
 * ------------------------------------------------------------------ */

describe('URL ״̬ͬ��', () => {
  it('Ĭ��״̬�²������κ� query', () => {
    assert.equal(writeToUrl(DEFAULT_FILTERS), '');
  });

  it('��Ĭ��ֵд��̲�����', () => {
    const query = writeToUrl({ ...DEFAULT_FILTERS, search: 'Palantir', detailLevel: 'deep' });
    assert.equal(query, '?q=Palantir&d=deep');
  });

  it('����ֵ���л�Ϊ 1 ������ true', () => {
    const query = writeToUrl({ ...DEFAULT_FILTERS, technicalOnly: true });
    assert.equal(query, '?t=1');
  });

  it('���غ���ԭ״̬һ�£���������', () => {
    const original = {
      ...DEFAULT_FILTERS,
      search: '֪ʶ��',
      detailLevel: 'deep',
      source: 'Datawhale',
      industryGroup: '�����빤ҵ',
      evidenceLevel: 'A',
      fde: '��ȷFDE',
      maturityStage: '������',
      technicalOnly: true,
    };
    assert.deepEqual(readFromUrl(writeToUrl(original)), original);
  });

  it('���Ĳ�����ȷ���������', () => {
    const filters = { ...DEFAULT_FILTERS, search: '�����빤ҵ' };
    assert.deepEqual(readFromUrl(writeToUrl(filters)), filters);
  });

  it('����δ֪����������Ⱦ״̬', () => {
    const filters = readFromUrl('?unknown=xxx&q=abc');
    assert.equal(filters.search, 'abc');
    assert.ok(!('unknown' in filters));
  });

  it('�ղ���ֵ�����ԣ����� ?q= ���һ����Ч������', () => {
    assert.equal(readFromUrl('?q=').search, '');
  });

  it('countActive ��ȷͳ����Ч��ɸѡ��', () => {
    assert.equal(countActive(DEFAULT_FILTERS), 0);
    assert.equal(countActive({ ...DEFAULT_FILTERS, search: 'x' }), 1);
    assert.equal(countActive({ ...DEFAULT_FILTERS, search: 'x', detailLevel: 'deep', technicalOnly: true }), 3);
  });
});

/* ------------------------------------------------------------------ *
 * i18n ��ǿ
 * ------------------------------------------------------------------ */

describe('���ʻ�', () => {
  it('��Ӣ�İ�key ��ȫ����', () => {
    assert.deepEqual(missingKeys('en'), []);
    assert.deepEqual(missingKeys('zh'), []);
  });

  it('���뺯��֧��ռλ����ֵ', () => {
    const t = createTranslator('zh');
    const rendered = t('result.showing', { shown: 5, total: 127 });
    assert.ok(rendered.includes('5'), `��ֵʧ�ܣ�${rendered}`);
    assert.ok(rendered.includes('127'), `��ֵʧ�ܣ�${rendered}`);
    assert.ok(!rendered.includes('{shown}'), 'ռλ��δ���滻');
  });

  it('ȱkey ʱ���� key ���������ǿմ������ڶ�λ��', () => {
    const t = createTranslator('zh');
    assert.equal(t('definitely.missing.key'), 'definitely.missing.key');
  });

  it('directness ��ǩ�������л�����������ö�� �� ���ػ����', () => {
    const zh = createTranslator('zh');
    const en = createTranslator('en');
    assert.equal(zh.directness('case_level'), '������ֱ����Դ');
    assert.equal(en.directness('case_level'), 'Direct case-level source');
    // ͬһö�ټ����������Զ��ܽ������ǿձ�ǩ
    for (const key of ['case_level', 'company_level', 'aggregate', 'secondary', 'lead']) {
      assert.ok(zh.directness(key).length > 0 && en.directness(key).length > 0, `${key} ��ǩȱʧ`);
    }
  });

  it('Ӣ�����ݵĳ����ֵ�ܱ�Ӣ�ķ���������', () => {
    const en = createTranslator('en');
    for (const stage of ['In production', 'Scaled', 'Validation', 'Pilot']) {
      assert.equal(en.maturity(stage), stage, `Ӣ�ĳ����ֵ ${stage} Ӧԭ������`);
    }
  });

  it('֤�ݱ�ǩ����������ǰ׺', () => {
    assert.equal(evidenceLabel('A', 'zh'), 'A����������ֱ����Դ');
    assert.equal(evidenceLabel('B', 'en'), 'Level B | Official aggregate source');
  });
});

await run();