// The shared period filter (public/assets/period.js): the range math, the saved/URL choice, and the three routes that now take
// ?from=&to= (Riyadh days): listening mentions, listening demand, a manager agent's card. Synthetic data; fetch is stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { analyze } from '../../public/modules/listening/analyze.js';
import { summarize } from '../../public/modules/listening/social.js';
import overview from '../../src/modules/overview/Overview.tsx?raw';
import listenPage from '../../src/modules/listening/Page.astro?raw';
import maestroPage from '../../src/modules/maestro/Page.astro?raw';
import listenJs from '../../public/modules/listening/client.js?raw';
import maestroJs from '../../public/modules/maestro/client.js?raw';
import { addDays, clampRange, daysWord, diffDays, isDay, MAX_SPAN, parseRangeParams, pick, PRESETS, rangeMs, resolvePreset, riyadhToday } from '../../public/assets/period.js';

// "now" is 2026-11-10 01:30 in Riyadh = 2026-11-09 22:30 UTC: the Riyadh day is already the 10th
const NOW = Date.parse('2026-11-09T22:30:00Z');
const TODAY = '2026-11-10';
const ctx = { today: TODAY, last: '2026-11-09', min: '2026-06-01' };

describe('days', () => {
  it('works on Riyadh days', () => {
    expect(riyadhToday(NOW)).toBe(TODAY);
    expect(riyadhToday(Date.parse('2026-11-09T20:59:59Z'))).toBe('2026-11-09');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-10-01', '2026-11-10')).toBe(40);
    expect(rangeMs('2026-11-10', '2026-11-10')).toEqual([Date.parse('2026-11-09T21:00:00Z'), Date.parse('2026-11-10T21:00:00Z')]);
  });
  it('knows a real day from text shaped like one', () => {
    expect(isDay('2026-11-10')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '10-11-2026', '', 'today', null, undefined, 20261110]) expect(isDay(bad)).toBe(false);
  });
  it('says days in Arabic and English', () => {
    expect([1, 2, 3, 10, 11, 30].map(n => daysWord(n))).toEqual(['يوم', 'يومين', '3 أيام', '10 أيام', '11 يوم', '30 يوم']);
    expect([1, 7].map(n => daysWord(n, 'en'))).toEqual(['1 day', '7 days']);
  });
});

describe('quick periods', () => {
  it('lists the seven bar entries in the agreed order and wording', () => {
    expect(PRESETS.map(p => p.ar)).toEqual(['اليوم', 'أمس', 'أسبوع', 'شهر', 'هذا الشهر', 'كل الفترة']);
    expect(PRESETS.map(p => p.en)).toEqual(['Today', 'Yesterday', 'Week', 'Month', 'This month', 'All time']);
  });
  it('resolves each one', () => {
    expect(resolvePreset('t', ctx)).toEqual([TODAY, TODAY]);
    expect(resolvePreset('y', ctx)).toEqual(['2026-11-09', '2026-11-09']);
    expect(resolvePreset('7', ctx)).toEqual(['2026-11-03', '2026-11-09']);   // seven days ending on the last day with data
    expect(resolvePreset('30', ctx)).toEqual(['2026-10-11', '2026-11-09']);
    expect(resolvePreset('tm', ctx)).toEqual(['2026-11-01', TODAY]);
    expect(resolvePreset('all', ctx)).toEqual(['2026-06-01', TODAY]);
  });
  it('week and month end on today when the page has no "last day"', () => {
    expect(resolvePreset('7', { today: TODAY })).toEqual(['2026-11-04', TODAY]);
    expect(resolvePreset('30', { today: TODAY })).toEqual(['2026-10-12', TODAY]);
  });
  it('this month on the 1st is that one day; across a year end it stays in the month', () => {
    expect(resolvePreset('tm', { today: '2026-11-01' })).toEqual(['2026-11-01', '2026-11-01']);
    expect(resolvePreset('tm', { today: '2027-01-15' })).toEqual(['2027-01-01', '2027-01-15']);
  });
  it('never goes before the first day the page has', () => {
    const young = { today: TODAY, last: '2026-11-09', min: '2026-11-05' };
    expect(resolvePreset('30', young)).toEqual(['2026-11-05', '2026-11-09']);
    expect(resolvePreset('tm', young)).toEqual(['2026-11-05', TODAY]);
    expect(resolvePreset('y', { today: '2026-11-05', min: '2026-11-05' })).toEqual(['2026-11-05', '2026-11-05']);
  });
  it('an unknown name is no period; the old 90-day choice still resolves', () => {
    expect(resolvePreset('forever', ctx)).toBeNull();
    expect(resolvePreset('90', ctx)).toEqual(['2026-08-12', '2026-11-09']);
  });
});

