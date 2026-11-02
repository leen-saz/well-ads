// Listening analysis that runs in the browser (free-tier Workers have 10 ms of CPU, too little for big JSON).
// Input: organic posts (facebook, instagram, tiktok) from the dashboard data, plus watched keywords.

const STOP_WORDS = ['من', 'في', 'على', 'الى', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'اللي', 'التي', 'الذي', 'كل', 'او', 'أو', 'ثم', 'لكن', 'عند', 'بعد', 'قبل', 'لين', 'حتى', 'انت', 'أنت', 'انتي', 'احنا', 'نحن', 'هو', 'هي', 'ما', 'لا', 'لم', 'لن', 'قد', 'كان', 'تكون', 'يكون', 'and', 'the', 'for', 'with', 'you', 'your', 'our', 'are', 'this', 'that', 'from', 'well', 'ويل'];

export function norm(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ْـ]/g, '')          // tashkeel and tatweel
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}

const STOP = new Set(STOP_WORDS.map(norm)); // compared after the same normalisation as the text

// "رعاية منزلية" should find "الرعاية المنزلية": compare without the definite article
export const bare = s => norm(s).replace(/(^|[\s#])(?:وال|بال|ال)(?=[\p{L}]{2,})/gu, '$1');

export function tokens(text) {
  const t = norm(text);
  const tags = (t.match(/#[\p{L}\p{N}_]+/gu) || []);
  const words = (t.replace(/#[\p{L}\p{N}_]+/gu, ' ').match(/[\p{L}\p{N}]{3,}/gu) || []).filter(w => !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set([...tags, ...words])];
}

const eng = p => p.engagement != null ? Number(p.engagement) || 0 : (p.likes || 0) + (p.comments || 0) + (p.shares || 0) + (p.saves || 0);
const median = xs => { const a = [...xs].sort((x, y) => x - y); if (!a.length) return 0; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

export function postsOf(organic) {
  const out = [], o = organic || {};
  const push = (p, network, page) => out.push({ ...p, network: p.network || network, page: p.page || page || '', eng: eng(p) });
  for (const pg of o.facebook || []) for (const p of pg.posts || []) push(p, 'facebook', pg.name);
  for (const pg of o.instagram || []) for (const p of pg.posts || []) push(p, 'instagram', pg.name);
  for (const p of (o.tiktok || {}).posts || []) push(p, 'tiktok', (o.tiktok || {}).name);
  return out.filter(p => p.caption || p.text);
}

export function analyze(posts, keywords = [], days = 90, today = new Date().toISOString().slice(0, 10)) {
  const from = new Date(Date.parse(today) - days * 864e5).toISOString().slice(0, 10);
  const P = posts.filter(p => !p.date || String(p.date).slice(0, 10) >= from);
  const avg = P.length ? P.reduce((s, p) => s + p.eng, 0) / P.length : 0;
  const medE = median(P.map(p => p.eng)), medC = median(P.map(p => p.comments || 0));

  const words = new Map();
  for (const p of P) for (const w of tokens(p.caption || p.text)) { const o = words.get(w) || { word: w, posts: 0, eng: 0 }; o.posts++; o.eng += p.eng; words.set(w, o); }
  const topics = [...words.values()].filter(o => o.posts >= 2).map(o => ({ ...o, avg: o.eng / o.posts, lift: avg ? (o.eng / o.posts) / avg : 0 }))
    .sort((a, b) => b.lift * Math.log2(1 + b.posts) - a.lift * Math.log2(1 + a.posts)).slice(0, 15);

  const watch = keywords.map(k => String(k || '').trim()).filter(Boolean).map(k => {
    const nk = bare(k), hit = P.filter(p => bare(p.caption || p.text).includes(nk));
    const a = hit.length ? hit.reduce((s, p) => s + p.eng, 0) / hit.length : 0;
    const last = hit.map(p => String(p.date || '').slice(0, 10)).sort().pop() || null;
    return { keyword: k, posts: hit.length, avg: a, lift: avg && hit.length ? a / avg : null, last };
  });

  const standouts = P.filter(p => medE > 0 && p.eng >= 2 * medE).sort((a, b) => b.eng - a.eng).slice(0, 6);
  const talking = P.filter(p => (p.comments || 0) >= Math.max(3, 2 * medC)).sort((a, b) => (b.comments || 0) - (a.comments || 0)).slice(0, 6);
  const nets = {};
  for (const p of P) { const n = (nets[p.network] ||= { posts: 0, eng: 0 }); n.posts++; n.eng += p.eng; }
  return { posts: P.length, avg, topics, watch, standouts, talking, networks: nets, from };
}

// Leads per source this week against last week (from /api/listening/demand)
export function demandAlerts(rows, minBase = 10) {
  return rows.filter(r => r.prev >= minBase || r.now >= minBase).map(r => ({ ...r, change: r.prev ? (r.now - r.prev) / r.prev : null }))
    .filter(r => r.change == null || Math.abs(r.change) >= 0.3).sort((a, b) => Math.abs(b.change ?? 1) - Math.abs(a.change ?? 1));
}
