// Social: validation, due rule, publishing to Facebook/Instagram with a stubbed Graph API, and company scoping.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validate, due, publishPost } from './social';
import { runSocial } from './cron';
import { WELL_COMPANY } from '../../lib/tenant';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const later = '2026-11-02T09:00:00Z';
afterEach(() => { vi.unstubAllGlobals(); });

describe('validate', () => {
  it('accepts a good post and keeps the Riyadh time as ISO', () => {
    const v = validate({ platforms: ['facebook', 'facebook', 'nope'], body: 'جلسة تغذية وريدية', publish_at: later, mode: 'auto' }, NOW);
    expect(v.draft).toEqual({ platforms: ['facebook'], body: 'جلسة تغذية وريدية', media: [], publish_at: '2026-11-02T09:00:00.000Z', mode: 'auto' });
  });
  it('refuses past times, empty posts, over-long text and Instagram without media', () => {
    expect(validate({ platforms: ['facebook'], body: 'x', publish_at: '2026-10-01T00:00:00Z' }, NOW).error).toBe('وقت النشر راح');
    expect(validate({ platforms: ['facebook'], publish_at: later }, NOW).error).toBeTruthy();
    expect(validate({ platforms: ['x'], body: 'ا'.repeat(281), publish_at: later }, NOW).error).toContain('X');
    expect(validate({ platforms: ['instagram'], body: 'x', publish_at: later }, NOW).error).toContain('انستقرام');
  });
  it('warns on MOH claims without blocking, and defaults to manual', () => {
    const v = validate({ platforms: ['facebook'], body: 'علاج نهائي ومضمون', publish_at: later }, NOW);
    expect(v.draft?.mode).toBe('manual');
    expect(v.notices.length).toBe(2);
  });
});

describe('due', () => {
  it('manual waits for approval, auto goes at its time', () => {
    const base = { status: 'scheduled', publish_at: '2026-11-01T11:59:00Z' };
    expect(due({ ...base, mode: 'manual' }, NOW)).toBe(false);
    expect(due({ ...base, mode: 'manual', approved_at: '2026-11-01T10:00:00Z' }, NOW)).toBe(true);
    expect(due({ ...base, mode: 'auto' }, NOW)).toBe(true);
    expect(due({ ...base, mode: 'auto', publish_at: later }, NOW)).toBe(false);
  });
});

describe('publish', () => {
  it('posts to the page feed and runs Instagram container + publish', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => { calls.push(url); return new Response(JSON.stringify({ id: String(calls.length) })); }) as unknown as typeof fetch;
    const t = { META_PAGE_ACCESS_TOKEN: 'tok', META_PAGE_ID: 'p1', IG_USER_ID: 'ig1' };
    const out = await publishPost({ platforms: ['facebook', 'instagram'], body: 'hi', media: [{ url: 'https://x/a.jpg', type: 'image' }], publish_at: later, mode: 'auto' }, t, f);
    expect(out.status).toBe('published');
    expect(calls).toEqual(['https://graph.facebook.com/v23.0/p1/photos', 'https://graph.facebook.com/v23.0/ig1/media', 'https://graph.facebook.com/v23.0/ig1/media_publish']);
  });
  it('partial when one platform is not connected or not live yet', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: '1' }))) as unknown as typeof fetch;
    const out = await publishPost({ platforms: ['facebook', 'x'], body: 'hi', media: [], publish_at: later, mode: 'auto' }, { META_PAGE_ACCESS_TOKEN: 't', META_PAGE_ID: 'p' }, f);
    expect(out.status).toBe('partial');
    expect(out.results.x?.ok).toBe(false);
  });
});

describe('runSocial', () => {
  it('claims each due post once and never uses Well tokens for another company', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    const posts = [
      { id: 1, company_id: WELL_COMPANY, platforms: ['facebook'], body: 'a', media: [], publish_at: '2026-11-01T11:00:00Z', mode: 'auto', status: 'scheduled' },
      { id: 2, company_id: OTHER, platforms: ['facebook'], body: 'b', media: [], publish_at: '2026-11-01T11:00:00Z', mode: 'auto', status: 'scheduled' },
      { id: 3, company_id: WELL_COMPANY, platforms: ['facebook'], body: 'c', media: [], publish_at: '2026-11-01T11:00:00Z', mode: 'manual', status: 'scheduled' },
    ];
    const saved: Record<number, { status: string }> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('/rpc/connector_env')) return new Response(JSON.stringify([{ name: 'META_PAGE_ACCESS_TOKEN', value: 't' }, { name: 'META_PAGE_ID', value: 'p' }]));
      if (url.includes('social_posts?select=')) return new Response(JSON.stringify(posts));
      const id = Number(url.match(/id=eq\.(\d+)/)?.[1]);
      if (url.includes('status=eq.scheduled')) return new Response(JSON.stringify([{ id }])); // claim
      if (init.method === 'PATCH') { saved[id] = JSON.parse(String(init.body)); return new Response('[]'); }
      return new Response('{}');
    }));
    const graph = vi.fn(async () => new Response(JSON.stringify({ id: 'g' }))) as unknown as typeof fetch;
    const n = await runSocial({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'l@x' }, NOW, graph);
    expect(n).toBe(2);                         // the manual post waits for approval
    expect(saved[1]?.status).toBe('published');
    expect(saved[2]?.status).toBe('failed');   // other company: no Well tokens
    expect(graph).toHaveBeenCalledTimes(1);
  });
});
