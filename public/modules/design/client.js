// التصميم: بريف من أفضل إعلاناتنا، نصوص مقترحة مفحوصة على قواعد الامتثال، ومعاينة لكل مقاس.
// النص دايم طبقة فوق الصورة: الصورة ما تنرفع للسيرفر، والرسم كله في المتصفح، والتحميل PNG.
import { $, $$, api, say, esc, shell, busy, fmt } from '/assets/common.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const LEVEL = { critical: 'مخالفة', warn: 'انتبه', info: 'ملاحظة' };
const C = { ink: '#1D1069', accent: '#7E57FD', white: '#FFFFFF' };

let fontReady = null;
const font = () => (fontReady ||= Promise.all([
  new FontFace('ThmanyahDesign', 'url(/assets/fonts/thmanyahsans-Bold.woff2)', { weight: '700' }).load(),
  new FontFace('ThmanyahDesign', 'url(/assets/fonts/thmanyahsans-Regular.woff2)', { weight: '400' }).load(),
]).then(fs => fs.forEach(f => document.fonts.add(f))).catch(() => {}));

function lines(ctx, text, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean), out = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}

// Photo (cover) → soft brand gradient at the bottom → headline, sub, CTA pill. All on a canvas, nothing uploaded.
export function draw(canvas, size, v, img) {
  canvas.width = size.w; canvas.height = size.h;
  const ctx = canvas.getContext('2d'), W = size.w, H = size.h, pad = Math.round(W * 0.07);
  ctx.fillStyle = '#ECE6FB'; ctx.fillRect(0, 0, W, H);
  if (img) { const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s; ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, 'rgba(29,16,105,0)'); g.addColorStop(1, 'rgba(29,16,105,.88)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  const hs = Math.round(Math.min(W, H) * 0.085), ss = Math.round(hs * 0.48), cs = Math.round(hs * 0.42);
  ctx.font = `700 ${cs}px ThmanyahDesign, sans-serif`;
  const ctaW = ctx.measureText(v.cta).width + cs * 2.2, ctaH = cs * 2.3, ctaY = H - pad - ctaH;
  ctx.fillStyle = C.accent; ctx.beginPath(); ctx.roundRect(W - pad - ctaW, ctaY, ctaW, ctaH, ctaH / 2); ctx.fill();
  ctx.fillStyle = C.white; ctx.fillText(v.cta, W - pad - cs * 1.1, ctaY + ctaH * 0.66);
  ctx.font = `400 ${ss}px ThmanyahDesign, sans-serif`;
  const sub = lines(ctx, v.sub, W - pad * 2).slice(0, 3);
  let y = ctaY - ss * 1.1;
  for (const l of sub.reverse()) { ctx.fillText(l, W - pad, y); y -= ss * 1.45; }
  ctx.font = `700 ${hs}px ThmanyahDesign, sans-serif`;
  const head = lines(ctx, v.headline, W - pad * 2).slice(0, 3);
  y -= hs * 0.25;
  for (const l of head.reverse()) { ctx.fillText(l, W - pad, y); y -= hs * 1.2; }
  ctx.font = `700 ${Math.round(hs * 0.5)}px ThmanyahDesign, sans-serif`; ctx.textAlign = 'left'; ctx.direction = 'ltr';
  ctx.fillStyle = C.white; ctx.fillText('Well.', pad, pad + hs * 0.5);
}

export default async function mount() {
  let res = null, pick = 0, img = null;
  const sizes = () => $$('input[name=size]:checked').map(x => x.value);

  async function render() {
    if (!res) return;
    await font();
    const v = res.variants[pick];
    $('#prev').innerHTML = sizes().map(k => `<figure class="dz-fig"><canvas data-size="${k}" aria-label="معاينة ${esc(res.sizes[k].label)}"></canvas>
      <figcaption><span>${esc(res.sizes[k].label)}</span><a class="btn sm secondary" data-dl="${k}" href="#" download="well-${k}.png">نزّل PNG</a></figcaption></figure>`).join('') || '<p class="muted">اختر مقاس واحد على الأقل.</p>';
    $$('#prev canvas').forEach(c => draw(c, res.sizes[c.dataset.size], v, img));
  }

  function drawResult() {
    const r = res.reference;
    $('#ref').innerHTML = `<h2>وش نجح عندنا آخر 30 يوم</h2>
      ${r.top.length ? `<div class="tbl"><table class="dg-plat"><thead><tr><th>الإعلان</th><th>المنصة</th><th>الصيغة</th><th>تكلفة الليد</th><th>ليدز</th></tr></thead><tbody>
        ${r.top.map(a => `<tr><td>${esc(a.name || a.ad_key)}</td><td>${esc(PLAT[a.platform] || a.platform)}</td><td>${esc(a.format || '—')}</td><td class="n">${fmt(a.cpl, 2)}</td><td class="n">${fmt(a.leads)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted" style="margin:8px 0 0">${r.medianWords ? `النص الناجح حوالي ${fmt(r.medianWords)} كلمة. ` : ''}${Object.entries(r.formats).map(([f, n]) => `${esc(f)}: ${fmt(n)}`).join(' · ')}</p>
        ${r.hooks.length ? `<div class="ls-topics" style="margin-top:8px">${r.hooks.map(h => `<span class="so-chip">${esc(h)}</span>`).join('')}</div>` : ''}`
        : '<p class="muted">ما فيه إعلانات ليدز بثلاث ليدز أو أكثر آخر 30 يوم، فالنصوص من القوالب.</p>'}`;
    $('#vars').innerHTML = `<h2>النصوص المقترحة <span class="muted" style="font-size:13px">${res.engine === 'workers-ai' ? '· ذكاء اصطناعي' : '· قوالب'}</span></h2>
      <div class="dz-vars">${res.variants.map((v, i) => `<label class="card dz-var${i === pick ? ' on' : ''}"><input type="radio" name="var" value="${i}" ${i === pick ? 'checked' : ''}>
        <b>${esc(v.headline)}</b><span>${esc(v.sub)}</span><span class="so-chip">${esc(v.cta)}</span>
        ${v.flags.map(f => `<span class="dz-flag">${LEVEL[f.level] || ''}: ${esc(f.title)} «${esc(f.match)}»</span>`).join('')}</label>`).join('')}</div>
      <div class="dz-edit"><label for="eh">العنوان</label><input id="eh" type="text"><label for="es">السطر الثاني</label><input id="es" type="text"><label for="ec">الزر</label><input id="ec" type="text"></div>`;
    const v = res.variants[pick]; $('#eh').value = v.headline; $('#es').value = v.sub; $('#ec').value = v.cta;
  }

  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.submitter; busy(btn, true); say($('#msg'), 'يجهز البريف…', true);
    try {
      res = await api('/api/design/brief', { method: 'POST', body: { type: $('#type').value, offer: $('#offer').value, audience: $('#aud').value, dept: $('#dept').value } });
      pick = 0; drawResult(); await render(); say($('#msg'), 'جاهز. عدّل النص أو اختر خيار ثاني، والمعاينة تتحدث.', true);
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  $('#photo').addEventListener('change', () => {
    const f = $('#photo').files[0]; if (!f) { img = null; render(); return; }
    const r = new FileReader(); r.onload = () => { const i = new Image(); i.onload = () => { img = i; render(); }; i.src = r.result; }; r.readAsDataURL(f);
  });
  $('#vars').addEventListener('change', e => { if (e.target.name === 'var') { pick = +e.target.value; drawResult(); render(); } });
  $('#vars').addEventListener('input', e => { if (!res || !['eh', 'es', 'ec'].includes(e.target.id)) return; const v = res.variants[pick]; v.headline = $('#eh').value; v.sub = $('#es').value; v.cta = $('#ec').value; render(); });
  $$('input[name=size]').forEach(x => x.addEventListener('change', render));
  $('#prev').addEventListener('click', e => { const a = e.target.closest('[data-dl]'); if (!a) return; const c = $(`#prev canvas[data-size="${a.dataset.dl}"]`); a.href = c.toDataURL('image/png'); });

  await shell({ active: 'design', title: 'التصميم' });
}
