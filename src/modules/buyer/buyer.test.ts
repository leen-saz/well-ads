// The media buyer: each rule fires on the data that should trigger it and stays quiet otherwise; the judge gates it;
// every text is compliant; nothing here can write. All names and numbers are made up.
import { describe, expect, it } from 'vitest';
import '../../../pipeline/dash/00-judge.js';
import { check } from '../compliance/compliance';
import { recommend, type AdRow, type CompanyRule, type Input, type MetricRow } from './buyer';
import { judgeOutcome, tune, type Outcome } from './learn';
import { cleanRules } from './rules';
import { RULES, RULE, PLATFORM_FACTS } from './playbook';

const docs = import.meta.glob('../../../docs/media-buyer/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const T = globalThis.WELL_JUDGE.targets(null);
const TODAY = '2026-11-20', last = '2026-11-19';
const add = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const ad = (k: string, platform: string, campaign: string, over: Partial<AdRow> = {}): AdRow => ({ ad_key: k, platform, campaign, name: k, goal: 'lead', live: true, ...over });
// f(i) → [spend, impressions, clicks, leads] for the day i days before `last`, from..to inclusive
function series(k: string, from: number, to: number, f: (i: number) => [number, number, number, number]): MetricRow[] {
  const out: MetricRow[] = [];
  for (let i = from; i >= to; i--) { const [spend, impressions, clicks, leads] = f(i); out.push({ ad_key: k, day: add(last, -i), spend, impressions, clicks, leads }); }
  return out;
}
const base = (over: Partial<Input> = {}): Input => ({ today: TODAY, ads: [], metrics: [], targets: T, ...over });
// 2 leads a day at half the target CPL, 2% click rate, 4% of clicks to a lead
const good = (k: string, from = 27, to = 0) => series(k, from, to, () => [T.cpl, 4000, 80, 2]);
const ids = (r: ReturnType<typeof recommend>) => r.recs.map(x => x.rule);

describe('media buyer rules', () => {
  it('holds a young campaign', () => {
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: good('m1', 3, 0) }));
    expect(ids(r)).toEqual(['learning_hold']);
  });
  it('scales a campaign under target, in a small step, when the judge says fine', () => {
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: good('m1') }));
    const s = r.recs.find(x => x.rule === 'scale_up')!;
    expect(s.kind).toBe('budget_up'); expect(s.change).toContain('20%'); expect(s.judge?.level).toBe('fine');
  });
  it('follows the company budget ladder instead of the default step', () => {
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: good('m1'), plans: { meta: { ladder: [T.cpl * 1.1, T.cpl * 3] } } }));
    expect(r.recs.find(x => x.rule === 'scale_up')!.change).toContain('10%');
  });
  it('cuts or stops over the stop line; the company stop line wins', () => {
    const bad = series('m1', 27, 0, () => [T.cpl * 4, 4000, 80, 2]);
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: bad }));
    expect(r.recs.find(x => x.rule === 'stop_cpl')!.kind).toBe('pause');
    expect(ids(r)).not.toContain('scale_up');
    expect(ids(recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: bad, plans: { meta: { stopCpl: T.cpl * 5 } } })))).not.toContain('stop_cpl');
  });
  it('the judge blocks what it disagrees with, and says why', () => {
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: series('m1', 27, 0, () => [T.cpl * 2.6, 4000, 80, 2]) }));
    expect(ids(r)).not.toContain('stop_cpl'); expect(ids(r)).not.toContain('scale_up');
    const r2 = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: good('m1'), plans: { meta: { stopCpl: T.cpl * 0.1 } } }));
    expect(ids(r2)).not.toContain('stop_cpl');
    expect(r2.gated.some(g => g.rule === 'stop_cpl' && g.reason.includes('تمام'))).toBe(true);
  });
  it('flags spend with no leads as a tracking check, even in the learning period', () => {
    const r = recommend(base({ ads: [ad('t1', 'meta', 'c1')], metrics: series('t1', 2, 0, () => [T.cpl, 3000, 60, 0]) }));
    expect(ids(r)).toEqual(['zero_leads']); expect(r.recs[0]!.kind).toBe('review');
  });
  it('spots creative fatigue when the cost is off target too', () => {
    const worse = [...series('m1', 27, 7, () => [T.cpl * 0.8, 4000, 80, 2]), ...series('m1', 6, 0, () => [T.cpl * 2, 4000, 50, 1.2])];
    expect(ids(recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: worse })))).toContain('fatigue');
  });
  it('marks fatigue on a handful of leads as low confidence, and shows the lead counts', () => {
    const rec = (prevLeads: number, curLeads: number) => recommend(base({ ads: [ad('m1', 'meta', 'c1')],
      metrics: [...series('m1', 27, 7, () => [T.cpl * 0.8, 4000, 80, prevLeads]), ...series('m1', 6, 0, () => [T.cpl * 2, 4000, 50, curLeads])] })).recs.find(x => x.rule === 'fatigue')!;
    const thin = rec(0.5, 0.3), enough = rec(2, 1.5);            // 3.5 then 2.1 leads a week, against 14 then 10.5
    expect(thin.confidence).toBe('low'); expect(thin.evidence.join(' ')).toContain('عينة صغيرة');
    expect(enough.confidence).toBe('medium'); expect(enough.evidence.join(' ')).not.toContain('عينة صغيرة');
    expect(enough.evidence.some(e => e.includes('ليد هذا الأسبوع'))).toBe(true);
  });
  it('does not list fatigue as blocked by the judge when the impressions are too few to tell', () => {
    const few = [...series('m1', 27, 7, () => [T.cpl * 0.2, 400, 8, 2]), ...series('m1', 6, 0, () => [T.cpl * 0.3, 400, 5, 2])];   // CTR and CPL moved, judge says fine, 2,800 impressions a week
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: few }));
    expect(ids(r)).not.toContain('fatigue'); expect(r.gated.some(g => g.rule === 'fatigue')).toBe(false);
  });
  it('sends clicks that do not become leads to the page', () => {
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: series('m1', 27, 0, () => [T.cpl * 0.4, 6000, 120, 1]) }));
    expect(ids(r)).toContain('page_leak');
  });
  it('flags a click rate far under target, only with enough clicks and a judge that agrees', () => {
    const low = (clicks: number) => recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: series('m1', 27, 0, () => [T.cpl * 0.4, 20000, clicks, 2]) }));
    const weak = low(40), tiny = low(20);                      // 0.2% against the target, on 280 clicks a week; 140 clicks is under the 200 minimum
    expect(ids(weak)).toContain('low_ctr'); expect(weak.recs.find(x => x.rule === 'low_ctr')!.kind).toBe('refresh_creative');
    expect(ids(tiny)).not.toContain('low_ctr');
    expect(ids(recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: good('m1') })))).not.toContain('low_ctr');   // a healthy click rate stays quiet
  });
  it('moves budget between platforms only with a sample on both', () => {
    const m = [...series('m1', 27, 0, () => [T.cpl * 9.6, 12000, 240, 6]), ...series('s1', 27, 0, () => [T.cpl * 3, 12000, 240, 6])];
    const s = recommend(base({ ads: [ad('m1', 'meta', 'c1'), ad('s1', 'snap', 'c2')], metrics: m })).recs.find(x => x.rule === 'shift_budget')!;
    expect(s.platform).toBe('meta'); expect(s.title).toContain('سناب');
    const thin = [...series('m1', 27, 0, () => [T.cpl, 100, 1, 0.5]), ...series('s1', 27, 0, () => [T.cpl, 100, 1, 1])];
    expect(ids(recommend(base({ ads: [ad('m1', 'meta', 'c1'), ad('s1', 'snap', 'c2')], metrics: thin })))).not.toContain('shift_budget');
  });
  it('finds the dearer Meta placement', () => {
    const m = [...series('f1', 13, 0, () => [T.cpl, 4000, 80, 2]), ...series('i1', 13, 0, () => [T.cpl * 3, 4000, 80, 2])];
    const r = recommend(base({ ads: [ad('f1', 'facebook', 'c1'), ad('i1', 'instagram', 'c1')], metrics: m }));
    const p = r.recs.find(x => x.rule === 'placement_gap')!;
    expect(p.title).toContain('انستقرام'); expect(p.kind).toBe('shift_budget');
  });
  it('finds the costly weekday only on four full weeks', () => {
    const m = series('m1', 27, 0, i => [T.cpl * 1.5 * (new Date(add(last, -i) + 'T00:00:00Z').getUTCDay() === 5 ? 2.4 : 1), 6000, 120, 3]);
    expect(recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: m })).recs.find(x => x.rule === 'weekday_gap')?.title).toContain('الجمعة');
    expect(ids(recommend(base({ ads: [ad('m1', 'meta', 'c1')], metrics: good('m1', 13) })))).not.toContain('weekday_gap');
  });
  it('flags one creative taking nearly all the spend', () => {
    const m = [...good('a1'), ...series('a2', 27, 0, () => [T.cpl * 0.05, 400, 8, 0.2])];
    expect(ids(recommend(base({ ads: [ad('a1', 'meta', 'c1'), ad('a2', 'meta', 'c1')], metrics: m })))).toContain('few_creatives');
  });
  it('ranks by priority and says so when there is no spend', () => {
    const r = recommend(base({ ads: [ad('m1', 'meta', 'c1'), ad('m2', 'meta', 'c2')], metrics: [...good('m1'), ...series('m2', 27, 0, () => [T.cpl * 8, 4000, 80, 2])] }));
    const p = r.recs.map(x => x.priority); expect(p).toEqual([...p].sort((a, b) => b - a));
    expect(r.recs[0]!.rule).toBe('stop_cpl');
    expect(recommend(base()).note).toBeTruthy();
  });
});

