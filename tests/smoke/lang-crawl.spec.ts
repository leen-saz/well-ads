// Language crawl: every page of the site in English and in Arabic, with its tabs, toggles, selects and dialogs opened,
// looking for text left in the other language. Arabic letters in English; Latin words in Arabic (outside the allow-list
// of brands, platforms, units and acronyms). Text nodes, attributes, the title and SVG chart text, hidden panes too.
// User data (ad names, campaigns, post text) is marked data-user-text and skipped.
//
// It writes a per-page report (test-results/lang-crawl/report.md and .json). It fails on the Performance pages (Overview,
// its creative tab, and the main analytics page with its views); the rest are reported for the general sweep.
// LANG_CRAWL_STRICT=all fails on every page. Synthetic data only: the parity fixture and a made-up CRM block.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { login, addSession } from './helpers';
import { MODULES } from '../../src/modules/registry';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'test-results', 'lang-crawl');
const STRICT_ALL = process.env['LANG_CRAWL_STRICT'] === 'all';

// ---- The data: the parity fixture, with a made-up CRM block so every card has numbers
type Row = [string, string, number, number, number, number, number];
const FIX = JSON.parse(readFileSync(join(ROOT, 'tests/parity/fixtures/ads.json'), 'utf8')) as { rows: Row[]; range: { end: string } } & Record<string, unknown>;
function dashData() {
  const rows: unknown[] = [], paid: unknown[] = [];
  let n = 0;
  for (const r of FIX.rows) for (let i = 0; i < r[5]; i++) {
    if (++n % 2) continue;
    const p = (n / 2) % 30 === 0;
    rows.push([r[0], r[1], p ? r[1] : '', p, p ? 1500 : 0]);
    if (p) paid.push([r[1], r[1], 1500, 'meta_form']);
  }
  return { ...FIX, platforms: { tiktok: { synced_at: FIX.range.end + 'T12:00+03:00' } }, crm: { rows, paid_all: paid } };
}

// ---- The main analytics page, built as pipeline/build.py does (template + pipeline/dash/*.js + the data inline)
function pipelinePage(): string {
  const dir = join(ROOT, 'pipeline/dash');
  const app = readdirSync(dir).filter(f => /^\d\d-.*\.js$/.test(f)).sort().map(f => readFileSync(join(dir, f), 'utf8')).join('');
  const tpl = readFileSync(join(ROOT, 'pipeline/template.html'), 'utf8').replace('/*__APP__*/\n', () => app);
  const organic = JSON.parse(readFileSync(join(ROOT, 'tests/parity/fixtures/organic.json'), 'utf8'));
  const blob = JSON.stringify({ ...dashData(), organic, generated_at: '2026-10-22T08:00+03:00' }).replace(/<\//g, '<\\/');
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + tpl.replace('/*__DATA__*/', () => blob);
}

// ---- What counts as the other language
const ARABIC = /[؀-ۿݐ-ݿ]/;
// Arabic in English: the language button names itself, and #196's quoted examples
const ALLOW_AR: RegExp[] = [/^عربي$/, /^A word or claim never to be written/];
// Latin words that belong in Arabic too: brands, platforms, units, acronyms, the product's own names
const LATIN_OK = new Set(('Well WellUnion Meta Facebook Instagram Messenger Threads Snapchat Snap TikTok Google YouTube WhatsApp Search Display ' +
  'Performance Max Demand Gen Shopping Moyasar CRM ROAS MER CTR CPM CPC CPL CPA CAC KPI SAR AI API URL PDF CSV ID GA GA4 SEO UTM HTML JSON ' +
  'Claude Anthropic Gemini OpenAI GitHub Supabase Cloudflare Notion Canva Higgsfield Seedance Kling Veo Sora CapCut Paperclip Maestro English ' +
  'iOS Android OK Pmax PMax Reels Stories Story Carousel Spark Lead Leads Ads Excel Care ' +
  'Analytics Console LinkedIn Pinterest Reddit Microsoft Bing Amazon Apple Taboola Apipeline Grok X Workers PostHog posthog ' +
  'googleads googleanalytics googlesearchconsole pinterest reddit wellcare MCP Business Pixel Advantage').split(' ').map(w => w.toLowerCase()));
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]+/g;

