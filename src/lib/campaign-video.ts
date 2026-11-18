// «فيديو الحملة» in أحلم (docs/ahlam.md, docs/motion-video.md): the campaign's motion deliverable as a REAL video file, made by Higgsfield
// (Seedance) through the Video module's own job functions (src/modules/video/jobs.ts), so that module's cap, limits, retries, queue and cost
// record apply here unchanged. The step is ASYNC and resumable: the first call queues the clip(s) and submits them, the task goes back to
// `waiting` with the job ids in its spec, and every later call of the driver (campaign-cron: one call per tick) or of an open page does ONE
// poll. A finished clip is already in R2 (jobs.store copies it before the provider's link expires) and becomes a `video_clip` output.
// Nothing here fails the campaign: a locked module, missing keys, the monthly cap, a refusal or a missing storage keep the storyboard and
// leave an `asset_missing` note that says what to do; «ولّد الملفات الناقصة» tries again (it spends again, so only an approver).
import { sb, locked, type Cfg, type Session } from './auth';
import { scoped } from './tenant';
import { overCap, usageCtx } from './usage';
import { videoCost } from './prices';
import { verdict, slim, type OutputRow, type TaskRow } from './campaign-run';
import type { Rule } from '../modules/compliance/compliance';
import { DEFAULT_ENGINE, engineOf } from '../modules/video/engines';
import { J_COLS, advance, createJobs, sayOf, type Job, type JobEnv } from '../modules/video/jobs';
import type { Capability } from '../modules/video/engine';

export type VideoEnv = JobEnv & { CAMPAIGN_VIDEO_CLIPS?: string | undefined; CAMPAIGN_VIDEO_SECONDS?: string | undefined };
export const MAX_VIDEO_CLIPS = 2;        // hard ceiling per campaign, whatever the setting says
export const DEFAULT_VIDEO_CLIPS = 1;    // the main story only
export const DEFAULT_CLIP_SECONDS = 10;
export const CLIP_RESOLUTION = '720p';
export const CLIP_RATIO = '9:16';

export const isVideoTask = (t: { agent: string; spec?: { kind?: string } | null }): boolean => t.agent === 'design' && t.spec?.kind === 'video';
const int = (v: unknown): number => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? n : NaN; };
// How many clips a campaign gets: the setting (CAMPAIGN_VIDEO_CLIPS, 1 or 2), never above the ceiling, 1 when it is missing or unreadable
export const clipCount = (e: Pick<VideoEnv, 'CAMPAIGN_VIDEO_CLIPS'>): number => { const n = int(e.CAMPAIGN_VIDEO_CLIPS); return n >= 1 ? Math.min(MAX_VIDEO_CLIPS, n) : DEFAULT_VIDEO_CLIPS; };
// The clip length: the setting when the engine can make that length, else the default
export function clipSeconds(e: Pick<VideoEnv, 'CAMPAIGN_VIDEO_SECONDS'>, caps?: Capability): number {
  const n = int(e.CAMPAIGN_VIDEO_SECONDS), sizes = (caps ?? engineOf(DEFAULT_ENGINE)!.caps).clipSeconds;
  return sizes.includes(n) ? n : sizes.includes(DEFAULT_CLIP_SECONDS) ? DEFAULT_CLIP_SECONDS : sizes[sizes.length - 1]!;
}
// What the clips add to the estimate, so the person sees it BEFORE approving (an estimate: the price table says whether it was matched to an invoice)
export function videoUsd(e: Pick<VideoEnv, 'CAMPAIGN_VIDEO_CLIPS' | 'CAMPAIGN_VIDEO_SECONDS'> = {}): number {
  return Math.round(clipCount(e) * videoCost(DEFAULT_ENGINE, CLIP_RESOLUTION, clipSeconds(e)).usd * 1e6) / 1e6;
}