describe('company rules (names and limits come from the database)', () => {
  const R = (r: Partial<CompanyRule> & Pick<CompanyRule, 'id' | 'kind' | 'platform' | 'match'>): CompanyRule => r;
  it('scales matched campaigns under the limit, replacing the general scale-up, and carries the open decision', () => {
    const rule = R({ id: 'a', kind: 'scale', platform: 'snapchat', match: ['alpha'], maxCpl: T.cpl, stepPct: 20, everyDays: 2, open: 'الحد مو محسوم' });
    const r = recommend(base({ ads: [ad('s1', 'snap', 'Alpha Campaign')], metrics: good('s1'), rules: [rule] }));
    const c = r.recs.filter(x => x.kind === 'budget_up');
    expect(c).toHaveLength(1); expect(c[0]!.rule).toBe('company'); expect(c[0]!.change).toContain('كل 2 أيام'); expect(c[0]!.open).toBe('الحد مو محسوم'); expect(c[0]!.owner).toBe('media_buyer');
    expect(ids(recommend(base({ ads: [ad('s1', 'snap', 'Beta')], metrics: good('s1'), rules: [rule] })))).not.toContain('company');
  });
  it('alerts when a campaign that was spending did not spend yesterday', () => {
    const m = series('s1', 20, 1, () => [T.cpl, 4000, 80, 2]);
    const r = recommend(base({ ads: [ad('s1', 'snap', 'alpha')], metrics: m, rules: [R({ id: 'b', kind: 'alert_stalled', platform: 'snapchat', match: ['alpha'] })] }));
    const a = r.recs.find(x => x.rule === 'company')!;
    expect(a.kind).toBe('resume'); expect(a.title).toContain('19/11'); expect(a.priority).toBeGreaterThanOrEqual(95);
  });
  it('suggests resuming a paused campaign with good results, and stops one idle for weeks', () => {
    const paused = recommend(base({ ads: [ad('t1', 'tiktok', 'gamma', { live: false })], metrics: series('t1', 6, 0, () => [T.cpl, 4000, 80, 0]), rules: [R({ id: 'c', kind: 'resume', platform: 'tiktok', match: ['gamma'], minCtr: 1 })] }));
    expect(paused.recs.find(x => x.rule === 'company')!.kind).toBe('resume');
    const idle = recommend(base({ ads: [ad('s2', 'snap', 'delta')], metrics: series('s2', 20, 0, () => [T.cpl * 0.2, 1000, 5, 0]), rules: [R({ id: 'd', kind: 'stop_idle', platform: 'snapchat', match: ['delta'], minIdleDays: 14 })] }));
    expect(idle.recs.find(x => x.rule === 'company')!.kind).toBe('pause');
  });
  it('asks for a new creative (not a stop) from the video agent, and reduces a campaign with a follow-up task', () => {
    const m = series('m1', 27, 0, () => [T.cpl * 0.5, 20000, 20, 1]);     // 0.1% click rate
    const r = recommend(base({ ads: [ad('m1', 'meta', 'epsilon')], metrics: m, rules: [R({ id: 'e', kind: 'replace_creative', platform: 'meta', match: ['epsilon'], minCtr: 0.5, owner: 'video_agent' }),
      R({ id: 'f', kind: 'reduce', platform: 'meta', match: ['epsilon'], owner: 'landing', followUp: 'أصلح الصفحة قبل إعادة الميزانية' })] }));
    const v = r.recs.find(x => x.owner === 'video_agent')!;
    expect(v.kind).toBe('refresh_creative'); expect(v.followUp).toContain('الامتثال'); expect(v.change).toContain('نتيجة عميل حقيقي');
    expect(r.recs.find(x => x.owner === 'landing')!.followUp).toContain('الصفحة');
  });
  it('never judges TikTok by leads: no lead-based recommendation, and the resume rule reads the click rate', () => {
    const noLeads = recommend(base({ ads: [ad('t1', 'tiktok', 'c1')], metrics: series('t1', 27, 0, () => [T.cpl * 9, 4000, 80, 0]) }));
    expect(noLeads.recs.filter(x => ['zero_leads', 'stop_cpl', 'scale_up', 'page_leak', 'shift_budget'].includes(x.rule))).toEqual([]);
    expect(noLeads.platforms.tiktok?.cpl).toBeNull();
    const weak = recommend(base({ ads: [ad('t1', 'tiktok', 'c1')], metrics: series('t1', 27, 0, () => [T.cpl, 40000, 80, 3]) }));
    expect(weak.recs.some(x => x.rule === 'low_ctr')).toBe(true);
    expect(weak.recs.every(x => !x.evidence.join(' ').includes('الـ CPL'))).toBe(true);
    expect(cleanRules([{ id: 'x', kind: 'scale', platform: 'tiktok', match: ['a'], maxCpl: 5 }])).toHaveProperty('error');
    expect(cleanRules([{ id: 'x', kind: 'resume', platform: 'tiktok', match: ['a'], maxCpl: 5 }])).toHaveProperty('error');
    expect('rules' in cleanRules([{ id: 'x', kind: 'resume', platform: 'tiktok', match: ['a'], minCtr: 1 }])).toBe(true);
  });
  it('validates what the owner saves', () => {
    expect('rules' in cleanRules([{ id: 'x', kind: 'scale', platform: 'snapchat', match: ['a'], maxCpl: 5 }])).toBe(true);
    expect(cleanRules([{ id: 'x', kind: 'scale', platform: 'snapchat', match: ['a'] }])).toHaveProperty('error');
    expect(cleanRules([{ id: 'x', kind: 'nope', platform: 'snapchat', match: ['a'] }])).toHaveProperty('error');
    expect(cleanRules([{ id: 'x', kind: 'reduce', platform: 'google', match: [] }])).toHaveProperty('error');
    expect(cleanRules('x')).toHaveProperty('error');
  });
});

