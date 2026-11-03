// تنبيهات الامتثال بنفس الشكل في كل تاب: العبارة بالضبط، والقاعدة، والسبب، والمصدر، والأسلم. تنبيه بس، ما يمنع شي.
import { esc } from './common.js';

export const LEVEL = { critical: 'مخالفة', warn: 'انتبه', info: 'ملاحظة' };
// The text with each hit's exact phrase marked (hits carry start/end on the original text)
export function marked(text, hits) {
  const spans = [...hits].filter(h => h.end > h.start).sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const h of spans) {
    if (h.start < at) continue;
    out += esc(text.slice(at, h.start)) + `<mark title="${esc(h.title)}">${esc(text.slice(h.start, h.end))}</mark>`;
    at = h.end;
  }
  return out + esc(text.slice(at));
}
const src = s => s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>، ${esc(s.ref)}` : `${esc(s.name)}، ${esc(s.ref)}`;
export const hitsHTML = hits => hits.map(h => `<div class="cp-hit ${h.level}"><div class="cp-meta"><span class="dg-tag">${LEVEL[h.level]}</span><b>${esc(h.title)}</b><span class="muted">«${esc(h.match)}»</span></div>
  <span class="muted">${esc(h.why)}</span><div class="dg-fix"><b>الأسلم:</b> ${esc(h.fix)}</div>
  <span class="muted cp-src">المصدر: ${(h.source || []).map(src).join(' · ')}</span></div>`).join('');
// A whole block: the marked text, then the hits. Empty when the text is clean.
export const block = (text, hits) => hits && hits.length ? `<div class="cp-box"><p class="cp-q" dir="auto">${marked(text, hits)}</p>${hitsHTML(hits)}</div>` : '';
