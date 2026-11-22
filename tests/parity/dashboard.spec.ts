// Phase 4.1 (docs/phase-4.md): the numbers every view of the PIPELINE-built dashboard shows, pinned in golden.json.
// Scope, on purpose: this renders pipeline/template.html with the pipeline's own script (the pages served from R2) and compares it with a golden file
// made from that same page, so it catches an accidental change of those figures. It does not load the Astro pages in src/pages (those are
// covered by the smoke suite), and regenerating the golden with UPDATE_GOLDEN accepts whatever the page shows now: review the diff.
//   npm run test:parity                      check against golden.json
//   UPDATE_GOLDEN=1 npm run test:parity      rewrite golden.json from the pipeline page (only on purpose)
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..', '..');
const GOLDEN = join(import.meta.dirname, 'golden.json');
const UPDATE = !!process.env['UPDATE_GOLDEN'];

// Synthetic ads (fixtures/make_ads.py: 4 platforms, departments, goals, live/off; the repo is public, so nothing
// real) plus the small organic block from test_date_fixture.py
function fixture(): unknown {
  const data = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/ads.json'), 'utf8')) as Record<string, unknown>;
  data['organic'] = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/organic.json'), 'utf8'));
  data['generated_at'] = '2026-10-22T08:00+03:00';
  return data;
}

// The template with its script from pipeline/dash/*.js in order, as pipeline/dash_template.py assembles it
function template(): string {
  const dir = join(ROOT, 'pipeline/dash');
  const app = readdirSync(dir).filter(f => /^\d\d-.*\.js$/.test(f)).sort().map(f => readFileSync(join(dir, f), 'utf8')).join('');
  const tpl = readFileSync(join(ROOT, 'pipeline/template.html'), 'utf8');
  if (tpl.split('/*__APP__*/\n').length !== 2) throw new Error('template.html needs exactly one /*__APP__*/ line');
  return tpl.replace('/*__APP__*/\n', () => app);
}

// The pipeline page exactly as build.py makes it (data pasted into the template)
let oldPage = '';
function pipelinePage(): string {
  if (oldPage) return oldPage;
  const tpl = template();
  const blob = JSON.stringify(fixture()).replace(/<\//g, '<\\/');
  const dir = mkdtempSync(join(tmpdir(), 'parity-'));
  oldPage = join(dir, 'index.html');
  writeFileSync(oldPage, tpl.replace('/*__DATA__*/', () => blob));
  return oldPage;
}

type Step = { click: string } | { range: [string, string] };
type Scenario = { name: string; query?: string; steps?: Step[] };
const preset = (k: string): Step => ({ click: `#presets button[data-k="${k}"]` });
const plat = (v: string): Step => ({ click: `#plats button[data-v="${v}"]` });
const dept = (v: string): Step => ({ click: `#depts button[data-v="${v}"]` });
const stat = (v: string): Step => ({ click: `#stat button[data-v="${v}"]` });
// A range picked with «اختيار تاريخ»: open the picker, type the two days, apply
const range = (from: string, to: string): Step => ({ range: [from, to] });

const SCENARIOS: Scenario[] = [
  { name: 'overview 7d' },
  { name: 'overview 30d', steps: [preset('30')] },
  { name: 'overview last month', steps: [range('2026-09-01', '2026-09-30')] },
  { name: 'overview all time', steps: [preset('90')] },
  { name: 'overview 30d facebook', steps: [preset('30'), plat('facebook')] },
  { name: 'overview 30d snap', steps: [preset('30'), plat('snap')] },
  { name: 'overview 30d dept iv', steps: [preset('30'), dept('iv')] },
  { name: 'overview 30d live only', steps: [preset('30'), stat('live')] },
  { name: 'depts 30d', query: 'p=depts', steps: [preset('30')] },
  { name: 'channels 30d', query: 'p=channels', steps: [preset('30')] },
  { name: 'channels 14d google', query: 'p=channels', steps: [range('2026-10-08', '2026-10-21'), plat('google')] },
  { name: 'creative 30d', query: 'p=creative', steps: [preset('30')] },
  { name: 'creative wall only 30d', query: 'view=creative', steps: [preset('30')] },
  { name: 'creative wall only 30d snap', query: 'view=creative', steps: [preset('30'), plat('snap')] },
  { name: 'creative wall only 30d live only', query: 'view=creative', steps: [preset('30'), stat('live')] },
  { name: 'organic accounts', query: 'mode=organic&p=accounts', steps: [preset('90')] },
  { name: 'organic posts', query: 'mode=organic&p=posts', steps: [preset('90')] },
];

// Everything a person reads off a view: KPI tiles, tables, cards, each section's full text, the range label and the active filters.
// Text only, whitespace collapsed, in DOM order; hidden sections are skipped.
async function snapshot(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const t = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const shown = (el: Element) => !!(el as HTMLElement).offsetParent && !(el as HTMLElement).closest('[hidden]');
    const sections = [...document.querySelectorAll('main section, .dash-main > section')].filter(shown).map(s => ({
      id: s.id || s.getAttribute('aria-labelledby') || s.getAttribute('aria-label') || '',
      title: t(s.querySelector('h2')),
      kpis: [...s.querySelectorAll('.kpi')].filter(shown).map(k => [t(k.querySelector('.l')), t(k.querySelector('.v')), t(k.querySelector('.delta'))]),
      tables: [...s.querySelectorAll('table')].filter(shown).map(tb => [...tb.querySelectorAll('tr')].slice(0, 60).map(r => [...r.children].map(t))),
      cards: [...s.querySelectorAll('.card')].filter(shown).slice(0, 40).map(t),
      // Charts, wins, pace and organic posts are not tables: their full text (labels, axis values) still has to match
      text: t(s).slice(0, 6000),
    })).filter(s => s.text);
    return { range: t(document.querySelector('#rangeLabel')), chips: t(document.querySelector('#chips')), sections };
  });
}