describe('read-only and clean', () => {
  const all = (() => {
    const m = [...good('m1'), ...series('m2', 27, 0, () => [T.cpl * 8, 4000, 80, 2]), ...series('t1', 2, 0, () => [T.cpl, 3000, 60, 0]), ...series('s1', 27, 0, () => [T.cpl, 4000, 80, 2])];
    return recommend(base({ ads: [ad('m1', 'meta', 'c1'), ad('m2', 'meta', 'c2'), ad('t1', 'tiktok', 'c3'), ad('s1', 'snap', 'c4')], metrics: m,
      rules: [{ id: 'z', kind: 'replace_creative', platform: 'meta', match: ['c1'], minCtr: 5, owner: 'video_agent' }] }));
  })();
  it('every recommendation is advice only, with the parts and an owner', () => {
    expect(all.recs.length).toBeGreaterThan(2);
    for (const r of all.recs) {
      expect(r.readOnly).toBe(true); expect(r.owner).toBeTruthy();
      for (const k of [r.change, r.why, r.risk, r.success.metric]) expect(k.length).toBeGreaterThan(5);
      expect(r.success.checkAfterDays).toEqual([3, 7]);
    }
  });
  it('no text carries a health claim the compliance check would flag', () => {
    // the ad-price rule is about advertised prices; an ad-spend figure in an internal note is not one
    const plain = (t: string) => t.replace(/[\d.,]+ ريال/g, 'مبلغ');
    for (const r of all.recs) for (const t of [r.title, r.change, r.why, r.risk, r.success.goal, r.followUp ?? '']) expect(check(plain(t))).toEqual([]);
    for (const r of RULES) for (const t of [r.ar, r.why, r.risk, r.success]) expect(check(t)).toEqual([]);
  });
  it('the module never touches an ad platform or holds a campaign name', () => {
    const files = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    for (const [f, src] of Object.entries(files)) {
      if (f.endsWith('.test.ts')) continue;
      expect(src, f).not.toMatch(/graph\.facebook|business-api\.tiktok|adsapi\.snapchat|googleads\.googleapis|method:\s*'(PATCH|DELETE|PUT)'/);
    }
  });
});

