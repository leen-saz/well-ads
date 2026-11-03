import { describe, expect, it } from 'vitest';
import type { Dash } from './numbers';
import { ALL, type CreativeAd, adStats, best, cplDiffers, formatOf, ideaName, ideas, matches, media, options, sortIdeas, video } from './creatives';

// Made-up ads: one idea («عرض الأسنان») as a Meta ad on two placements, a copy of it, and a Spark version on TikTok;
// a WhatsApp ad of another idea; and an image ad with no results
const D: Dash & { ads: Record<string, CreativeAd> } = {
  range: { start: '2026-10-01', end: '2026-10-05', today: '2026-10-06' },
  ads: {
    'm1|facebook': { name: 'clip.mp4_عرض الأسنان', campaign: 'أسنان ليدز', platform: 'facebook', dept: 'dental', goal: 'lead', live: true, format: 'فيديو', thumb: '/thumbs/m1.jpg', vid: { i: 1000, v: 300, c: 60 } },
    'm1|instagram': { name: 'clip.mp4_عرض الأسنان', campaign: 'أسنان ليدز', platform: 'instagram', dept: 'dental', goal: 'lead', live: true, format: 'فيديو', thumb: '/thumbs/m1.jpg', vid: { i: 1000, v: 300, c: 60 } },
    m2: { name: 'عرض الأسنان - نسخة 2', campaign: 'أسنان رسايل', platform: 'facebook', dept: 'dental', goal: 'messages', format: 'فيديو', vid: { i: 500, v: 50, c: 5 } },
    t1: { name: 'عرض الأسنان - Spark', campaign: 'تيك توك', platform: 'tiktok', dept: 'dental', goal: 'lead', format: 'VIDEO', text: 'ابتسامتك تستاهل', video: 'https://cdn.example/t1.mp4' },
    w1: { name: 'زيارة منزلية', campaign: 'واتساب', platform: 'snap', dept: 'home', goal: 'messages', format: 'صورة' },
    i1: { name: 'صورة بدون نتيجة', campaign: 'صور', platform: 'snap', goal: 'lead', format: 'صورة' },
  },
  rows: [
    ['m1|facebook', '2026-10-01', 100, 2000, 40, 5, 0],
    ['m1|instagram', '2026-10-01', 50, 1000, 10, 5, 0],
    ['m2', '2026-10-02', 40, 800, 8, 0, 8],
    ['t1', '2026-10-03', 60, 3000, 30, 2, 0],
    ['w1', '2026-10-03', 30, 600, 6, 0, 10],
    ['i1', '2026-10-03', 0, 0, 0, 0, 0],
    ['t1', '2026-09-20', 999, 1, 1, 1, 1], // before the period
  ],
};
const FROM = '2026-10-01', TO = '2026-10-05';

describe('creative ideas', () => {
  it('groups versions of the same idea: file prefix, copy and Spark suffixes go', () => {
    const list = ideas(D, FROM, TO);
    const teeth = list.find(x => x.key === 'عرض الأسنان')!;
    expect(list).toHaveLength(2);
    expect(teeth.ads.map(x => x.key).sort()).toEqual(['m1|facebook', 'm1|instagram', 'm2', 't1']);
    expect(teeth.platforms.sort()).toEqual(['meta', 'tiktok']);
    expect(teeth.depts).toEqual(['dental']);
    expect(teeth.live).toBe(true);
  });

  it('adds up the period only, and drops ads with no spend and no result', () => {
    const teeth = ideas(D, FROM, TO).find(x => x.key === 'عرض الأسنان')!;
    expect(teeth.spend).toBe(250);
    expect(teeth.impr).toBe(6800);
    expect(teeth.results).toBe(20); // 12 leads + 8 chats
    expect(adStats(D, FROM, TO).map(x => x.key)).not.toContain('i1');
  });

  it('cost per lead uses only lead-goal spend and leads, like the creative wall', () => {
    const teeth = ideas(D, FROM, TO).find(x => x.key === 'عرض الأسنان')!;
    expect(teeth.leadSpend).toBe(210); // the WhatsApp copy's 40 stays out
    expect(teeth.leadN).toBe(12);
    expect(teeth.cpl).toBeCloseTo(17.5);
    expect(cplDiffers(teeth)).toBe(true);
    const home = ideas(D, FROM, TO).find(x => x.key === 'زيارة منزلية')!;
    expect(home.cpl).toBeNull();
    expect(cplDiffers(home)).toBe(false);
  });

  it('click rate is clicks ÷ impressions', () => {
    const teeth = ideas(D, FROM, TO).find(x => x.key === 'عرض الأسنان')!;
    expect(teeth.ctr).toBeCloseTo(88 / 6800);
  });

  it('one Meta ad across placements is one version; versions come biggest spender first', () => {
    const v = ideas(D, FROM, TO).find(x => x.key === 'عرض الأسنان')!.versions;
    expect(v.map(x => x.id)).toEqual(['m1', 't1', 'm2']);
    expect(v[0]!.spend).toBe(150);
    expect(v[0]!.platforms.sort()).toEqual(['facebook', 'instagram']);
    expect(v[0]!.cpl).toBe(15);
    expect(v[2]!.cpl).toBeNull();
  });

  it('names the idea without the file prefix or the copy and Spark suffixes', () => {
    expect(ideas(D, FROM, TO).find(x => x.key === 'عرض الأسنان')!.name).toBe('عرض الأسنان');
    expect(ideaName('Teeth Offer - Spark')).toBe('Teeth Offer');
    expect(ideaName('clip.mp4_')).toBe('clip.mp4_');
  });

  it('the idea is shown by an ad with a picture, then by spend', () => {
    expect(ideas(D, FROM, TO).find(x => x.key === 'عرض الأسنان')!.ad.thumb).toBe('/thumbs/m1.jpg');
  });
});

