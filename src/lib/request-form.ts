// The public request form (src/components/site/RequestForm.astro): shows the security scope only for audits, sends
// the answers to /api/site/request, and puts the server's per-field messages next to their boxes.
// Messages arrive in Arabic; on English the page's i18n (public/assets/i18n.js) translates them as they appear.
const form = document.querySelector<HTMLFormElement>('[data-request-form]');
if (form) {
  const shown = performance.now();
  const kind = form.querySelector('select[name="kind"]') as unknown as HTMLSelectElement;
  const scope = form.querySelector<HTMLElement>('[data-scope]')!;
  const msg = form.querySelector<HTMLElement>('[data-msg]')!;
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';

  kind.addEventListener('change', () => { scope.hidden = kind.value !== 'security'; });
  // An error goes away as soon as the visitor fixes that box
  form.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    const err = t.name ? form.querySelector<HTMLElement>(`[data-err="${t.name}"]`) : null;
    if (err?.textContent) { err.textContent = ''; t.removeAttribute('aria-invalid'); }
  });
  // A link to #request from a page section can pre-pick what the visitor wants: <a href="#request" data-kind="security">
  document.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-kind]');
    if (a) { kind.value = a.dataset.kind!; scope.hidden = kind.value !== 'security'; }
  });

  const showErrors = (errors: Record<string, string>) => {
    form.querySelectorAll<HTMLElement>('[data-err]').forEach(el => {
      const m = errors[el.dataset.err!] ?? '';
      el.textContent = m;
      const input = form.elements.namedItem(el.dataset.err!) as HTMLInputElement | null;
      if (input && 'setAttribute' in input) { if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
    });
    const first = Object.keys(errors)[0];
    const el = first ? form.elements.namedItem(first) as HTMLElement | null : null;
    if (el) { el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); el.focus?.({ preventScroll: true }); }
  };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    showErrors({});
    msg.textContent = '';
    btn.disabled = true; btn.classList.add('loading');
    const body = {
      kind: kind.value, name: val('name'), company: val('company'), phone: val('phone'), email: val('email'), message: val('message'),
      website: val('website'), consent: (form.elements.namedItem('consent') as HTMLInputElement).checked,
      scope: [...form.querySelectorAll<HTMLInputElement>('input[name="scope"]:checked')].map(x => x.value),
      page: location.pathname, lang: document.documentElement.lang === 'en' ? 'en' : 'ar', t: Math.round(performance.now() - shown),
    };
    try {
      const r = await fetch('/api/site/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; fields?: Record<string, string> };
      if (r.ok && j.ok) {
        form.querySelector<HTMLElement>('.st-fields')!.hidden = true;
        form.querySelector<HTMLElement>('.st-form-bar')!.hidden = true;
        form.querySelector<HTMLElement>('[data-done]')!.hidden = false;
        return;
      }
      if (j.fields) showErrors(j.fields);
      msg.textContent = j.error || 'صار خطأ، جرّب مرة ثانية';
    } catch {
      msg.textContent = 'ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية';
    } finally {
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}
