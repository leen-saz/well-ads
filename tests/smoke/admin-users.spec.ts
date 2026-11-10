// Settings → users: add a user directly (typed or generated password), accounts without a profile, in Arabic and in English.
// Synthetic data only (the fake Supabase answers).
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const COPY = {
  ar: { qs: '', title: 'إضافة مستخدم مباشرة', add: 'أضف المستخدم', dup: 'الإيميل مسجّل من قبل', ok: 'انضاف المستخدم', orphans: 'حسابات بدون صلاحيات', give: 'أعطه صلاحيات' },
  en: { qs: '?lang=en', title: 'Add a user directly', add: 'Add user', dup: 'This email is already registered', ok: 'User added', orphans: 'Accounts without access', give: 'Give access' },
};

for (const [lang, t] of Object.entries(COPY)) {
  test.describe(`settings users (${lang})`, () => {
    test('the direct form adds a user, says a duplicate plainly, and lists accounts without access', async ({ page, context, request }) => {
      await addSession(context, await login(request, 'owner'));
      await page.goto(`/admin/${t.qs}`);
      await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
      const form = page.locator('#addDirect');
      await expect(page.locator('select[name=dd]').first()).toBeVisible(); // the page script has mounted
      // the generate button fills a long password on screen
      await form.locator('#dGen').click();
      expect((await form.locator('#dPass').inputValue()).length).toBeGreaterThanOrEqual(16);
      await form.locator('#dEmail').fill('taken@example.test');
      await form.locator('select[name=dd]').first().selectOption('view');
      await form.getByRole('button', { name: t.add }).click();
      await expect(page.locator('#dMsg')).toContainText(t.dup);
      await form.locator('#dEmail').fill('new-person@example.test');
      await form.getByRole('button', { name: t.add }).click();
      await expect(page.locator('#dMsg')).toContainText(t.ok);
      await expect(form.locator('#dPass')).toHaveValue('');
      // an auth account with no profile shows up with its button
      await expect(page.getByRole('heading', { name: t.orphans })).toBeVisible();
      await page.getByRole('button', { name: t.give }).click();
      await expect(page.locator('#orphans select').first()).toBeVisible();
      if (process.env['SHOTS']) await page.screenshot({ path: `${process.env['SHOTS']}/settings-users-${lang}.png`, fullPage: true });
    });
  });
}

test('the three owner routes refuse a member', async ({ request }) => {
  const c = (await login(request, 'u-control')).header;
  for (const [m, p] of [['post', '/api/admin/direct'], ['get', '/api/admin/orphans'], ['post', '/api/admin/orphans'], ['post', '/api/admin/password']] as const) {
    const r = await request.fetch(p, { method: m.toUpperCase(), headers: { cookie: c, origin: `http://localhost:${process.env['SMOKE_PORT'] || 8787}` }, data: m === 'post' ? {} : undefined });
    expect(r.status(), p).toBe(403);
  }
});
