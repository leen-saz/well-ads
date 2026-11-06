// الكوبي رايتر: مشروع (إعداد + منافسين)، وبطاقة نمط لكل منافس من نصوصه، ونوع الطلب (المهارة) بمدخلاته، ونسخ مفحوصة.
import { $, $$, api, apiStream, liveText, say, esc, shell, busy } from '/assets/common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {
  let LIST = [], CUR = null, SK = null;
  const SKILLS = JSON.parse($('#skillsData')?.textContent || '[]');
  const DOCS = 'https://github.com/leen-saz/well-ads/blob/main/docs/copywriter-skills/';
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

  // ---- The skill: its form from its inputs, then its variants
  const fieldHTML = f => {
    const id = `in-${f.key}`, req = f.required ? '' : ' <span class="muted">(اختياري)</span>';
    const input = f.type === 'select' ? `<select id="${id}" data-in="${esc(f.key)}">${f.options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select>`
      : f.type === 'area' ? `<textarea id="${id}" data-in="${esc(f.key)}" rows="3" dir="auto" maxlength="${f.max || 200}" placeholder="${esc(f.placeholder || '')}"></textarea>`
      : `<input type="text" id="${id}" data-in="${esc(f.key)}" maxlength="${f.max || 200}" placeholder="${esc(f.placeholder || '')}">`;
    return `<div${f.type === 'area' ? ' style="grid-column:1/-1"' : ''}><label for="${id}">${esc(f.ar)}${f.type === 'select' && !f.required ? '' : req}</label>${input}</div>`;
  };
  function choose(key) {
    SK = SKILLS.find(k => k.key === key) || null;
    $$('[data-skill]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.skill === key)));
    $('#wf').hidden = !SK; $('#out').innerHTML = ''; $('#ask').hidden = true; $('#engine').textContent = '';
    if (!SK) return;
    $('#skTitle').textContent = SK.ar;
    $('#skDoc').href = DOCS + SK.doc;
    $('#skEx').textContent = `مثال: ${SK.example}`;
    $('#fields').innerHTML = SK.inputs.map(fieldHTML).join('');
    const [lo, hi] = SK.count;
    $('#count').innerHTML = Array.from({ length: hi }, (_, i) => i + 1).map(n => `<option${n === lo ? ' selected' : ''}>${n}</option>`).join('');
    $('#skChecks').innerHTML = SK.checks.map(c => `<li>${esc(c)}</li>`).join('');
    $('#wf').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#skills').addEventListener('click', e => { const b = e.target.closest('[data-skill]'); if (b) choose(b.dataset.skill); });
  $('#skBack').onclick = () => { choose(null); $('#skills').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };

  const flagHTML = d => [
    ...d.checks.filter(c => !c.ok && c.title !== 'الامتثال').map(c => `<div class="cw-flag">${esc(c.title)}: ${esc(c.detail)}</div>`),
    ...d.compliance.map(h => `<div class="cw-flag${h.level === 'critical' ? ' bad' : ''}">امتثال: ${esc(h.title)} «${esc(h.match)}». ${esc(h.fix)}</div>`),
    ...(d.over || []).map(o => `<div class="cw-flag">${esc(o.field)}${o.n ? ` ${o.n}` : ''}: ${o.len} حرف، والحد ${o.max}</div>`),
    ...(d.banned.length ? [`<div class="cw-flag bad">كلمات ممنوعة في المشروع: ${d.banned.map(esc).join('، ')}</div>`] : []),
  ].join('');
  const partHTML = (p, v) => {
    const val = v.parts[p.key];
    if (!val || (Array.isArray(val) && !val.length)) return '';
    return `<div class="t"><span class="muted">${esc(p.ar)}</span>\n${Array.isArray(val) ? `<ol>${val.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : esc(val)}</div>`;
  };
  const DIALECT = { saudi: 'سعودي', msa: 'فصحى', mixed: 'مخلوط' };
  $('#wf').addEventListener('submit', async e => {
    e.preventDefault(); if (!CUR || !SK) return;
    const b = e.submitter; busy(b, true); $('#out').innerHTML = ''; $('#engine').textContent = ''; $('#ask').hidden = true;
    $$('.cw-miss').forEach(x => x.classList.remove('cw-miss'));
    const inputs = Object.fromEntries($$('[data-in]').map(x => [x.dataset.in, x.value]));
    try {
      // the text shows as it is written, with a stop button; the reviewed cards replace it when the writing ends
      const ac = new AbortController(), live = $('#live'), stop = $('#stop');
      live.textContent = ''; live.hidden = false; $('#liveTag').hidden = false; stop.hidden = false; stop.onclick = () => ac.abort();
      let r;
      try { r = await apiStream('/api/copy/skill', { project_id: CUR.id, skill: SK.key, inputs, count: $('#count').value, competitors: $$('input[name="use"]:checked').map(x => x.value), stream: true }, { signal: ac.signal, onText: t => { live.textContent = liveText(t); } }); }
      finally { live.hidden = true; $('#liveTag').hidden = true; stop.hidden = true; }
      if (!r) say($('#wmsg'), 'وقّفت الكتابة');
      else if (r.ask) {
        $('#ask').innerHTML = `قبل ما أكتب، أحتاج أعرف:<ul>${r.ask.map(a => `<li>${esc(a.ask)}</li>`).join('')}</ul>`;
        $('#ask').hidden = false;
        r.ask.forEach(a => $(`#in-${a.key}`)?.classList.add('cw-miss'));
        $(`#in-${r.ask[0].key}`)?.focus();
      } else {
        $('#engine').textContent = [r.used.knowledge ? 'قرا معرفة الشركة' : 'ما فيه معرفة للحين', r.used.competitors.length ? `نمط ${r.used.competitors.join('، ')}` : '', r.used.hooks.length ? 'افتتاحياتنا اللي نجحت' : ''].filter(Boolean).join(' · ');
        $('#out').innerHTML = r.variants.map((v, i) => `<article class="card cw-d">
            ${v.angle ? `<div class="meta"><span class="chip line">${esc(v.angle)}</span></div>` : ''}
            ${r.parts.map(p => partHTML(p, v)).join('')}
            ${v.why ? `<p class="cw-why">${esc(v.why)}</p>` : ''}
            <div class="meta"><span class="cw-score">${v.score}/100</span><span class="muted">${DIALECT[v.dialect] || 'محايد'}</span>
              <span style="margin-inline-start:auto;display:flex;gap:6px;align-items:center"><button class="btn sm ghost" type="button" data-star="${i}" aria-pressed="false" aria-label="حط في المكتبة بنجمة" title="نجمة: احفظ في المكتبة وحطه في المفضلة">☆</button>
              <button class="btn sm secondary" type="button" data-save="${i}">احفظ في المكتبة</button>
              <button class="btn sm secondary" type="button" data-copy="${i}">انسخ</button></span></div>
            ${flagHTML(v)}</article>`).join('');
        // Save to the shared library (the server checks the text against the compliance rules and keeps the result); the star saves and favourites
        const saved = {};
        const keep = async (i, star, btn) => {
          const v = r.variants[i], inp = Object.fromEntries($$('[data-in]').map(x => [x.dataset.in, x.value]));
          busy(btn, true);
          try {
            if (saved[i]) saved[i] = { ...saved[i], starred: (await api('/api/library/star', { method: 'POST', body: { id: saved[i].id, on: star ? !saved[i].starred : saved[i].starred } })).starred };
            else { const o = await api('/api/library', { method: 'POST', body: { module: 'copy', kind: 'text', title: [SK.ar, v.angle].filter(Boolean).join(' · ') + ' · ' + CUR.name, content: v.text, platform: inp.platform || '', service: CUR.service || '', star } }); saved[i] = { id: o.item.id, starred: o.item.starred }; }
            const card = btn.closest('.cw-d'), st = $('[data-star]', card), sv = $('[data-save]', card);
            st.textContent = saved[i].starred ? '★' : '☆'; st.setAttribute('aria-pressed', String(saved[i].starred));
            sv.innerHTML = 'انحفظت ✓ <a href="/library/">افتح المكتبة</a>'; sv.disabled = true;
          } catch (err) { say($('#wmsg'), err.message); }
          busy(btn, false);
          if (saved[i]) $('[data-save]', btn.closest('.cw-d')).disabled = true;
        };
        $$('[data-save]', $('#out')).forEach(x => x.onclick = () => keep(x.dataset.save, false, x));
        $$('[data-star]', $('#out')).forEach(x => x.onclick = () => keep(x.dataset.star, true, x));
        $$('[data-copy]', $('#out')).forEach(x => x.onclick = async () => { try { await navigator.clipboard.writeText(r.variants[x.dataset.copy].text); x.textContent = 'انسخ ✓'; } catch { x.textContent = 'ما قدرت أنسخ'; } });
      }
    } catch (err) { say($('#wmsg'), err.message); }
    busy(b, false);
  });

  shell({ active: 'copy', title: 'الكوبي رايتر' }).then(() => load()).catch(err => say($('#pmsg'), err.message));
}
