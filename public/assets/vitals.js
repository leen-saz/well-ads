// Core Web Vitals of this full page load (UX audit, step 6): LCP, INP, CLS and the server's response time,
// sent once when the page is hidden. Read in the Worker logs (src/api/routes/vitals.ts). Targets:
// LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.
let started = false;
export function measure() {
  if (started || typeof PerformanceObserver === 'undefined') return;
  started = true;
  const v = { path: location.pathname, lcp: null, inp: null, cls: 0, ttfb: null, mobile: matchMedia('(max-width: 760px)').matches };
  const watch = (type, fn, opts = {}) => { try { new PerformanceObserver(l => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); } catch { /* not supported */ } };
  watch('largest-contentful-paint', e => { v.lcp = e.startTime; });
  // Layout shifts not caused by the user's own input
  watch('layout-shift', e => { if (!e.hadRecentInput) v.cls += e.value; });
  // The slowest interaction (a close stand-in for INP on pages with few interactions)
  watch('event', e => { if (e.interactionId) v.inp = Math.max(v.inp || 0, e.duration); }, { durationThreshold: 40 });
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav) v.ttfb = nav.responseStart;
  let sent = false;
  const send = () => {
    if (sent || document.visibilityState !== 'hidden') return;
    sent = true;
    try { navigator.sendBeacon('/api/vitals/report', new Blob([JSON.stringify(v)], { type: 'application/json' })); } catch { /* best effort */ }
  };
  addEventListener('visibilitychange', send);
  addEventListener('pagehide', () => { if (!sent) { sent = true; try { navigator.sendBeacon('/api/vitals/report', new Blob([JSON.stringify(v)], { type: 'application/json' })); } catch {} } });
}
