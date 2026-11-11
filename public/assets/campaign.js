// احلم ← «حملة جديدة»: تكتب أمنياتك للحملة بكلام عادي، واحلم يحوّلها لخطة ومهام لإيجنتس التطبيق.
// التكلفة المتوقعة تطلع قبل ما يشتغل أي شي، والاعتماد لمن عنده صلاحية الموافقة. ما فيه نشر ولا صرف ولا تعديل على حسابات الإعلانات.
import { $, esc, api, say } from './common.js';
import { render } from './ahlam.js';

const AGENT = { knowledge: ['المعرفة والرصد', 'Knowledge & listening'], content: ['المحتوى و SEO', 'Content & SEO'], design: ['التصميم', 'Design'], voice: ['الصوت والفويس أوفر', 'Voice & voiceover'],
  social: ['السوشال', 'Social'], compliance: ['الامتثال', 'Compliance'], optimize: ['التحسين وخطة القياس', 'Optimization & measurement'] };
const STATUS = { planned: ['الخطة تنتظر الاعتماد', 'Plan waiting for approval'], approved: ['معتمدة', 'Approved'], running: ['تشتغل', 'Running'], review: ['تنتظر المراجعة', 'Waiting for review'],
  done: ['مكتملة', 'Done'], cancelled: ['ملغاة', 'Cancelled'], draft: ['قيد الكتابة', 'Draft'] };
const TSTATUS = { waiting: ['ينتظر', 'Waiting'], running: ['يشتغل', 'Running'], review: ['يحتاج مراجعة', 'Needs review'], approved: ['معتمد', 'Approved'], blocked: ['موقوف بسبب الامتثال', 'Blocked by compliance'], failed: ['فشل', 'Failed'] };
const PLATFORMS = { meta: 'Meta', google: 'Google', tiktok: 'TikTok', snapchat: 'Snapchat', x: 'X' };
const DEPTS = { iv: ['المحاليل الوريدية', 'IV Drips'], midwife: ['القبالة / رعاية الحمل', 'Midwifery / Maternity'], foot: ['تقويم القدم', 'Foot Alignment'], renan: ['رينان لصحة الطفل', 'Renan Child Health'] };
const USD_SAR = 3.75;

