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
    post: ['مسودة منشور', 'Post draft'], design_image: ['صورة التصميم', 'Design image'], voice_script: ['نص الفويس أوفر', 'Voiceover script'], voice_audio: ['تسجيل صوتي', 'Voice recording'], voice_srt: ['ترجمة SRT', 'SRT subtitles'], asset_missing: ['ملف ما انولّد', 'File not made'], compliance_report: ['تقرير الامتثال', 'Compliance report'], optimization: ['الميزانية والتحسين', 'Budget & optimization'], measurement: ['خطة القياس', 'Measurement plan'] };
  const KPI_EN = { ctr: 'Click rate', clickToLead: 'Click to lead', leadToClose: 'Lead to close', cpl: 'Cost per lead (max)', costShare: 'Cost of a close, share of its value (max)', roas: 'Return on spend', maturityDays: 'Lead age before judging its close' };
  const UNIT = { '%': '%', SAR: ['ر.س', 'SAR'], '×': '×', day: ['يوم', 'days'] };
  const PLAT = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', snapchat: 'Snapchat' };
  const packText = (c, d) => {
    const b = c.brief || {}, out = [`# ${c.title}`, '', b.summary || '', ''];
    if ((b.questions || []).length) out.push(`## ${L('أسئلة مفتوحة', 'Open questions')}`, ...b.questions.map(x => `- ${x.q} → ${x.answer ? L('الجواب: ', 'Answer: ') + x.answer : L('افتراض: ', 'Assumption: ') + x.assumption}`), '');
    for (const t of d.tasks) { out.push(`## ${pick(AGENT, t.agent)}: ${t.title}`, ''); for (const o of d.outputs.filter(x => x.task_id === t.id)) out.push(o.platform ? `**${PLAT[o.platform] || o.platform}**` : '', o.body?.key ? `[${o.body.text || o.kind}](${location.origin}/api/campaigns/file?id=${o.id}&dl=1)` : (o.body?.text || ''), ''); }
    return out.join('\n');
  };

  function outputHtml(o) {
    const k = KIND[o.kind] ? L(...KIND[o.kind]) : o.kind;
    // internal references (the knowledge summary, the budget document) are not ads: no findings are shown on them, whatever an older run stored
    const hits = ['insight', 'optimization', 'measurement'].includes(o.kind) ? [] : (o.compliance || []).filter(h => h.level !== 'info');
    const file = `/api/campaigns/file?id=${encodeURIComponent(o.id)}`;
    const dl = (url, name) => `<a class="btn" href="${esc(url)}" download="${esc(name)}">${esc(L('تنزيل', 'Download'))}</a>`;
    const body = o.kind === 'design_image'
      ? `<figure class="cm-fig"><img src="${file}" alt="${esc(o.body.text || '')}" loading="lazy" width="${esc(o.body.w || '')}" height="${esc(o.body.h || '')}"><figcaption>${esc(o.body.text || '')} · ${dl(file + '&dl=1', `design-${o.platform || 'image'}.jpg`)}</figcaption></figure>`
      : o.kind === 'voice_audio'
        ? `<div class="cm-aud"><audio controls preload="none" src="${file}"></audio><span class="muted">${esc(L(`نسخة ${o.body.label} ثانية · ${o.body.seconds} ث`, `${o.body.label}-second version · ${o.body.seconds}s`))}</span> ${dl(file + '&dl=1', `voiceover-${o.body.label}s.wav`)}</div><div class="cm-text">${render(o.body.text || '')}</div>`
        : o.kind === 'voice_srt'
          ? `<pre class="cm-srt" dir="auto">${esc(o.body.text || '')}</pre>${dl('data:text/plain;charset=utf-8,' + encodeURIComponent(o.body.text || ''), `subtitles-${o.body.label}s.srt`)}`
          : o.kind === 'asset_missing'
            ? `<p class="msg err">${esc(o.body.text || '')}</p>`
            : o.kind === 'voice_script' ? `<p class="muted">${esc(L(`نسخة ${o.body.label} ثانية`, `${o.body.label}-second version`))}</p><div class="cm-text">${render(o.body.text || '')}</div>${o.body.notes ? `<p class="muted">${esc(o.body.notes)}</p>` : ''}`
      : o.kind === 'measurement'
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
    if (!live && !now && !['review', 'done'].includes(d.campaign.status)) return '';   // a started campaign always shows its bar and dots
    return `<div class="cm-prog" role="status" aria-live="polite"><div class="cm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${fin}"><i style="width:${n ? Math.round((fin / n) * 100) : 0}%"></i></div>
      <b>${esc(L(`${fin} من ${n} مهام`, `${fin} of ${n} tasks`))}</b> <span class="cm-dots">${d.tasks.map(t => dot(t.status)).join('')}</span>${bad ? ` <span class="muted">${esc(L(`· ${bad} موقوفة`, `· ${bad} stopped`))}</span>` : ''}</div>`;
  }
  // ---- the campaign screen: built ONCE, then patched. Updates never redraw the page: only the nodes that changed are touched, so the
  // scroll position, the folded tasks, the focus and anything the user is typing stay where they are.
  const ATTN = ['running', 'blocked', 'failed'];   // a task opens by itself only while it works or has a problem
  const flat = s => String(s || '').replace(/[#*_`>|~-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const oneLine = (t, outs) => {
    const first = outs.find(o => o.kind !== 'measurement' && o.body?.text);
    return flat(t.blocked_reason || first?.body?.text || t.spec?.detail || '').slice(0, 110);
  };
  const store = id => {
    const k = 'cm-fold-' + id;
    return { get: () => { try { return JSON.parse(sessionStorage.getItem(k) || '{}') || {}; } catch { return {}; } },
      set: v => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: the folds last for the visit */ } } };
  };

  function taskBody(t, outs, d) {
    return `${t.blocked_reason ? `<p class="msg err">${esc(t.blocked_reason)}</p>` : ''}
      ${t.spec?.auto ? `<p class="muted cm-auto">${esc(t.status === 'blocked' ? L(`أعاد الإيجنت كتابتها تلقائياً ${t.spec.auto} من 2 بعد ملاحظات الامتثال وما نجحت: تحتاج قرارك.`, `The agent rewrote it automatically ${t.spec.auto} of 2 times after compliance feedback and it still failed: it needs your decision.`) : L(`أعاد الإيجنت كتابتها تلقائياً ${t.spec.auto} من 2 بحسب ملاحظات الامتثال.`, `The agent rewrote it automatically ${t.spec.auto} of 2 times following compliance feedback.`))}</p>` : ''}
      ${t.spec?.override ? `<p class="cm-ovr"><b>${esc(L('تجاوز بموافقة', 'Overridden with approval'))}</b> · ${esc(t.spec.override.by)} · ${esc(t.spec.override.reason)}</p>` : ''}
      ${t.spec?.detail && !outs.length ? `<p class="muted">${esc(t.spec.detail)}</p>` : ''}${outs.map(outputHtml).join('')}
      <div class="cm-actions">${t.status === 'blocked' && d.mayApprove ? `<button class="btn" data-ovr="${t.id}" type="button">${esc(L('اعتمد رغم الرفض', 'Approve despite the refusal'))}</button>` : ''}
        ${t.status === 'review' && d.mayApprove ? `<button class="btn" data-ok="${t.id}" type="button">${esc(L('اعتمد هذا الناتج', 'Approve this output'))}</button>` : ''}
        ${(t.spec?.missing || []).length && d.mayApprove && (t.status === 'review' || t.status === 'approved') ? `<button class="btn primary" data-assets="${t.id}" type="button">${esc(L('ولّد الملفات الناقصة', 'Make the missing files'))}</button>` : ''}
        ${(t.status === 'blocked' || t.status === 'failed') && d.mayApprove && (t.spec?.retries || 0) < 2 ? `<button class="btn" data-retry="${t.id}" type="button">${esc(L('أعد الكتابة وافحص من جديد', 'Rewrite and check again'))}</button>` : ''}</div>`;
  }
  function taskSummary(t, outs) {
    return `${dot(t.status)} <b>${esc(pick(AGENT, t.agent))}</b> · ${esc(t.title)}
      <small class="muted"><span class="cm-st" data-st="${t.id}" data-s="${esc(t.status)}">${esc(pick(TSTATUS, t.status))}</span> · ${esc(sar(t.estimate_usd))}${t.spec?.override ? ' · ' + esc(L('تجاوز بموافقة', 'Overridden')) : ''}</small>
      <span class="cm-one">${esc(oneLine(t, outs))}</span>`;
  }

  let cur = null;   // the screen on show: { id, mine, d, fold, folds, sig, seq, looping, timer }
  async function showCampaign(id, opts = {}) {
    const mine = ++view;
    if (cur?.timer) clearInterval(cur.timer);
    cur = null;
    frame(`<p class="muted">${esc(L('يحمّل…', 'Loading…'))}</p>`);
    let d;
    try { d = await api('/api/campaigns/get?id=' + encodeURIComponent(id)); } catch (err) { frame(''); say(msg(), err.message); return showListLater(); }
    if (mine !== view) return;
    build(id, mine, d);
    if (opts.run && cur.live) loop();
  }

  function build(id, mine, d) {
    const c = d.campaign, b = c.brief || {};
    const li = a => (a || []).map(x => `<li>${esc(x)}</li>`).join('');
    frame(`<button class="btn" id="cmBack" type="button">${esc(L('كل الحملات', 'All campaigns'))}</button>
      <h2 class="cm-h">${esc(c.title)}</h2><p class="muted" id="cmStatus"></p>
      <div id="cmProg"></div>
      <section><h3>${esc(L('ملخص الحملة', 'Campaign brief'))}</h3><p>${esc(b.summary)}</p>${b.audience ? `<p><b>${esc(L('الجمهور:', 'Audience:'))}</b> ${esc(b.audience)}</p>` : ''}
        ${(b.messages || []).length ? `<h4>${esc(L('الرسائل الرئيسية', 'Key messages'))}</h4><ul>${li(b.messages)}</ul>` : ''}${(b.risks || []).length ? `<h4>${esc(L('مخاطر وأسئلة مفتوحة', 'Risks and open questions'))}</h4><ul>${li(b.risks)}</ul>` : ''}</section>
      <section id="cmQs" hidden></section>
      <section class="cm-run" id="cmRunBox" hidden><div><b>${esc(L('الإيجنتس جاهزة للتشغيل', 'The agents are ready to run'))}</b><p class="muted" id="cmRunNote"></p></div>
        <button class="btn primary" id="cmRun" type="button"></button></section>
      <section id="cmPack"><div class="cm-packhead"><h3 id="cmPackH"></h3><span class="cm-tools"><button class="btn" id="cmAll" type="button">${esc(L('توسيع الكل', 'Expand all'))}</button><button class="btn" id="cmNone" type="button">${esc(L('طي الكل', 'Collapse all'))}</button></span></div>
        <ol class="cm-tasks" id="cmTasks"></ol><p class="muted" id="cmPackNote" hidden>${esc(L('كل شي هنا مسودات ووثائق. المنشورات تنحفظ مسودة في السوشال وما تنشر إلا بعد اعتماد المعتمد هناك. ما يتغيّر أي حساب إعلاني.', 'Everything here is drafts and documents. Posts are saved as drafts in Social and only go out once its approver approves them there. No ad account is changed.'))}</p></section>
      <section class="cm-cost"><b>${esc(L('التكلفة المتوقعة قبل التشغيل:', 'Expected cost before running:'))} ${esc(sar(c.estimate_usd))}</b>
        <p class="muted">${esc(L('تقدير تقريبي حسب الموديل المختار. الصرف الفعلي يظهر في «الصرف على الذكاء الاصطناعي» ويلتزم بالسقف الشهري.', 'A rough estimate for the chosen model. Actual spend shows in AI spend and follows the monthly cap.'))}</p>
        <p class="muted" id="cmAssets" hidden></p>
        <p class="msg err" id="cmCap" hidden>${esc(L('وصل السقف الشهري لاحلم: التنفيذ بيكون على الموديل المجاني أو يتوقف.', "Ahlam's monthly cap is reached: the run will use the free model or stop."))}</p></section>
      <div class="cm-actions"><button class="btn primary" id="cmOk" type="button" hidden>${esc(L('اعتمد الخطة والتكلفة', 'Approve the plan and cost'))}</button>
        <button class="btn" id="cmDl" type="button" hidden>${esc(L('نزّل الحزمة (Markdown)', 'Download the pack (Markdown)'))}</button><button class="btn" id="cmCp" type="button" hidden>${esc(L('انسخ الحزمة', 'Copy the pack'))}</button>
        <button class="btn" id="cmNo" type="button" hidden>${esc(L('إلغاء الحملة', 'Cancel the campaign'))}</button></div>
      <p class="muted" id="cmHint" hidden></p><p class="muted" id="cmStall" hidden>${esc(L('بعض المهام تنتظر لأن مهمة قبلها موقوفة أو فاشلة. أعد كتابتها من زرها فوق.', 'Some tasks wait because an earlier one is blocked or failed. Rewrite it with its button above.'))}</p>`);
    const folds = store(id);
    cur = { id, mine, d, folds, fold: folds.get(), sig: {}, prev: {}, set: {}, qsig: '', seq: 0, looping: false, live: false, timer: 0 };
    const R = root;
    $('#cmBack', R).onclick = () => { view++; if (cur?.timer) clearInterval(cur.timer); cur = null; showList(); };
    const call = async (path, body, after) => { try { await api(path, { method: 'POST', body: { id, ...body } }); window.dispatchEvent(new Event('wl-campaign-change')); await refresh(); if (after) after(); } catch (err) { say(msg(), err.message); return false; } return true; };
    $('#cmOk', R).onclick = async ev => { ev.target.disabled = true; if (await call('/api/campaigns/approve', {}, () => cur?.live && loop())) return; ev.target.disabled = false; };
    $('#cmNo', R).onclick = async ev => { ev.target.disabled = true; if (!(await call('/api/campaigns/cancel', {}))) ev.target.disabled = false; };
    $('#cmRun', R).onclick = () => loop();
    $('#cmDl', R).onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([packText(cur.d.campaign, cur.d)], { type: 'text/markdown' })); a.download = 'campaign-pack.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    $('#cmCp', R).onclick = async () => { try { await navigator.clipboard.writeText(packText(cur.d.campaign, cur.d)); say(msg(), L('اننسخت الحزمة', 'Pack copied')); } catch { say(msg(), L('ما قدرت أنسخ، استخدم التنزيل', 'Could not copy, use download')); } };
    // expand / collapse all: the user's choice, remembered for the visit
    const setAll = on => { for (const t of cur.d.tasks) { cur.fold[t.id] = on; const det = R.querySelector(`[data-tid="${t.id}"] details`); if (det) { cur.set[t.id] = on; det.open = on; } } folds.set(cur.fold); };
    $('#cmAll', R).onclick = () => setAll(true); $('#cmNone', R).onclick = () => setAll(false);
    // one listener for everything inside the task list and the questions: the nodes inside are replaced when their task changes
    $('#cmTasks', R).addEventListener('toggle', ev => {
      const det = ev.target, tid = Number(det.closest('[data-tid]')?.dataset.tid);
      if (!tid || cur.set[tid] === det.open) return;   // the page's own change, not the user's
      cur.fold[tid] = det.open; cur.set[tid] = det.open; folds.set(cur.fold);
    }, true);
    $('#cmTasks', R).addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      const ok = b.dataset.ok, retry = b.dataset.retry, ovr = b.dataset.ovr, again = b.dataset.assets;
      if (again) { b.disabled = true; call('/api/campaigns/assets', { task: Number(again) }, () => cur?.live && loop()); return; }
      if (ok) { b.disabled = true; call('/api/campaigns/review', { task: Number(ok) }); }
      else if (retry) { b.disabled = true; call('/api/campaigns/retry', { task: Number(retry) }); }
      else if (ovr) openOverride(b, Number(ovr));
      else if (b.dataset.x !== undefined) b.closest('.cm-ovf')?.remove();
    });
    $('#cmTasks', R).addEventListener('submit', async ev => {
      const f = ev.target.closest('.cm-ovf'); if (!f) return;
      ev.preventDefault();
      const reason = f.querySelector('textarea').value.trim(), tid = Number(f.dataset.task);
      if (reason.length < 5) return say(msg(), L('اكتب سبب التجاوز (جملة قصيرة على الأقل)', 'Write the reason (a short sentence at least)'));
      f.querySelector('[type=submit]').disabled = true;
      f.remove();   // the form goes; the task body is then patched with the override marked
      await call('/api/campaigns/override', { task: tid, reason });
    });
    $('#cmQs', R).addEventListener('click', async ev => {
      const b = ev.target.closest('[data-qs]'); if (!b) return;
      const i = Number(b.dataset.qs), text = R.querySelector(`[data-q="${i}"]`).value.trim();
      if (!text) return say(msg(), L('اكتب الجواب', 'Write the answer'));
      b.disabled = true;
      try { const r = await api('/api/campaigns/answer', { method: 'POST', body: { id, index: i, answer: text } }); window.dispatchEvent(new Event('wl-campaign-change')); R.querySelector(`[data-q="${i}"]`).defaultValue = text; await refresh(); if (r.regenerate > 0 && cur?.live) loop(); }
      catch (err) { say(msg(), err.message); } finally { b.disabled = false; }
    });
    patch(d);
    // one timer for the screen: while the campaign is running (here or elsewhere) it asks again and patches; it stops with the screen
    cur.timer = setInterval(() => { if (!cur || cur.mine !== view) return clearInterval(cur?.timer); if (cur.looping || ['running', 'approved'].includes(cur.d.campaign.status)) refresh(); }, 2500);
  }

  function openOverride(btn, tid) {
    const li = btn.closest('li');
    if (li.querySelector('.cm-ovf')) return;
    li.querySelector('.cm-body').insertAdjacentHTML('beforeend', `<form class="cm-ovf" data-task="${tid}"><p class="muted">${esc(L('الامتثال رفض هذي القطعة. التجاوز يتسجّل باسمك مع السبب، والمنشورات تبقى مسودات ما تنشر لين يعتمدها معتمد السوشال.', 'Compliance refused this piece. The override is logged under your name with the reason, and posts stay drafts that only go out once Social approves them.'))}</p>
      <label class="cm-f"><span>${esc(L('سبب التجاوز (إجباري)', 'Reason for the override (required)'))}</span><textarea rows="2" maxlength="300" required minlength="5"></textarea></label>
      <div class="cm-actions"><button class="btn primary" type="submit">${esc(L('تأكيد التجاوز', 'Confirm the override'))}</button><button class="btn" type="button" data-x>${esc(L('تراجع', 'Cancel'))}</button></div></form>`);
    li.querySelector('.cm-ovf textarea').focus();
  }

  // Ask the server and patch what changed. A late answer from an older request is dropped.
  async function refresh() {
    if (!cur) return;
    const { id, mine } = cur, seq = ++cur.seq;
    try {
      const d = await api('/api/campaigns/get?id=' + encodeURIComponent(id));
      if (!cur || mine !== view || cur.seq !== seq) return;
      patch(d);
    } catch { /* the next tick tries again */ }
  }

  // The patch: header, progress, questions, the run box, each task (its summary, and its body only when it changed), the buttons.
  function patch(d) {
    const R = root, c = d.campaign, b = c.brief || {};
    cur.d = d;
    const started = ['approved', 'running', 'review', 'done'].includes(c.status), planned = c.status === 'planned';
    cur.live = c.status === 'approved' || c.status === 'running' || (c.status === 'review' && !!c.approved_by && d.tasks.some(t => t.status === 'waiting'));
    const set = (sel, html) => { const el = $(sel, R); if (el && el.innerHTML !== html) el.innerHTML = html; };
    const show = (sel, on) => { const el = $(sel, R); if (el) el.hidden = !on; };
    set('#cmStatus', esc(pick(STATUS, c.status)));
    set('#cmProg', progHtml(d));
    set('#cmPackH', esc(started ? L('حزمة الحملة', 'Campaign pack') : L('الخطة: مين يسوي وش', 'The plan: who does what')));
    show('#cmPackNote', started); show('#cmCap', !!d.capped);
    const ap = d.assetPlan || {};
    show('#cmAssets', !!ap.images);
    set('#cmAssets', esc(L(`يشمل توليد ${ap.images} صور وملفين صوتيين (نحو ${sar(ap.usd)}): كل واحد يتولّد بعد ما يمر نصه على الامتثال، ويمر على سقف تاب التصميم والفويس أوفر.`, `Includes making ${ap.images} pictures and ${ap.audio} audio files (about ${sar(ap.usd)}): each is made only after its text passes compliance, and counts against the Design and Voiceover caps.`)));
    show('#cmOk', planned && d.mayApprove); show('#cmDl', started); show('#cmCp', started);
    show('#cmNo', ['planned', 'approved', 'running', 'review'].includes(c.status));
    const waitingN = d.tasks.filter(t => t.status === 'waiting').length;
    show('#cmRunBox', cur.live);
    const note = d.tasks.length ? L(`${waitingN} مهام تنتظر. التشغيل ما يحتاج اعتماد جديد، وكل شي مسودات.`, `${waitingN} tasks waiting. No new approval is needed, and everything is a draft.`) : L('ما فيه مهام محفوظة لهذي الحملة: بنجهّز الخطة القياسية أول ما تضغط، وبعدها يبدأ التنفيذ.', 'No tasks are saved for this campaign: the standard plan is prepared as soon as you press, and then the run starts.');
    set('#cmRunNote', esc(note));
    const run = $('#cmRun', R); run.disabled = cur.looping; const rl = cur.looping ? L('يشتغل…', 'Running…') : L('شغّل الإيجنتس', 'Run the agents'); if (run.textContent !== rl) run.textContent = rl;
    show('#cmHint', planned && !d.mayApprove); set('#cmHint', esc(L('الاعتماد لمن عنده صلاحية الموافقة. أرسل له الخطة.', 'Approval needs someone with approval rights. Send them the plan.')));
    show('#cmStall', d.tasks.some(t => t.status === 'waiting') && !cur.live && !d.tasks.some(t => t.status === 'running'));
    patchQuestions(b, started);
    patchTasks(d);
  }

  function patchQuestions(b, started) {
    const box = $('#cmQs', root), qs = b.questions || [];
    box.hidden = !qs.length;
    const sig = JSON.stringify(qs.map(x => [x.q, x.assumption, x.answer || '', x.affects || []])) + started;
    // never rewrite the questions while the user is typing in one of them
    const typing = [...box.querySelectorAll('textarea')].some(t => t === document.activeElement || t.value !== t.defaultValue);
    if (sig === cur.qsig || typing) return;
    cur.qsig = sig;
    box.innerHTML = `<h3>${esc(L('أسئلة مفتوحة', 'Open questions'))}</h3><p class="muted">${esc(L('الإيجنتس ما توقفوا عندها: أخذوا افتراضاً لكل سؤال وكمّلوا. عدّل الجواب وبنعيد كتابة الأجزاء المتأثرة بس.', 'The agents did not stop for them: they took an assumption for each question and went on. Edit an answer and only the affected parts are written again.'))}</p>
      <ul class="cm-qs">${qs.map((x, i) => `<li><b>${esc(x.q)}</b> <span class="cm-asm ${x.answer ? 'ans' : ''}">${esc(x.answer ? L('إجابتك', 'Your answer') : L('افتراض', 'Assumption'))}</span>
        <textarea data-q="${i}" rows="2" maxlength="400" aria-label="${esc(L('الجواب', 'Answer'))}">${esc(x.answer || x.assumption)}</textarea>
        <button class="btn" data-qs="${i}" type="button">${esc(started ? L('احفظ وأعد توليد الجزء المتأثر', 'Save and rewrite the affected part') : L('احفظ الجواب', 'Save the answer'))}</button>
        ${(x.affects || []).length ? `<small class="muted">${esc(L('يؤثر على:', 'Affects:'))} ${esc(x.affects.map(a => pick(AGENT, a)).join('، '))}</small>` : ''}</li>`).join('')}</ul>
      ${started ? `<p class="muted">${esc(L('المسودات اللي انحفظت قبل في السوشال تبقى هناك، والجديدة تنضاف جنبها.', 'Drafts already saved in Social stay there; the new ones are added beside them.'))}</p>` : ''}`;
  }

  function patchTasks(d) {
    const ol = $('#cmTasks', root);
    const ids = new Set(d.tasks.map(t => String(t.id)));
    [...ol.children].forEach(li => { if (!ids.has(li.dataset.tid)) li.remove(); });
    d.tasks.forEach((t, idx) => {
      const outs = d.outputs.filter(o => o.task_id === t.id);
      let li = ol.querySelector(`[data-tid="${t.id}"]`);
      if (!li) {
        li = document.createElement('li'); li.className = 'cm-task'; li.dataset.tid = String(t.id);
        li.innerHTML = '<details><summary class="cm-sum"></summary><div class="cm-body"></div></details>';
        ol.insertBefore(li, ol.children[idx] || null);
      } else if (ol.children[idx] !== li) ol.insertBefore(li, ol.children[idx] || null);
      const det = li.querySelector('details'), sum = li.querySelector('summary'), body = li.querySelector('.cm-body');
      const sh = taskSummary(t, outs); if (sum.innerHTML !== sh) sum.innerHTML = sh;
      // the body is rebuilt only when this task changed, and not while a form is open in it
      const sig = JSON.stringify([t.status, t.blocked_reason, t.spec?.override, t.spec?.auto, t.spec?.retries, t.spec?.missing, outs.map(o => [o.id, (o.body?.text || '').length]), d.mayApprove]);
      if (cur.sig[t.id] !== sig && !body.querySelector('.cm-ovf')) { body.innerHTML = taskBody(t, outs, d); cur.sig[t.id] = sig; }
      // fold: the user's own choice wins; otherwise it opens only while the task works or has a problem
      const was = cur.prev[t.id]; cur.prev[t.id] = t.status;
      if (was !== undefined && was !== t.status && ATTN.includes(t.status)) delete cur.fold[t.id];   // a new problem: open it again
      const want = t.id in cur.fold ? cur.fold[t.id] : ATTN.includes(t.status);
      if (det.open !== want) { cur.set[t.id] = want; det.open = want; } else cur.set[t.id] = want;
    });
    cur.folds.set(cur.fold);
  }

  // The run: one task per call, patched after each, until it ends, pauses or stalls. Nothing asks the user to press anything between tasks.
  async function loop() {
    if (!cur || cur.looping) return;
    const { id, mine } = cur;
    cur.looping = true; patch(cur.d);
    try {
      for (;;) {
        if (mine !== view) return;
        window.dispatchEvent(new Event('wl-campaign-change'));
        const r = await api('/api/campaigns/step', { method: 'POST', timeout: 180000, body: { id } });
        if (mine !== view) return;
        window.dispatchEvent(new Event('wl-campaign-change'));
        if (r.paused) { await refresh(); say(msg(), r.message); return; }
        if (r.busy) { await new Promise(res => setTimeout(res, 3000)); continue; }
        await refresh();
        if (r.done || r.more === false) return;
      }
    } catch (err) { if (mine === view) { await refresh(); say(msg(), err.message); } }
    finally { if (cur && cur.mine === mine) { cur.looping = false; patch(cur.d); } }
  }
  const showListLater = () => setTimeout(showList, 2500);
  const link = new URLSearchParams(location.search).get('c');
  if (link && /^[0-9a-f-]{36}$/i.test(link)) showCampaign(link); else showList();
}