async function open(page: Page, s: Scenario): Promise<unknown> {
  // Same starting point every run: no saved filters, Arabic
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* storage blocked */ } });
  await page.goto('file://' + pipelinePage() + (s.query ? '?' + s.query : ''));
  await page.waitForFunction(() => !!document.querySelector('#kpis .kpi .v')?.textContent?.trim() || !!document.querySelector('#acctPage *'));
  // Dispatched, not clicked: department and status sit in the collapsed "more filters" rows
  for (const st of s.steps ?? []) {
    if ('range' in st) {
      await page.locator('#dpickBtn').click();
      await page.locator('#from').fill(st.range[0]);
      await page.locator('#to').fill(st.range[1]);
      await page.locator('#to').dispatchEvent('change');
      await page.locator('#dpApply').click();
    } else await page.locator(st.click).first().dispatchEvent('click');
  }
  await page.waitForTimeout(300);
  return snapshot(page);
}

const golden: Record<string, unknown> = !UPDATE && existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown> : {};
const fresh: Record<string, unknown> = {};

for (const s of SCENARIOS) {
  test(s.name, async ({ page }) => {
    const got = await open(page, s);
    if (UPDATE) { fresh[s.name] = got; return; }
    expect(golden[s.name], `no golden for "${s.name}": run with UPDATE_GOLDEN=1`).toBeDefined();
    expect(got).toEqual(golden[s.name]);
  });
}

// The summary strip on top of the creative page reads the same data as the cards below it: same creatives, same spend, and its
// delivery counts come from `delivery` (not `live`) for the ads in the picked platform.
for (const q of ['view=creative', 'p=creative']) {
  test(`creative summary strip agrees with the cards (${q})`, async ({ page }) => {
    await open(page, { name: 'strip', query: q, steps: [preset('90')] });
    await page.locator('#more').evaluate(el => { while (!(el as HTMLElement).hidden) (el as HTMLElement).click(); });
    const got = await page.evaluate(() => {
      const num = (s: string) => Number(s.replace(/[^0-9.]/g, ''));
      const tiles = Object.fromEntries([...document.querySelectorAll('#sumStripBody .ss-kpis .kpi')].map(k => [k.querySelector('.l')?.textContent?.trim() ?? '', (k.querySelector('.v')?.textContent ?? '').trim()]));
      const cards = [...document.querySelectorAll('#cards .card')];
      const cardSpend = cards.map(c => [...c.querySelectorAll('.k')].find(k => k.textContent?.trim() === 'الصرف')?.nextElementSibling?.textContent ?? '0').reduce((a, v) => a + num(v), 0);
      const rows = [...document.querySelectorAll('#sumStripBody .ss-table tbody tr')].map(r => [...r.children].map(c => (c.firstChild?.textContent ?? '').trim()));
      return { creatives: num(tiles['عدد المواد'] ?? ''), cards: cards.length, spend: num(tiles['الصرف'] ?? ''), cardSpend, rows };
    });
    expect(got.creatives).toBe(got.cards);
    expect(Math.abs(got.spend - got.cardSpend)).toBeLessThan(got.cards + 1);   // cards round each spend
    expect(got.rows.length).toBeGreaterThan(1);
  });
}

test('summary strip delivery counts come from `delivery`, per platform', async ({ page }) => {
  await open(page, { name: 'strip', query: 'p=creative', steps: [preset('90')] });
  const data = fixture() as { ads: Record<string, { platform: string; delivery: string }> };
  const tot = [0, 0, 0];
  for (const a of Object.values(data.ads)) { const d = a.delivery; if (d === 'delivering') tot[0]++; else if (['budget', 'rejected', 'in_review', 'scheduled'].includes(d)) tot[1]++; }
  const shownTotal = await page.locator('#sumStripBody .ss-table tbody tr.ss-total td').first().textContent();
  expect(Number(shownTotal)).toBe(tot[0]);
});

test.afterAll(() => {
  if (!UPDATE) return;
  const prev = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown> : {};
  writeFileSync(GOLDEN, JSON.stringify({ ...prev, ...fresh }, null, 1) + '\n');
});
