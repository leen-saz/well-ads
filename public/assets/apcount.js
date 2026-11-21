// The live number next to «الاعتمادات» in the sidebar (docs/PRD.md §3.1, §4.4; milestone M4). Reads /api/approvals/counts
// (counts only, never content) when the page opens, every 60 seconds while the tab is visible, when the tab comes back,
// and when the approvals page decides something (event «well:approvals»). No long-lived connection. Installed once per
// document: the sidebar is kept across page changes, the number is found again by [data-ap-n] each time.
const EVERY = 60_000;
let timer = 0, last = null, inflight = null;

function paint(n) {
  for (const b of document.querySelectorAll('[data-ap-n]')) {
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n || '');
    const a = b.closest('a');
    if (a) a.setAttribute('aria-label', n ? `${a.querySelector('span')?.textContent || ''} (${n})` : (a.querySelector('span')?.textContent || ''));
  }
}

export function refresh() {
  if (!document.querySelector('[data-ap-n]') || document.hidden) return Promise.resolve();
  if (inflight) return inflight;
  inflight = fetch('/api/approvals/counts', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => { if (j?.counts) { last = j.counts.total | 0; paint(last); } })
    .catch(() => { /* the number simply stays as it was */ })
    .finally(() => { inflight = null; });
  return inflight;
}

export function startCounts() {
  if (last !== null) paint(last);   // a page change redraws the sidebar: show the known number at once
  refresh();
  if (window.__wlApCount) return;
  window.__wlApCount = true;
  timer = window.setInterval(refresh, EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('well:approvals', () => refresh());
}
export const _test = { paint, get timer() { return timer; } };
