// «قواعد الإدارة»: قواعد الميديا باير للمالكة. استيراد (ملف أو نص) مع معاينة من نفس تحقق السيرفر، تصدير، وتعديل الحدود والقرار المفتوح
// لكل قاعدة. كلها تنحفظ عبر POST /api/buyer/rules في قاعدة البيانات، والملف ما يدخل الريبو. ما يمس أي حملة.
import { $, api, say, esc, fmt, busy } from '/assets/common.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const KINDS = { scale: 'رفع ميزانية', stop_idle: 'إيقاف بلا نتائج', resume: 'تشغيل', reduce: 'تقليل', replace_creative: 'مادة جديدة', alert_stalled: 'تنبيه توقف الصرف' };
const OWNER = { media_buyer: 'المشتري الإعلامي', video_agent: 'إيجنت الفيديو الإعلاني', production: 'الإنتاج', landing: 'صفحة الهبوط' };
const LIMIT = r => [r.maxCpl != null && `تكلفة الليد ≤ ${r.maxCpl}`, r.minCtr != null && `النقر ≥ ${r.minCtr}%`, r.stepPct != null && `خطوة ${r.stepPct}%`, r.everyDays != null && `كل ${r.everyDays} أيام`, r.minIdleDays != null && `${r.minIdleDays} يوم`].filter(Boolean).join('، ') || '—';
// The limits each kind of rule reads (TikTok is judged by click rate, so its «resume» reads minCtr)
const FIELDS = r => ({ scale: ['maxCpl', 'stepPct', 'everyDays', 'minResults'], resume: [r.platform === 'tiktok' ? 'minCtr' : 'maxCpl'], stop_idle: ['minIdleDays'], replace_creative: ['minCtr'] }[r.kind] || []);
const LABEL = { maxCpl: 'أقصى تكلفة ليد', minCtr: 'أقل نسبة نقر %', stepPct: 'خطوة الرفع %', everyDays: 'كل كم يوم', minResults: 'أقل عدد نتائج', minIdleDays: 'أيام بلا نتائج' };

