// social.post.create: schedules a post exactly like the Social tab (src/modules/social/schedule.ts). It never publishes by itself:
// the post waits for its approver in the approvals center, whatever the caller or the mode.
import { schedulePost } from '../../modules/social/schedule';
import { ToolFail, type Parsed, type Tool } from '../types';

type Input = Record<string, unknown>;
const STATUS: Record<number, 'invalid' | 'conflict' | 'unavailable' | 'failed'> = { 400: 'invalid', 409: 'conflict', 503: 'unavailable' };

export const socialPostCreate: Tool<Input> = {
  name: 'social.post.create', title: 'Schedule a post', write: true,
  description: 'Schedules a post on the chosen platforms. Give publish_at (ISO time) or queue: true for the next free queue slot. The post waits for approval before it goes out.',
  inputSchema: { type: 'object', required: ['platforms', 'body'], additionalProperties: false, properties: {
    platforms: { type: 'array', items: { type: 'string' }, minItems: 1 }, body: { type: 'string' }, publish_at: { type: 'string', format: 'date-time' },
    queue: { type: 'boolean' }, mode: { type: 'string' }, media: { type: 'array', items: { type: 'object' } }, overrides: { type: 'object' } } },
  parse(args): Parsed<Input> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'Send an object' };
    const a = args as Input;
    if (!Array.isArray(a.platforms) || !a.platforms.length) return { ok: false, error: 'platforms: at least one' };
    if (typeof a.body !== 'string') return { ok: false, error: 'body: the post text' };
    const allowed = ['platforms', 'body', 'publish_at', 'queue', 'mode', 'media', 'overrides'];
    const extra = Object.keys(a).find(k => !allowed.includes(k));
    if (extra) return { ok: false, error: `Unknown field: ${extra}` };
    return { ok: true, value: { ...a } };
  },
  async run(ctx, input) {
    const user = ctx.user ? { co: ctx.company, email: ctx.user.email, role: ctx.user.role } : { co: ctx.company, email: ctx.actor };
    const r = await schedulePost(ctx.cfg, user, ctx.env, input);
    if (r.status !== 200) throw new ToolFail(STATUS[r.status] || 'failed', String(r.body.error || 'Not scheduled'));
    return { post: r.body.post, notices: r.body.notices, awaiting_approval: true };
  },
};
