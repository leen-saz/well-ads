// السوشال: إنشاء منشور مجدول لأكثر من منصة، وتقويم الأسبوعين الجايين. النشر يصير من السيرفر في وقته.
import { $, $$, api, say, esc, shell, busy, LANG, pageFailure, pageSignal, friendly } from '/assets/common.js';
import { block } from '/assets/compliance-ui.js';
import { t } from '/assets/i18n.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  const ST = { draft: 'مسودة', scheduled: 'مجدول', publishing: 'ينشر الحين', published: 'انتشر', partial: 'انتشر جزئياً', failed: 'ما انتشر', cancelled: 'ملغي' };
  // Why a platform did not publish, in plain words (the platform's own message is for the owner only, under "تفاصيل")
  const WHY = {
    not_connected: 'الحساب مو مربوط. اربطه من صفحة الربط وبعدها أعد المحاولة',
    no_media: 'انستقرام يحتاج صورة أو فيديو',
    token: 'انتهى ربط الحساب. اربطه من جديد من صفحة الربط',
    permission: 'ما عندنا إذن النشر على هالحساب. اربطه من جديد ووافق على كل الصلاحيات',
    busy: 'المنصة مشغولة الحين. جرّب بعد شوي',
    media_rejected: 'المنصة ما قبلت الصورة أو الفيديو. جرّب ملف ثاني',
    video_failed: 'المنصة ما قدرت تعالج الفيديو. جرّب فيديو ثاني بصيغة MP4',
    video_timeout: 'الفيديو تأخر كثير في المعالجة عند المنصة',
    unsaved: 'المنشور اننشر على المنصة، بس ما قدرنا نحفظ النتيجة عندنا. لا تعيد المحاولة: افتح الصفحة وتأكد',
    unconfirmed: 'ما وصلنا رد من المنصة وممكن يكون المنشور اننشر. افتح الصفحة وتأكد قبل ما تعيد المحاولة',
    network: 'تعذر الاتصال بالمنصة',
    platform: 'المنصة ما قبلت المنشور',
    unsupported: 'النشر التلقائي لهالمنصة غير متاح الحين. انحفظ كتذكير',
    invalid: 'المنشور ما يناسب شروط المنصة (عدد الصور أو نوع الملف)',
    many_accounts: 'فيه أكثر من حساب مربوط لهالمنصة. خلّ المالك يترك حساب واحد',
  };
  // The extra publishing service, for the owner's check (words only; the codes come from /api/social/engine)
  const ENGINE = {
    ok: 'الخدمة شغالة', off: 'ما انربطت خدمة النشر لتيك توك وX ولينكدإن. اربطها من صفحة الربط',
    url: 'عنوان الخدمة غير صحيح. صححه من صفحة الربط', key: 'مفتاح الخدمة مرفوض أو ناقص. حدّثه من صفحة الربط',
    down: 'ما قدرنا نوصل للخدمة. تأكد إنها شغالة',
  };
  const CHANNEL = { ok: 'حساب مربوط', none: 'ما فيه حساب مربوط. اربطه من داخل الخدمة', many: 'أكثر من حساب مربوط. اترك حساب واحد' };
  const CHECK = {
    fb_ok: 'فيسبوك جاهز للنشر', fb_not_connected: 'صفحة فيسبوك مو مربوطة. اربطها من صفحة الربط',
    fb_token: 'ربط فيسبوك انتهى أو انرفض. اربطه من جديد', fb_page: 'ما قدرنا نوصل لصفحة فيسبوك. تأكد إنها موجودة وإنك مديرها',
    fb_perm: 'ناقص إذن النشر على الصفحة. اربط من جديد ووافق على كل الصلاحيات', fb_expiring: 'الربط بينتهي قريباً. اربطه من جديد قبل ما تتأخر',
    perm_unknown: 'وصلنا للصفحة بس ما قدرنا نتأكد من الصلاحيات',
    ig_ok: 'انستقرام جاهز للنشر', ig_not_connected: 'حساب انستقرام مو مربوط. اربطه من صفحة الربط',
    ig_token: 'ربط انستقرام انتهى أو انرفض. اربطه من جديد', ig_not_linked: 'الصفحة المربوطة ما لها حساب انستقرام تجاري. اربط الحساب بالصفحة من إعدادات الصفحة',
    ig_not_saved: 'حساب انستقرام ما انحفظ. اربط ميتا من جديد', ig_mismatch: 'حساب انستقرام المحفوظ غير المربوط بالصفحة. اربط ميتا من جديد',
    ig_perm: 'ناقص إذن النشر على انستقرام. اربط من جديد ووافق على كل الصلاحيات', ig_page: 'ما قدرنا نوصل لحساب انستقرام',
  };
  const processing = p => Object.values(p.results || {}).some(r => !r.ok && r.state === 'processing' && !r.code);
  let PLATS = {}, APPR = { approvers: [], canApprove: false, owner: false, people: [] };
  const fmtDay = d => new Intl.DateTimeFormat((LANG === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn'), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' }).format(d);
  const fmtTime = d => new Intl.DateTimeFormat((LANG === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn'), { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(d);

  function counter() {
    const n = $('#body').value.length;
    const picked = $$('input[name="pl"]:checked').map(x => x.value);
    const limit = Math.min(...picked.map(p => PLATS[p]?.max || Infinity));
    const el = $('#cnt');
    el.textContent = picked.length && Number.isFinite(limit) ? `${n} / ${limit} ${t('حرف')}` : `${n} ${t('حرف')}`;
    el.classList.toggle('over', n > limit);
  }

  // The real state of a post in plain words, from its status and the per-platform results kept on it
  const CHECK_MIN = 5;   // the server looks for due posts every 5 minutes
  const nextCheck = () => new Date(Math.ceil((Date.now() + 1) / (CHECK_MIN * 6e4)) * CHECK_MIN * 6e4);
  function stateOf(p, at, waiting) {
    if (waiting) return { cls: 'wait', html: '<span>ينتظر الاعتماد</span>' };
    if (p.status === 'scheduled') {
      if (processing(p)) return { cls: 'go', html: '<span>ينشر الآن</span> <span class="muted">· <span>الفيديو قيد المعالجة عند المنصة</span></span>' };
      const due = at.getTime() <= Date.now();
      return { cls: 'ok', html: `<span>معتمد وينتظر موعده</span> <span class="muted">(<span>الساعة</span> <bdi>${fmtTime(at)}</bdi>)</span>${due ? ` <span class="muted">· <span>الفحص الجاي</span> <bdi>${fmtTime(nextCheck())}</bdi></span>` : ''}` };
    }
    if (p.status === 'publishing') return { cls: 'go', html: '<span>ينشر الآن</span>' };
    if (p.status === 'published') return { cls: 'done', html: '<span>انتشر على كل المنصات</span> ✓' };
    return { cls: p.status === 'failed' ? 'bad' : p.status === 'partial' ? 'warn' : 'wait', html: `<span>${ST[p.status] || p.status}</span>` };
  }
  // One line per platform of what happened to it: published (with the link where we have one), failed and why, or still waiting
  function resultLines(p) {
    if (!['published', 'partial', 'failed', 'publishing', 'scheduled'].includes(p.status)) return '';
    const rows = p.platforms.map(k => {
      const r = (p.results || {})[k], name = `<span class="so-rn">${esc(PLATS[k]?.name || k)}</span>`;
      if (r?.ok) {
        const link = k === 'facebook' && r.id ? ` <a href="https://www.facebook.com/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer"><span>افتح المنشور</span></a>` : '';
        return `<li class="ok"><span aria-hidden="true">✓</span><span><span>اننشر على</span> ${name}${link}</span></li>`;
      }
      if (r?.code) return `<li class="bad"><span aria-hidden="true">✕</span><span>${name}: <span>فشل</span> · <span>${esc(WHY[r.code] || WHY.platform)}</span>${APPR.owner && r.detail ? `<details class="so-more"><summary>تفاصيل للمالك</summary><code>${esc(r.detail)}</code></details>` : ''}</span></li>`;
      if (r?.state) return `<li class="go"><span aria-hidden="true">…</span><span>${name}: <span>ينشر الآن</span></span></li>`;
      return p.status === 'scheduled' ? '' : `<li class="wait"><span aria-hidden="true">·</span><span>${name}: <span>ما انرسل للمنصة</span></span></li>`;
    }).join('');
    return rows ? `<ul class="so-res">${rows}</ul>` : '';
  }

  function postCard(p) {
    const at = new Date(p.publish_at);
    const waiting = p.status === 'scheduled' && !p.approved_at;
    const bad = Object.entries(p.results || {}).filter(([, r]) => !r.ok && r.code);
    const retryable = ['failed', 'partial'].includes(p.status) && !p.retried_at && bad.some(([, r]) => r.code !== 'unsupported' && r.code !== 'unsaved');
    const unsure = bad.some(([, r]) => r.code === 'unconfirmed' || r.code === 'unsaved');
    const failBox = bad.length && ['failed', 'partial'].includes(p.status) ? `<div class="so-note so-fail" role="alert">
        <strong>${p.status === 'partial' ? 'انتشر على بعض المنصات بس' : 'المنشور ما انتشر'}</strong>
        ${retryable ? `<div class="bar" style="margin-top:10px"><button class="btn sm primary" data-act="retry" data-unsure="${unsure ? 1 : 0}"${APPR.canApprove ? '' : ' disabled'}>أعد المحاولة للمنصات اللي ما انتشرت</button>${APPR.canApprove ? '' : '<span class="muted">المعتمد بس يقدر يعيد المحاولة</span>'}</div>`
          : p.retried_at ? '<p class="muted" style="margin:8px 0 0">انعادت المحاولة مرة. لو تبي تنشر ثاني، سوّ منشور جديد.</p>' : ''}
      </div>` : '';
    const st = stateOf(p, at, waiting);
    return `<article class="card so-post" data-id="${p.id}">
      <div class="so-top">${p.platforms.map(k => `<span class="so-chip">${esc(PLATS[k]?.name || k)}</span>`).join('')}
        <span class="muted">${fmtTime(at)}</span></div>
      <p class="so-state ${st.cls}" role="status">${st.html}</p>
      ${p.body ? (p.compliance?.length ? block(p.body, p.compliance) : `<p class="so-body" data-user-text>${esc(p.body)}</p>`) : ''}
      ${resultLines(p)}
      ${failBox}
      ${p.status === 'scheduled' ? `<div class="bar">${waiting && APPR.canApprove ? '<button class="btn sm primary" data-act="approve">اعتمد</button>' : ''}<button class="btn sm ghost" data-act="cancel">ألغِ</button></div>` : ''}
    </article>`;
  }

  async function load() {
    const from = new Date(Date.now() - 864e5), to = new Date(Date.now() + 14 * 864e5);
    const r = await api(`/api/social/posts?from=${from.toISOString()}&to=${to.toISOString()}`);
    PLATS = r.platforms;
    showAccount(r.account);
    if (!$('#plats').innerHTML) {
      // Each platform is a chip with a status badge; choosing it says in one line what the status means
      const R = r.ready || {};
      const kind = k => !PLATS[k].live ? ((R[k] || '').includes('غير متاح') ? 'off' : 'soon') : R[k] ? 'warn' : 'ok';
      const BADGE = { ok: 'جاهز', warn: 'يحتاج ربط', off: 'غير متاح الحين', soon: 'قريباً' };
      const REASON = { ok: 'ينشر تلقائياً بعد الاعتماد', warn: 'يحتاج ربط الحساب من صفحة الربط قبل موعد النشر', off: 'النشر التلقائي غير متاح الحين: ينحفظ المنشور كتذكير', soon: 'النشر التلقائي لهالمنصة قريباً: ينحفظ المنشور كتذكير' };
      $('#plats').innerHTML = Object.entries(PLATS).map(([k, p]) => `<label class="so-pl ${kind(k)}"><input type="checkbox" name="pl" value="${k}"><span class="so-pn">${esc(p.name)}</span><span class="so-bd ${kind(k)}">${BADGE[kind(k)]}</span></label>`).join('');
      const why = k => { const w = $('#platWhy'); const kd = kind(k); w.innerHTML = `<span class="so-bd ${kd}">${BADGE[kd]}</span><span><bdi>${esc(PLATS[k].name)}</bdi>: <span>${REASON[kd]}</span></span>`; w.hidden = false; };
      $$('input[name="pl"]').forEach(x => { x.addEventListener('change', () => { why(x.value); counter(); }); x.addEventListener('focus', () => why(x.value)); });
    }
    $('#range').textContent = `${fmtDay(from)} ← ${fmtDay(to)}`;
    // When the next publishing check runs (the server looks for approved posts that are due every 5 minutes); kept fresh while the page is open
    const chk = () => { const el = $('#chk'); if (el) el.innerHTML = `<span>النشر يتفحص كل 5 دقايق: المنشور المعتمد ينزل خلال 5 دقايق من موعده.</span> <span>الفحص الجاي</span> <bdi>${fmtTime(nextCheck())}</bdi>`; };
    chk(); clearInterval(window.__soChk); window.__soChk = setInterval(chk, 30000);
    pageSignal().addEventListener('abort', () => clearInterval(window.__soChk), { once: true });   // stops when the user leaves this page
    const byDay = new Map();
    for (const p of r.posts) { const k = fmtDay(new Date(p.publish_at)); byDay.set(k, [...(byDay.get(k) || []), p]); }
    $('#list').innerHTML = byDay.size ? [...byDay].map(([d, ps]) => `<h3 class="so-day">${esc(d)}</h3><div class="cx-list" style="display:grid;gap:10px">${ps.map(postCard).join('')}</div>`).join('')
      : '<p class="muted">ما فيه منشورات مجدولة. ابدأ من النموذج.</p>';
    counter();
  }

  // The connected Facebook page and Instagram account (names only). The owner can test the connection without posting,
  // and chooses the page when Meta was connected with several.
  let ACC = null;
  function showAccount(a) {
    ACC = a; const el = $('#connNames');
    if (!a) { el.textContent = 'ربط المنصات لهالشركة قيد التجهيز.'; return; }
    const one = (label, name) => `<span>${label}</span>: ${name ? `<strong dir="auto" data-user-text>${esc(name)}</strong>` : '<span>مو مربوط</span>'}`;
    if (a.page || a.instagram) el.innerHTML = `${one('فيسبوك', a.page)} · ${one('انستقرام', a.instagram)}`;
    else el.textContent = a.pick ? 'ما انربطت صفحة للحين. اختر صفحة من تحت.' : 'ما انربط حساب للنشر للحين.';
    $('#connLink').hidden = !APPR.owner;
    $('#connCheck').hidden = !APPR.owner || !a.page;
    $('#eng').hidden = !APPR.owner;
    loadPick();
  }
  async function loadPick() {
    if (!APPR.owner || !ACC?.pick) { $('#pick').hidden = true; return; }
    const r = await api('/api/social/pages').catch(() => null);
    const list = r?.choices || [];
    $('#pick').hidden = !list.length;
    $('#pickList').innerHTML = list.map((c, i) => `<label><input type="radio" name="pg" value="${esc(c.id)}"${i === 0 ? ' checked' : ''}> ${esc(c.name)} <span class="muted">${c.instagram ? `· <span>انستقرام</span>: <bdi>${esc(c.instagram)}</bdi>` : '· <span>بدون حساب انستقرام</span>'}</span></label>`).join('');
    if (list.length && new URLSearchParams(location.search).has('pick')) $('#conn').scrollIntoView({ block: 'start' });
  }
  $('#pickSave').onclick = async e => {
    const btn = e.currentTarget, id = $$('input[name="pg"]:checked')[0]?.value; if (!id) return;
    busy(btn, true);
    try { await api('/api/social/pages', { method: 'POST', body: { id } }); say($('#pickMsg'), 'انربطت الصفحة.', true); $('#connOut').innerHTML = ''; await load(); }
    catch (err) { say($('#pickMsg'), err.message); }
    busy(btn, false);
  };
  $('#connCheck').onclick = async e => {
    const btn = e.currentTarget;
    busy(btn, true); $('#connOut').innerHTML = '';
    try {
      const r = await api('/api/social/connection');
      $('#connOut').innerHTML = r.checks.map(c => `<li class="${c.level}"><span>${c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✕'}</span><span>${esc(CHECK[c.code] || c.code)}</span></li>`).join('')
        + '<li class="muted"><span></span><span>هذا فحص بس، ما نشرنا شي.</span></li>';
    } catch (err) { $('#connOut').innerHTML = `<li class="block"><span>✕</span><span>${esc(err.message)}</span></li>`; }
    busy(btn, false);
  };

  // The owner's check of the extra publishing service: reachable, key valid, which platforms have a connected account (names only). Reads only.
  $('#engCheck').onclick = async e => {
    const btn = e.currentTarget;
    busy(btn, true); $('#engOut').innerHTML = '';
    try {
      const r = await api('/api/social/engine');
      const line = (cls, mark, html) => `<li class="${cls}"><span>${mark}</span><span>${html}</span></li>`;
      $('#engOut').innerHTML = line(r.status === 'ok' ? 'ok' : 'block', r.status === 'ok' ? '✓' : '✕', esc(ENGINE[r.status] || ENGINE.down))
        + (r.status === 'ok' ? r.channels.map(c => line(c.code === 'ok' ? 'ok' : 'warn', c.code === 'ok' ? '✓' : '!',
          `<span>${esc(PLATS[c.platform]?.name || c.platform)}</span>: <span>${esc(CHANNEL[c.code])}</span>${c.names.length ? ` <bdi dir="auto">(${c.names.map(esc).join('، ')})</bdi>` : ''}`)).join('') : '')
        + '<li class="muted"><span></span><span>هذا فحص بس، ما نشرنا شي.</span></li>';
    } catch (err) { $('#engOut').innerHTML = `<li class="block"><span>✕</span><span>${esc(err.message)}</span></li>`; }
    busy(btn, false);
  };

  // Who approves: named in the tab by the owner; the form says who will approve the post
  async function loadApprovers() {
    APPR = await api('/api/social/approvers');
    const names = APPR.who || [];
    $('#who').textContent = names.length ? `ينتظر اعتماد ${names.join(' أو ')} قبل ما ينشر.` : 'ينتظر اعتماد المالك قبل ما ينشر.';
    $('#appr').hidden = !APPR.owner;
    if (APPR.owner) $('#apprList').innerHTML = APPR.people.map(p => `<label><input type="checkbox" name="ap" value="${esc(p.email)}"${APPR.approvers.includes(p.email) ? ' checked' : ''}> ${esc(p.name || p.email)}</label>`).join('');
  }
  $('#apprSave').onclick = async e => {
    const btn = e.currentTarget;
    busy(btn, true);
    try { await api('/api/social/approvers', { method: 'PUT', body: { approvers: $$('input[name="ap"]:checked').map(x => x.value) } }); say($('#apprMsg'), 'انحفظ.', true); await loadApprovers(); await load(); }
    catch (err) { say($('#apprMsg'), err.message); }
    busy(btn, false);
  };
  $('#body').addEventListener('input', counter);
  // Upload the chosen photo/video right away; its public link goes into the post (Meta reads it from there)
  let uploaded = null;
  const showPrev = m => { const el = $('#prev'); el.hidden = !m; el.innerHTML = !m ? '' : m.type === 'video' ? `<video src="${esc(m.url)}" controls muted></video>` : `<img src="${esc(m.url)}" alt="">`; };
  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0]; uploaded = null; showPrev(null); if (!f) { $('#upMsg').textContent = ''; return; }
    $('#upMsg').textContent = 'يرفع…';
    try {
      const res = await fetch('/api/social/upload', { method: 'POST', headers: { 'content-type': f.type }, body: f, credentials: 'same-origin' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'ما انرفع الملف');
      uploaded = { url: j.url, type: j.type }; $('#media').value = ''; showPrev(uploaded); $('#upMsg').textContent = 'انرفع ✓';
    } catch (err) { $('#upMsg').textContent = friendly(err, 'ما انرفع الملف. جرّب مرة ثانية.'); e.target.value = ''; }
  });

  // Write the idea in the text box, then let the social model write the post (it is checked, and you edit it before scheduling)
  $('#suggest').addEventListener('click', async e => {
    const btn = e.currentTarget; busy(btn, true); $('#notices').innerHTML = '';
    try {
      const r = await api('/api/social/suggest', { method: 'POST', body: { brief: $('#body').value, platforms: $$('input[name="pl"]:checked').map(x => x.value) } });
      $('#body').value = r.body; $('#body').dispatchEvent(new Event('input'));
      say($('#msg'), 'كتبه الذكاء الاصطناعي. راجعه قبل ما تجدوله.', true);
      $('#notices').innerHTML = block(r.body, r.compliance || []);
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });

  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true); $('#notices').innerHTML = '';
    const local = $('#at').value; // Riyadh time (UTC+3, no DST)
    const body = { platforms: $$('input[name="pl"]:checked').map(x => x.value), body: $('#body').value,
      media: uploaded ? [uploaded] : $('#media').value ? [{ url: $('#media').value, type: /\.(mp4|mov|webm)(\?|$)/i.test($('#media').value) ? 'video' : 'image' }] : [],
      publish_at: local ? new Date(local + ':00+03:00').toISOString() : '' };
    try {
      const r = await api('/api/social/posts', { method: 'POST', body });
      say($('#msg'), 'انجدول.', true);
      $('#notices').innerHTML = (r.notices || []).map(n => `<p class="so-note">${esc(n)}</p>`).join('');
      $('#body').value = ''; $('#media').value = ''; $('#file').value = ''; uploaded = null; showPrev(null); $('#upMsg').textContent = ''; await load();
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });

  $('#list').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'cancel' && !confirm(t('تلغي المنشور؟'))) return;
    if (b.dataset.act === 'retry' && !confirm(t(b.dataset.unsure === '1' ? 'ممكن يكون المنشور اننشر على بعض المنصات. تأكد من الصفحة أول. تعيد المحاولة؟ (مرة وحدة بس)' : 'نعيد المحاولة للمنصات اللي ما انتشرت بس؟ (مرة وحدة بس)'))) return;
    busy(b, true);
    try { await api('/api/social/posts', { method: 'PATCH', body: { id: b.closest('[data-id]').dataset.id, action: b.dataset.act } }); await load(); }
    catch (err) { say($('#msg'), err.message); busy(b, false); }
  });

  shell({ active: 'social', title: 'السوشال' }).then(loadApprovers).then(load).catch(pageFailure);
}
