// Phase 4.1 (docs/phase-4.md): the numbers every dashboard view shows, pinned in golden.json.
// The pipeline page must match it today; the Astro pages must match the same file before the cutover (4.6).
//   npm run test:parity                      check against golden.json
//   UPDATE_GOLDEN=1 npm run test:parity      rewrite golden.json from the pipeline page (only on purpose)
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(import.meta.dirname, '..', '..');
const GOLDEN = join(import.meta.dirname, 'golden.json');
const UPDATE = !!process.env['UPDATE_GOLDEN'];

// Real-shaped ads data (pipeline fixture) plus the small organic block from test_date_fixture.py
function fixture(): unknown {
  const data = JSON.parse(readFileSync(join(ROOT, 'pipeline/tests/fixtures/prototype_slim.json'), 'utf8')) as Record<string, unknown>;
  data['organic'] = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/organic.json'), 'utf8'));
  data['generated_at'] = '2026-10-12T08:00+03:00';
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

type Step = { click: string };
type Scenario = { name: string; query?: string; steps?: Step[] };
const preset = (k: string): Step => ({ click: `#presets button[data-k="${k}"]` });
const plat = (v: string): Step => ({ click: `#plats button[data-v="${v}"]` });
const dept = (v: string): Step => ({ click: `#depts button[data-v="${v}"]` });
const stat = (v: string): Step => ({ click: `#stat button[data-v="${v}"]` });

const SCENARIOS: Scenario[] = [
  { name: 'overview 7d' },
  { name: 'overview 30d', steps: [preset('30')] },
  { name: 'overview last month', steps: [preset('pm')] },
  { name: 'overview all time', steps: [preset('90')] },
  { name: 'overview 30d meta', steps: [preset('30'), plat('meta')] },
  { name: 'overview 30d snap', steps: [preset('30'), plat('snap')] },
  { name: 'overview 30d dept iv', steps: [preset('30'), dept('iv')] },
  { name: 'overview 30d live only', steps: [preset('30'), stat('live')] },
  { name: 'depts 30d', query: 'p=depts', steps: [preset('30')] },
  { name: 'channels 30d', query: 'p=channels', steps: [preset('30')] },
  { name: 'channels 14d google', query: 'p=channels', steps: [preset('14'), plat('google')] },
  { name: 'creative 30d', query: 'p=creative', steps: [preset('30')] },
  { name: 'creative wall only 30d', query: 'view=creative', steps: [preset('30')] },
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
    await page.locator(st.click).first().dispatchEvent('click');
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

test.afterAll(() => {
  if (!UPDATE) return;
  const prev = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown> : {};
  writeFileSync(GOLDEN, JSON.stringify({ ...prev, ...fresh }, null, 1) + '\n');
});
