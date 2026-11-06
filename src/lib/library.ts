// The shared library (docs/library.md): what a saved item may hold, and how it is cleaned. Pure, so the routes and the tests share it.
import type { Hit } from '../modules/compliance/compliance';

export const KINDS = { text: 'نص', design: 'تصميم', script: 'سكربت', video: 'فيديو' } as const;
export type Kind = keyof typeof KINDS;
export const STATUSES = ['draft', 'in_review', 'returned', 'approved'] as const;
export type Status = typeof STATUSES[number];

export interface Item {
  id: number; module: string; kind: Kind; title: string; content: string; platform: string; service: string;
  compliance_result: { hits?: { rule: string; level: string; title: string; match: string; fix: string }[]; checked_at?: string };
  review_status: Status; reviewed_by: string | null; approved_by: string | null; created_by: string | null; created_by_id?: string | null; created_at: string; updated_at: string;
}
export interface Fields { module: string; kind: Kind; title: string; content: string; platform: string; service: string }

const cut = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// A new item from a request body. `modules` are the keys the saver may write to.
export function clean(b: Record<string, unknown>, modules: string[]): Fields | { error: string } {
  const module = String(b.module || '');
  if (!modules.includes(module)) return { error: 'اختر الموديول اللي طلع منه الناتج' };
  const kind = String(b.kind || 'text') as Kind;
  if (!(kind in KINDS)) return { error: 'نوع الناتج غير معروف' };
  const content = String(b.content ?? '').slice(0, 20_000).trim();
  if (!content) return { error: 'ما فيه شي تحفظه' };
  const title = cut(b.title, 120) || cut(content, 60);
  return { module, kind, title, content, platform: cut(b.platform, 40), service: cut(b.service, 120) };
}

// An edit: only the fields sent, cleaned the same way
export function cleanEdit(b: Record<string, unknown>): Partial<Pick<Fields, 'title' | 'content' | 'platform' | 'service'>> | { error: string } {
  const out: Partial<Pick<Fields, 'title' | 'content' | 'platform' | 'service'>> = {};
  if ('title' in b) { out.title = cut(b.title, 120); if (!out.title) return { error: 'اكتب عنوان' }; }
  if ('content' in b) { out.content = String(b.content ?? '').slice(0, 20_000).trim(); if (!out.content) return { error: 'النص فاضي' }; }
  if ('platform' in b) out.platform = cut(b.platform, 40);
  if ('service' in b) out.service = cut(b.service, 120);
  return Object.keys(out).length ? out : { error: 'ما فيه تعديل' };
}

// The compliance result saved with an item: the same rules as the rest of the system, kept short
export const complianceOf = (hits: Hit[], now = new Date()): Item['compliance_result'] =>
  ({ hits: hits.slice(0, 30).map(h => ({ rule: h.rule, level: h.level, title: h.title, match: h.match.slice(0, 80), fix: h.fix })), checked_at: now.toISOString() });
