// «موشن جرافيك» in a campaign (docs/ahlam.md): the motion task takes the campaign's own picture (9:16 story) and 30-second recording, has the
// Design module's motion planner write the scenes that move over them, and saves a real motion project (motion_projects / motion_versions,
// the same tables and files as Design → «موشن جرافيك»). What it can NOT do is render the video: that is drawn and exported in the browser
// by the Design page (canvas + recorder), so the pack shows the storyboard and opens the project there. The answer says so; nothing is faked.
import { sb, audit, missingSchema, notApplied, type Cfg, type Session } from './auth';
import { generate, pick, type LlmEnv, type Msg } from './llm';
import { usageCtx } from './usage';
import { knowledgeFor, withKnowledge } from '../modules/knowledge/knowledge';
import { brandFor } from '../modules/knowledge/brand';
import { clampSeconds, cleanSpec, parseSpec, specPrompt, templateSpec, type Spec } from '../modules/design/motion';
import type { Rule } from '../modules/compliance/compliance';
import { verdict, slim, type OutputRow } from './campaign-run';
import { EXT, isMiss, type AssetEnv } from './campaign-assets';

const MIG = '018_motion_videos.sql';
const rnd = () => crypto.randomUUID().replace(/-/g, '');
export const motionKey = (co: string, ext: string): string => `motion/${co}/${rnd()}.${ext}`;
export const isMotionTask = (t: { agent: string; spec?: { kind?: string } | null }): boolean => t.agent === 'design' && t.spec?.kind === 'motion';

// The inputs the motion needs from earlier tasks: a story picture (else any picture) and a recording (the 30-second one, else the 10-second one)
export function motionInputs(outputs: OutputRow[]): { image: OutputRow | null; audio: OutputRow | null; script: string } {
  const pics = outputs.filter(o => o.kind === 'design_image' && (o.body as { key?: unknown }).key);
  const auds = outputs.filter(o => o.kind === 'voice_audio' && (o.body as { key?: unknown }).key);
  const image = pics.find(o => o.platform === 'story') ?? pics[0] ?? null;
  const audio = auds.find(o => (o.body as { label?: unknown }).label === '30') ?? auds[0] ?? null;
  return { image, audio, script: String(audio?.body['text'] ?? '') };
}

export interface Motion { outs: OutputRow[]; status: 'review' | 'blocked'; reason: string | null; missing: string[]; project?: number }
const missing = (text: string, code: string): Motion => ({ outs: [{ task_id: null, kind: 'asset_missing', platform: null, body: { what: 'motion', text, code, retry: true }, compliance: [] }], status: 'review', reason: null, missing: ['motion:' + code] });

