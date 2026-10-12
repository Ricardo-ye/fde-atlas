#!/usr/bin/env node
/**
 * �����ع���һ���Խű�����Ӧ�ã������Ա㸴�֣���
 *
 * ������evidence_label ���� 14 �ֱ༭��д���
 *   ��"A��������������Դ" / "A������ҵ���̲���ֱ����Դ" / ...����
 *   ���������� evidence_level Ψһ��������Щ�����ǣ�
 *     1. ���� validate.mjs ��� 77 �� "δʹ�ñ�׼���" ������
 *     2. �� source_record.directness �����ͻ
 *        ������directness='��ҵ��ֱ����Դ' ȴ�� A ����label д"��ҵ����ֱ����Դ"����
 *     3. Υ��"ͬһ����ֻ��һ������"������Դ�������� source_type/directness ���
 *
 * ���ű���
 *   1. ��������ɾ�� evidence_label����Ϊ��������������
 *   2. �� directness ��һΪ�ܿشʱ�����Դ����ϸ��ͳһ������ source_type��
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

/** ��һ���ֱ���Դʱ���֤�ݵȼ�����"�ܷ�λ����һ��"�� */
const DIRECTNESS = {
  '������ֱ����Դ': 'A',
  '��ҵ��ֱ����Դ': 'A',
  '�ٷ�������Դ': 'B',
  '���Ŷ��β���': 'C',
  '����������': 'D',
};

const normalize = (records) => {
  let relabeled = 0;
  const out = records.map((record) => {
    const copy = { ...record };
    delete copy.evidence_label;

    const source = { ...(copy.source_record || {}) };
    const original = String(source.directness || '').trim();

    // �ʱ���һ��ֻ�������ֱ�׼ֱ���ԣ��� evidence_level ��Ӧ
    if (original && !DIRECTNESS[original]) {
      // ��ʷ���������"����������Դ""��ҵ���̲���ֱ����Դ"�������ǣ�
      // ���������϶�����"������ֱ����Դ"�����ȼ����˼���
      source.directness = DIRECTNESS[copy.evidence_level] === 'A'
        ? '������ֱ����Դ'
        : (DIRECTNESS[copy.evidence_level] || original);
      relabeled += 1;
    }
    // directness �� evidence_level ��ͻʱ�Եȼ�Ϊ׼���ȼ������ܿشʱ���
    const expected = DIRECTNESS[source.directness];
    if (expected && expected !== copy.evidence_level) {
      source.directness = copy.evidence_level === 'A' ? '������ֱ����Դ'
        : copy.evidence_level === 'B' ? '�ٷ�������Դ'
          : copy.evidence_level === 'C' ? '���Ŷ��β���' : '����������';
      relabeled += 1;
    }

    copy.source_record = source;
    return copy;
  });
  return { out, relabeled };
};

for (const [file, label] of [['data/cases.json', '����'], ['data/cases.en.json', 'Ӣ��']]) {
  const records = read(file);
  const { out, relabeled } = normalize(records);
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${label}��${out.length} ����ɾ�� evidence_label����һ directness ${relabeled} ��`);
}