#!/usr/bin/env node
/**
 * 数据重构（一次性脚本，已应用；保留以便复现）。
 *
 * 背景：evidence_label 混入 14 种编辑手写措辞
 *   （"A级｜厂商逐案例来源" / "A级｜企业工程博客直接来源" / ...），
 *   而它本该由 evidence_level 唯一决定。这些额外措辞：
 *     1. 导致 validate.mjs 输出 77 条 "未使用标准措辞" 噪音；
 *     2. 与 source_record.directness 表达冲突
 *        （例：directness='企业级直接来源' 却标 A 级，label 写"企业自述直接来源"）；
 *     3. 违反"同一概念只有一处定义"——来源类型已由 source_type/directness 表达。
 *
 * 本脚本：
 *   1. 从数据中删除 evidence_label（改为构建期派生）；
 *   2. 把 directness 归一为受控词表，来源类型细节统一收敛到 source_type。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

/** 归一后的直接性词表：证据等级决定"能否定位到这一条"。 */
const DIRECTNESS = {
  '案例级直接来源': 'A',
  '企业级直接来源': 'A',
  '官方汇总来源': 'B',
  '可信二次材料': 'C',
  '线索待核验': 'D',
};

const normalize = (records) => {
  let relabeled = 0;
  const out = records.map((record) => {
    const copy = { ...record };
    delete copy.evidence_label;

    const source = { ...(copy.source_record || {}) };
    const original = String(source.directness || '').trim();

    // 词表归一：只保留四种标准直接性，与 evidence_level 对应
    if (original && !DIRECTNESS[original]) {
      // 历史数据里存在"厂商逐案例来源""企业工程博客直接来源"等自造措辞，
      // 它们语义上都落在"案例级直接来源"，按等级回退即可
      source.directness = DIRECTNESS[copy.evidence_level] === 'A'
        ? '案例级直接来源'
        : (DIRECTNESS[copy.evidence_level] || original);
      relabeled += 1;
    }
    // directness 与 evidence_level 冲突时以等级为准（等级才是受控词表）
    const expected = DIRECTNESS[source.directness];
    if (expected && expected !== copy.evidence_level) {
      source.directness = copy.evidence_level === 'A' ? '案例级直接来源'
        : copy.evidence_level === 'B' ? '官方汇总来源'
          : copy.evidence_level === 'C' ? '可信二次材料' : '线索待核验';
      relabeled += 1;
    }

    copy.source_record = source;
    return copy;
  });
  return { out, relabeled };
};

for (const [file, label] of [['data/cases.json', '中文'], ['data/cases.en.json', '英文']]) {
  const records = read(file);
  const { out, relabeled } = normalize(records);
  fs.writeFileSync(path.join(root, file), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${label}：${out.length} 条，删除 evidence_label，归一 directness ${relabeled} 处`);
}