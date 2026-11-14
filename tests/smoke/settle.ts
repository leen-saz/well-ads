import type { Page } from '@playwright/test';

/**
 * Wait until the page has stopped changing instead of sleeping a fixed time: the network is idle and two animation frames in a row
 * painted without the document height or text length changing. A condition, so a slow CI machine waits longer and a fast one does not.
 */
export async function settle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => { /* a long-poll never idles: the stability check below still decides */ });
  await page.waitForFunction(() => new Promise<boolean>(resolve => {
    const size = () => `${document.documentElement.scrollHeight}:${document.body.innerText.length}`;
    const first = size();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(size() === first)));
  }), undefined, { timeout, polling: 100 }).catch(() => { /* never stable (a live clock, a spinner): do not fail the test on that */ });
}

/** The cheap version for after a click: the layout has stopped changing for two frames (no network wait), so a crawl that clicks 40 elements stays fast. */
export async function nextPaint(page: Page, timeout = 3000): Promise<void> {
  await page.waitForFunction(() => new Promise<boolean>(resolve => {
    const size = () => `${document.documentElement.scrollHeight}:${document.body.innerText.length}`;
    const first = size();
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(size() === first), 50)));
  }), undefined, { timeout, polling: 50 }).catch(() => { /* still changing: go on, the caller reads what is there */ });
}