type Lang = 'en' | 'ar';
// Every piece of visible-or-hidden text and the attributes a reader meets, minus user data
async function texts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const skip = /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT|CODE|PRE)$/;
    const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || skip.test(p.tagName) || p.closest('[data-user-text]')) continue;
      const v = (n.nodeValue || '').trim(); if (v) out.push(v);
    }
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('[data-user-text]')) continue;
      for (const a of ['placeholder', 'aria-label', 'data-tip', 'title', 'alt']) { const v = el.getAttribute(a); if (v) out.push(v.trim()); }
    }
    out.push(document.title);
    return out;
  });
}
// The crawl supplied the data, so it knows it: ad names, campaigns, ad sets, ad text and the fake users' names are taken
// out of a string before it is judged (they stay in the language they were written in)
const DATA = [...new Set(Object.values((FIX as unknown as { ads: Record<string, Record<string, unknown>> }).ads)
  .flatMap(a => ['name', 'campaign', 'group', 'text'].map(k => String(a[k] ?? '')).filter(v => v.length > 1)))].sort((x, y) => y.length - x.length);
const withoutData = (s: string) => DATA.reduce((t, d) => t.split(d).join(' '), s).replace(/Smoke [a-z-]+/gi, ' ');
function leftovers(lang: Lang, list: string[]): string[] {
  if (lang === 'en') return list.filter(s => ARABIC.test(withoutData(s)) && !ALLOW_AR.some(re => re.test(s)));
  return list.filter(raw => {
    const s = withoutData(raw);
    if (!ARABIC.test(s) && !/[A-Za-z]{2}/.test(s)) return false;
    if (/^(https?:|www\.|@|\S+@\S+\.\S+$)/.test(s.trim())) return false;
    return (s.match(LATIN_WORD) ?? []).some(w => !LATIN_OK.has(w.toLowerCase()) && !/^[A-Z0-9_]{2,}$/.test(w));
  });
}

// Open what a person would open: tabs, toggles, segments, selects, details, then one row and one card dialog.
// Nothing that saves, sends, deletes or navigates away.
const SAFE = '[role="tab"], [data-tab], .seg button, [data-slot="toggle-group-item"], [role="radio"], summary, [data-slot="select-trigger"], #dpickBtn';
const LANG_SWITCH = /^(عربي|English|EN|AR|ع)$/;
const DANGER = /حفظ|احفظ|أرسل|ارسل|احذف|حذف|اعتمد|نفّذ|نفذ|موافق|إيقاف|شغّل|save|send|delete|remove|approve|run|publish|stop/i;
async function exercise(page: Page, seen: Set<string>, lang: Lang) {
  const grab = async () => { for (const s of leftovers(lang, await texts(page))) seen.add(s); };
  await grab();
  const n = Math.min(await page.locator(SAFE).count(), 40);
  for (let i = 0; i < n; i++) {
    const el = page.locator(SAFE).nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const label = ((await el.textContent().catch(() => '')) ?? '').trim();
    if (DANGER.test(label)) continue;
    // Never the language switch itself: it would turn the page into the other language mid-crawl
    if (LANG_SWITCH.test(label) || await el.evaluate(e => !!e.closest('[data-lang], #lang, .lang')).catch(() => false)) continue;
    await el.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(200);
    await grab();
    await page.keyboard.press('Escape').catch(() => {});
  }
  // A row and a card that open a sheet/dialog (Overview's ads table and creative ideas, the main page's ad cards)
  for (const sel of ['tbody tr[tabindex="0"]', '[role="button"][tabindex="0"]', '.card[role="button"]']) {
    const el = page.locator(sel).first();
    if (!(await el.isVisible().catch(() => false))) continue;
    await el.click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(400);
    await grab();
    await page.keyboard.press('Escape').catch(() => {});
  }
}