export async function buildMotion(e: AssetEnv & LlmEnv, cfg: Cfg, user: Session, campaign: { id: string; title: string }, outputs: OutputRow[], feedback: string | undefined, extra: Rule[]): Promise<Motion> {
  const { image, audio, script } = motionInputs(outputs);
  if (!image || !audio) return missing(`ما تقدر الحملة تبني الموشن لأنه يحتاج ${!image && !audio ? 'صورة التصميم وتسجيل الصوت' : !image ? 'صورة التصميم' : 'تسجيل الصوت'} وهي ما انولّدت (شوف سبب ذلك في مهمة ${!image ? 'التصميم' : 'الصوت'}). ولّد الملف الناقص وبعدها اضغط «ولّد الملفات الناقصة» هنا.`, 'needs_inputs');
  if (!e.FILES) return missing('تخزين الملفات مو مفعّل في هالبيئة، فما انبنى الموشن.', 'no_storage');
  const seconds = clampSeconds(audio.body['seconds']);
  if (seconds < 3) return missing('تسجيل الصوت أقصر من 3 ثواني، والموشن يحتاج 3 ثواني على الأقل.', 'too_short');
  const colors = (await brandFor(cfg, user.co)).colors;
  const headline = campaign.title.slice(0, 140), ratio = '9:16' as const;

  // the scenes: the motion planner of the Design module (task «motion»: its own route, cap and cost record); a template when no model answers
  let spec: Spec | null = null, engine = 'templates', model: string | null = null;
  if (pick(e, 'motion')) {
    try {
      const msgs: Msg[] = specPrompt({ headline, script, seconds, ratio, colors });
      if (feedback) msgs.push({ role: 'user', content: `المحاولة السابقة رفضها فحص الامتثال. أعد الخطة كاملة وصلّح هذا بالضبط (احذف العبارة أو بدّلها بصياغة معتمدة): ${feedback}` });
      const out = await generate(e, 'motion', { messages: withKnowledge(msgs, await knowledgeFor(cfg, user.co, 'design')), max_tokens: 1500 }, fetch, usageCtx(cfg, user));
      spec = cleanSpec(parseSpec(out.response), seconds, ratio, colors); engine = out.engine; model = out.model;
    } catch (err) {
      const m = (err as Error)?.message;
      if (m === 'cap_reached') return missing('وصل السقف الشهري لتاب التصميم، فما انكتبت خطة المشاهد. الصورة والصوت محفوظين، حاول بعد ما ينفتح السقف.', 'capped');
      console.warn('campaign_motion_plan_failed', m);
    }
  }
  spec ??= templateSpec({ headline, script, seconds, ratio, colors });
  if (!spec) return missing('ما طلعت خطة مشاهد للموشن، جرّب مرة ثانية.', 'no_plan');

  // the words that will appear on the video are checked like any ad text, BEFORE a project is made
  const texts = [...spec.scenes.map((s, i) => ({ label: `مشهد ${i + 1}`, text: s.text })), ...(spec.cta ? [{ label: 'الدعوة', text: spec.cta.text }] : [])];
  const v = verdict(texts, extra);
  const board = (hits: ReturnType<typeof slim>): OutputRow => ({ task_id: null, kind: 'motion_storyboard', platform: null, body: { ratio, seconds, scenes: spec.scenes, cta: spec.cta, engine, text: spec.scenes.map(s => s.text).concat(spec.cta ? [spec.cta.text] : []).join(' / ') }, compliance: hits });
  if (v.blocked) return { outs: [board(slim(v.hits))], status: 'blocked', reason: v.reason, missing: [] };

  // the files go where the Design page expects them (motion/<company>/…), copied from the campaign's own folder
  const copy = async (o: OutputRow, mime: string): Promise<string | null> => {
    const obj = await e.FILES!.get(String(o.body['key']));
    if (!obj) return null;
    const key = motionKey(user.co, EXT[mime] ?? 'bin');
    await e.FILES!.put(key, await obj.arrayBuffer(), { httpMetadata: { contentType: mime } });
    return key;
  };
  const dk = await copy(image, String(image.body['mime'] ?? 'image/jpeg')), vk = await copy(audio, 'audio/wav');
  if (!dk || !vk) return missing('ملف الصورة أو الصوت ما انقرا من التخزين، ولّدهم من جديد.', 'file_gone');
  const made = await sb<{ id: number }[]>(cfg, '/rest/v1/motion_projects', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: {
    company_id: user.co, title: headline, headline, script: script.slice(0, 2000), ratio, design_key: dk, design_mime: String(image.body['mime'] ?? 'image/jpeg'), voice_key: vk, voice_mime: 'audio/wav',
    voice_seconds: seconds, created_by: user.email } });
  if (missingSchema(made)) return missing(notApplied(user, MIG), 'no_schema');
  const pid = Array.isArray(made.data) ? made.data[0]?.id : undefined;
  if (!made.ok || !pid) return missing('ما انحفظ مشروع الموشن، جرّب مرة ثانية.', 'save_failed');
  const ver = await sb(cfg, '/rest/v1/motion_versions', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: { company_id: user.co, project_id: pid, version: 1, spec, engine, model, created_by: user.email } });
  if (!ver.ok) return missing('انحفظ المشروع لكن ما انحفظت خطة المشاهد، افتحه من التصميم وجرّب «تعديل».', 'save_failed');
  await audit(cfg, user, 'motion_create', { target: { project: pid, engine, campaign: campaign.id } });
  const out = board(slim(v.hits));
  out.body = { ...out.body, project: pid, version: 1, image_id: (image as { id?: number }).id, audio_id: (audio as { id?: number }).id };
  return { outs: [out], status: 'review', reason: null, missing: [], project: pid };
}

export { isMiss };
