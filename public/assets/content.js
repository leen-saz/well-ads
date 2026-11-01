// إيجنت المحتوى و SEO/AEO: يحلل الموقع ويبني بلان، والماركتير يوافق على كل بند، ويكتب مسودة، وينشر (تصدير الحين).
import { $, api, say, esc, shell, busy, LANG } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  const KIND = { fix: 'تصليح', page: 'صفحة', article: 'مقال', faq: 'أسئلة شائعة' };
  const ST = { proposed: 'مقترح', approved: 'موافَق', done: 'انتشر', rejected: 'مرفوض' };
  let plans = [], cur = null, PUB = {};

  function stage(n) { document.querySelectorAll('.ct-flow li').forEach(li => li.classList.toggle('on', +li.dataset.s <= n)); }

  function drawPlan() {
    if (!cur) { $('#plan').innerHTML = '<p class="muted">حلّل موقع عشان يطلع البلان هنا.</p>'; stage(1); return; }
    const a = cur.analysis || {}, items = [...cur.items].sort((x, y) => x.priority - y.priority);
    stage(items.some(i => i.status === 'done') ? 5 : items.some(i => i.status === 'approved') ? 4 : 3);
    $('#plan').innerHTML = `<div class="bar" style="justify-content:space-between"><h2 style="margin:0">البلان · <span dir="ltr">${esc(cur.site.replace('https://', ''))}</span></h2>
        <span class="muted">${a.pages || 0} صفحة · ${(a.gsc || []).length ? 'Search Console مربوط' : 'Search Console مو مربوط'} · ${cur.engine === 'workers-ai' ? 'ذكاء اصطناعي + قواعد' : 'قواعد ثابتة'}</span></div>
      ${a.position ? `<p class="so-note ct-pos"><b>البوزشن:</b> ${esc(a.position)}${a.niche ? `<br><b>النيش:</b> ${esc(a.niche)}` : ''}</p>` : ''}
      <div style="display:grid;gap:10px">${items.map(it => `<article class="card ct-item ${it.status}" data-item="${esc(it.id)}">
        <div class="so-top"><span class="so-chip">${KIND[it.kind] || it.kind}</span><span class="so-chip">أولوية ${it.priority}</span><b>${esc(it.title)}</b><span class="so-st muted">${ST[it.status]}</span></div>
        ${it.why ? `<p class="muted" style="margin:0">${esc(it.why)}</p>` : ''}
        ${it.draft ? `<pre class="ct-draft" dir="auto">${esc(it.draft)}</pre>` : ''}
        <div class="bar">${it.status === 'proposed' ? '<button class="btn sm primary" data-act="approve">وافق</button><button class="btn sm ghost" data-act="reject">ارفض</button>' : ''}
          ${it.status === 'approved' && it.kind !== 'fix' ? `<button class="btn sm secondary" data-act="draft">${it.draft ? 'أعد كتابة المسودة' : 'اكتب مسودة'}</button>` : ''}
          ${it.status === 'approved' ? `<button class="btn sm secondary" data-copy>${esc(PUB.export?.name || 'تصدير')}</button><button class="btn sm ghost" data-act="done">تم النشر</button>
            ${Object.entries(PUB).filter(([k, p]) => k !== 'export' && !p.live).map(([, p]) => `<button class="btn sm ghost" disabled title="قريباً">${esc(p.name)} · قريباً</button>`).join('')}` : ''}</div>
      </article>`).join('')}</div>`;
  }

  function drawHistory() {
    $('#history').innerHTML = plans.map(p => `<button class="btn sm ${cur && p.id === cur.id ? 'secondary' : 'ghost'}" data-plan="${p.id}" style="margin:0 0 6px">${esc(p.site.replace('https://', ''))} · ${new Date(p.created_at).toLocaleDateString((LANG === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn'))}</button>`).join(' ') || '<p class="muted">ما فيه.</p>';
  }

  async function load(keep) {
    const r = await api('/api/content/plans');
    plans = r.plans; PUB = r.publish;
    cur = (keep && plans.find(p => p.id === keep)) || plans[0] || null;
    if (cur && !$('#site').value) { $('#site').value = cur.site; $('#niche').value = cur.niche || ''; $('#comp').value = (cur.competitors || []).join('\n'); }
    drawHistory(); drawPlan();
  }

  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true); say($('#msg'), 'يحلل الموقع… ياخذ دقيقة تقريباً', true); stage(2);
    try {
      const r = await api('/api/content/analyze', { method: 'POST', body: { site: $('#site').value, niche: $('#niche').value, competitors: $('#comp').value } });
      say($('#msg'), 'جاهز البلان.', true); await load(r.plan.id);
    } catch (err) { say($('#msg'), err.message); stage(1); }
    busy(btn, false);
  });

  $('#history').addEventListener('click', e => { const b = e.target.closest('[data-plan]'); if (b) { cur = plans.find(p => p.id == b.dataset.plan); drawHistory(); drawPlan(); } });
  $('#plan').addEventListener('click', async e => {
    const card = e.target.closest('[data-item]'); if (!card) return;
    const it = cur.items.find(x => x.id === card.dataset.item);
    if (e.target.closest('[data-copy]')) { await navigator.clipboard.writeText(`# ${it.title}\n\n${it.draft || it.why}`); say($('#msg'), 'انسخ.', true); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    busy(b, true);
    try { await api('/api/content/item', { method: 'PATCH', body: { plan: cur.id, item: it.id, action: b.dataset.act } }); await load(cur.id); }
    catch (err) { say($('#msg'), err.message); busy(b, false); }
  });

  shell({ active: 'content', title: 'المحتوى و SEO' }).then(() => load()).catch(err => say($('#msg'), err.message));
}