// ---- The routes: what the sidebar offers the owner (every module) plus the module sub-pages and the known extras
const EXTRA = ['/', '/today/', '/control/', '/control/new/', '/connectors/', '/account/', '/admin/', '/admin/modules/', '/library/', '/maestro/health/', '/soon/'];
const MODULE_PAGES = MODULES.flatMap(m => [`/${m.key}/`, ...(m.pages ?? []).map(p => `/${m.key}/${p.path}/`)]);
const PUBLIC = ['/login/', '/reset/', '/welcome/', '/security/', '/profile/'];
// The Performance pages: these must be clean in both languages
const PERFORMANCE = /^\/overview\/|^pipeline:/;
// The main analytics page in its views (the Worker serves a placeholder there in the smoke setup, so it is built here)
const PIPELINE_VIEWS = ['', 'p=depts', 'p=channels', 'p=creative', 'view=creative', 'mode=organic&p=accounts', 'mode=organic&p=posts'];

// Each visit writes its own result (workers run in parallel); every worker's afterAll merges them all, so the last one
// to finish writes the full report. Playwright empties test-results/ at the start of a run.
type Result = { page: string; lang: Lang; strict: boolean; left: string[] };
const RESULTS = join(OUT, 'results');
test.afterAll(() => {
  mkdirSync(RESULTS, { recursive: true });
  const report: Result[] = readdirSync(RESULTS).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(RESULTS, f), 'utf8')) as Result);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const md = ['# Language crawl', '', `${report.length} page visits; ${report.filter(r => r.left.length).length} with leftovers.`, ''];
  for (const r of [...report].sort((a, b) => a.page.localeCompare(b.page) || a.lang.localeCompare(b.lang))) {
    if (!r.left.length) continue;
    md.push(`## ${r.page} (${r.lang})${r.strict ? ' [must be clean]' : ''}`, ...r.left.slice(0, 60).map(s => `- ${s.replace(/\s+/g, ' ').slice(0, 160)}`), '');
  }
  writeFileSync(join(OUT, 'report.md'), md.join('\n') + '\n');
});

async function check(name: string, lang: Lang, page: Page, open: () => Promise<void>) {
  const seen = new Set<string>();
  await open();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(700);
  await exercise(page, seen, lang);
  const strict = STRICT_ALL || PERFORMANCE.test(name);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${lang}-${name.replace(/[^a-z0-9]+/gi, '_')}.json`), JSON.stringify({ page: name, lang, strict, left: [...seen] }));
  if (strict) expect([...seen], `${lang === 'en' ? 'Arabic' : 'Latin UI words'} left on ${name} in ${lang}`).toEqual([]);
}

for (const lang of ['en', 'ar'] as const) {
  test.describe(`language crawl (${lang})`, () => {
    test.describe.configure({ mode: 'parallel' });
    // A page with many tabs and toggles takes longer than the smoke suite's 30 s
    test.setTimeout(120_000);
    const signedIn = [...new Set([...EXTRA, ...MODULE_PAGES])];
    for (const path of signedIn) {
      test(`${path} ${lang}`, async ({ page, context, request }) => {
        await addSession(context, await login(request, 'owner'));
        await page.route('**/api/overview/data*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashData()) }));
        await check(path, lang, page, async () => { await page.goto(`${path}?lang=${lang}`); });
      });
    }
    for (const path of PUBLIC) {
      test(`${path} ${lang} (signed out)`, async ({ page }) => {
        await check(path, lang, page, async () => { await page.goto(`${path}?lang=${lang}`); });
      });
    }
    for (const q of PIPELINE_VIEWS) {
      test(`main analytics page ?${q} ${lang}`, async ({ page }) => {
        const dir = join(OUT, 'pages'); mkdirSync(dir, { recursive: true });
        const file = join(dir, 'main.html'); writeFileSync(file, pipelinePage());
        await page.addInitScript(l => { try { localStorage.clear(); localStorage.setItem('well-ads-lang', l); } catch { /* storage blocked */ } }, lang);
        await check(`pipeline:/?${q}`, lang, page, async () => { await page.goto(`file://${file}?${q}${q ? '&' : ''}lang=${lang}`); });
      });
    }
  });
}
