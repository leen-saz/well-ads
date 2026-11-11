// احلم ← «حملة جديدة»: تكتب أمنياتك للحملة بكلام عادي، واحلم يحوّلها لخطة ومهام لإيجنتس التطبيق.
// التكلفة المتوقعة تطلع قبل ما يشتغل أي شي، والاعتماد لمن عنده صلاحية الموافقة. ما فيه نشر ولا صرف ولا تعديل على حسابات الإعلانات.
import { $, esc, api, say } from './common.js';

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

  async function showCampaign(id) {
    frame(`<p class="muted">${esc(L('يحمّل…', 'Loading…'))}</p>`);
    let d;
    try { d = await api('/api/campaigns/get?id=' + encodeURIComponent(id)); } catch (err) { frame(''); say(msg(), err.message); return showListLater(); }
    const c = d.campaign, b = c.brief || {}, planned = c.status === 'planned';
    const li = a => (a || []).map(x => `<li>${esc(x)}</li>`).join('');
    frame(`<button class="btn" id="cmBack" type="button">${esc(L('كل الحملات', 'All campaigns'))}</button>
      <h2 class="cm-h">${esc(c.title)}</h2><p class="muted">${esc(pick(STATUS, c.status))}</p>
      <section><h3>${esc(L('ملخص الحملة', 'Campaign brief'))}</h3><p>${esc(b.summary)}</p>${b.audience ? `<p><b>${esc(L('الجمهور:', 'Audience:'))}</b> ${esc(b.audience)}</p>` : ''}
        ${(b.messages || []).length ? `<h4>${esc(L('الرسائل الرئيسية', 'Key messages'))}</h4><ul>${li(b.messages)}</ul>` : ''}${(b.risks || []).length ? `<h4>${esc(L('مخاطر وأسئلة مفتوحة', 'Risks and open questions'))}</h4><ul>${li(b.risks)}</ul>` : ''}</section>
      <section><h3>${esc(L('الخطة: مين يسوي وش', 'The plan: who does what'))}</h3><ol class="cm-tasks">${d.tasks.map(t => `<li><b>${esc(pick(AGENT, t.agent))}</b> · ${esc(t.title)}${t.spec?.detail ? `<br><span class="muted">${esc(t.spec.detail)}</span>` : ''}
        <br><small class="muted">${esc(pick(TSTATUS, t.status))} · ${esc(sar(t.estimate_usd))}</small></li>`).join('')}</ol></section>
      <section class="cm-cost"><b>${esc(L('التكلفة المتوقعة قبل التشغيل:', 'Expected cost before running:'))} ${esc(sar(c.estimate_usd))}</b>
        <p class="muted">${esc(L('تقدير تقريبي حسب الموديل المختار. الصرف الفعلي يظهر في «الصرف على الذكاء الاصطناعي» ويلتزم بالسقف الشهري.', 'A rough estimate for the chosen model. Actual spend shows in AI spend and follows the monthly cap.'))}</p>
        ${d.capped ? `<p class="msg err">${esc(L('وصل السقف الشهري لاحلم: التنفيذ بيكون على الموديل المجاني أو يتوقف.', "Ahlam's monthly cap is reached: the run will use the free model or stop."))}</p>` : ''}</section>
      <div class="cm-actions">${planned && d.mayApprove ? `<button class="btn primary" id="cmOk" type="button">${esc(L('اعتمد الخطة والتكلفة', 'Approve the plan and cost'))}</button>` : ''}
        ${['planned', 'approved', 'running', 'review'].includes(c.status) ? `<button class="btn" id="cmNo" type="button">${esc(L('إلغاء الحملة', 'Cancel the campaign'))}</button>` : ''}</div>
      ${planned && !d.mayApprove ? `<p class="muted">${esc(L('الاعتماد لمن عنده صلاحية الموافقة. أرسل له الخطة.', 'Approval needs someone with approval rights. Send them the plan.'))}</p>` : ''}
      ${c.status === 'approved' ? `<p class="muted">${esc(L(`اعتمدها ${c.approved_by}. تنفيذ المهام وحزمة الحملة تجي في الخطوة الجاية، ولا يُنشر ولا يُصرف شي قبلها.`, `Approved by ${c.approved_by}. Running the tasks and the campaign pack come in the next step; nothing is published or spent before.`))}</p>` : ''}`);
    $('#cmBack', root).onclick = showList;
    const act = (sel, path, ok) => { const el = $(sel, root); if (el) el.onclick = async () => { el.disabled = true; try { await api(path, { method: 'POST', body: { id } }); showCampaign(id); } catch (err) { say(msg(), err.message); el.disabled = false; } }; };
    act('#cmOk', '/api/campaigns/approve'); act('#cmNo', '/api/campaigns/cancel');
  }
  const showListLater = () => setTimeout(showList, 2500);
  showList();
}
