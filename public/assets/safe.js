// Pure text helpers shared by every page (no browser objects, so they are unit-tested): what may reach the user, and which links may be shown.

// What a browser says when something fails ("Failed to fetch", "Unexpected token <", a DOMException) is not for the user:
// anything like that, without an Arabic sentence of ours, becomes one fixed Arabic sentence.
const TECH = /failed to fetch|networkerror|load failed|unexpected token|is not valid json|json\.parse|dynamically imported module|the play\(\) request|aborterror|typeerror|domexception|\[object|undefined|null is not/i;
export const friendly = (what, fallback = 'صار خطأ، جرّب مرة ثانية') => { const m = String(what?.message ?? what ?? ''); return TECH.test(m) && !/[\u0600-\u06FF]/.test(m) ? fallback : m; };
// A link from data (a competitor page, an ad link) is shown only when it is a plain http(s) address: never javascript: or data:
export const safeUrl = u => { try { const x = new URL(String(u ?? '').trim()); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; } };
// A picture address: the same http(s) rule, or a path on this site (covers are served from /m/…)
export const safeSrc = u => (/^\/(?!\/)/.test(String(u ?? '').trim()) ? String(u).trim() : safeUrl(u));
// A stored error (a platform's reply, an agent's last error) is for the user only when it is a sentence of ours in Arabic; otherwise a fixed sentence
export const arabicOr = (s, fallback = 'صار خطأ، جرّب مرة ثانية') => (/[\u0600-\u06FF]/.test(String(s ?? '')) ? String(s) : fallback);
