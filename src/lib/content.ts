// إيجنت المحتوى و SEO/AEO: يقرا الموقع (الصفحة الرئيسية + sitemap)، ويطلع الملاحظات بقواعد ثابتة،
// وبعدين يبني بلان بـ Workers AI (مجاني ضمن حد Cloudflare اليومي). لو الذكاء الاصطناعي ما اشتغل، البلان من القواعد بس.
// كل بند يحتاج موافقة الماركتير قبل النشر (أو تلقائي مع تنبيه).

export interface PageFacts { url: string; status: number; title: string; description: string; h1: string[]; words: number; schema: string[]; faq: boolean; lang: string; canonical: boolean }
export interface Item { id: string; kind: 'fix' | 'page' | 'article' | 'faq'; title: string; why: string; priority: 1 | 2 | 3; status: 'proposed' | 'approved' | 'done' | 'rejected'; draft?: string }
export interface Gsc { query: string; clicks: number; impressions: number; position: number }

export const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_PAGES = 12;
const UA = { 'user-agent': 'WellContentAgent/1.0 (+https://well-ads.pages.dev)' };

export function normalizeSite(s: unknown): string | null {
  try {
    const u = new URL(/^https?:\/\//.test(String(s)) ? String(s) : `https://${String(s)}`);
    if (u.protocol !== 'https:' || !/\./.test(u.hostname) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}

const pick = (html: string, re: RegExp) => (html.match(re)?.[1] || '').replace(/\s+/g, ' ').trim();
const strip = (s: string) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

export function facts(url: string, status: number, html: string): PageFacts {
  const schema = [...html.matchAll(/"@type"\s*:\s*"([A-Za-z]+)"/g)].map(m => m[1] as string);
  return {
    url, status,
    title: pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || pick(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i),
    h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => strip(m[1] as string).replace(/\s+/g, ' ').trim()).filter(Boolean),
    words: strip(html).split(/\s+/).filter(Boolean).length,
    schema: [...new Set(schema)],
    faq: schema.includes('FAQPage'),
    lang: pick(html, /<html[^>]+lang=["']([^"']+)/i),
    canonical: /<link[^>]+rel=["']canonical["']/i.test(html),
  };
}

export async function crawl(site: string, f: typeof fetch = fetch): Promise<PageFacts[]> {
  const get = async (u: string) => { const r = await f(u, { headers: UA, redirect: 'follow' }); return { status: r.status, text: r.ok ? (await r.text()).slice(0, 600_000) : '' }; };
  const urls = new Set([site + '/']);
  try {
    const sm = await get(site + '/sitemap.xml');
    for (const m of sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      const u = m[1] as string;
      if (u.startsWith(site) && !u.endsWith('.xml') && urls.size < MAX_PAGES) urls.add(u);
    }
  } catch { /* no sitemap */ }
  const out: PageFacts[] = [];
  for (const u of urls) {
    try { const r = await get(u); out.push(facts(u, r.status, r.text)); } catch { out.push(facts(u, 0, '')); }
  }
  return out;
}

// Fixed rules from Google's Search Essentials and structured-data docs. The biweekly docs refresh updates this list.
export function audit(pages: PageFacts[]): Item[] {
  const items: Item[] = [];
  const add = (kind: Item['kind'], title: string, why: string, priority: Item['priority']) => items.push({ id: `r${items.length + 1}`, kind, title, why, priority, status: 'proposed' });
  const broken = pages.filter(p => p.status >= 400 || p.status === 0);
  if (broken.length) add('fix', `صلّح ${broken.length} صفحة ما تفتح`, broken.map(p => p.url).slice(0, 5).join('، '), 1);
  const noTitle = pages.filter(p => p.status === 200 && (!p.title || p.title.length > 65));
  if (noTitle.length) add('fix', `عناوين ناقصة أو طويلة في ${noTitle.length} صفحة`, 'العنوان يطلع في نتايج قوقل وإجابات الذكاء الاصطناعي. خلّه أقل من 60 حرف وفيه الخدمة والمدينة.', 1);
  const noDesc = pages.filter(p => p.status === 200 && !p.description);
  if (noDesc.length) add('fix', `وصف (meta description) ناقص في ${noDesc.length} صفحة`, 'بدونه قوقل يختار أي نص من الصفحة.', 2);
  const badH1 = pages.filter(p => p.status === 200 && p.h1.length !== 1);
  if (badH1.length) add('fix', `عنوان H1 واحد لكل صفحة (${badH1.length} صفحة فيها مشكلة)`, 'يوضح موضوع الصفحة لمحركات البحث.', 2);
  const thin = pages.filter(p => p.status === 200 && p.words < 250);
  if (thin.length) add('page', `وسّع ${thin.length} صفحة محتواها قليل`, 'الصفحات القصيرة نادراً تطلع أو تنذكر في إجابات الذكاء الاصطناعي.', 2);
  if (!pages.some(p => p.faq)) add('faq', 'أضف أسئلة شائعة بالسعودي مع FAQPage schema', 'محركات الإجابة (AEO) تقتبس الأسئلة والأجوبة المباشرة.', 1);
  if (!pages.some(p => p.schema.some(s => ['MedicalClinic', 'MedicalBusiness', 'LocalBusiness', 'Organization'].includes(s)))) add('fix', 'أضف schema للمنشأة (MedicalClinic / LocalBusiness)', 'يربط اسمك وعنوانك وخدماتك في نتايج البحث والخرائط.', 1);
  if (pages.some(p => p.status === 200 && !p.canonical)) add('fix', 'أضف رابط canonical لكل صفحة', 'يمنع تكرار الصفحات في الفهرسة.', 3);
  return items;
}

export function prompt(site: string, niche: string, competitors: string[], pages: PageFacts[], gsc: Gsc[], rules: Item[]): string {
  return `أنت خبير SEO و AEO للسوق السعودي (الرياض). الموقع: ${site}. النيش: ${niche || 'غير محدد'}.
المنافسين اللي يعجبون الماركتير (نبرة وأسلوب كمرجع): ${competitors.join('، ') || 'ما فيه'}.
صفحات الموقع (عنوان | كلمات | schema):
${pages.map(p => `- ${p.url} | ${p.title} | ${p.words} | ${p.schema.join(',') || '-'}`).join('\n')}
أعلى كلمات البحث من Search Console (كلمة | ظهور | نقرات | ترتيب):
${gsc.slice(0, 30).map(g => `- ${g.query} | ${g.impressions} | ${g.clicks} | ${g.position.toFixed(1)}`).join('\n') || '- غير مربوط'}
ملاحظات القواعد الثابتة: ${rules.map(r => r.title).join('؛ ')}
المطلوب: حدد البوزشن والنيش باختصار، وبعدين 8 بنود محتوى جديدة (مقالات، صفحات خدمات، أسئلة شائعة) بالسعودي، كل بند يستهدف بحث حقيقي في الرياض، بدون ادعاءات طبية (وزارة الصحة).
رد JSON فقط بهالشكل: {"position":"...","niche":"...","items":[{"kind":"article|page|faq","title":"...","why":"...","priority":1}]}`;
}

export function parsePlan(text: string): { position: string; niche: string; items: Item[] } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { position?: unknown; niche?: unknown; items?: unknown };
    const items = (Array.isArray(j.items) ? j.items : []).slice(0, 12).flatMap((x, i): Item[] => {
      const o = (x || {}) as Record<string, unknown>;
      const kind = ['article', 'page', 'faq'].includes(String(o.kind)) ? (o.kind as Item['kind']) : 'article';
      const title = String(o.title || '').trim().slice(0, 200);
      const p = Number(o.priority);
      return title ? [{ id: `a${i + 1}`, kind, title, why: String(o.why || '').trim().slice(0, 500), priority: (p === 1 || p === 2 || p === 3 ? p : 2), status: 'proposed' }] : [];
    });
    return { position: String(j.position || '').slice(0, 1000), niche: String(j.niche || '').slice(0, 300), items };
  } catch { return null; }
}

export type AiRun = (model: string, input: { messages: { role: string; content: string }[]; max_tokens: number }) => Promise<unknown>;

export async function plan(ai: AiRun | undefined, site: string, niche: string, competitors: string[], pages: PageFacts[], gsc: Gsc[]) {
  const rules = audit(pages);
  if (!ai) return { engine: 'rules', analysis: { pages: pages.length }, items: rules };
  try {
    const out = await ai(AI_MODEL, { messages: [{ role: 'user', content: prompt(site, niche, competitors, pages, gsc, rules) }], max_tokens: 2000 });
    const parsed = parsePlan(String((out as { response?: unknown })?.response ?? ''));
    if (!parsed) return { engine: 'rules', analysis: { pages: pages.length, ai: 'رد غير مفهوم' }, items: rules };
    return { engine: 'workers-ai', analysis: { pages: pages.length, position: parsed.position, niche: parsed.niche }, items: [...rules, ...parsed.items] };
  } catch { return { engine: 'rules', analysis: { pages: pages.length, ai: 'ما اشتغل' }, items: rules }; }
}

// Search Console: top queries of the last 28 days, if the company connected Google (OAuth)
export async function searchConsole(site: string, t: Record<string, string | undefined>, f: typeof fetch = fetch): Promise<Gsc[]> {
  if (!t.GSC_CLIENT_ID || !t.GSC_CLIENT_SECRET || !t.GSC_REFRESH_TOKEN) return [];
  const tok = await f('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: t.GSC_CLIENT_ID, client_secret: t.GSC_CLIENT_SECRET, refresh_token: t.GSC_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const access = ((await tok.json()) as { access_token?: string }).access_token;
  if (!access) return [];
  const end = new Date(), start = new Date(Date.now() - 28 * 864e5);
  const r = await f(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(t.GSC_SITE || site + '/')}/searchAnalytics/query`, {
    method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), dimensions: ['query'], rowLimit: 50 }) });
  const rows = ((await r.json()) as { rows?: { keys: string[]; clicks: number; impressions: number; position: number }[] }).rows || [];
  return rows.map(x => ({ query: x.keys[0] || '', clicks: x.clicks, impressions: x.impressions, position: x.position }));
}

// Publishing options per item: export now; WordPress / GitHub PR once each is connected through OAuth
export const PUBLISH = { export: { name: 'تصدير (نسخ)', live: true }, wordpress: { name: 'WordPress', live: false }, github: { name: 'طلب دمج على GitHub', live: false } } as const;
