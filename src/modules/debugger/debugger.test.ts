// Tracking health: each check fires on the data that should trigger it, and stays quiet otherwise.
import { describe, expect, it, vi } from 'vitest';
import { diagnose, hasUtm, type Input } from './debugger';
import { CLAUDE_MODEL, explain, explainPrompt } from './explain';

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

describe('Claude plan', () => {
  const findings = [{ id: 'stale', level: 'critical' as const, title: 'سناب وقفت أرقامه', detail: 'آخر يوم 2026-10-30', fix: 'جدّد الربط' }];
  const platforms = { snapchat: { spend7: 900, leads7: 0, crm7: 4, lastDay: '2026-10-30' } };
  it('sends the findings with the fallback and effort set, and reads the text', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: CLAUDE_MODEL, stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '1. جدّد ربط سناب' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const r = await explain({ ANTHROPIC_API_KEY: 'sk-ant-test' }, findings, platforms, f as unknown as typeof fetch);
    expect(r).toEqual({ text: '1. جدّد ربط سناب', model: CLAUDE_MODEL, usage: { in: 1, out: 1 } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain('/v1/messages');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: CLAUDE_MODEL, fallbacks: 'default', output_config: { effort: 'medium' } });
    expect(body.messages[0].content).toContain('سناب وقفت أرقامه');
  });
  it('needs the key, and a refusal is an error, not an empty plan', async () => {
    await expect(explain({}, findings, platforms)).rejects.toThrow('no_key');
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: CLAUDE_MODEL, stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(explain({ ANTHROPIC_API_KEY: 'k' }, findings, platforms, f as unknown as typeof fetch)).rejects.toThrow('refused');
    expect(explainPrompt([], {})).toContain('ما فيه مشاكل');
  });
});

describe('platform names', () => {
  it('compares snap ads with snapchat CRM leads, and facebook ads with meta, in one row', () => {
    const leads = Array.from({ length: 25 }, () => ({ source_platform: 'snapchat_form', ad_id: '1', created_at: '2026-10-31T10:00:00Z' }));
    const r = diagnose(base({ ads: [ad('s1', 'snap'), ad('f1', 'facebook')], metrics: [{ ad_key: 's1', day: '2026-11-01', spend: 500, leads: 26 }, { ad_key: 'f1', day: '2026-11-01', spend: 100, leads: 3 }], leads }));
    expect(r.platforms.snap).toBeUndefined();
    expect(r.platforms.snapchat).toMatchObject({ leads7: 26, crm7: 25 });
    expect(r.platforms.meta?.leads7).toBe(3);
    expect(r.findings.some(x => x.id === 'gap:snapchat')).toBe(false);
  });
  it('says the match failed, not that leads were lost, when the CRM has none for the platform', () => {
    const r = diagnose(base({ ads: [ad('s1', 'snap')], metrics: [{ ad_key: 's1', day: '2026-11-01', spend: 500, leads: 40 }], leads: [{ source_platform: 'meta_form', ad_id: '1', created_at: '2026-10-31T10:00:00Z' }] }));
    expect(r.findings.find(x => x.id === 'gap:snapchat')?.title).toContain('تعذّر مطابقة');
  });
});
