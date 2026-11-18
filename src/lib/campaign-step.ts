// «حملة جديدة» in احلم, the engine that runs ONE task of an approved campaign (docs/ahlam.md). The page loop (POST /api/campaigns/step in
// src/api/routes/campaigns.ts) and the server's own driver (src/lib/campaign-cron.ts) both call `advance`, so a task runs the same way,
// under the same claim, compliance and caps, whoever asks. Nothing here touches an ad account.
import { sb, json, audit, missingSchema, notApplied, type AuthEnv, type Session } from './auth';
import { scoped } from './tenant';
import { generate, llmMessage, pick, type LlmEnv } from './llm';
import { usageCtx } from './usage';
import { TASK, estimate } from './campaign';
import { loadDash, toolsFor, type AhlamEnv } from './ahlam';
import { SOCIAL } from '../modules/social/engine';
import { loadKnowledge, forbiddenRules, systemPrompt } from '../modules/knowledge/knowledge';
import { brandFor } from '../modules/knowledge/brand';
import { DEPTS, type requireUser } from './auth';
import { SIZES } from '../modules/design/design';
import { assetUsd, brandText, brandVoice, designSizes, drawPicture, dropAssets, isMiss, keep, speakText, srtOf, type AssetEnv } from './campaign-assets';
import { buildMotion, isMotionTask } from './campaign-motion';
import { INTERNAL_KINDS, PUBLISHABLE, defaultTasks, MAX_AUTO, STALE_MS, budgetIssue, kpis, parsePosts, parseVoice, readyTask, rollup, slim, socialTargets, taskMessages, verdict, type OutputRow, type TaskRow } from './campaign-run';

type Env = AuthEnv & LlmEnv & AssetEnv;
export const MIGRATION = 'migration 030_campaigns.sql';
export type Row = Record<string, unknown>;
export const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
export const fail = (user: Session, r: { ok: boolean; status: number; data: unknown }, msg: string) =>
  json(missingSchema(r as never) ? 503 : 500, { error: missingSchema(r as never) ? notApplied(user, MIGRATION) : msg });


const AGENTS_AR: Record<string, string> = { knowledge: 'المعرفة', content: 'المحتوى', design: 'التصميم', voice: 'الصوت', optimize: 'التحسين' };
const KIND: Record<string, string> = { knowledge: 'insight', content: 'copy', design: 'design_brief', voice: 'voice_script', optimize: 'optimization' };
export const nowIso = () => new Date().toISOString();
export type SbCfg = Parameters<typeof sb>[0];
export const patchTask = (cfg: SbCfg, co: string, id: number, body: Row, extra = '') =>
  sb<Row[]>(cfg, scoped(`/rest/v1/campaign_tasks?id=eq.${id}${extra}`, co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { ...body, updated_at: nowIso() } });
