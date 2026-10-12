/**
 * 案例卡片与详情弹窗渲染。
 *
 * 类名约定：
 *   ui-*  来自设计系统（src/ui/），提供通用外观
 *   app-* 本应用特有布局（在 src/styles/app.css）
 *
 * 内容一律经 esc() 转义后再进 innerHTML —— 案例文本来自外部网页摘录，
 * 不转义等于给页面留XSS 口子。
 */

import { esc, renderList, renderSteps, renderChips, renderOptions } from '../core/dom.js';

/** 详细度分级 → 徽章语气。 */
const levelTone = (level) => ({
  deep: 'grade-a',
  standard: 'grade-b',
  overview: 'grade-c',
}[level] ?? 'neutral');

/** 证据等级 → 徽章语气（A/B/C/D 恰好对应 grade-a~d）。 */
const evidenceTone = (level) => `grade-${String(level).toLowerCase()}`;

/** 卡片 HTML。detail 由构建期随数据下发，页面不重算，保证与 manifest 一致。 */
export const renderCard = (record, t) => `
<article class="app-case">
  <div class="app-case__head">
    <div class="ui-row ui-row--wrap ui-row--sm">
      <span class="ui-badge ui-badge--${levelTone(record.detail.level)}">${esc(t(`detail.level.${record.detail.level}`))}</span>
      ${record.technical_reference ? `<span class="ui-badge ui-badge--accent">${esc(t('card.technical'))}</span>` : ''}
      <span class="ui-badge ui-badge--${evidenceTone(record.evidence_level)}">${esc(t.evidence(record.evidence_level))}</span>
    </div>
    <h3 class="app-case__title">${esc(record.company)}</h3>
    <p class="app-case__scenario">${esc(record.scenario)}</p>
  </div>

  <div class="app-case__meta">
    <span>${esc(record.industry_group)}</span>
    <span class="app-case__meta-sep" aria-hidden="true">·</span>
    <span>${esc(record.fde)}</span>
    <span class="app-case__meta-sep" aria-hidden="true">·</span>
    <span>${esc(t.maturity(record.maturity_stage))}</span>
    <span class="app-case__meta-sep" aria-hidden="true">·</span>
    <span class="ui-numeric">${esc(t('detail.score'))} ${record.detail.score}/12</span>
  </div>

  <p class="app-case__summary">${esc(record.case_summary)}</p>

  <div class="app-case__footer">
    <a class="app-case__link" href="#" data-case-id="${esc(record.id)}">${esc(t('card.viewDetail'))} →</a>
    <span class="app-case__id">${esc(record.id)}</span>
  </div>
</article>`;

/** 空状态。 */
export const renderEmpty = (t) => `
<div class="ui-empty">
  <span class="ui-empty__icon" aria-hidden="true">⌕</span>
  <p class="ui-empty__title">${esc(t('result.empty'))}</p>
  <p class="ui-empty__hint">${esc(t('result.emptyHint'))}</p>
</div>`;

/**
 * 骨架屏。
 * 分层加载后首屏有一小段等待窗口（读脚本 + 建索引），
 * 与其留白不如展示占位结构，避免布局跳动。
 */
export const renderSkeleton = (count = 6) => `
${Array.from({ length: count }, () => `
<article class="app-case" aria-hidden="true">
  <div class="app-case__head">
    <div class="ui-row ui-row--sm"><div class="ui-skeleton ui-skeleton--badge" style="width:45%"></div></div>
    <div class="ui-skeleton ui-skeleton--title" style="width:65%"></div>
    <div class="ui-skeleton ui-skeleton--text" style="width:85%"></div>
  </div>
  <div class="ui-skeleton ui-skeleton--text" style="width:100%"></div>
  <div class="ui-skeleton ui-skeleton--text" style="width:55%"></div>
</article>`).join('')}`;

/** 数据加载失败。 */
export const renderError = (message) => `
<div class="ui-empty">
  <span class="ui-empty__icon" aria-hidden="true">⚠</span>
  <p class="ui-empty__title">数据加载失败</p>
  <p class="ui-empty__hint ui-mono">${esc(message)}</p>
</div>`;

/** 详情内容的一个小节。 */
const section = (title, body) => `
<div class="app-detail__section">
  <h3 class="app-detail__title">${esc(title)}</h3>
  ${body}
</div>`;

/** 六维评分条。 */
const renderScoreGrid = (record, t) => `
<div class="ui-grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
  ${Object.entries(record.detail.dimensions).map(([key, value]) => `
  <div class="ui-score">
    <div class="ui-score__head">
      <span>${esc(t.dimension(key))}</span>
      <span class="ui-score__value">${value}/2</span>
    </div>
    <div class="ui-score__track">
      ${[0, 1].map((i) => `<span class="ui-score__seg" data-on="${i < value}"></span>`).join('')}
    </div>
  </div>`).join('')}
</div>`;

