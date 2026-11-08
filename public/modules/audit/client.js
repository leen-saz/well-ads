// «تدقيق القرارات» (للمالكة): تعيد فحص حكم الحكم التسويقي من البيانات الخام. النصوص تجي من الخادم بالعربي والإنجليزي، وهنا نختار حسب لغة الصفحة.
import { $, api, say, esc, fmt, shell, failure, pageFailure, when } from '/assets/common.js';

const lang = () => { try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'en' || q === 'ar') return q; return localStorage.getItem('well-ads-lang') === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } };
const L = {
  ar: { title: 'تدقيق القرارات', back: '← المدير', note: 'قراءة فقط. بدون أسماء أو جوالات. التدقيق بالقواعد وما يحتاج مفتاح.', verdict: 'القرار اللي يعرضه الحكم', owner: 'المسؤول', none: 'لا مشكلة', period: 'الفترة', days: 'أيام',
    confirmed: 'القرار مؤكَّد', confirmedShort: 'مؤكَّد', weakenedShort: 'أضعف مما يبدو', contradictedShort: 'مناقَض', weakened: 'القرار أضعف مما يبدو', contradicted: 'القرار مناقَض', checks: 'فحص', findings: 'ملاحظات المدقق', nofind: 'ما لقينا شي يناقض القرار أو يضعفه.',
    settle: 'وش يحسمها: ', steps: 'كل خطوة', step: 'الخطوة', status: 'الحالة', notes: 'ملاحظات', bt: 'تجربة على التاريخ', btNote: 'أعدنا تشغيل الحكم على فترات سابقة من بياناتنا وهذي العدّادات (بدون أرقام).',
    windows: 'فترة مجرّبة', silent: 'سكوت غلط', wrong: 'حكم غلط', flips: 'تبدّل الخطوة', weak: 'أضعف مما يبدو', ok: 'مؤكّد', log: 'سجل الاختلافات', nolog: 'ما فيه اختلافات مسجّلة.', at: 'متى', check: 'الفحوص',
    critic: 'مراجعة Claude (مسودة)', ask: 'اطلب مراجعة Claude', asking: 'جاري المراجعة…', criticNote: 'مسودة تساعدك بس، مو هي اللي تحسم. تكلّف مال، وتتسجّل في صرف الذكاء الاصطناعي.', nokey: 'مراجعة Claude مطفية (ما فيه مفتاح).',
    overall: 'التقييم العام', all: 'الكل', skip: 'ما فيه أرقام للتدقيق بعد.' },
  en: { title: 'Verdict audit', back: '← Manager', note: 'Read only. No names or phone numbers. The audit uses rules and needs no key.', verdict: 'The verdict the judge shows', owner: 'Owner', none: 'No problem', period: 'Period', days: 'days',
    confirmed: 'Verdict confirmed', confirmedShort: 'Confirmed', weakenedShort: 'Weaker than it looks', contradictedShort: 'Contradicted', weakened: 'Verdict weaker than it looks', contradicted: 'Verdict contradicted', checks: 'checks', findings: 'Auditor findings', nofind: 'Nothing found that contradicts or weakens the verdict.',
    settle: 'What would settle it: ', steps: 'Each step', step: 'Step', status: 'Status', notes: 'Notes', bt: 'Back-test on history', btNote: 'We replayed the judge over past periods of our data. These are counts only (no figures).',
    windows: 'periods replayed', silent: 'wrongly silent', wrong: 'wrong verdict', flips: 'step changes', weak: 'weaker than it looks', ok: 'confirmed', log: 'Disagreement log', nolog: 'No disagreements logged.', at: 'When', check: 'Checks',
    critic: 'Claude review (draft)', ask: 'Ask Claude for a review', asking: 'Reviewing…', criticNote: 'A draft to help you, not the decision. It costs money and is recorded in AI spend.', nokey: 'Claude review is off (no key).',
    overall: 'Overall', all: 'All', skip: 'No numbers to audit yet.' },
};
const STEP = { click: ['نسبة النقر', 'Click rate'], lead: ['من نقرة إلى ليد', 'Click to lead'], sale: ['من ليد إلى إقفالة', 'Lead to closing'], cpl: ['تكلفة الليد', 'Cost per lead'], cpm: ['تكلفة الألف ظهور', 'Cost per 1,000 impressions'] };
const CRIT = { evidence: ['الدليل', 'Evidence'], alternatives: ['تفسيرات بديلة', 'Alternatives'], attribution: ['الربط بالإعلان', 'Attribution'], actionable: ['قابلية التنفيذ', 'Actionable'] };

const badge = (t, s, short) => `<span class="au-st ${s}">${esc(short ? t[s + 'Short'] : t[s])}</span>`;
const finds = (t, fs, i) => fs.length ? fs.map(f => `<div class="au-find ${f.effect}">${esc(f.text[i])}${f.needs ? `<small>${esc(t.settle)}${esc(f.needs[i])}</small>` : ''}</div>`).join('') : `<p class="au-find">${esc(t.nofind)}</p>`;