export async function mountRules() {
  let cur;
  try { cur = await api('/api/buyer/rules'); } catch { return; }          // not the owner: the section stays hidden
  const box = $('#by-rulesBox'); if (!box) return;
  box.hidden = false;
  let rules = cur.rules || [];
  const msg = $('#by-rulesMsg');
  const info = () => { $('#by-rulesInfo').textContent = rules.length ? `القواعد المحفوظة: ${rules.length}، ومنها ${rules.filter(r => r.open).length} مفتوحة تنتظر قرار لين.` : 'ما فيه قواعد محفوظة بعد. استورد ملف القواعد.'; };
  const edit = () => {
    $('#by-rulesEdit').innerHTML = rules.length ? `<div class="tbl"><table class="by-edit"><thead><tr><th>القاعدة</th><th>تطابق</th><th>الحدود</th><th>ينفّذ</th><th>قرار مفتوح</th><th></th></tr></thead><tbody>`
      + rules.map((r, i) => `<tr data-i="${i}"><td><b>${esc(r.id)}</b><br><small>${esc(PLAT[r.platform] || r.platform)} · ${esc(KINDS[r.kind] || r.kind)}</small></td>
        <td><input data-f="match" value="${esc(r.match.join('، '))}" aria-label="تطابق"></td>
        <td><div class="by-lim">${FIELDS(r).map(f => `<label><span>${esc(LABEL[f])}</span><input type="number" step="any" min="0" data-f="${f}" value="${r[f] ?? ''}"></label>`).join('') || '<span class="muted">—</span>'}</div></td>
        <td><select data-f="owner">${Object.entries(OWNER).map(([k, v]) => `<option value="${k}"${(r.owner || 'media_buyer') === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
        <td><input data-f="open" value="${esc(r.open || '')}" placeholder="فاضي = محسوم" aria-label="قرار مفتوح"></td>
        <td><button class="btn sm secondary" type="button" data-del="${i}">احذف</button></td></tr>`).join('') + '</tbody></table></div>'
      : '<p class="muted">ما فيه قواعد للتعديل.</p>';
  };
  info(); edit();
  // Read the edited table back into the rules (the server validates everything again on save)
  const collect = () => rules.map((r, i) => {
    const row = $(`#by-rulesEdit tr[data-i="${i}"]`); if (!row) return r;
    const o = { ...r }, val = f => row.querySelector(`[data-f="${f}"]`)?.value ?? '';
    o.match = val('match').split(/[،,]/).map(s => s.trim()).filter(Boolean);
    for (const f of FIELDS(r)) { const v = val(f).trim(); if (v === '') delete o[f]; else o[f] = Number(v); }
    o.owner = val('owner') || 'media_buyer';
    const op = val('open').trim(); if (op) o.open = op; else delete o.open;
    return o;
  });
  const save = async (list, btn, ok) => {
    busy(btn, true);
    try { await api('/api/buyer/rules', { method: 'POST', body: { rules: list } }); rules = list; info(); edit(); say(msg, ok, true); $('#by-refresh')?.click(); }
    catch (err) { say(msg, err.message); }
    busy(btn, false);
  };
  $('#by-rulesSaveEdit').addEventListener('click', e => save(collect(), e.currentTarget, 'انحفظت التعديلات. التوصيات تتحدّث.'));
  $('#by-rulesEdit').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    const list = collect(), i = +b.dataset.del;
    if (!confirm(`حذف القاعدة ${list[i]?.id}؟ ما تنحذف إلا لما تضغط «احفظ التعديلات».`)) return;
    rules = list.filter((_, j) => j !== i); info(); edit();
  });
  $('#by-rulesImport').addEventListener('click', () => { $('#by-rulesForm').hidden = !$('#by-rulesForm').hidden; });
  $('#by-rulesExport').addEventListener('click', async () => {
    const r = await api('/api/buyer/rules');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ rules: r.rules || [] }, null, 1)], { type: 'application/json' }));
    a.download = 'buyer-rules.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#by-rulesFile').addEventListener('change', async e => { const f = e.target.files?.[0]; if (f) $('#by-rulesText').value = await f.text(); });
  $('#by-rulesPreview').addEventListener('click', async e => {
    const btn = e.currentTarget, out = $('#by-rulesPrev'); busy(btn, true);
    try {
      let body; try { body = JSON.parse($('#by-rulesText').value); } catch { throw new Error('النص مو JSON صحيح'); }
      const r = await api('/api/buyer/rules', { method: 'POST', body: { rules: Array.isArray(body) ? body : body.rules, dry: true } });
      out.innerHTML = `<p><b>${fmt(r.rules.length)}</b> قاعدة سليمة، ومنها <b>${fmt(r.rules.filter(x => x.open).length)}</b> مفتوحة.</p>
        <div class="tbl"><table class="by-prev"><thead><tr><th>الاسم</th><th>المنصة</th><th>النوع</th><th>تطابق</th><th>الحدود</th><th>ينفّذ</th><th>مفتوح</th></tr></thead><tbody>`
        + r.rules.map(x => `<tr><td>${esc(x.id)}</td><td>${esc(PLAT[x.platform] || x.platform)}</td><td>${esc(KINDS[x.kind] || x.kind)}</td><td>${esc(x.match.join('، '))}</td><td>${esc(LIMIT(x))}</td><td>${esc(OWNER[x.owner || 'media_buyer'] || '')}</td><td>${x.open ? `<span class="by-tag by-open">مفتوح: يحتاج قرار لين</span> ${esc(x.open)}` : ''}</td></tr>`).join('')
        + `</tbody></table></div><div class="bar" style="margin:10px 0 0"><button class="btn sm" type="button" id="by-rulesSave">أكّد واحفظ</button></div>`;
      $('#by-rulesSave').addEventListener('click', async ev => { await save(r.rules, ev.currentTarget, 'انحفظت القواعد. التوصيات تتحدّث.'); out.innerHTML = ''; $('#by-rulesText').value = ''; });
    } catch (err) { out.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    busy(btn, false);
  });
}
