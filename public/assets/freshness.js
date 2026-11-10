// Plain-word notice when the numbers are old (or the CRM part is missing). Reads /api/data-status (R2 only, kept 2 minutes
// by the browser). Static sentences only (no numbers inside them), so the English page translates them. Pure text parts are
// exported for the tests and for «صحة الداتا».
const AGE = h => (h == null ? null : h >= 72 ? 'أكثر من ٣ أيام' : h >= 24 ? 'أكثر من يوم' : h >= 12 ? 'أكثر من ١٢ ساعة' : 'أكثر من ٦ ساعات');

// Normal users: only what changes how far they can trust a number. A failed dispatch is for the owner page.
export function staleText(s) {
  if (!s || s.level === 'unknown' || !Array.isArray(s.warnings)) return [];
  const w = s.warnings, out = [];
  if (w.includes('no_data')) out.push('ما وصلتك أرقام محدّثة للحين. جرّب بعد قليل.');
  else if (w.includes('data_very_old')) out.push(`آخر تحديث للأرقام قبل ${AGE(s.dash_age_hours)}. الأرقام اللي تشوفها قد تكون قديمة، فلا تبني عليها قرار قبل ما تتحدّث.`);
  if (w.includes('crm_missing')) out.push('أرقام الإقفالات والمبيعات غير مربوطة حالياً، فلا تعتمد عليها.');
  else if (w.includes('crm_old')) out.push('أرقام الإقفالات والمبيعات ما تحدّثت من فترة، فقد تكون ناقصة.');
  return out;
}

// For the owner: every warning, in plain words, with what it means
export function ownerText(s) {
  if (!s || s.level === 'unknown' || !Array.isArray(s.warnings)) return [];
  const w = s.warnings, out = staleText(s);
  if (w.includes('data_old')) out.push(`آخر تحديث للأرقام قبل ${AGE(s.dash_age_hours)}. التحديث يصير كل ساعة، فيمكن مرّت عدة مرات بدون ما يشتغل.`);
  if (w.includes('dispatch_failed')) out.push('آخر مرة حاول الموقع يبدأ التحديث فشل. الأرقام ما راح تتحدّث لين يتصلّح (غالباً مفتاح البدء ناقص أو منتهي).');
  return out;
}

export async function staleBanner(mount) {
  try {
    const r = await fetch('/api/data-status', { credentials: 'same-origin' });
    if (!r.ok) return;
    const lines = staleText(await r.json());
    if (!lines.length || !mount || mount.querySelector('.stale-note')) return;
    const el = document.createElement('div');
    el.className = 'stale-note'; el.setAttribute('role', 'status');
    el.innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    mount.prepend(el);
  } catch { /* a notice is never worth an error */ }
}
