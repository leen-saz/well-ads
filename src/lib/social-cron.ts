// Every 5 minutes (Worker cron): publish the posts that are due. Each post is claimed first
// (scheduled -> publishing) so two runs never publish it twice.
import { env, sb, type AuthEnv } from './auth';
import { WELL_COMPANY } from './tenant';
import { due, publishPost, type Draft } from './social';

type Row = Draft & { id: number; company_id: string; status: string; approved_at?: string | null };

export async function runSocial(e: AuthEnv, now = Date.now(), f: typeof fetch = fetch): Promise<number> {
  let cfg;
  try { cfg = env(e); } catch { console.error('social: setup incomplete'); return 0; }
  const list = await sb<Row[]>(cfg, `/rest/v1/social_posts?select=*&status=eq.scheduled&publish_at=lte.${new Date(now).toISOString()}&order=publish_at.asc&limit=50`, { admin: true });
  if (!list.ok || !Array.isArray(list.data)) return 0;
  // Platform tokens: the vault holds Well's today; per-company vault names come with ADR-0006's next step
  const vault = await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} });
  const wellTokens = Object.fromEntries((vault.ok && Array.isArray(vault.data) ? vault.data : []).map(x => [x.name, x.value]));
  let done = 0;
  for (const p of list.data.filter(x => due(x, now))) {
    const claim = await sb<Row[]>(cfg, `/rest/v1/social_posts?id=eq.${p.id}&status=eq.scheduled`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status: 'publishing' } });
    if (!claim.ok || !Array.isArray(claim.data) || !claim.data.length) continue;
    const out = await publishPost(p, p.company_id === WELL_COMPANY ? wellTokens : {}, f);
    await sb(cfg, `/rest/v1/social_posts?id=eq.${p.id}`, { method: 'PATCH', admin: true, body: out });
    done++;
  }
  return done;
}
