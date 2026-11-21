// ⌘K palette, shortcuts and the live approvals number (docs/PRD.md §4.4-4.5, milestone M4)
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

test('Ctrl+K opens the palette, search folds Arabic, Enter goes there', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/today/');
  await expect(page.locator('#side .navi').first()).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  const box = page.locator('dialog.cmdk[open] .cmdk-in');
  await expect(box).toBeFocused();
  await box.fill('لوحه القرارات');                       // ة typed as ه
  await expect(page.locator('dialog.cmdk[open] [role=option]').first()).toContainText('لوحة القرارات');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/control\/$/);
});

test('the top-bar button and «/» open it too; Esc closes; no result says so', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/today/');
  await page.locator('#cmdkBtn').click();
  await expect(page.locator('dialog.cmdk[open]')).toBeVisible();
  await page.locator('dialog.cmdk[open] .cmdk-in').fill('zzzz');
  await expect(page.locator('dialog.cmdk[open] .cmdk-none')).toContainText('ما لقينا');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.cmdk[open]')).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('/');
  await expect(page.locator('dialog.cmdk[open]')).toBeVisible();
});

test('typing in a field does not trigger «/» or g-shortcuts', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/today/');
  await page.locator('#ahQ').click();
  await page.keyboard.type('/ga');
  await expect(page.locator('dialog.cmdk[open]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/today\/$/);
  await expect(page.locator('#ahQ')).toHaveValue('/ga');
});

test('? shows the shortcuts; G then A opens approvals without triggering its own A key', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  await page.goto('/today/');
  await expect(page.locator('#side .navi').first()).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('dialog.cmdk-help[open]')).toContainText('Ctrl');
  await page.keyboard.press('Escape');
  await page.keyboard.press('g'); await page.keyboard.press('a');
  await expect(page).toHaveURL(/\/approvals\/$/);
  await expect(page.locator('[data-empty]')).toBeVisible();
  await page.keyboard.press('g'); await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/control\/$/);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('the sidebar shows the live number and hides it at zero', async ({ page, context, request }) => {
  await addSession(context, await login(request, 'owner'));
  let n = 4;
  await page.route('**/api/approvals/counts', r => r.fulfill({ json: { counts: { social: n, ads: 0, lessons: 0, total: n } } }));
  await page.goto('/today/');
  const badge = page.locator('#side .ap-link [data-ap-n]');
  await expect(badge).toHaveText('4');
  await expect(page.locator('#side .ap-link')).toHaveAttribute('aria-label', /\(4\)/);
  n = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('well:approvals')));
  await expect(badge).toBeHidden();
});
