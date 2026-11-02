// Tracking health: each check fires on the data that should trigger it, and stays quiet otherwise.
import { describe, expect, it } from 'vitest';
import { diagnose, hasUtm, type Input } from './debugger';

const base = (over: Partial<Input> = {}): Input => ({
  today: '2026-11-02', ads: [], metrics: [], leads: [], connections: [],
  tables: { ads: true, metrics: true, leads: true, connections: true }, ...over,
});
const ad = (k: string, platform: string, goal = 'lead', extra = {}) => ({ ad_key: k, platform, name: k, goal, live: true, ...extra });

describe('tracking health', () => {
  it('flags a platform whose numbers stopped', () => {
    const r = diagnose(base({ ads: [ad('t1', 'tiktok')], metrics: [{ ad_key: 't1', day: '2026-10-28', spend: 50, leads: 2 }] }));
    const f = r.findings.find(x => x.id === 'stale:tiktok');
    expect(f?.level).toBe('critical');
    expect(f?.title).toContain('5');
  });

  it('flags lead ads that spend with no lead, and the whole platform when nothing converts', () => {
    const r = diagnose(base({ ads: [ad('s1', 'snapchat'), ad('s2', 'snapchat')],
      metrics: [{ ad_key: 's1', day: '2026-11-01', spend: 300, leads: 0 }, { ad_key: 's2', day: '2026-11-01', spend: 150, leads: 0 }] }));
    const f = r.findings.find(x => x.id === 'noleads:snapchat');
    expect(f?.level).toBe('critical');
    expect(f?.count).toBe(2);
    const ok = diagnose(base({ ads: [ad('m1', 'meta')], metrics: [{ ad_key: 'm1', day: '2026-11-01', spend: 300, leads: 9 }] }));
    expect(ok.findings.some(x => x.id.startsWith('noleads'))).toBe(false);
  });

  it('compares platform leads with CRM leads and reports leads with no ad id', () => {
    const leads = Array.from({ length: 30 }, (_, i) => ({ source_platform: 'meta_form', ad_id: i < 20 ? null : '1', created_at: '2026-10-31T10:00:00Z' }));
    const r = diagnose(base({ ads: [ad('m1', 'meta')], metrics: [{ ad_key: 'm1', day: '2026-11-01', spend: 500, leads: 80 }], leads }));
    expect(r.findings.find(x => x.id === 'gap:meta')?.title).toContain('80');
    expect(r.findings.find(x => x.id === 'attr:meta_form')?.level).toBe('critical');
    expect(r.platforms.meta?.crm7).toBe(30);
  });

  it('suggests CAPI for spending platforms without it, and warns before a connection expires', () => {
    const r = diagnose(base({ ads: [ad('m1', 'meta')], metrics: [{ ad_key: 'm1', day: '2026-11-01', spend: 40, leads: 3 }],
      connections: [{ platform: 'tiktok', expires_at: '2026-11-05T00:00:00Z' }] }));
    expect(r.findings.some(x => x.id === 'capi:meta')).toBe(true);
    expect(r.findings.find(x => x.id === 'exp:tiktok')?.level).toBe('warn');
    const withCapi = diagnose(base({ ads: [ad('m1', 'meta')], metrics: [{ ad_key: 'm1', day: '2026-11-01', spend: 40, leads: 3 }], connections: [{ platform: 'meta_capi' }] }));
    expect(withCapi.findings.some(x => x.id === 'capi:meta')).toBe(false);
  });

  it('checks UTM on website links only', () => {
    expect(hasUtm('https://wellcare.sa/iv?utm_source=google&utm_campaign=iv')).toBe(true);
    expect(hasUtm('https://wellcare.sa/iv')).toBe(false);
    expect(hasUtm('https://adsmanager.facebook.com/adsmanager/manage/ads?act=1')).toBe(true);
    const r = diagnose(base({ ads: [ad('g1', 'google', 'lead', { link: 'https://wellcare.sa/iv' })] }));
    expect(r.findings.find(x => x.id === 'utm')?.count).toBe(1);
  });

  it('sorts the worst first and counts by level', () => {
    const r = diagnose(base({ ads: [ad('t1', 'tiktok')], metrics: [{ ad_key: 't1', day: '2026-10-20', spend: 500, leads: 0 }], tables: { ads: true, metrics: false, leads: true, connections: true } }));
    expect(r.findings[0]?.level).toBe('critical');
    expect(r.summary.critical).toBeGreaterThan(0);
  });
});
