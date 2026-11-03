// The user's copy that draws the sidebar at once (common.js and nav.js share it). It is kept in this browser without
// the email, and a copy older than 12 hours is not drawn: on a shared computer whose session ran out without signing
// out, the next person waits for the server instead of seeing the last user's name and menu.
export const ME_KEY = 'well-me-2'; // v2: carries the modules list
export const FRESH = 5 * 60 * 1000, MAX_AGE = 12 * 60 * 60 * 1000;

// The stored text, or null when there is none, it is unreadable, or it is too old (or from the future) to draw
export function readMe(raw, now = Date.now()) {
  let c = null;
  try { c = JSON.parse(raw || 'null'); } catch { return null; }
  if (!c || !c.v || typeof c.t !== 'number' || now - c.t > MAX_AGE || c.t > now + FRESH) return null;
  return c;
}
// What is stored: everything the sidebar draws, without the email
export function slim(v) {
  const { email: _email, ...rest } = v || {};
  return rest;
}
