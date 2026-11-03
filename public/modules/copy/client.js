// الكوبي رايتر: مشروع (إعداد + منافسين)، وبطاقة نمط لكل منافس من نصوصه، وكتابة نسخ مفحوصة.
import { $, $$, api, say, esc, shell, busy } from '/assets/common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {
  let LIST = [], CUR = null;
  const FIELDS = ['name', 'service', 'audience', 'offer', 'cta', 'voice'];
  const PLAT = { facebook: 'فيسبوك', instagram: 'انستقرام', tiktok: 'تيك توك', x: 'X', snapchat: 'سناب', linkedin: 'لينكدإن', web: 'موقع' };

  const cardHTML = c => !c ? '<p class="cw-note">ما فيه نصوص للحين: ألصق نصوصهم عشان يطلع نمطهم.</p>' : `
    <div class="cw-card">
      <div><b>${c.samples}</b><span>نص</span></div><div><b>${c.avgWords}</b><span>كلمة بالنص</span></div>
      <div><b>${c.avgSentence}</b><span>كلمة بالجملة</span></div><div><b>${c.questions}%</b><span>يبدأ أو فيه سؤال</span></div>
      <div><b>${c.emojiPer}</b><span>إيموجي بالنص</span></div><div><b>${c.numbers}%</b><span>فيه رقم أو سعر</span></div>
    </div>
    ${c.openers.length ? `<div class="cw-tags"><span class="muted" style="background:none;padding:0">افتتاحياتهم:</span>${c.openers.map(o => `<span>${esc(o.text)}${o.n > 1 ? ` ×${o.n}` : ''}</span>`).join('')}</div>` : ''}
    ${c.dialect.length ? `<div class="cw-tags"><span class="muted" style="background:none;padding:0">كلماتهم السعودية:</span>${c.dialect.map(d => `<span>${esc(d.word)} ×${d.n}</span>`).join('')}</div>` : ''}
    ${c.ctas.length ? `<div class="cw-tags"><span class="muted" style="background:none;padding:0">دعوتهم:</span>${c.ctas.map(d => `<span>${esc(d.word)} ×${d.n}</span>`).join('')}</div>` : ''}`;

  function fill() {
    $('#pick').innerHTML = `<option value="">+ مشروع جديد</option>${LIST.map(p => `<option value="${p.id}"${CUR && p.id === CUR.id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}`;
    for (const k of FIELDS) $('#' + k).value = CUR?.[k] || '';
    $('#banned').value = (CUR?.banned || []).join('، ');
    $('#save').textContent = CUR ? 'احفظ التعديل' : 'احفظ المشروع';
    $('#cf').hidden = !CUR;
    const comps = CUR?.competitors || [];
    $('#comps').innerHTML = !CUR ? '<p class="cw-note">احفظ المشروع أول، وبعدها أضف منافسينك.</p>' : comps.length ? comps.map(c => `<article class="cw-c" data-id="${esc(c.id)}">
        <header><b>${esc(c.name)}</b>${c.platform ? `<span class="chip line">${esc(PLAT[c.platform] || c.platform)}</span>` : ''}${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.url)}</a>` : ''}
          <button class="btn sm ghost" type="button" data-del="${esc(c.id)}">شيل</button></header>
        ${cardHTML(c.card)}</article>`).join('') : '<p class="cw-note">ما فيه منافسين للحين.</p>';
    const usable = comps.filter(c => c.card);
    $('#usec').innerHTML = usable.length ? usable.map(c => `<label><input type="checkbox" name="use" value="${esc(c.id)}" checked> ${esc(c.name)}</label>`).join('') : '<span class="muted">أضف منافس بنصوصه أول.</span>';
    $('#go').disabled = !CUR;
  }

  async function load(keep) {
    const r = await api('/api/copy/projects');
    LIST = r.projects;
    CUR = LIST.find(p => p.id === keep) || (keep === undefined ? LIST[0] : null) || null;
    fill();
  }

  // What the server stores for a competitor (its style card is counted on read)
  const bare = c => ({ id: c.id, name: c.name, url: c.url, samples: c.samples });
  const body = () => ({ ...Object.fromEntries(FIELDS.map(k => [k, $('#' + k).value])), banned: $('#banned').value.split(/[,،]/).map(x => x.trim()).filter(Boolean) });
  async function saveProject(extra = {}) {
    const r = CUR ? await api('/api/copy/projects', { method: 'PATCH', body: { id: CUR.id, ...body(), ...extra } })
      : await api('/api/copy/projects', { method: 'POST', body: { ...body(), ...extra } });
    await load(r.project.id);
  }

  $('#pick').onchange = () => { const id = Number($('#pick').value); CUR = LIST.find(p => p.id === id) || null; fill(); $('#out').innerHTML = ''; };
  $('#pf').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true);
    try { await saveProject(); say($('#pmsg'), 'انحفظ.', true); } catch (err) { say($('#pmsg'), err.message); }
    busy(b, false);
  });
  $('#cf').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true);
    const samples = $('#csamples').value.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
    const add = { name: $('#cname').value, url: $('#curl').value, samples };
    try {
      if (!add.name.trim() && !add.url.trim()) throw new Error('اكتب اسم المنافس أو رابطه');
      await saveProject({ competitors: [...(CUR.competitors || []).map(bare), add] });
      $('#cname').value = ''; $('#curl').value = ''; $('#csamples').value = ''; say($('#cmsg'), 'انضاف.', true);
    } catch (err) { say($('#cmsg'), err.message); }
    busy(b, false);
  });
  $('#comps').addEventListener('click', async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    busy(b, true);
    try { await saveProject({ competitors: CUR.competitors.filter(c => c.id !== b.dataset.del).map(bare) }); }
    catch (err) { say($('#cmsg'), err.message); busy(b, false); }
  });

  const flagHTML = d => [
    ...d.checks.filter(c => !c.ok && c.title !== 'الامتثال').map(c => `<div class="cw-flag">${esc(c.title)}: ${esc(c.detail)}</div>`),
    ...d.compliance.map(h => `<div class="cw-flag${h.level === 'critical' ? ' bad' : ''}">امتثال: ${esc(h.title)} «${esc(h.match)}». ${esc(h.fix)}</div>`),
    ...(d.banned.length ? [`<div class="cw-flag bad">كلمات ممنوعة في المشروع: ${d.banned.map(esc).join('، ')}</div>`] : []),
  ].join('');
  $('#wf').addEventListener('submit', async e => {
    e.preventDefault(); if (!CUR) return;
    const b = e.submitter; busy(b, true); $('#out').innerHTML = ''; $('#engine').textContent = '';
    try {
      const r = await api('/api/copy/write', { method: 'POST', body: { project_id: CUR.id, kind: $('#kind').value, count: $('#count').value, competitors: $$('input[name="use"]:checked').map(x => x.value) } });
      $('#engine').textContent = r.engine === 'templates' ? 'قوالب ثابتة (الذكاء الاصطناعي مو متصل)' : `${{ openai: 'ChatGPT', xai: 'Grok' }[r.engine] || 'الذكاء الاصطناعي المجاني'}${r.used.competitors.length ? ` · نمط ${r.used.competitors.join('، ')}` : ''}`;
      $('#out').innerHTML = r.drafts.map((d, i) => `<article class="card cw-d">
          <p class="t">${d.hook ? `<b>${esc(d.hook)}</b>` : ''}${esc(d.body)}${d.cta ? `\n${esc(d.cta)}` : ''}</p>
          <div class="meta"><span class="cw-score">${d.score}/100</span><span class="muted">${d.dialect === 'saudi' ? 'سعودي' : d.dialect === 'msa' ? 'فصحى' : d.dialect === 'mixed' ? 'مخلوط' : 'محايد'}</span>
            <button class="btn sm secondary" type="button" data-copy="${i}" style="margin-inline-start:auto">انسخ</button></div>
          ${flagHTML(d)}</article>`).join('');
      $$('[data-copy]', $('#out')).forEach(x => x.onclick = async () => { try { await navigator.clipboard.writeText(r.drafts[x.dataset.copy].text); x.textContent = 'انسخ ✓'; } catch { x.textContent = 'ما قدرت أنسخ'; } });
    } catch (err) { say($('#wmsg'), err.message); }
    busy(b, false);
  });

  shell({ active: 'copy', title: 'الكوبي رايتر' }).then(() => load()).catch(err => say($('#pmsg'), err.message));
}