function draw(t, i, d, critic) {
  const v = d.verdict, h = d.headline[i === 'ar' ? 'ar' : 'en'], name = k => (STEP[k] || [k, k])[i === 'ar' ? 0 : 1];
  const kpi = (n, x) => `<div class="card au-kpi"><b>${fmt(n)}</b><span>${esc(x)}</span></div>`, b = d.backtest;
  const rows = Object.entries(d.steps).map(([k, s]) => `<tr><td>${esc(name(k))}</td><td>${badge(t, s.status, true)}</td><td>${s.findings.length ? s.findings.map(f => esc(f.text[i])).join('<br>') : '—'}</td></tr>`).join('');
  const log = d.log.length ? `<div class="au-tbl-wrap"><table class="au-tbl"><thead><tr><th>${esc(t.at)}</th><th>${esc(t.step)}</th><th>${esc(t.status)}</th><th>${esc(t.check)}</th></tr></thead><tbody>${d.log.map(x => `<tr><td>${esc(when(x.at))}</td><td>${esc(x.step ? name(x.step) : t.none)}</td><td>${x.status ? badge(t, x.status, true) : ''}</td><td dir="ltr" style="text-align:start">${esc((x.checks || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${esc(t.nolog)}</p>`;
  return `<section class="card pad au-sec"><div class="au-bar"><h2 style="margin:0">${esc(t.verdict)}</h2>${badge(t, d.status)}</div>
    <p style="margin:6px 0"><b>${esc(h.title)}</b>${h.owner ? ` · ${esc(t.owner)}: ${esc(h.owner)}` : ''}</p>
    <p class="muted" style="margin:0">${esc(t.period)}: <bdi dir="ltr">${esc(d.period.from)} → ${esc(d.period.to)}</bdi> · ${fmt(d.checked)} ${esc(t.checks)}</p>
    <h3>${esc(t.findings)}</h3>${finds(t, v.findings, i)}</section>
    <section class="card pad au-sec"><h2>${esc(t.steps)}</h2><div class="au-tbl-wrap"><table class="au-tbl"><thead><tr><th>${esc(t.step)}</th><th>${esc(t.status)}</th><th>${esc(t.notes)}</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="card pad au-sec"><h2>${esc(t.bt)}</h2><p class="muted" style="margin:0">${esc(t.btNote)}</p>
      <div class="au-kpis">${kpi(b.windows, t.windows)}${kpi(b.confirmed, t.ok)}${kpi(b.weakened, t.weak)}${kpi(b.silent, t.silent)}${kpi(b.wrong, t.wrong)}${kpi(b.flips, t.flips)}</div></section>
    <section class="card pad au-sec"><h2>${esc(t.log)}</h2>${log}</section>
    <section class="card pad au-sec"><h2>${esc(t.critic)}<span class="au-draft">${i === 'ar' ? 'مسودة' : 'DRAFT'}</span></h2><p class="muted" style="margin:0 0 8px">${esc(critic ? t.criticNote : t.nokey)}</p>
      ${critic ? `<button class="btn" id="auAsk" type="button">${esc(t.ask)}</button>` : ''}<div id="auCritic" role="status"></div></section>`;
}

export default async function mount() {
  const i = lang(), t = L[i];
  $('#auBack').textContent = t.back; $('#auNote').textContent = t.note; document.title = `${t.title} · Well`;
  shell({ active: 'maestro', title: t.title }).then(async () => {
    const box = $('#sections');
    try {
      const d = await api('/api/maestro/audit');
      if (!d.headline) { box.innerHTML = `<p class="muted">${esc(t.skip)}</p>`; return; }
      box.innerHTML = draw(t, i, d, d.critic);
      $('#auAsk')?.addEventListener('click', async e => {
        const btn = e.currentTarget, out = $('#auCritic');
        btn.disabled = true; out.textContent = t.asking;
        try {
          const c = await api('/api/maestro/critique', { method: 'POST', body: {} });
          out.innerHTML = `<p class="au-find"><b>${esc(t.overall)}: ${esc(String(c.overall))} / 5</b> ${esc(c.summary)}</p>` + c.scores.map(s => `<p class="au-find"><b>${esc(CRIT[s.criterion][i === 'ar' ? 0 : 1])}: ${s.score}/5</b><br>${esc(s.reason)}</p>`).join('');
        } catch (err) { out.textContent = ''; say($('#msg'), err.message); }
        btn.disabled = false;
      });
    } catch (err) { if (err.status === 404) box.innerHTML = `<p class="muted">${esc(t.skip)}</p>`; else failure(box, err, () => location.reload()); }
  }).catch(pageFailure);
}