export function mountCampaign(root, me, L) {
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  const pick = (m, k) => (m[k] ? L(m[k][0], m[k][1]) : k);
  const sar = usd => `${(Math.round(Number(usd || 0) * USD_SAR * 100) / 100).toLocaleString('en-US')} ${L('ر.س', 'SAR')}`;
  const date = iso => new Date(iso).toLocaleDateString(L('ar-SA-u-nu-latn', 'en-GB'), { day: 'numeric', month: 'short' });
  const msg = () => $('#cmMsg', root);
  const frame = html => { root.innerHTML = `<div class="card ah-card">${html}<div class="msg" id="cmMsg" role="status"></div></div>`; };

  async function showList() {
    frame(`<div class="cm-head"><p class="ah-note muted">${esc(L('اكتب أمنياتك للحملة، واحلم يطلع لك خطة ومهام لكل إيجنت، وتكلفتها المتوقعة قبل ما يشتغل أي شي. ما ينشر ولا يصرف ولا يغيّر حساب إعلاني.', 'Write your wishes for a campaign and Ahlam builds a plan with tasks for each agent, and its expected cost before anything runs. It never publishes, spends or changes an ad account.'))}</p>
      <button class="btn primary" id="cmNew" type="button">${esc(L('حملة جديدة', 'New campaign'))}</button></div><div id="cmList" class="muted">${esc(L('يحمّل…', 'Loading…'))}</div>`);
    $('#cmNew', root).onclick = showForm;
    try {
      const { campaigns } = await api('/api/campaigns/list');
      $('#cmList', root).innerHTML = campaigns.length ? `<ul class="cm-list">${campaigns.map(c => `<li><button type="button" data-id="${esc(c.id)}"><b>${esc(c.title)}</b><span class="muted">${esc(pick(STATUS, c.status))} · ${esc(date(c.created_at))} · ${esc(sar(c.estimate_usd))}</span></button></li>`).join('')}</ul>`
        : `<p class="muted">${esc(L('ما فيه حملات للحين.', 'No campaigns yet.'))}</p>`;
      $('#cmList', root).onclick = ev => { const b = ev.target.closest('button[data-id]'); if (b) showCampaign(b.dataset.id); };
    } catch (err) { say(msg(), err.message); $('#cmList', root).textContent = ''; }
  }

  function showForm() {
    const field = (id, ar, en, rows = 2, max = 400) => `<label class="cm-f"><span>${esc(L(ar, en))}</span><textarea id="${id}" rows="${rows}" maxlength="${max}"></textarea></label>`;
    frame(`<h2 class="cm-h">${esc(L('حملة جديدة', 'New campaign'))}</h2>
      <form id="cmForm" class="cm-form">
        ${field('cmGoal', 'وش تبي من الحملة؟ (الهدف)', 'What do you want from the campaign? (goal)', 3)}
        <label class="cm-f"><span>${esc(L('القسم أو الخدمة', 'Department or service'))}</span><select id="cmDept"><option value="">${esc(L('غير محدد', 'Not set'))}</option>${Object.keys(DEPTS).map(k => `<option value="${k}">${esc(pick(DEPTS, k))}</option>`).join('')}</select></label>
        ${field('cmOffer', 'العرض', 'Offer')}${field('cmAud', 'الجمهور', 'Audience')}
        <fieldset class="cm-f"><legend>${esc(L('المنصات', 'Platforms'))}</legend>${Object.entries(PLATFORMS).map(([k, n]) => `<label class="cm-c"><input type="checkbox" name="plat" value="${k}"> ${esc(n)}</label>`).join('')}</fieldset>
        ${field('cmDates', 'التواريخ', 'Dates', 1, 120)}${field('cmBudget', 'نطاق الميزانية', 'Budget range', 1, 120)}${field('cmTone', 'النبرة', 'Tone', 1, 200)}${field('cmNotes', 'أي شي ثاني تبي نعرفه', 'Anything else we should know', 3, 1200)}
        <div class="cm-actions"><button class="btn primary" id="cmGo" type="submit">${esc(L('جهّز الخطة', 'Build the plan'))}</button><button class="btn" id="cmBack" type="button">${esc(L('رجوع', 'Back'))}</button></div>
        <p class="muted ah-note">${esc(L('تجهيز الخطة يستهلك طلب ذكاء اصطناعي واحد. التنفيذ ما يبدأ إلا بعد اعتماد الخطة وتكلفتها.', 'Building the plan uses one AI request. Nothing runs until the plan and its cost are approved.'))}</p>
      </form>`);
    $('#cmBack', root).onclick = showList;
    $('#cmForm', root).onsubmit = async ev => {
      ev.preventDefault();
      const v = id => $(id, root).value;
      const btn = $('#cmGo', root); btn.disabled = true; btn.textContent = L('أجهّز الخطة…', 'Building the plan…');
      try {
        const r = await api('/api/campaigns/create', { method: 'POST', timeout: 120000, body: { goal: v('#cmGoal'), dept: v('#cmDept'), offer: v('#cmOffer'), audience: v('#cmAud'),
          platforms: [...root.querySelectorAll('input[name=plat]:checked')].map(x => x.value), dates: v('#cmDates'), budget: v('#cmBudget'), tone: v('#cmTone'), notes: v('#cmNotes') } });
        showCampaign(r.id);
      } catch (err) { say(msg(), err.message); btn.disabled = false; btn.textContent = L('جهّز الخطة', 'Build the plan'); }
    };
  }

  let view = 0;   // a new screen cancels a run loop that belongs to the old one
  const KIND = { insight: ['سياق ورصد', 'Context & listening'], copy: ['نصوص ومحتوى', 'Copy & content'], design_brief: ['بريف التصميم', 'Design brief'], voice_script: ['نص الصوت', 'Voice script'],
    post: ['مسودة منشور', 'Post draft'], compliance_report: ['تقرير الامتثال', 'Compliance report'], optimization: ['الميزانية والتحسين', 'Budget & optimization'], measurement: ['خطة القياس', 'Measurement plan'] };
  const KPI_EN = { ctr: 'Click rate', clickToLead: 'Click to lead', leadToClose: 'Lead to close', cpl: 'Cost per lead (max)', costShare: 'Cost of a close, share of its value (max)', roas: 'Return on spend', maturityDays: 'Lead age before judging its close' };
  const UNIT = { '%': '%', SAR: ['ر.س', 'SAR'], '×': '×', day: ['يوم', 'days'] };
  const PLAT = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', snapchat: 'Snapchat' };
  const packText = (c, d) => {
    const b = c.brief || {}, out = [`# ${c.title}`, '', b.summary || '', ''];
    for (const t of d.tasks) { out.push(`## ${pick(AGENT, t.agent)}: ${t.title}`, ''); for (const o of d.outputs.filter(x => x.task_id === t.id)) out.push(o.platform ? `**${PLAT[o.platform] || o.platform}**` : '', o.body?.text || '', ''); }
    return out.join('\n');
  };

  function outputHtml(o) {
    const k = KIND[o.kind] ? L(...KIND[o.kind]) : o.kind;
    const hits = (o.compliance || []).filter(h => h.level !== 'info');
    const body = o.kind === 'measurement'
      ? `<ul class="cm-kpis">${(o.body.kpis || []).map(x => `<li>${esc(L(x.ar, KPI_EN[x.key] || x.ar))}: <b>${esc(x.target)} ${esc(Array.isArray(UNIT[x.unit]) ? L(...UNIT[x.unit]) : UNIT[x.unit] || '')}</b></li>`).join('')}</ul>`
      : `<div class="cm-text">${render(o.body.text || '')}</div>`;
    const day = o.kind === 'post' && o.body.day ? ` · ${esc(L('اليوم', 'Day'))} ${esc(o.body.day)}` : '';
    const verdict = o.kind === 'compliance_report' ? '' : hits.length ? '' : `<small class="cm-ok">${esc(L('الامتثال: ما فيه ملاحظات', 'Compliance: no findings'))}</small>`;
    return `<div class="cm-out"><small class="muted">${esc(k)}${o.platform ? ' · ' + esc(PLAT[o.platform] || o.platform) : ''}${day}</small>${body}${verdict}
      ${hits.length ? `<ul class="cm-hits">${hits.map(h => `<li class="${esc(h.level)}">${esc(h.title)} «${esc(h.match)}» ${esc(h.fix)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  // A small dot per agent, no text: pulsing = working, steady = waiting (or finished), grey = stopped, red = failed
  const dot = st => `<span class="cm-dot ${st === 'running' ? 'run' : st === 'blocked' ? 'off' : st === 'failed' ? 'bad' : st === 'review' || st === 'approved' ? 'ok' : 'wait'}" data-dot role="img" aria-label="${esc(pick(TSTATUS, st))}"></span>`;
  // The live progress: how many tasks are finished, and one moving line for the task being worked on right now
  function progHtml(d) {
    const n = d.tasks.length, fin = d.tasks.filter(t => t.status === 'review' || t.status === 'approved').length, bad = d.tasks.filter(t => t.status === 'blocked' || t.status === 'failed').length;
    const now = d.tasks.some(t => t.status === 'running');
    const live = ['approved', 'running'].includes(d.campaign.status);
    if (!live && !now) return '';
    return `<div class="cm-prog" role="status" aria-live="polite"><div class="cm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${fin}"><i style="width:${n ? Math.round((fin / n) * 100) : 0}%"></i></div>
      <b>${esc(L(`${fin} من ${n} مهام`, `${fin} of ${n} tasks`))}</b> <span class="cm-dots">${d.tasks.map(t => dot(t.status)).join('')}</span>${bad ? ` <span class="muted">${esc(L(`· ${bad} موقوفة`, `· ${bad} stopped`))}</span>` : ''}</div>`;
  }
  // While a step runs (it can take a while) the screen asks again every few seconds, so tasks move waiting -> running -> review by themselves
  const watch = (id, mine, root_) => {
    const tick = async () => {
      if (mine !== view) return;
      try {
        const d = await api('/api/campaigns/get?id=' + encodeURIComponent(id));
        if (mine !== view) return;
        const box = $('#cmProg', root_); if (box) box.innerHTML = progHtml(d);
        for (const t of d.tasks) { const el = root_.querySelector(`[data-st="${t.id}"]`); if (el) { el.textContent = pick(TSTATUS, t.status); el.dataset.s = t.status; const dl = el.closest('li')?.querySelector('[data-dot]'); if (dl) dl.outerHTML = dot(t.status); } }
        if (d.campaign.status !== 'running' && d.campaign.status !== 'approved') return;
      } catch { /* the next tick tries again */ }
      setTimeout(tick, 2500);
    };
    setTimeout(tick, 2500);
  };

  async function showCampaign(id, auto = false) {
    const mine = ++view;
    if (!auto) frame(`<p class="muted">${esc(L('يحمّل…', 'Loading…'))}</p>`);
    let d;
    try { d = await api('/api/campaigns/get?id=' + encodeURIComponent(id)); } catch (err) { frame(''); say(msg(), err.message); return showListLater(); }
    if (mine !== view) return;
    const c = d.campaign, b = c.brief || {}, planned = c.status === 'planned', started = ['approved', 'running', 'review', 'done'].includes(c.status);
    const live = c.status === 'approved' || c.status === 'running';
    const li = a => (a || []).map(x => `<li>${esc(x)}</li>`).join('');
    const outs = t => d.outputs.filter(o => o.task_id === t.id);
    const tasks = d.tasks.map(t => `<li>${dot(t.status)} <b>${esc(pick(AGENT, t.agent))}</b> · ${esc(t.title)}${t.spec?.detail && !started ? `<br><span class="muted">${esc(t.spec.detail)}</span>` : ''}
        <br><small class="muted"><span class="cm-st" data-st="${t.id}" data-s="${esc(t.status)}">${esc(pick(TSTATUS, t.status))}</span> · ${esc(sar(t.estimate_usd))}</small>
        ${t.blocked_reason ? `<p class="msg err">${esc(t.blocked_reason)}</p>` : ''}${outs(t).map(outputHtml).join('')}
        <div class="cm-actions">${t.status === 'review' && d.mayApprove ? `<button class="btn" data-ok="${t.id}" type="button">${esc(L('اعتمد هذا الناتج', 'Approve this output'))}</button>` : ''}
        ${(t.status === 'blocked' || t.status === 'failed') && d.mayApprove && (t.spec?.retries || 0) < 2 ? `<button class="btn" data-retry="${t.id}" type="button">${esc(L('أعد الكتابة وافحص من جديد', 'Rewrite and check again'))}</button>` : ''}</div></li>`).join('');
    const stalled = d.tasks.some(t => t.status === 'waiting') && !live;
    frame(`<button class="btn" id="cmBack" type="button">${esc(L('كل الحملات', 'All campaigns'))}</button>
      <h2 class="cm-h">${esc(c.title)}</h2><p class="muted">${esc(pick(STATUS, c.status))}</p>
      <div id="cmProg">${progHtml(d)}</div>
      <section><h3>${esc(L('ملخص الحملة', 'Campaign brief'))}</h3><p>${esc(b.summary)}</p>${b.audience ? `<p><b>${esc(L('الجمهور:', 'Audience:'))}</b> ${esc(b.audience)}</p>` : ''}
        ${(b.messages || []).length ? `<h4>${esc(L('الرسائل الرئيسية', 'Key messages'))}</h4><ul>${li(b.messages)}</ul>` : ''}${(b.risks || []).length ? `<h4>${esc(L('مخاطر وأسئلة مفتوحة', 'Risks and open questions'))}</h4><ul>${li(b.risks)}</ul>` : ''}</section>
      <section id="cmPack"><h3>${esc(started ? L('حزمة الحملة', 'Campaign pack') : L('الخطة: مين يسوي وش', 'The plan: who does what'))}</h3><ol class="cm-tasks">${tasks}</ol>
        ${started ? `<p class="muted">${esc(L('كل شي هنا مسودات ووثائق. المنشورات تنحفظ مسودة في السوشال وما تنشر إلا بعد اعتماد المعتمد هناك. ما يتغيّر أي حساب إعلاني.', 'Everything here is drafts and documents. Posts are saved as drafts in Social and only go out once its approver approves them there. No ad account is changed.'))}</p>` : ''}</section>
      <section class="cm-cost"><b>${esc(L('التكلفة المتوقعة قبل التشغيل:', 'Expected cost before running:'))} ${esc(sar(c.estimate_usd))}</b>
        <p class="muted">${esc(L('تقدير تقريبي حسب الموديل المختار. الصرف الفعلي يظهر في «الصرف على الذكاء الاصطناعي» ويلتزم بالسقف الشهري.', 'A rough estimate for the chosen model. Actual spend shows in AI spend and follows the monthly cap.'))}</p>
        ${d.capped ? `<p class="msg err">${esc(L('وصل السقف الشهري لاحلم: التنفيذ بيكون على الموديل المجاني أو يتوقف.', "Ahlam's monthly cap is reached: the run will use the free model or stop."))}</p>` : ''}</section>
      <div class="cm-actions">${planned && d.mayApprove ? `<button class="btn primary" id="cmOk" type="button">${esc(L('اعتمد الخطة والتكلفة', 'Approve the plan and cost'))}</button>` : ''}
        ${live ? `<button class="btn primary" id="cmRun" type="button"${auto ? ' disabled' : ''}>${esc(auto ? L('يشتغل…', 'Running…') : L('شغّل المهام', 'Run the tasks'))}</button>` : ''}
        ${started ? `<button class="btn" id="cmDl" type="button">${esc(L('نزّل الحزمة (Markdown)', 'Download the pack (Markdown)'))}</button><button class="btn" id="cmCp" type="button">${esc(L('انسخ الحزمة', 'Copy the pack'))}</button>` : ''}
        ${['planned', 'approved', 'running', 'review'].includes(c.status) ? `<button class="btn" id="cmNo" type="button">${esc(L('إلغاء الحملة', 'Cancel the campaign'))}</button>` : ''}</div>
      ${planned && !d.mayApprove ? `<p class="muted">${esc(L('الاعتماد لمن عنده صلاحية الموافقة. أرسل له الخطة.', 'Approval needs someone with approval rights. Send them the plan.'))}</p>` : ''}
      ${stalled ? `<p class="muted">${esc(L('بعض المهام تنتظر لأن مهمة قبلها موقوفة أو فاشلة. أعد كتابتها من زرها فوق.', 'Some tasks wait because an earlier one is blocked or failed. Rewrite it with its button above.'))}</p>` : ''}`);
    $('#cmBack', root).onclick = () => { view++; showList(); };
    const act = (el, path, body) => { if (el) el.onclick = async () => { el.disabled = true; try { await api(path, { method: 'POST', body: { id, ...body } }); showCampaign(id, path.endsWith('/approve') && !body); } catch (err) { say(msg(), err.message); el.disabled = false; } }; };
    act($('#cmOk', root), '/api/campaigns/approve'); act($('#cmNo', root), '/api/campaigns/cancel');
    root.querySelectorAll('[data-ok]').forEach(el => act(el, '/api/campaigns/review', { task: Number(el.dataset.ok) }));
    root.querySelectorAll('[data-retry]').forEach(el => act(el, '/api/campaigns/retry', { task: Number(el.dataset.retry) }));
    const dl = $('#cmDl', root), cp = $('#cmCp', root);
    if (dl) dl.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([packText(c, d)], { type: 'text/markdown' })); a.download = 'campaign-pack.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(packText(c, d)); say(msg(), L('اننسخت الحزمة', 'Pack copied')); } catch { say(msg(), L('ما قدرت أنسخ، استخدم التنزيل', 'Could not copy, use download')); } };
    // One task per call, then the screen refreshes: the run is visible step by step and stops by itself on a pause, a stall or the end
    const go = async () => {
      try {
        const r = await api('/api/campaigns/step', { method: 'POST', timeout: 180000, body: { id } });
        if (mine !== view) return;
        if (r.paused) { await showCampaign(id, false); return say(msg(), r.message); }
        if (r.busy) { setTimeout(() => mine === view && go(), 3000); return; }
        showCampaign(id, !r.done && r.more !== false);
      } catch (err) { if (mine === view) { await showCampaign(id, false); say(msg(), err.message); } }
    };
    const run = $('#cmRun', root);
    if (run) run.onclick = () => showCampaign(id, true);
    if (auto && live) { go(); watch(id, mine, root); }
    else if (c.status === 'running') { watch(id, mine, root); }   // another tab or person is running it: follow it without a reload
  }
  const showListLater = () => setTimeout(showList, 2500);
  const link = new URLSearchParams(location.search).get('c');
  if (link && /^[0-9a-f-]{36}$/i.test(link)) showCampaign(link); else showList();
}