/** 来源与证据账本。 */
const renderLedger = (record, t) => {
  const source = record.source_record || {};
  const fields = [
    [t('modal.publisher'), source.publisher],
    [t('modal.claimOrigin'), source.claim_origin],
    // 直接性用语言中立枚举的当前语言标签
    [t('modal.directness'), source.directness ? t.directness(source.directness) : ''],
    [t('modal.independent'), source.independently_verified ? 'Yes / 是' : 'No / 否'],
    [t('modal.accessed'), source.accessed_at],
  ];
  if (source.collection_title) fields.push([t('modal.collection'), source.collection_title]);
  if (source.case_number) fields.push([t('modal.caseNumber'), source.case_number]);
  if (source.pdf_page) fields.push([t('modal.pdfPage'), `${source.pdf_page} / 印刷 ${source.printed_page}`]);

  return `
<div class="ui-keyvalue">
  ${fields.filter(([, value]) => value).map(([label, value]) => `
  <div class="ui-keyvalue__item">
    <span class="ui-keyvalue__label">${esc(label)}</span>
    <span class="ui-keyvalue__value">${esc(value)}</span>
  </div>`).join('')}
</div>`;
};

/** 来源链接列表。 */
const renderSourceLinks = (record, t) => {
  const source = record.source_record || {};
  const primary = `
  <a class="ui-source" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">
    <span class="ui-source__title">${esc(source.title || record.url)}</span>
    <span class="ui-source__meta">${esc(record.url)}</span>
  </a>`;

  const additional = (record.additional_sources || []).map((link) => `
  <a class="ui-source" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">
    <span class="ui-source__title">${esc(link.title)}</span>
    <span class="ui-source__meta">${esc(link.url)}</span>
  </a>`).join('');

  return `<div class="app-detail__sources">${primary}${additional}</div>`;
};

/** 字段来源边界表。 */
const renderBoundary = (record, t) => {
  const rows = Object.entries(record.analysis_boundary || {});
  if (!rows.length) return '';
  return `
<div class="ui-table-wrap">
  <table class="ui-table ui-table--compact">
    <thead>
      <tr><th scope="col">${esc(t('modal.boundary'))}</th><th scope="col">${esc(t('nav.evidence'))}</th></tr>
    </thead>
    <tbody>
      ${rows.map(([field, note]) => `
      <tr>
        <td>${esc(t(`boundary.${field}`) || field)}</td>
        <td>${esc(note)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>`;
};

/**
 * 详情弹窗主体。
 * source_record 与 analysis_boundary 来自详情层，分层加载尚未完成时为空对象，
 * renderLedger / renderBoundary 会自然跳过缺失部分。
 */
export const renderDetail = (record, t) => {
  const notDisclosed = t('modal.notDisclosed');
  const hasLedger = Boolean(record.source_record && Object.keys(record.source_record).length);

  return [
    section(t('modal.problem'), `<p class="ui-prose">${esc(record.problem)}</p>`),
    section(t('modal.solution'), `<p class="ui-prose">${esc(record.solution)}</p>`),
    section(t('modal.architecture'), `<ol class="ui-steps">${(record.architecture || []).map((step) => `<li class="ui-steps__item">${esc(step)}</li>`).join('')}</ol>` || `<p class="app-detail__empty">${esc(notDisclosed)}</p>`),
    section(t('modal.components'), `<div class="ui-row ui-row--wrap ui-row--sm">${(record.components || []).map((c) => `<span class="ui-tag">${esc(c)}</span>`).join('')}</div>`),
    section(t('modal.human'), `<p class="ui-prose">${esc(record.human)}</p>`),
    section(t('modal.fdeActions'), renderList(record.fde_actions, notDisclosed)),
    section(t('modal.reusable'), renderList(record.reusable, notDisclosed)),
    section(t('modal.result'), `<p class="ui-prose">${esc(record.result)}</p>`),
    section(
      `${t('detail.score')} · ${record.detail.score}/12`,
      `${renderScoreGrid(record, t)}
       <p class="app-detail__note">${esc(t('detail.gaps'))}：${
  record.detail.missing.length
    ? esc(record.detail.missing.map((key) => t.dimension(key)).join(' · '))
    : esc(t('detail.noGaps'))}</p>`,
    ),
    hasLedger ? section(t('modal.ledger'), renderLedger(record, t)) : '',
    hasLedger && record.analysis_boundary ? section(t('modal.boundary'), renderBoundary(record, t)) : '',
    section(t('modal.verification'), renderList(record.verification_notes, notDisclosed)),
    section(t('modal.primary'), renderSourceLinks(record, t)),
  ].join('');
};

/**
 * 复制到剪贴板的摘要（纯文本，不含 HTML）。
 *
 * 来源用 Markdown 链接而不是裸 URL：贴到 Slack / Notion / GitHub
 * 等支持 Markdown 的地方会直接变成可点链接，贴到纯文本编辑器也不丢信息。
 */
export const buildSummaryText = (record, t) => {
  const primary = [`- [${record.source_record?.title || record.url}](${record.url})`];
  const additional = (record.additional_sources || [])
    .map((source) => `- [${source.title}](${source.url})`);
  // source_record 只在详情层才有，缺失时退回只给主链接
  const sources = record.source_record ? [...primary, ...additional] : [`- ${record.url}`];

  return [
    `【${record.company} · ${record.scenario}】`,
  `${t('modal.caseId')}: ${record.id}`,
    `${t('detail.score')}: ${record.detail.score}/12`,
    '',
    `${t('modal.problem')}：${record.problem}`,
  `${t('modal.solution')}：${record.solution}`,
    `${t('modal.result')}：${record.result}`,
    '',
    `${t('modal.architecture')}：`,
    ...(record.architecture || []).map((step, i) => `${i + 1}. ${step}`),
    '',
  `${t('modal.primary')}：`,
    ...sources,
    '',
    t('evidence.hint'),
  ].join('\n');
};

export { renderOptions, renderChips, renderSteps };