// Appended to every prompt, whatever the scenes say: no words on screen, nobody real, nothing medical (MOH advertising rules)
export const SAFETY_SUFFIX = 'Strict rules: no on-screen text, captions, subtitles, logos or watermarks. No real or identifiable people, no celebrities. No medical procedures, no before-and-after comparisons, no claims of treatment results or cures. Calm, respectful, family-friendly.';
const LEAD = 'Vertical 9:16 cinematic advertising clip for a healthcare brand in Saudi Arabia, soft natural light, gentle camera movement, no dialogue. Story beats (the visual idea, not text to display):';
// The beats a clip tells: the compliance-checked scene text of the motion storyboard (clip k of n gets every n-th scene), else nothing
export function scenesOf(outputs: OutputRow[]): string[] {
  const b = outputs.find(o => o.kind === 'motion_storyboard')?.body as { scenes?: { text?: unknown }[]; cta?: { text?: unknown } | null } | undefined;
  const scenes = (b?.scenes ?? []).map(s => String(s?.text ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cta = String(b?.cta?.text ?? '').replace(/\s+/g, ' ').trim();
  return cta ? [...scenes, cta] : scenes;
}
export function clipBeats(scenes: string[], k: number, n: number): string[] { const mine = scenes.filter((_, i) => i % n === k); return mine.length ? mine : scenes.slice(0, 1); }
export const promptOf = (beats: string[]): string => `${LEAD} ${beats.join(' / ').slice(0, 700)}. ${SAFETY_SUFFIX}`;

// ---- the plain words (masculine, say exactly what to do); every fix ends with the button that tries again
const fix = (m: string): string => `${m}، ثم اضغط «ولّد الملفات الناقصة».`;
const CAP = fix('وصل سقف صرف الفيديو الشهري: ارفعه من ماويسترو ← الصرف أو انتظر الشهر الجاي');
export const MISS: Record<string, string> = {
  locked: fix('وحدة الفيديو مقفلة لشركتك: افتحها من إدارة الوحدات'),
  no_keys: fix('مفاتيح Higgsfield ناقصة: اطلب من المالكة تضيفها'),
  capped: CAP, cap_reached: CAP,
  needs_inputs: fix('ما فيه خطة مشاهد للموشن أبني منها الفيديو: شغّل مهمة الموشن أول'),
  no_storage: 'تخزين الملفات مو مفعّل في هالبيئة، فما انحفظ الفيديو.',
  no_schema: fix('وحدة الفيديو ما تجهّزت بعد: بلّغ الإدارة تكمل تجهيزها'),
  save_failed: 'ما انحفظ طلب الفيديو، جرّب مرة ثانية.',
  blocked: fix('محرك الفيديو رفض المحتوى عنده: عدّل نص مشاهد الموشن'),
  balance: fix('رصيد حساب Higgsfield خلص: اشحنه'),
  no_access: fix('موديل Seedance غير متاح لحساب Higgsfield: افتحه من لوحة Higgsfield'),
  auth: fix('مفاتيح Higgsfield مرفوضة: بلّغ الإدارة تراجعها'),
};
const say = (code: string): string => MISS[code] ?? (sayOf(code) || 'ما انولد الفيديو، جرّب مرة ثانية.');
const miss = (code: string, extra = ''): OutputRow => ({ task_id: null, kind: 'asset_missing', platform: null, body: { what: 'video', text: `فيديو الحملة: ${extra || say(code)}`, code, retry: code !== 'no_storage' }, compliance: [] });
export const PENDING_SAY = 'الفيديو قيد التوليد عند Higgsfield: بيكتمل لحاله، وتقدر تسكّر الصفحة.';

export interface VideoState { project: number; jobs: number[] }
export interface VideoRun { outs: OutputRow[]; missing: string[]; made: number; pending: boolean; state?: VideoState | undefined }
const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? d : []) as T[];
const mimeOf = (key: string): string => (key.endsWith('.webm') ? 'video/webm' : 'video/mp4');
const none = (): VideoRun => ({ outs: [], missing: [], made: 0, pending: false });
const stop = (code: string, extra = ''): VideoRun => ({ outs: [miss(code, extra)], missing: ['video:' + code], made: 0, pending: false });

// Runs ONE step of the video task: poll what is in flight (one advance per job), else queue what is still missing.
export async function runVideo(e: VideoEnv, cfg: Cfg, user: Session, campaign: { id: string; title: string }, task: TaskRow, outputs: OutputRow[], extra: Rule[], opts: { fetch?: typeof fetch; now?: number } = {}): Promise<VideoRun> {
  const want = clipCount(e), have = outputs.filter(o => o.task_id === task.id && o.kind === 'video_clip').length;
  const state = (task.spec as { video?: VideoState } | null | undefined)?.video;
  const ctx = { cfg, env: e, usage: usageCtx(cfg, user), ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.now != null ? { now: opts.now } : {}) };

  // ---- in flight: one poll per job, then sort them out
  if (state?.jobs?.length) {
    const r = await sb<Job[]>(cfg, scoped(`/rest/v1/video_jobs?select=${J_COLS}&id=in.(${state.jobs.map(Number).filter(n => n > 0).join(',')})&order=shot_no.asc`, user.co), { admin: true });
    const jobs = rows<Job>(r.data);
    if (!jobs.length) return stop('save_failed');
    const outs: OutputRow[] = [], missing: string[] = [], still: number[] = [];
    let made = 0;
    for (const j0 of jobs) {
      const j = await advance(ctx, j0);
      if (j.status === 'queued' || j.status === 'running') { still.push(j.id); continue; }
      if (j.status === 'done' && j.result_key) {
        outs.push({ task_id: null, kind: 'video_clip', platform: 'story', body: { key: j.result_key, mime: mimeOf(j.result_key), ratio: j.params.ratio, seconds: j.params.seconds, job: j.id, shot: j.shot_no, text: `فيديو الحملة · ${j.params.ratio} · ${j.params.seconds} ثواني` }, compliance: [] });
        made++;
      } else { const code = j.error_code || 'failed'; outs.push(miss(code)); missing.push('video:' + code); }
    }
    if (still.length) return { outs, missing, made, pending: true, state: { project: state.project, jobs: still } };
    return { outs, missing: [...new Set(missing)], made, pending: false };
  }

  // ---- nothing in flight: is there anything left to make?
  if (have >= want) return none();
  const pre = (): string | null => locked(user, 'video') ? 'locked' : !engineOf(DEFAULT_ENGINE)!.configured(e) ? 'no_keys' : !e.FILES ? 'no_storage' : null;
  const why = pre();
  if (why) return stop(why);
  const scenes = scenesOf(outputs);
  if (!scenes.length) return stop('needs_inputs');
  const ucx = usageCtx(cfg, user);
  if (ucx && await overCap(ucx, 'video')) return stop('capped');
  // the scene text goes through the same compliance rules as every other piece BEFORE anything is queued or paid
  const n = want - have, total = want;
  const prompts = Array.from({ length: n }, (_, i) => clipBeats(scenes, have + i, total));
  const v = verdict(prompts.map((b, i) => ({ label: `مشاهد الفيديو ${have + i + 1}`, text: b.join(' ') })), extra);
  if (v.blocked) return { ...stop('blocked_text', `نص المشاهد فيه مخالفة امتثال وما أُرسل لمحرك الفيديو: ${v.reason}`), outs: [{ ...miss('blocked_text', `نص المشاهد فيه مخالفة امتثال وما أُرسل لمحرك الفيديو: ${v.reason}`), compliance: slim(v.hits) }] };

  const engine = engineOf(DEFAULT_ENGINE)!, seconds = clipSeconds(e, engine.caps);
  const made = await sb<{ id: number }[]>(cfg, '/rest/v1/video_projects', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, title: `حملة: ${campaign.title}`.slice(0, 120), ratio: CLIP_RATIO, seconds: 15, created_by: user.email, created_by_id: user.uid } });
  if (!made.ok && /relation|does not exist|schema cache|42P01|PGRST/i.test(JSON.stringify(made.data ?? ''))) return stop('no_schema');
  const pid = rows<{ id: number }>(made.data)[0]?.id;
  if (!made.ok || !pid) return stop('save_failed');
  const clips = prompts.map(b => ({ kind: 'text-to-video', prompt: promptOf(b), seconds, ratio: CLIP_RATIO, resolution: CLIP_RESOLUTION, silent: true }));
  const q = await createJobs(cfg, user, pid, engine, clips, ucx);   // the module's own reservation and queue limit apply
  if (!q.jobs) return stop(q.status === 429 ? 'capped' : 'save_failed');
  // submit them now (one advance each: the request is sent, the status is read on the next call)
  const sent = await Promise.all(q.jobs.map(j => advance(ctx, j)));
  const failed = sent.filter(j => j.status === 'failed');
  const outs = failed.map(j => miss(j.error_code || 'failed'));
  const still = sent.filter(j => j.status === 'queued' || j.status === 'running').map(j => j.id);
  return { outs, missing: [...new Set(failed.map(j => 'video:' + (j.error_code || 'failed')))], made: 0, pending: still.length > 0, ...(still.length ? { state: { project: pid, jobs: still } } : {}) };
}
