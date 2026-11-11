// What the executor needs from an ad platform: read one entity, find a campaign by its exact name, set a budget or a status.
// Adapters hold NO policy: every guard lives in guards.ts and the service. They take their credentials from the Worker's secrets
// (never from the database or the repo) and never log, return or store them.
import type { Level, Plat, Status } from './guards';

export interface Entity { id: string; level: Level; name: string; status: Status | 'other'; budget: number | null; campaignId?: string }
export interface Adapter {
  readonly platform: Plat;
  /** Every campaign with exactly this name (0 = not found, 2+ = ambiguous: the caller refuses to guess). */
  findCampaigns(name: string): Promise<Entity[]>;
  /** The ad sets under a campaign that carry their own daily budget. */
  budgetedAdsets(campaignId: string): Promise<Entity[]>;
  read(level: Level, id: string): Promise<Entity | null>;
  setBudget(level: Level, id: string, daily: number): Promise<void>;
  setStatus(level: Level, id: string, to: Status): Promise<void>;
}
// A failure the caller can show without leaking anything: a short code, never the platform's message.
export class PlatformError extends Error { constructor(public code: string) { super(code); } }

// The secrets the executor may read. Separate from the read-only keys the data pull uses, on purpose: the write keys are only
// ever the ones the owner added for this feature, and removing them switches execution off completely.
export interface ExecEnv {
  META_WRITE_TOKEN?: string; META_WRITE_AD_ACCOUNT_ID?: string;
  SNAP_WRITE_CLIENT_ID?: string; SNAP_WRITE_CLIENT_SECRET?: string; SNAP_WRITE_REFRESH_TOKEN?: string; SNAP_WRITE_AD_ACCOUNT_ID?: string;
}
export const ENV_NAMES: Record<'meta' | 'snapchat', (keyof ExecEnv)[]> = {
  meta: ['META_WRITE_TOKEN', 'META_WRITE_AD_ACCOUNT_ID'],
  snapchat: ['SNAP_WRITE_CLIENT_ID', 'SNAP_WRITE_CLIENT_SECRET', 'SNAP_WRITE_REFRESH_TOKEN', 'SNAP_WRITE_AD_ACCOUNT_ID'],
};
// Which platforms have every secret they need (booleans only: the names, never the values, are what the UI may learn)
export const configured = (e: ExecEnv): Record<'meta' | 'snapchat', boolean> => ({
  meta: ENV_NAMES.meta.every(k => !!String(e[k] ?? '').trim()), snapchat: ENV_NAMES.snapchat.every(k => !!String(e[k] ?? '').trim()),
});
export type { Plat };
