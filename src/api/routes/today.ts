// /api/today/state: the start page (/today/). What is ready, what setup is missing, and the decisions waiting, each
// part only when this user may open the page it comes from. The numbers are the user's own data copy (the same one
// /api/dash/data serves) through the overview tab's functions, so they match «ملخص الأداء» for the same 7 days.
import { sb, json, readJson, handle, requireUser, can, claimDaily, type AuthEnv } from '../../lib/auth';
import { dataCopy, dataKey } from '../../lib/dash';
import { WELL_COMPANY } from '../../lib/tenant';
import { list as connectorList } from './connectors';
import { converse, cleanTurns, dailyLimit, dayStart, MAX_Q, type AhlamEnv, type Lang } from '../../lib/ahlam';
import { pick, sseResponse } from '../../lib/llm';
import { type Dash, addDays, lastDay, summarize, previous, canCompare, holes } from '../../modules/overview/numbers';

type FilesEnv = { FILES?: R2Bucket };
type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);

export const state = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'any');
    const out: Row = {};

    // Data status and the last 7 full days against the 7 before them
    const copy = dataCopy(user, cfg, null);
    const files = (e as unknown as FilesEnv).FILES;
    if (copy && files) {
      const obj = await files.get(dataKey(user.co, copy));
      if (!obj) out['data'] = { none: true };
      else {
        const d = await obj.json<Dash>();
        const to = lastDay(d);
        if (to) {
          const from = addDays(to, -6), [pf, pt] = previous(from, to);
          out['data'] = { generated_at: d.generated_at ?? null, from, to, gaps: holes(d, to), now: summarize(d, from, to),
            before: canCompare(d, from, to) ? summarize(d, pf, pt) : null };
        } else out['data'] = { none: true, generated_at: d.generated_at ?? null };
      }
    }

    // Decisions waiting on the board: how many, and the first in the board's own order
    if (user.co === WELL_COMPANY && can(user, 'control', cfg)) {
      const r = await sb(cfg, '/rest/v1/suggestions?select=id,kind,platform,target_name,reason&status=eq.open&order=priority.desc,created_at.desc&limit=300', { admin: true });
      const open = r.ok ? rows(r.data) : [];
      out['decisions'] = { open: open.length, top: open[0] ?? null };
    }

    // The platforms the system needs (connectors CORE): which are connected and which are not
    if (user.co === WELL_COMPANY && can(user, 'connectors', cfg)) {
      const r = await connectorList.GET(request, e);
      if (r.ok) {
        const { platforms } = (await r.json()) as { platforms: Row[] };
        out['setup'] = platforms.filter(p => p['core']).map(p => ({ id: p['id'], name: p['name'], core: p['core'], status: p['status'] }));
      }
    }
    return json(200, out);
  }),
};

// /api/today/ask: «احلم», the assistant on the home page (src/lib/ahlam.ts, docs/ahlam.md). Any signed-in user may ask; what it
// reads is limited by that user's own permissions. It reads and proposes only. Streams the answer (SSE: delta, then one `result`
// with the sources). Each question is one `ahlam_ask` audit row (which is also the daily limit) and each tool read one `ahlam_tool`.
export const ask = {
  POST: handle(async (request, e: AuthEnv & AhlamEnv) => {
    const { cfg, user } = await requireUser(request, e, 'any', { write: true });
    const b = await readJson(request, 20_000);
    const q = String(b['q'] ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    if (!q) return json(400, { error: 'اكتب سؤالك' });
    if (q.length > MAX_Q) return json(400, { error: `السؤال طويل، اختصره (الحد ${MAX_Q} حرف)` });
    if (!pick(e, 'ahlam')) return json(503, { error: 'احلم يحتاج الذكاء الاصطناعي، وهو غير متصل الحين' });
    const limit = dailyLimit(e);
    // One `ahlam_ask` row per question, written first and counted right after (the question itself is never stored)
    const slot = await claimDaily(cfg, user, 'ahlam_ask', limit, dayStart(Date.now()));
    if (slot === 'over') return json(429, { error: `وصلت حدّك اليوم (${limit} سؤال). جرّب بكرة.` });
    if (slot === 'error') return json(503, { error: 'ما قدرت أتأكد من حدّك اليوم. جرّب بعد لحظات.' });
    const lang: Lang = b['lang'] === 'en' ? 'en' : 'ar';
    return sseResponse(converse({ cfg, user, e }, { q, history: cleanTurns(b['history']), lang }, fetch, request.signal));
  }),
};
