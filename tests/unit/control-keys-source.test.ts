// The decisions board's front-end rules that keep a keypress or a read error from approving something (source-level: the page is
// plain browser JS, covered end to end by tests/smoke/control-keys.spec.ts).
// Files are read through Vite (?raw): node:fs breaks typecheck.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import control from '../../public/assets/control.js?raw';
import exec from '../../public/modules/buyer/exec.js?raw';
import journeys from '../../public/modules/journeys/client.js?raw';
import admin from '../../public/assets/admin.js?raw';
const keydown = control.slice(control.indexOf("document.addEventListener('keydown'"));

describe('decisions board keyboard shortcuts', () => {
  it('act only on the inbox tabs and never on a focused button, link, dialog or the side panel', () => {
    expect(control).toMatch(/INBOX_KEYS = tab => !\['log', 'learn', 'buyer', 'rules'\]\.includes\(tab\)/);
    expect(control).toMatch(/NO_KEYS = 'input,textarea,select,button,a,/);
    expect(keydown).toMatch(/!INBOX_KEYS\(S\.tab\) \|\| e\.target\.closest\(NO_KEYS\)/);
  });
  it('have no Enter shortcut that swallows the key of a focused button', () => {
    expect(keydown.slice(0, keydown.indexOf('}, { signal')).includes("'Enter'")).toBe(false);
  });
  it('drop the hidden inbox list when another tab is showing, so «a» has nothing to approve', () => {
    expect(control).toMatch(/if \(r \|\| b \|\| S\.tab === 'log' \|\| S\.tab === 'learn'\) S\.list = null/);
  });
});

describe('emergency stop state on the board fails closed', () => {
  it('an unreadable state counts as stopped and unknown: approvals are refused, the lift button is disabled', () => {
    expect(control).toContain("api('/api/control/kill').catch(() => ({ kill: true, unknown: true }))");
    expect(control).toMatch(/decision !== 'reject' && S\.kill\.unknown/);
    expect(control).toMatch(/S\.kill\.unknown\s*\n?\s*\? `<button class="btn sm danger" id="killBtn" disabled/);
    expect(control).not.toContain("catch(() => ({ kill: false }))");
  });
});

describe('other buttons', () => {
  it('the execution section hides only on 403, any other failure says so', () => {
    expect(exec).toMatch(/err\?\.status === 403\) return;/);
    expect(exec).not.toMatch(/catch \{ return; \}/);
  });
  it('sending a journey to a customer and stopping an account ask first', () => {
    expect(journeys).toMatch(/confirm\(`ترسل الرحلة الحين إلى/);
    expect(admin).toMatch(/b\.dataset\.act === 'toggle' && b\.dataset\.active === 'true' && !confirm\(/);
  });
});
