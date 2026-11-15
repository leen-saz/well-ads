// The sidebar's agent dots: next to the tab of each in-app agent, a small dot (no text) that shows whether that agent is working on a
// campaign task right now: pulsing = working, steady grey = not working, red = a task failed. Hidden until a campaign is active.
// One light read of /api/campaigns/agents (the user's own campaigns, no ids, no text): every 6 s while something runs, every 30 s
// otherwise, and not at all while the page is hidden. A failed read changes nothing: the page never waits on this.
export const AGENT_TAB = { knowledge: 'knowledge', content: 'content', design: 'design', voice: 'voice', social: 'social', compliance: 'compliance', optimize: 'maestro' };
const TAB_AGENT = Object.fromEntries(Object.entries(AGENT_TAB).map(([a, k]) => [k, a]));

export function agentDots(side, L, fetcher = () => fetch('/api/campaigns/agents', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null))) {
  let state = null, timer = 0, busy = false;
  const label = st => (st === 'running' ? L('يشتغل الحين على مهمة حملة', 'Working on a campaign task now') : st === 'failed' ? L('فشلت مهمة حملة', 'A campaign task failed') : L('ما يشتغل الحين', 'Not working now'));
  const paint = () => {
    if (!state?.active) { side.querySelectorAll('.agent-dot').forEach(d => d.remove()); return; }
    side.querySelectorAll('a[data-k]').forEach(a => {
      const agent = TAB_AGENT[a.dataset.k];
      if (!agent) return;
      const st = state.agents?.[agent] === 'running' ? 'running' : state.agents?.[agent] === 'failed' ? 'failed' : 'idle';
      let d = a.querySelector('.agent-dot');
      if (!d) { d = document.createElement('i'); d.className = 'agent-dot'; d.setAttribute('role', 'img'); a.append(d); }
      if (d.dataset.s !== st) { d.dataset.s = st; d.setAttribute('aria-label', label(st)); d.title = label(st); }
    });
  };
  const tick = async () => {
    clearTimeout(timer);
    if (!document.hidden && !busy) {
      busy = true;
      try { const j = await fetcher(); if (j && typeof j === 'object') { state = j; paint(); } } catch { /* the next tick tries again */ } finally { busy = false; }
    }
    const running = state?.active && Object.values(state.agents || {}).includes('running');
    timer = setTimeout(tick, running ? 6000 : 30000);
  };
  // the sidebar is drawn again when the profile arrives: paint the dots again on the new markup
  new MutationObserver(() => { if (state?.active) paint(); }).observe(side, { childList: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  // the campaign page tells us right away when a task starts or ends, instead of waiting for the timer
  window.addEventListener('wl-campaign-change', tick);
  tick();
  return { refresh: tick, paint };
}
