// The one switch for the Media buyer tab. Leen hid it on 2026-11-12 («الميديا باير» out of the system for now): with this
// false the tab is gone from the sidebar for everyone, the owner included, /buyer/ and every /api/buyer/* answer 404 (the
// execution routes with them: apply, propose, decide, rollback, execution), and nothing can reach an ad account through it.
// The code, the tables (032_buyer_actions) and the saved rules in the database are untouched. To bring it back: set this to
// true, put 'buyer' back in tests/smoke/keys.ts and remove the skip in tests/smoke/buyer-exec.spec.ts.
export const BUYER_ENABLED = false;
