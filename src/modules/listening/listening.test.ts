// Listening: Arabic normalisation, topics that beat the average, watched keywords, standouts, and the weekly demand signal.
import { describe, expect, it } from 'vitest';
import { analyze, bare, demandAlerts, norm, postsOf, tokens } from '../../../public/modules/listening/analyze.js';
import { weekly } from './listening';

const post = (caption: string, likes: number, comments = 0, date = '2026-10-20', network = 'instagram') => ({ caption, likes, comments, date, network });

describe('listening', () => {
  it('normalises Arabic spelling and drops stop words', () => {
    expect(norm('المحاليلُ الوريديّة')).toBe('المحاليل الوريديه');
    expect(tokens('جلسة #محاليل في البيت مع فريق ويل')).toEqual(expect.arrayContaining(['#محاليل', 'جلسه', 'البيت', 'فريق']));
    expect(tokens('في من على')).toEqual([]);
    expect(bare('الرعاية المنزلية والمحاليل')).toBe('رعايه منزليه محاليل');
    expect(bare('رعاية منزلية')).toBe('رعايه منزليه');
  });

  it('reads posts from every network of the dashboard data', () => {
    const p = postsOf({ facebook: [{ name: 'Well', posts: [{ caption: 'a b c', likes: 1 }] }], instagram: [{ name: '@w', posts: [{ caption: 'x', likes: 2 }] }], tiktok: { name: 't', posts: [{ caption: 'y', likes: 3 }, { likes: 9 }] } });
    expect(p.map(x => x.network)).toEqual(['facebook', 'instagram', 'tiktok']);
    expect(p[2]?.eng).toBe(3);
  });

  it('ranks topics that beat the average, scores watched keywords and finds standouts', () => {
    const posts = postsOf({ instagram: [{ name: '@w', posts: [
      post('فيتامين سي للمناعة', 120, 30), post('فيتامين سي بالوريد', 100, 2), post('عرض المحاليل', 10, 1), post('عرض الشتاء', 12, 0), post('رعاية الأم', 11, 1),
    ] }] });
    const r = analyze(posts, ['فيتامين', 'ولادة'], 90, '2026-11-02');
    expect(r.posts).toBe(5);
    expect(r.topics[0]?.word).toBe('فيتامين');
    expect(r.watch[0]).toMatchObject({ keyword: 'فيتامين', posts: 2 });
    expect(r.watch[0]?.lift).toBeGreaterThan(1.5);
    expect(r.watch[1]).toMatchObject({ posts: 0, lift: null });
    expect(r.standouts.length).toBe(2);
    expect(r.talking[0]?.comments).toBe(30);
  });

  it('counts leads per source this week against last week and keeps only big moves', () => {
    const now = Date.parse('2026-11-02T00:00:00Z');
    const at = (d: number) => new Date(now - d * 864e5).toISOString();
    const rows = weekly([...Array(20).fill(0).map(() => ({ source_platform: 'snapchat_form', created_at: at(2) })), ...Array(10).fill(0).map(() => ({ source_platform: 'snapchat_form', created_at: at(9) })),
      ...Array(12).fill(0).map(() => ({ source_platform: 'meta_form', created_at: at(3) })), ...Array(11).fill(0).map(() => ({ source_platform: 'meta_form', created_at: at(10) })), { source_platform: 'x', created_at: at(30) }], now);
    expect(rows[0]).toEqual({ source: 'snapchat_form', now: 20, prev: 10 });
    expect(demandAlerts(rows).map((a: { source: string }) => a.source)).toEqual(['snapchat_form']);
  });
});