describe('hook rate', () => {
  it('stopped to watch ÷ impressions, counting a Meta ad once across its placements', () => {
    const r = video(['m1|facebook', 'm1|instagram', 'm2'].map(key => ({ key, ad: D.ads[key]! })));
    expect(r.hook).toBeCloseTo(350 / 1500);
    expect(r.hold).toBeCloseTo(65 / 350);
  });
  it('is empty when there is no video record', () => {
    expect(video([{ key: 'w1', ad: D.ads.w1! }])).toEqual({ hook: null, hold: null });
  });
});

describe('filters', () => {
  it('platform filters by family, and the rest by the ad', () => {
    const f = (o: Partial<typeof ALL>) => ideas(D, FROM, TO, { ...ALL, ...o }).map(x => x.key).sort();
    expect(f({ platform: 'meta' })).toEqual(['عرض الأسنان']);
    expect(f({ platform: 'snap' })).toEqual(['زيارة منزلية']);
    expect(f({ dept: 'home' })).toEqual(['زيارة منزلية']);
    expect(f({ goal: 'messages' }).sort()).toEqual(['زيارة منزلية', 'عرض الأسنان']);
    expect(f({ format: 'صورة' })).toEqual(['زيارة منزلية']);
    expect(f({ q: 'ابتسامتك' })).toEqual(['عرض الأسنان']);
  });
  it('a filter narrows the idea down to its matching versions', () => {
    const teeth = ideas(D, FROM, TO, { ...ALL, goal: 'messages' })[0]!;
    expect(teeth.ads.map(x => x.key)).toEqual(['m2']);
    expect(teeth.spend).toBe(40);
  });
  it('ads with no department count as brand', () => {
    expect(matches(D.ads.i1!, { ...ALL, dept: 'brand' })).toBe(true);
  });
  it('offers only what is in the data', () => {
    const o = options(D);
    expect(o.platforms.sort()).toEqual(['meta', 'snap', 'tiktok']);
    expect(o.depts.sort()).toEqual(['brand', 'dental', 'home']);
    expect(o.formats).toEqual(['صورة', 'فيديو']);
  });
  it('reads the format in Arabic or English', () => {
    expect(formatOf({ name: '', campaign: '', platform: 'tiktok', format: 'VIDEO' })).toBe('فيديو');
    expect(formatOf({ name: '', campaign: '', platform: 'snap', format: 'IMAGE' })).toBe('صورة');
    expect(formatOf({ name: '', campaign: '', platform: 'google_search', format: 'بحث نصي' })).toBe('بحث نصي');
    expect(formatOf({ name: '', campaign: '', platform: 'snap' })).toBe('غير محدد');
  });
});

describe('sorting and comparing', () => {
  const list = ideas(D, FROM, TO);
  it('sorts by spend, results, cost, click rate and hook', () => {
    expect(sortIdeas(list, 'spend')[0]!.key).toBe('عرض الأسنان');
    expect(sortIdeas(list, 'cpl')[0]!.key).toBe('عرض الأسنان'); // the other has no leads: last
    expect(sortIdeas(list, 'hook')[1]!.key).toBe('زيارة منزلية');
  });
  it('the best value in a row: highest, lowest for costs, nothing for spend or a single value', () => {
    expect(best([1, 3, null, 2], 1)).toBe(3);
    expect(best([1, 3, null, 2], -1)).toBe(1);
    expect(best([1, 3], 0)).toBeNull();
    expect(best([5, null], 1)).toBeNull();
  });
});

describe('preview', () => {
  it('plays a video file from this site, and opens an outside one in a new tab', () => {
    expect(media({ name: '', campaign: '', platform: 'tiktok', video: '/m/x/y.mp4', thumb: '/thumbs/t.jpg' })).toEqual({ img: '/thumbs/t.jpg', video: '/m/x/y.mp4', open: '' });
    expect(media(D.ads.t1!)).toEqual({ img: '', video: '', open: 'https://cdn.example/t1.mp4' });
  });
  it('shows only pictures the page may load, and never links the Snap API', () => {
    expect(media({ name: '', campaign: '', platform: 'snap', thumb: 'data:image/png;base64,x', preview_url: 'https://adsapi.snapchat.com/x' }))
      .toEqual({ img: 'data:image/png;base64,x', video: '', open: '' });
    expect(media({ name: '', campaign: '', platform: 'meta', thumb: 'https://scontent.example/t.jpg', permalink: 'https://fb.com/p/1' }))
      .toEqual({ img: '', video: '', open: 'https://fb.com/p/1' });
  });
});
