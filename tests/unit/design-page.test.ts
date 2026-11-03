// The design page holds both design types: «صورة» (client.js) and «موشن جرافيك» (motion.js, moved here from Maestro).
// Both scripts reach their elements by id: one missing id stopped the whole motion page once (#120), so every id
// either script uses must be on the page, and only once. Files are read through Vite (?raw); node:fs broke typecheck.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import design from '../../public/modules/design/client.js?raw';
import motion from '../../public/modules/design/motion.js?raw';
import maestroJs from '../../public/modules/maestro/client.js?raw';
import page from '../../src/modules/design/Page.astro?raw';
import maestroPage from '../../src/modules/maestro/Page.astro?raw';
import * as A from '../../src/lib/auth';
import { gate } from '../../src/lib/gate';

const ids = (js: string) => [...new Set([...js.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map(m => m[1]!))];

describe('design page', () => {
  it('offers both design types', () => {
    expect(page).toContain('نوع التصميم');
    expect(page).toMatch(/data-kind="image"[^>]*>صورة</);
    expect(page).toMatch(/data-kind="motion"[^>]*>موشن جرافيك</);
    expect(page).toContain('id="imageFlow"');
    expect(page).toContain('id="motionFlow"');
    expect(design).toContain("import('/modules/design/motion.js')");
  });

  it('has every element its scripts look up, each id once', () => {
    for (const js of [design, motion]) {
      expect(ids(js).length).toBeGreaterThan(10);
      // ids the script draws itself (the copy editor fields) count as there
      expect(ids(js).filter(id => !page.includes(`id="${id}"`) && !js.includes(`id="${id}"`))).toEqual([]);
    }
    const all = [...page.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    expect(all.filter((id, i) => all.indexOf(id) !== i)).toEqual([]);
  });

  it('motion talks to the design API and links back to the design page', () => {
    expect(motion).not.toContain('/api/maestro/');
    expect(motion).not.toContain('/maestro/');
    expect(motion).toContain('/design/?type=motion&id=');
  });
});

describe('Maestro', () => {
  it('has no motion entry left', () => {
    for (const s of [maestroJs, maestroPage]) {
      expect(s).not.toMatch(/موشن|video/i);
    }
  });
});

describe('old motion address', () => {
  const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
  const cfg = A.env(E);
  // A designer without Maestro still reaches the new place
  const who: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'sara@example.com', active: true, company_id: '00000000-0000-0000-0000-000000000001', access: { design: 'edit' } };
  const open = async (path: string) => gate(new Request('https://well.example' + path, {
    headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}` } }), E) as Promise<Response>;

  it('/maestro/video/ redirects to the motion type of the design page, keeping the video id', async () => {
    const r = await open('/maestro/video/');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('https://well.example/design/?type=motion');
    expect((await open('/maestro/video/?id=7')).headers.get('location')).toBe('https://well.example/design/?type=motion&id=7');
  });
});