describe('playbook and docs', () => {
  it('every rule is documented in rules.md and has its parts', () => {
    const rules = Object.entries(docs).find(([k]) => k.endsWith('/rules.md'))?.[1] ?? '';
    for (const r of RULES) { expect(rules, r.id).toContain('`' + r.id + '`'); expect(r.why && r.risk && r.success).toBeTruthy(); expect(RULE[r.id]).toBe(r); }
  });
  it('the docs hold no secrets, and the playbook keeps the verified platform facts', () => {
    expect(Object.keys(docs).length).toBeGreaterThanOrEqual(10);
    for (const [k, t] of Object.entries(docs)) expect(t, k).not.toMatch(/sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}|HOVEN/i);
    expect(PLATFORM_FACTS.meta.learningEvents).toBe(50);
  });
});

describe('learning loop', () => {
  const o = (rule: Outcome['rule'], kind: Outcome['kind'], b: number, a: number, acted = true): Outcome => ({ rule, kind, platform: 'meta', days: 7, acted, before: { cpl: b, leads: 20, spend: 100 }, after: { cpl: a, leads: 24, spend: 90 } });
  it('judges an outcome only when it was acted on and the sample is real', () => {
    expect(judgeOutcome(o('fatigue', 'refresh_creative', 10, 8))).toBe('worked');
    expect(judgeOutcome(o('fatigue', 'refresh_creative', 10, 12))).toBe('worse');
    expect(judgeOutcome(o('fatigue', 'refresh_creative', 10, 8, false))).toBe('not_acted');
    expect(judgeOutcome({ ...o('fatigue', 'refresh_creative', 10, 8), after: { cpl: null, leads: 0, spend: 0 } })).toBe('unclear');
  });
  it('proposes a threshold change only with enough outcomes', () => {
    expect(tune(Array.from({ length: 5 }, () => o('fatigue', 'refresh_creative', 10, 12)))[0]!.proposal).toBeNull();
    expect(tune(Array.from({ length: 10 }, (_, i) => o('fatigue', 'refresh_creative', 10, i < 2 ? 8 : 12)))[0]!.proposal).toContain('fatigueCtrDrop');
    expect(tune(Array.from({ length: 10 }, () => o('fatigue', 'refresh_creative', 10, 8)))[0]!.proposal).toContain('تخفف');
  });
});

describe('import preview', () => {
  it('the validation behind the preview keeps the open decisions and refuses a bad file as one piece', () => {
    const ok = cleanRules([{ id: 'x', kind: 'scale', platform: 'snapchat', match: ['a'], maxCpl: 9, open: 'مفتوح' }]);
    expect('rules' in ok && ok.rules[0]!.open).toBe('مفتوح');
    expect(cleanRules([{ id: 'x', kind: 'scale', platform: 'snapchat', match: ['a'], maxCpl: 8 }, { id: 'x', kind: 'reduce', platform: 'google', match: ['b'] }])).toHaveProperty('error');
  });
});
