// The Foot Alignment video drafts (docs/video-drafts/foot-alignment.md): every word that would be spoken or shown goes through the
// same Saudi health-advertising rules as the rest of the system, the three versions differ only in their first shot's opening, and
// the mandatory disclosure line is on every version. Synthetic copy; no figures, no patient, no testimonial.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import raw from '../../docs/video-drafts/foot-alignment.json?raw';
import { check } from '../../src/modules/compliance/compliance';

interface Hook { id: string; line: string; onScreen: string; scene: string; prompt: string }
const d = JSON.parse(raw) as { hooks: Hook[]; body: { seconds: number; line?: string; onScreen?: string; tail?: { line: string; onScreen: string; scene: string; prompt: string } }[]; cta: string; disclosure: string; placeholders: string[]; lengthSeconds: number };
const texts = [...d.hooks.flatMap(h => [h.line, h.onScreen, h.scene]), ...d.body.flatMap(b => [b.line, b.onScreen, b.tail?.line, b.tail?.onScreen, b.tail?.scene]), d.cta, d.disclosure].filter((t): t is string => !!t);

describe('Foot Alignment drafts', () => {
  it('every spoken and shown text passes the health-advertising rules with no notice', () => {
    for (const t of texts) expect(check(t), t).toEqual([]);
  });
  it('the checker is alive: a banned claim is caught', () => { expect(check('علاج مضمون وهو الأفضل').length).toBeGreaterThan(0); });
  it('has no testimonial, no patient result, no before/after, no figure', () => {
    const all = texts.join(' ');
    expect(all).not.toMatch(/شهادة|تجربة مريض|قبل وبعد|نتيجة|مضمون|الأفضل|الوحيد|\d/);
  });
  it('three versions that differ only in the opening', () => {
    expect(d.hooks).toHaveLength(3);
    expect(new Set(d.hooks.map(h => h.line)).size).toBe(3);
    expect(d.body.reduce((n, b) => n + b.seconds, 0)).toBe(d.lengthSeconds);   // 5 s opening clip + 10 s clip
  });
  it('the disclosure line says what the Ministry requires and keeps its blanks visible', () => {
    for (const w of ['مادة إعلانية', 'Well', 'أوقات العمل', 'رسوم الخدمة', 'المتابعة الطبية']) expect(d.disclosure).toContain(w);
    expect(d.placeholders.length).toBeGreaterThan(0);
    for (const p of d.placeholders) expect(d.disclosure).toContain(p);
  });
});