export async function setCampaign(cfg: SbCfg, co: string, id: string, status: string, from: string): Promise<void> {
  await sb(cfg, scoped(`/rest/v1/campaigns?id=eq.${id}&status=in.(${from})`, co), { method: 'PATCH', admin: true, body: { status, updated_at: nowIso() } });
}
export async function tasksOf(cfg: SbCfg, co: string, id: string): Promise<TaskRow[]> {
  const t = await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=id,position,agent,title,spec,depends_on,status,blocked_reason,updated_at&campaign_id=eq.${id}&order=position.asc`, co), { admin: true });
  return rows(t.data) as unknown as TaskRow[];
}

// ---- the files: pictures (the Design module's image maker) and speech (the Voiceover module's speech maker)
type Made = { outs: OutputRow[]; missing: string[]; made: number };
async function makePictures(e: Env, cfg: SbCfg, user: Parameters<typeof brandFor>[1] extends never ? never : Awaited<ReturnType<typeof requireUser>>['user'], campaign: string, wishes: Row, briefText: string, have: Set<string>): Promise<Made> {
  const res: Made = { outs: [], missing: [], made: 0 };
  const brand = await brandFor(cfg, user.co), platforms = Array.isArray(wishes['platforms']) ? (wishes['platforms'] as string[]) : [];
  const input = { offer: String(wishes['offer'] || wishes['goal'] || ''), audience: String(wishes['audience'] || ''), dept: wishes['dept'] ? String(DEPTS[String(wishes['dept']) as keyof typeof DEPTS] ?? '') : '' };
  for (const size of designSizes(platforms)) {
    if (have.has(size)) continue;
    const pic = await drawPicture(e, cfg, user, size, input, brand.colors, `Visual idea from the approved design brief: ${briefText.replace(/\s+/g, ' ').slice(0, 350)}`);
    const key = isMiss(pic) ? pic : await keep(e, user.co, campaign, pic.bytes, pic.mime);
    if (isMiss(key)) { res.outs.push({ task_id: null, kind: 'asset_missing', platform: size, body: { what: 'image', size, text: `${SIZES[size]?.label ?? size}: ${key.message}`, code: key.miss, retry: key.retry }, compliance: [] }); res.missing.push('image:' + size); break; }
    const pic2 = pic as Exclude<typeof pic, { miss: string }>;
    res.outs.push({ task_id: null, kind: 'design_image', platform: size, body: { key, mime: pic2.mime, w: pic2.w, h: pic2.h, size, text: SIZES[size]?.label ?? size }, compliance: [] });
    res.made++;
  }
  return res;
}
async function makeSpeech(e: Env, cfg: SbCfg, user: Awaited<ReturnType<typeof requireUser>>['user'], campaign: string, readings: { label: string; text: string }[], have: Set<string>, hits: unknown[]): Promise<Made> {
  const res: Made = { outs: [], missing: [], made: 0 };
  const voice = await brandVoice(cfg, user.co);
  for (const r of readings) {
    if (have.has(r.label)) continue;
    const sp = await speakText(e, cfg, user, r.text, voice);
    const key = isMiss(sp) ? sp : await keep(e, user.co, campaign, sp.wav, 'audio/wav');
    if (isMiss(key)) { res.outs.push({ task_id: null, kind: 'asset_missing', platform: null, body: { what: 'audio', label: r.label, text: `صوت نسخة ${r.label} ثانية: ${key.message}`, code: key.miss, retry: key.retry }, compliance: [] }); res.missing.push('audio:' + r.label); break; }
    const seconds = (sp as { seconds: number }).seconds;
    res.outs.push({ task_id: null, kind: 'voice_audio', platform: null, body: { key, mime: 'audio/wav', seconds, label: r.label, text: r.text }, compliance: [] });
    res.outs.push({ task_id: null, kind: 'voice_srt', platform: null, body: { text: srtOf(r.text, seconds), label: r.label }, compliance: hits });
    res.made++;
  }
  return res;
}

// One task per call. Runs the next task whose dependencies are done, by the agent it was given to; the page calls it again until it
// says `done`, and so does the server's own driver (src/lib/campaign-cron.ts) when no page is open. Only a campaign an approver approved
// runs; whoever may see it may keep it going. The claim (waiting -> running) is one conditional write, so two pages, or a page and the
// driver, never run the same task twice. `seen` is the visibility filter of who asks (the driver sees what its approver sees).
export async function advance(e: Env, cfg: SbCfg, user: Session, id: string, seen: string): Promise<Response> {
  const c = await sb<Row[]>(cfg, scoped(`/rest/v1/campaigns?select=id,title,status,wishes,brief,approved_at&id=eq.${id}${seen}`, user.co), { admin: true });
  if (!c.ok) return fail(user, c, 'ما قدرت أقرأ الحملة');
  const camp = rows(c.data)[0];
  if (!camp) return json(404, { error: 'الحملة غير موجودة' });
  const was = String(camp['status']);
  // Only an approved campaign runs (approved_at is the approver's mark; «review» is a campaign that stopped and has tasks left to run). Planned,
  // cancelled and done ones never do: nothing is spent without the approval.
  if (was !== 'approved' && was !== 'running' && !(was === 'review' && camp['approved_at'])) return json(409, { error: 'الحملة لازم تنعتمد أول، وما تشتغل بعد الإلغاء' });
  let tasks = await tasksOf(cfg, user.co, id);
  if (!tasks.length) {
    // approved before the tasks existed, or saved without them: give it the standard plan now (no AI call, no new approval)
    const m = pick(e, TASK), est = estimate(defaultTasks().map(x => x.agent), m?.model ?? 'openai/gpt-4.1', m?.provider ?? 'openrouter', defaultTasks().map(x => assetUsd(x.agent, Array.isArray((camp['wishes'] as Row | undefined)?.['platforms']) ? ((camp['wishes'] as Row)['platforms'] as string[]) : [])));
    const made = await sb(cfg, '/rest/v1/campaign_tasks', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
      body: defaultTasks().map((x, i) => ({ campaign_id: id, company_id: user.co, position: i, agent: x.agent, title: x.title, spec: { detail: x.detail, backfilled: true, ...(x.kind ? { kind: x.kind } : {}) }, depends_on: x.after, estimate_usd: est.perTask[i] })) });
    if (!made.ok) return fail(user, made, 'ما قدرت أجهّز مهام الحملة');
    await audit(cfg, user, 'campaign_backfill', { target: { id, tasks: defaultTasks().length } });
    tasks = await tasksOf(cfg, user.co, id);
  }
  for (const t of tasks.filter(x => x.status === 'running' && x.updated_at && Date.parse(x.updated_at) < Date.now() - STALE_MS)) { await patchTask(cfg, user.co, t.id, { status: 'waiting' }, '&status=eq.running'); t.status = 'waiting'; }
  // An internal reference (knowledge, optimization) that an older version stopped for quoting forbidden words was never an ad: released
  for (const x of tasks.filter(y => y.status === 'blocked' && y.agent !== 'compliance' && !PUBLISHABLE.includes(y.agent) && !y.spec?.override)) {
    const rel = await patchTask(cfg, user.co, x.id, { status: 'review', blocked_reason: null }, '&status=eq.blocked');
    if (rel.ok && rows(rel.data).length) { x.status = 'review'; await audit(cfg, user, 'campaign_unblock_internal', { target: { id, task: x.id, agent: x.agent } }); }
  }
  const t = readyTask(tasks);
  if (!t) {
    const r = rollup(tasks);
    if (r.status !== 'running' && String(camp['status']) !== r.status) await setCampaign(cfg, user.co, id, r.status, 'approved,running');
    return json(200, { done: true, status: r.status, stalled: r.stalled });
  }
  const claim = await patchTask(cfg, user.co, t.id, { status: 'running' }, '&status=eq.waiting');
  if (!claim.ok) return fail(user, claim, 'ما قدرت أبدأ المهمة');
  if (!rows(claim.data).length) return json(200, { busy: true });
  if (was === 'approved' || was === 'review') await setCampaign(cfg, user.co, id, 'running', 'approved,review');

  const wishes = (camp['wishes'] ?? {}) as Row, wanted = socialTargets(Array.isArray(wishes['platforms']) ? (wishes['platforms'] as string[]) : []);
  const entries = await loadKnowledge(cfg, user.co);
  const extra = forbiddenRules(entries);
  const out: OutputRow[] = [];
  let status = 'review', reason: string | null = null, spec: Row = {}, fixing = 0, assets = 0, missing: string[] = [];
  const offenders = new Map<number, string>();   // the final scan: task id -> why its piece was refused (what the repair loop gives back to its agent)

  try {
    const prior = await sb(cfg, scoped(`/rest/v1/campaign_outputs?select=id,task_id,kind,platform,body,compliance&campaign_id=eq.${id}&order=id.asc&limit=200`, user.co), { admin: true });
    const outputs = rows(prior.data) as unknown as OutputRow[];
    if (t.agent === 'compliance') {
      // The gate before «ready»: every draft of the campaign is checked again against the rules as they are today. No AI call.
      const live = new Set(tasks.filter(x => x.status !== 'blocked' && x.status !== 'failed').map(x => x.id));
      const passed = new Set(tasks.filter(x => x.spec?.override).map(x => x.id));   // let through by a person, with a reason: not blocked again
      // ...and only those that really had a refused piece are mentioned (an override on an internal reference changes nothing)
      const overridden = new Set(outputs.filter(o => o.task_id != null && passed.has(o.task_id) && !INTERNAL_KINDS.includes(o.kind) && (o.compliance as { level?: string }[] | undefined)?.some(h => h.level === 'critical')).map(o => o.task_id));
      const texts = outputs.filter(o => o.task_id != null && live.has(o.task_id) && !passed.has(o.task_id) && !INTERNAL_KINDS.includes(o.kind)).map(o => ({ label: `${o.kind}${o.platform ? ' · ' + o.platform : ''}`, text: String(o.body.text ?? '') }));
      const v = verdict(texts, extra);
      if (v.blocked) {
        // which task each refused piece belongs to: every piece is checked alone, so a task gets only its own reasons
        for (const o of outputs.filter(x => x.task_id != null && live.has(x.task_id) && !passed.has(x.task_id) && !INTERNAL_KINDS.includes(x.kind))) {
          const one = verdict([{ label: `${o.kind}${o.platform ? ' · ' + o.platform : ''}`, text: String(o.body.text ?? '') }], extra);
          if (one.blocked) offenders.set(o.task_id!, [offenders.get(o.task_id!), one.reason].filter(Boolean).join(' | ').slice(0, 900));
        }
      }
      const n = (l: string) => v.hits.filter(h => h.level === l).length;
      out.push({ task_id: t.id, kind: 'compliance_report', body: { text: `فُحصت ${texts.length} مسودة: ${n('critical')} مخالفة، ${n('warn')} انتبه، ${n('info')} ملاحظة.${overridden.size ? ` (${overridden.size} مهمة متجاوزة بموافقة ومذكورة في الحزمة)` : ''}${v.hits.length ? '\n' + v.hits.slice(0, 20).map(h => `- ${h.title} «${h.match}»: ${h.fix}`).join('\n') : '\nما ظهرت ملاحظات.'}` }, compliance: slim(v.hits) });
      if (v.blocked) { status = 'blocked'; reason = v.reason; }
    } else if (isMotionTask(t)) {
      // a motion task is not written by the campaign model: the Design module's motion planner makes the scenes over the campaign's own picture and recording
      const m = await buildMotion(e, cfg, user, { id, title: String(camp['title'] ?? 'حملة') }, outputs, t.spec?.feedback, extra);
      out.push(...m.outs.map(o => ({ ...o, task_id: t.id }))); status = m.status; reason = m.reason; missing = m.missing; if (m.project) assets = 1;
    } else {
      const run = { cfg, user, e: e as AhlamEnv };
      const tool = async (n: string, a: Record<string, unknown>): Promise<string> => { try { return (await toolsFor(run).find(x => x.name === n)?.run(run, a)) ?? ''; } catch { return ''; } };
      const data = t.agent === 'knowledge' || t.agent === 'optimize' ? [await tool('performance', { days: 30 }), await tool('ads', { sort: 'best', days: 30, limit: 5 })].filter(Boolean).join('\n\n') : '';
      const funnel = t.agent === 'optimize' ? ((await loadDash(run)) as { funnel_targets?: unknown } | null)?.funnel_targets : undefined;
      const ks = kpis(funnel);
      const brand = await brandFor(cfg, user.co);
      const stage = t.spec?.stage === 'assets' && (t.agent === 'design' || t.agent === 'voice');   // a retry of the files only: the written draft stays
      const mine = outputs.filter(o => o.task_id === t.id);
      let text = '';
      if (!stage) {
        const gen = await generate(e, TASK, { messages: taskMessages(t.agent, { brand: brandText(brand), wishes: wishes as never, brief: camp['brief'], questions: ((camp['brief'] as { questions?: { q: string; assumption: string; answer?: string }[] } | null)?.questions) ?? [], task: t, outputs, knowledge: systemPrompt(entries, 'content', 4000), data, kpis: ks, platforms: wanted }), max_tokens: 2500 }, fetch, usageCtx(cfg, user, TASK));
        text = gen.response.trim();
      }
      if (t.agent === 'social') {
        const posts = parsePosts(text, wanted);
        if (!posts.length) { status = 'failed'; reason = 'ما طلعت مسودات منشورات أقدر أقراها'; }
        else {
          const v = verdict(posts.map(p => ({ label: SOCIAL[p.platform as keyof typeof SOCIAL].name, text: p.body })), extra);
          for (const p of posts) out.push({ task_id: t.id, kind: 'post', platform: p.platform, body: { text: p.body, day: p.day }, compliance: slim(v.hits.filter(h => p.body.includes(h.match))) });
          if (v.blocked) { status = 'blocked'; reason = v.reason; }
        }
      } else if (t.agent === 'voice') {
        const parsed = stage ? { versions: mine.filter(o => o.kind === 'voice_script').map(o => ({ label: String(o.body['label'] ?? '30'), text: String(o.body.text ?? '') })), notes: '' } : parseVoice(text);
        if (!parsed.versions.length) { status = 'failed'; reason = 'ما طلع نص فويس أوفر أقدر أقراه'; }
        else {
          let hits: ReturnType<typeof slim> = [];
          if (!stage) {
            // the scripts are checked BEFORE anything is spoken: a refused script costs no audio
            const v = verdict(parsed.versions.map(r => ({ label: `فويس ${r.label} ثانية`, text: r.text })), extra);
            hits = slim(v.hits);
            parsed.versions.forEach((r, i) => out.push({ task_id: t.id, kind: 'voice_script', body: { text: r.text, label: r.label, ...(i === 0 && parsed.notes ? { notes: parsed.notes } : {}) }, compliance: slim(v.hits.filter(h => r.text.includes(h.match))) }));
            if (v.blocked) { status = 'blocked'; reason = v.reason; }
          }
          if (status === 'review') {
            const have = new Set(mine.filter(o => o.kind === 'voice_audio').map(o => String(o.body['label'])));
            const made = await makeSpeech(e, cfg, user, id, parsed.versions, have, hits);
            out.push(...made.outs.map(o => ({ ...o, task_id: t.id }))); assets = made.made; missing = made.missing;
          }
        }
      } else if (t.agent === 'design') {
        const briefText = stage ? String(mine.find(o => o.kind === 'design_brief')?.body.text ?? '') : text;
        const v = stage ? { hits: [], blocked: false, reason: '' } : verdict([{ label: AGENTS_AR[t.agent] ?? t.agent, text }], extra);
        if (!stage) { out.push({ task_id: t.id, kind: 'design_brief', body: { text }, compliance: slim(v.hits) }); if (v.blocked) { status = 'blocked'; reason = v.reason; } }
        // the pictures are drawn only from a brief that passed: a refused brief costs no image
        if (status === 'review') {
          const have = new Set(mine.filter(o => o.kind === 'design_image').map(o => String(o.platform)));
          const made = await makePictures(e, cfg, user, id, wishes, briefText, have);
          out.push(...made.outs.map(o => ({ ...o, task_id: t.id }))); assets = made.made; missing = made.missing;
        }
      } else {
        // internal references (knowledge, optimization) are not ads: no rules, no stop, no repair loop
        const v = PUBLISHABLE.includes(t.agent) ? verdict([{ label: AGENTS_AR[t.agent] ?? t.agent, text }], extra) : { hits: [], blocked: false, reason: '' };
        out.push({ task_id: t.id, kind: KIND[t.agent] ?? 'text', body: { text }, compliance: slim(v.hits) });
        if (t.agent === 'optimize') out.push({ task_id: t.id, kind: 'measurement', body: { text: 'أهداف القياس (نفس أرقام الحكم في لوحة الأداء)', kpis: ks }, compliance: [] });
        if (v.blocked) { status = 'blocked'; reason = v.reason; }
        // an amount in riyals that the user never gave is not allowed in the plan: the same repair loop asks for it to be removed
        const bi = budgetIssue(t.agent, text, wishes as never);
        if (bi) { status = 'blocked'; reason = bi; }
      }
    }
    if (status === 'blocked') spec = { feedback: reason };
    // The repair loop: compliance refused a draft, so its agent writes it again by compliance's own instructions (what to cut, the approved
    // wording) and the check runs again, up to MAX_AUTO times. Only then does the task stop, with the reason, for a person.
    if (status === 'blocked' && t.agent !== 'compliance' && (t.spec?.auto ?? 0) < MAX_AUTO) {
      fixing = (t.spec?.auto ?? 0) + 1; out.length = 0; status = 'waiting'; spec = { auto: fixing, feedback: reason }; reason = null;
    }
    // The same loop for the final scan (the compliance task): the task that wrote the refused piece is reset with the scan's own feedback for it
    // (its old drafts and files dropped), the design/voice task's motion storyboard built from them goes with it, and compliance runs again
    // after them. Also at most MAX_AUTO loops; then the task stops for a person, and the manual override stays as it was.
    if (status === 'blocked' && t.agent === 'compliance' && (t.spec?.auto ?? 0) < MAX_AUTO && offenders.size) {
      const redo = new Map<number, string>();
      for (const [tid, why] of offenders) {
        const o = tasks.find(x => x.id === tid);
        if (!o || o.status === 'running') continue;
        redo.set(tid, why);
        if (o.agent === 'design' || o.agent === 'voice') for (const m of tasks.filter(x => isMotionTask(x) && x.depends_on.includes(o.position) && x.status !== 'running')) if (!redo.has(m.id)) redo.set(m.id, '');
      }
      if (redo.size) {
        for (const [tid, why] of redo) {
          const o = tasks.find(x => x.id === tid)!;
          await dropAssets(cfg, e, user.co, `task_id=eq.${tid}&campaign_id=eq.${id}`);
          await patchTask(cfg, user.co, tid, { status: 'waiting', blocked_reason: null, spec: { ...(o.spec ?? {}), auto: 0, stage: undefined, missing: undefined, override: undefined, feedback: why || undefined } });
        }
        fixing = (t.spec?.auto ?? 0) + 1; out.length = 0; status = 'waiting'; spec = { auto: fixing }; reason = null;
        await audit(cfg, user, 'campaign_final_autofix', { target: { id, tasks: [...redo.keys()], attempt: fixing } });   // ids only, never the text
      }
    }
  } catch (err) {
    const m = (err as Error)?.message;
    if (m === 'cap_reached' || m === 'no_model' || m === 'llm_busy') { await patchTask(cfg, user.co, t.id, { status: 'waiting' }); return json(200, { paused: m, message: llmMessage(err) }); }
    status = 'failed'; reason = llmMessage(err);
  }
  if (out.length) {
    const w = await sb(cfg, '/rest/v1/campaign_outputs', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: out.map(o => ({ ...o, campaign_id: id, company_id: user.co })) });
    if (!w.ok) { status = 'failed'; reason = 'ما انحفظت مخرجات المهمة'; }
  }
  // Drafts into Social only from a task that passed the check; they are `draft` and manual: scheduling and approval stay with Social's approvers
  let drafts = 0;
  if (t.agent === 'social' && status === 'review') {
    const posts = out.filter(o => o.kind === 'post');
    const w = await sb(cfg, '/rest/v1/social_posts', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: posts.map(o => {
      const at = new Date(Date.now() + Number(o.body['day'] ?? 1) * 864e5); at.setUTCHours(15, 0, 0, 0);
      return { company_id: user.co, platforms: [o.platform ?? ''], body: String(o.body.text ?? ''), publish_at: at.toISOString(), mode: 'manual', status: 'draft', created_by: user.email };
    }) });
    if (w.ok) drafts = posts.length;
  }
  // the files: what could not be made stays listed (and shown with its reason) until a retry makes it; the stage flag is spent
  if (t.agent === 'design' || t.agent === 'voice') spec = { ...spec, stage: undefined, missing: missing.length ? missing : undefined };
  await patchTask(cfg, user.co, t.id, { status, blocked_reason: reason, spec: { ...(t.spec ?? {}), ...spec } });
  await audit(cfg, user, fixing ? 'campaign_task_autofix' : 'campaign_task_run', { target: { id, task: t.id, agent: t.agent, status, outputs: out.length, drafts, ...(assets ? { files: assets } : {}), ...(missing.length ? { missing } : {}), ...(fixing ? { attempt: fixing } : {}) } });
  tasks = await tasksOf(cfg, user.co, id);
  const r = rollup(tasks);
  if (r.status !== 'running') await setCampaign(cfg, user.co, id, r.status, 'approved,running');
  return json(200, { ran: { task: t.id, agent: t.agent, status, reason, ...(fixing ? { fixing } : {}) }, more: r.status === 'running', status: r.status });
}