describe('custom dates and bad input', () => {
  it('puts a reversed range in order and keeps it inside the data', () => {
    expect(clampRange('2026-11-08', '2026-11-02', ctx)).toEqual(['2026-11-02', '2026-11-08']);
    expect(clampRange('2026-01-01', '2026-12-31', ctx)).toEqual(['2026-06-01', TODAY]);
    expect(clampRange('2026-11-05', '2026-11-05', ctx)).toEqual(['2026-11-05', '2026-11-05']);
  });
  it('picks what was asked for: a name, a custom range, or the default', () => {
    expect(pick({ key: 'tm' }, ctx)).toEqual({ key: 'tm', from: '2026-11-01', to: TODAY });
    expect(pick({ from: '2026-10-05', to: '2026-10-20' }, ctx)).toEqual({ key: 'custom', from: '2026-10-05', to: '2026-10-20' });
    expect(pick({ from: '2026-10-20', to: '2026-10-05' }, ctx)).toMatchObject({ key: 'custom', from: '2026-10-05', to: '2026-10-20' });
    expect(pick(null, ctx, '7')).toEqual({ key: '7', from: '2026-11-03', to: '2026-11-09' });
    expect(pick(null, ctx)).toMatchObject({ key: '30' });
  });
  it('falls back to the default on anything that does not parse, never throws', () => {
    for (const bad of [{ key: 'nope' }, { from: 'x', to: 'y' }, { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-10-01', to: null }, { key: '' }, {}]) {
      expect(pick(bad, ctx, '30')).toEqual({ key: '30', from: '2026-10-11', to: '2026-11-09' });
    }
    expect(pick({ key: '90' }, ctx)).toMatchObject({ key: 'custom', from: '2026-08-12', to: '2026-11-09' }); // an old saved choice becomes its days
  });
});

describe('server side from/to', () => {
  const get = (q: Record<string, string>) => (k: string) => q[k] ?? null;
  it('accepts Riyadh days, both included', () => {
    expect(parseRangeParams(get({ from: '2026-11-01', to: '2026-11-07' }), NOW)).toEqual({ from: '2026-11-01', to: '2026-11-07', days: 7 });
    expect(parseRangeParams(get({ from: TODAY, to: TODAY }), NOW)).toEqual({ from: TODAY, to: TODAY, days: 1 });
  });
  it('swaps a reversed range and cuts the future to today', () => {
    expect(parseRangeParams(get({ from: '2026-11-07', to: '2026-11-01' }), NOW)).toMatchObject({ from: '2026-11-01', to: '2026-11-07' });
    expect(parseRangeParams(get({ from: '2026-11-05', to: '2027-01-01' }), NOW)).toMatchObject({ from: '2026-11-05', to: TODAY });
    expect(parseRangeParams(get({ from: '2027-01-01', to: '2027-02-01' }), NOW)).toEqual({ from: TODAY, to: TODAY, days: 1 });
  });
  it('caps the span to the last year of it', () => {
    const r = parseRangeParams(get({ from: '2020-01-01', to: TODAY }), NOW);
    expect(r).toEqual({ from: addDays(TODAY, -(MAX_SPAN - 1)), to: TODAY, days: MAX_SPAN });
    expect(parseRangeParams(get({ from: '2020-01-01', to: TODAY }), NOW, { maxDays: 90 })).toMatchObject({ days: 90 });
  });
  it('refuses text that is not a day, or a half range', () => {
    for (const q of [{ from: 'x', to: TODAY }, { from: '2026-02-30', to: TODAY }, { from: '2026-11-01' }, { to: TODAY }, { from: '2026-11-01', to: '' }, { from: "2026-11-01' or 1=1", to: TODAY }])
      expect(parseRangeParams(get(q), NOW)).toEqual({ error: 'bad_range' });
  });
  it('still understands the old ?days=', () => {
    expect(parseRangeParams(get({ days: '7' }), NOW)).toEqual({ from: '2026-11-04', to: TODAY, days: 7 });
    expect(parseRangeParams(get({}), NOW, { days: 90 })).toMatchObject({ days: 90 });
    expect(parseRangeParams(get({ days: '9999' }), NOW)).toMatchObject({ days: 30 });
    expect(parseRangeParams(get({ days: 'abc' }), NOW, { days: 7 })).toMatchObject({ days: 7 });
  });
});

// ---- the routes
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com', PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 't' };
const cfg = A.env(E);
const ALL = Object.fromEntries(Object.keys(A.DASHBOARDS).map(k => [k, 'approve']));
const member: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'member@example.com', role: 'member', active: true, access: ALL, company_id: WELL_COMPANY };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function get(path: string) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(String(url));
    const u = String(url);
    const data = u.includes('/profiles?') ? [member] : u.includes('/companies?') ? [{ id: WELL_COMPANY, name: 'Well', paperclip_company_id: 'pc1' }] : [];
    return new Response(JSON.stringify(data));
  }));
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(member, cfg), cfg.secret))}`;
  const res = await api.request('https://well.example' + path, { headers: { cookie } }, E);
  return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> | null, urls };
}
const fmtRange = (from: string, to: string) => ({ since: new Date(rangeMs(from, to)[0]).toISOString(), until: new Date(rangeMs(from, to)[1]).toISOString() });

describe('routes take from/to', () => {
  it('mentions: asks the database for exactly the Riyadh days, and refuses a bad day', async () => {
    const ok = await get('/api/listening/mentions?from=2026-10-01&to=2026-10-31');
    expect(ok.status).toBe(200);
    const q = decodeURIComponent(ok.urls.find(u => u.includes('listen_mentions')) ?? '');
    const { since, until } = fmtRange('2026-10-01', '2026-10-31');
    expect(q).toContain(`published_at.gte.${since}`);
    expect(q).toContain(`published_at.lt.${until}`);
    expect(since).toBe('2026-09-30T21:00:00.000Z');
    for (const bad of ['from=x&to=2026-10-31', 'from=2026-02-30&to=2026-03-01', 'from=2026-10-01']) {
      const r = await get(`/api/listening/mentions?${bad}`);
      expect(r.status).toBe(400);
      expect(r.urls.some(u => u.includes('listen_mentions'))).toBe(false); // nothing was read
    }
  });
  it('mentions: without from/to it is still the last 90 days', async () => {
    const r = await get('/api/listening/mentions');
    expect(r.status).toBe(200);
    expect(decodeURIComponent(r.urls.find(u => u.includes('listen_mentions')) ?? '')).toContain('published_at.gte.');
  });
  it('mentions: a span over a year is cut, not refused', async () => {
    const r = await get('/api/listening/mentions?from=2000-01-01&to=2026-10-31');
    expect(r.status).toBe(200);
    const m = decodeURIComponent(r.urls.find(u => u.includes('listen_mentions')) ?? '').match(/published_at\.gte\.([^,)]+)/);
    expect(Date.parse('2026-11-01') - Date.parse(m![1]!)).toBeLessThan((MAX_SPAN + 2) * 864e5);
  });
  it('demand: reads the period and the same length before it, and refuses a bad day', async () => {
    const ok = await get('/api/listening/demand?from=2026-10-10&to=2026-10-19');
    expect(ok.status).toBe(200);
    const q = decodeURIComponent(ok.urls.find(u => u.includes('crm_leads')) ?? '');
    expect(q).toContain(`created_at=gte.${new Date(rangeMs('2026-09-30', '2026-09-30')[0]).toISOString()}`); // 10 days before the 10th
    expect(q).toContain(`created_at=lt.${new Date(rangeMs('2026-10-19', '2026-10-19')[1]).toISOString()}`);
    expect((await get('/api/listening/demand?from=nope&to=2026-10-19')).status).toBe(400);
  });
  it('the manager card: from/to, the old days=7, and a bad day', async () => {
    const ok = await get('/api/maestro/agent?id=a1&from=2026-10-01&to=2026-10-07');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ days: 7, from: '2026-10-01', to: '2026-10-07' });
    const old = await get('/api/maestro/agent?id=a1&days=7');
    expect(old.body).toMatchObject({ days: 7 });
    expect((await get('/api/maestro/agent?id=a1')).body).toMatchObject({ days: 30 });
    expect((await get('/api/maestro/agent?id=a1&from=zzz&to=2026-10-07')).status).toBe(400);
    expect((await get('/api/maestro/agent?id=a1&from=2026-10-01&to=2026-13-40')).status).toBe(400);
  });
});

describe('the pages follow the period', () => {
  const day = (s: string, h = 12) => new Date(Date.parse(`${s}T00:00:00+03:00`) + h * 36e5).toISOString();
  const W = [{ id: 1, kind: 'brand', name: 'Well' }, { id: 2, kind: 'competitor', name: 'منافس' }];
  const M = [
    ...['2026-11-10', '2026-11-10', '2026-11-09'].map(d => ({ watch_id: 1, published_at: day(d), sentiment: 'positive' })),
    { watch_id: 2, published_at: day('2026-11-09'), sentiment: 'neutral' },
    { watch_id: 1, published_at: day('2026-10-20'), sentiment: 'negative' },
    { watch_id: 1, published_at: day('2026-08-01'), sentiment: 'negative' },
  ];
  const run = (from: string, to: string) => { const [a, z] = rangeMs(from, to); return summarize(W, M, z, Math.round((z - a) / 864e5)); };
  it('counts only the mentions inside the Riyadh days', () => {
    expect(run('2026-11-10', '2026-11-10').share.map((r: { total: number }) => r.total)).toEqual([2, 0]);        // today
    expect(run('2026-11-09', '2026-11-09').share.map((r: { total: number }) => r.total)).toEqual([1, 1]);        // yesterday
    expect(run('2026-11-01', '2026-11-10').share.map((r: { total: number }) => r.total)).toEqual([3, 1]);        // this month
    expect(run('2026-10-01', '2026-11-10').share[0]?.total).toBe(4);
    expect(run('2026-06-01', '2026-11-10').share[0]?.total).toBe(5);                                                // all time
  });
  it('sizes the trend to the period: a bar a day, a week or a month', () => {
    expect(run('2026-11-10', '2026-11-10')).toMatchObject({ step: 1, window: 1 });
    expect(run('2026-11-04', '2026-11-10').weeks).toHaveLength(7);
    expect(run('2026-10-11', '2026-11-10')).toMatchObject({ step: 7, window: 7 });
    expect(run('2026-10-11', '2026-11-10').weeks).toHaveLength(5);
    expect(run('2025-11-10', '2026-11-10')).toMatchObject({ step: 30 });
    expect(run('2026-11-04', '2026-11-10').weeks.reduce((n: number, w: { positive: number }) => n + w.positive, 0)).toBe(3);
  });
  it('organic posts follow a day range, both days included', () => {
    const posts = [{ date: '2026-10-31', eng: 5 }, { date: '2026-11-01', eng: 5 }, { date: '2026-11-30', eng: 5 }, { date: '2026-12-01', eng: 5 }, { eng: 5 }];
    expect(analyze(posts, [], { from: '2026-11-01', to: '2026-11-30' }).posts).toBe(3); // two dated + the undated one
    expect(analyze(posts, [], 90, '2026-11-30').posts).toBe(5);                          // the old number still works
  });
  it('all three pages use the one shared bar, and the old buttons are gone', () => {
    expect(overview).toContain('PeriodFilter');
    expect(overview).not.toMatch(/RANGES|ToggleGroup/);
    expect(listenPage).toContain('id="lxPeriod"'); expect(listenPage).toContain('id="orgPeriod"');
    expect(maestroPage).toContain('id="perfPeriod"');
    for (const old of ['data-ld', 'data-days', 'perfDays', '7 أيام', '30 يوم', '90 يوم']) for (const src of [listenPage, maestroPage, listenJs, maestroJs, overview]) expect(src).not.toContain(old);
    for (const js of [listenJs, maestroJs]) expect(js).toContain("from '/assets/period.js'");
  });
});
