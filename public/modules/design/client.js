// التصميم: تفاصيل تصميم من أفضل إعلاناتنا، نصوص مقترحة مفحوصة على قواعد الامتثال، ومعاينة لكل مقاس.
// الصورة يصممها المصمم (OpenAI Images: منتجك في مشهد جديد، أو خلفية)، والنص دايم طبقة فوقها في المتصفح، والتحميل PNG.
// «نوع التصميم»: صورة (هذا الملف) أو موشن جرافيك (motion.js)، والنوع ينحفظ في الرابط ?type=motion.
import { $, $$, api, say, esc, shell, busy, fmt } from '/assets/common.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const LEVEL = { critical: 'مخالفة', warn: 'انتبه', info: 'ملاحظة' };
const C = { ink: '#1D1069', accent: '#7E57FD', white: '#FFFFFF' };

let fontReady = null;
const font = () => (fontReady ||= Promise.all([
  new FontFace('ThmanyahDesign', 'url(/assets/fonts/thmanyahsans-Bold.woff2)', { weight: '700' }).load(),
  new FontFace('ThmanyahDesign', 'url(/assets/fonts/thmanyahsans-Regular.woff2)', { weight: '400' }).load(),
]).then(fs => fs.forEach(f => document.fonts.add(f))).catch(() => {}));

const FF = brand => (brand && brand.font) || 'ThmanyahDesign';

function lines(ctx, text, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean), out = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur);
  return out;
}

// Photo (cover) → soft brand gradient at the bottom → headline, sub, CTA pill. All on a canvas, nothing uploaded.
// brand = the company's approved logo and font (المعرفة ← الهوية والبصريات), when there are any.
export function draw(canvas, size, v, img, pal, brand = null) {
  canvas.width = size.w; canvas.height = size.h;
  const ctx = canvas.getContext('2d'), W = size.w, H = size.h, pad = Math.round(W * 0.07);
  ctx.fillStyle = '#ECE6FB'; ctx.fillRect(0, 0, W, H);
  if (img) { const s = Math.max(W / img.width, H / img.height), w = img.width * s, h = img.height * s; ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
  const dark = (pal && pal.dark) || [29, 16, 105], acc = (pal && pal.accent) || C.accent;
  const g = ctx.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, `rgba(${dark.join(',')},0)`); g.addColorStop(1, `rgba(${dark.join(',')},.88)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  const hs = Math.round(Math.min(W, H) * 0.085), ss = Math.round(hs * 0.48), cs = Math.round(hs * 0.42);
  ctx.font = `700 ${cs}px ${FF(brand)}, sans-serif`;
  const ctaW = ctx.measureText(v.cta).width + cs * 2.2, ctaH = cs * 2.3, ctaY = H - pad - ctaH;
  ctx.fillStyle = acc; ctx.beginPath(); ctx.roundRect(W - pad - ctaW, ctaY, ctaW, ctaH, ctaH / 2); ctx.fill();
  ctx.fillStyle = C.white; ctx.fillText(v.cta, W - pad - cs * 1.1, ctaY + ctaH * 0.66);
  ctx.font = `400 ${ss}px ${FF(brand)}, sans-serif`;
  const sub = lines(ctx, v.sub, W - pad * 2).slice(0, 3);
  let y = ctaY - ss * 1.1;
  for (const l of sub.reverse()) { ctx.fillText(l, W - pad, y); y -= ss * 1.45; }
  ctx.font = `700 ${hs}px ${FF(brand)}, sans-serif`;
  const head = lines(ctx, v.headline, W - pad * 2).slice(0, 3);
  y -= hs * 0.25;
  for (const l of head.reverse()) { ctx.fillText(l, W - pad, y); y -= hs * 1.2; }
  if (brand && brand.logo) {
    const lh = Math.round(hs * 0.9), lw = Math.min(W * 0.35, brand.logo.width * (lh / brand.logo.height));
    ctx.drawImage(brand.logo, pad, pad, lw, lw * (brand.logo.height / brand.logo.width));
  } else {
    ctx.font = `700 ${Math.round(hs * 0.5)}px ${FF(brand)}, sans-serif`; ctx.textAlign = 'left'; ctx.direction = 'ltr';
    ctx.fillStyle = C.white; ctx.fillText('Well.', pad, pad + hs * 0.5);
  }
}


// Images are downscaled in the browser (max 384 px, JPEG) before anything leaves the device
function load(file) {
  return new Promise((ok, no) => { const r = new FileReader(); r.onerror = no; r.onload = () => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = r.result; }; r.readAsDataURL(file); });
}
function small(img, max = 384) {
  const s = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
// Dominant colours: 4-bit buckets over a 64 px copy; darkest strong colour for the gradient, most saturated for the button
export function palette(imgs) {
  const count = new Map();
  for (const img of imgs) {
    const c = small(img, 64), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; const k = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4); count.set(k, (count.get(k) || 0) + 1); }
  }
  const cols = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8]);
  if (!cols.length) return null;
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], sat = c => Math.max(...c) - Math.min(...c);
  const dark = [...cols].sort((a, b) => lum(a) - lum(b))[0];
  const vivid = [...cols].sort((a, b) => sat(b) - sat(a))[0];
  // Keep white text readable: the gradient colour must be dark enough
  const d = lum(dark) > 90 ? dark.map(x => Math.round(x * 0.45)) : dark;
  return { dark: d, accent: `rgb(${vivid.join(',')})`, swatches: cols.slice(0, 5) };
}

let keepState = null;

export default async function mount() {
  let res = null, pick = 0, img = null, refs = [], pal = null, drawn = null;
  // The brand from المعرفة: colours, logo and font load once; the references uploaded here still win for colours
  let brand = null;
  const usePal = () => ($('#useRefColors')?.checked && pal) || (brand && brand.pal) || null;
  const picture = url => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  async function loadBrand() {
    let b;
    try { b = (await api('/api/design/options')).brand; } catch { return; }
    if (!b) return;
    const out = { logo: null, font: null, pal: null };
    if (b.logo) out.logo = await picture(`/api/design/brandfile?id=${b.logo}`).catch(() => null);
    if (b.fonts && b.fonts[0]) {
      try { const f = new FontFace('BrandFont', `url(/api/design/brandfile?id=${b.fonts[0].id})`); await f.load(); document.fonts.add(f); out.font = 'BrandFont'; } catch { /* default font */ }
    }
    if (b.colors && b.colors.length) {
      const dark = rgb(b.colors[0]), lum = 0.2126 * dark[0] + 0.7152 * dark[1] + 0.0722 * dark[2];
      out.pal = { dark: lum > 90 ? dark.map(x => Math.round(x * 0.45)) : dark, accent: b.colors[1] || b.colors[0], swatches: b.colors.map(rgb) };
    } else if (b.refs && b.refs.length) {
      const imgs = (await Promise.all(b.refs.map(r => picture(`/api/design/brandfile?id=${r.id}`).catch(() => null)))).filter(Boolean);
      if (imgs.length) out.pal = palette(imgs);
    }
    brand = out;
    if (out.logo || out.font || out.pal) $('#brandNote').hidden = false;
  }
  const sizes = () => $$('input[name=size]:checked').map(x => x.value);

  async function render() {
    if (!res) return;
    await font();
    const v = res.variants[pick];
    $('#prev').innerHTML = sizes().map(k => `<figure class="dz-fig"><canvas data-size="${k}" aria-label="معاينة ${esc(res.sizes[k].label)}"></canvas>
      <figcaption><span>${esc(res.sizes[k].label)}</span><a class="btn sm secondary" data-dl="${k}" href="#" download="well-${k}.png">نزّل PNG</a></figcaption></figure>`).join('') || '<p class="muted">اختر مقاس واحد على الأقل.</p>';
    // What ChatGPT drew for this brief (the product in a new scene, or a background); the uploaded photo when it did not
    $$('#prev canvas').forEach(c => draw(c, res.sizes[c.dataset.size], v, drawn || img, usePal(), brand));
  }

  function drawResult() {
    const r = res.reference;
    $('#ref').innerHTML = `${res.style ? `<h2>أسلوب صورك</h2><p>${esc(res.style)}</p>` : (res.images && res.images.sent ? '<p class="muted">ما قدر الذكاء الاصطناعي يوصف الصور هالمرة، والنصوص طلعت بدونها.</p>' : '')}
      <h2>وش نجح عندنا آخر 30 يوم</h2>
      ${r.top.length ? `<div class="tbl"><table class="dg-plat"><thead><tr><th>الإعلان</th><th>المنصة</th><th>الصيغة</th><th>تكلفة الليد</th><th>ليدز</th></tr></thead><tbody>
        ${r.top.map(a => `<tr><td>${esc(a.name || a.ad_key)}</td><td>${esc(PLAT[a.platform] || a.platform)}</td><td>${esc(a.format || '—')}</td><td class="n">${fmt(a.cpl, 2)}</td><td class="n">${fmt(a.leads)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted" style="margin:8px 0 0">${r.medianWords ? `النص الناجح حوالي ${fmt(r.medianWords)} كلمة. ` : ''}${Object.entries(r.formats).map(([f, n]) => `${esc(f)}: ${fmt(n)}`).join(' · ')}</p>
        ${r.hooks.length ? `<div class="ls-topics" style="margin-top:8px">${r.hooks.map(h => `<span class="so-chip">${esc(h)}</span>`).join('')}</div>` : ''}`
        : '<p class="muted">ما فيه إعلانات ليدز بثلاث ليدز أو أكثر آخر 30 يوم، فالنصوص من القوالب.</p>'}`;
    $('#vars').innerHTML = `<h2>النصوص المقترحة <span class="muted" style="font-size:13px">${res.engine === 'templates' ? '· قوالب' : ''}</span></h2>
      <div class="dz-vars">${res.variants.map((v, i) => `<label class="card dz-var${i === pick ? ' on' : ''}"><input type="radio" name="var" value="${i}" ${i === pick ? 'checked' : ''}>
        <b>${esc(v.headline)}</b><span>${esc(v.sub)}</span><span class="so-chip">${esc(v.cta)}</span>
        ${v.flags.map(f => `<span class="dz-flag" title="${esc((f.source || []).map(s => `${s.name}، ${s.ref}`).join(' / '))}">${LEVEL[f.level] || ''}: ${esc(f.title)} «${esc(f.match)}»${f.fix ? `. ${esc(f.fix)}` : ''}</span>`).join('')}</label>`).join('')}</div>
      <div class="dz-edit"><label for="eh">العنوان</label><input id="eh" type="text"><label for="es">السطر الثاني</label><input id="es" type="text"><label for="ec">الزر</label><input id="ec" type="text"></div>`;
    const v = res.variants[pick]; $('#eh').value = v.headline; $('#es').value = v.sub; $('#ec').value = v.cta;
  }

  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.submitter;
    // An empty subject designs from the brand and our best ads: said once, and a second press goes ahead
    if (!$('#offer').value.trim() && !btn.dataset.ok) {
      btn.dataset.ok = '1'; $('#offer').focus();
      say($('#msg'), 'ما كتبت وش نعلن عنه: لو ضغطت «صمّم» مرة ثانية، المصمم يعتمد على معرفة العلامة وأفضل إعلاناتنا آخر 30 يوم.', true); return;
    }
    delete btn.dataset.ok; busy(btn, true); say($('#msg'), 'المصمم شغّال والتصميم بالطريق… (حوالي دقيقة)', true);
    try {
      res = await api('/api/design/brief', { method: 'POST', body: { type: $('#type').value, offer: $('#offer').value, audience: $('#aud').value, dept: $('#dept').value,
        product: img ? small(img, 1024).toDataURL('image/jpeg', 0.9) : '',
        images: [...(img ? [{ kind: 'product', data: small(img).toDataURL('image/jpeg', 0.7) }] : []), ...refs.map(r => ({ kind: 'ref', data: small(r).toDataURL('image/jpeg', 0.7) }))] } });
      drawn = res.image ? await picture(res.image).catch(() => null) : null;
      pick = 0; drawResult(); await render();
      const missed = !drawn && res.engine === 'openai';
      say($('#msg'), missed ? (img ? 'النصوص جاهزة، بس المصمم ما رجّع صورة هالمرة، فالمعاينة على صورتك الأصلية.' : 'النصوص جاهزة، بس المصمم ما رجّع خلفية هالمرة. جرّب مرة ثانية أو ارفع صورة.') : 'جاهز. عدّل النص أو اختر خيار ثاني، والمعاينة تتحدث.', !missed);
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  function thumbs() {
    const all = [...(img ? [[img, 'المنتج']] : []), ...refs.map((r, i) => [r, `مرجع ${i + 1}`])];
    $('#thumbs').innerHTML = all.map(([im, l]) => `<figure><img alt="${esc(l)}" src="${small(im, 144).toDataURL('image/jpeg', 0.8)}"><figcaption>${esc(l)}</figcaption></figure>`).join('')
      + (pal ? `<div class="sw" aria-label="ألوان المراجع">${pal.swatches.map(c => `<i style="background:rgb(${c.join(',')})"></i>`).join('')}</div>` : '');
  }
  $('#photo').addEventListener('change', async () => {
    const f = $('#photo').files[0]; img = f ? await load(f).catch(() => null) : null;
    if (f && !img) say($('#msg'), 'ما قدرت أقرا صورة المنتج. جرّب JPG أو PNG.');
    thumbs(); render();
  });
  $('#refs').addEventListener('change', async () => {
    const files = [...$('#refs').files];
    if (files.length > 4) say($('#msg'), 'أخذت أول 4 صور مرجعية بس.', true);
    refs = (await Promise.all(files.slice(0, 4).map(f => load(f).catch(() => null)))).filter(Boolean);
    pal = refs.length ? palette(refs) : null;
    // The reference colours only mean something once there are references
    $('#useRefColors').disabled = !refs.length; $('#useRefColors').checked = !!refs.length; $('#refColorsNote').hidden = !!refs.length;
    thumbs(); render();
  });
  $('#useRefColors').addEventListener('change', render);
  $('#vars').addEventListener('change', e => { if (e.target.name === 'var') { pick = +e.target.value; drawResult(); render(); } });
  $('#vars').addEventListener('input', e => { if (!res || !['eh', 'es', 'ec'].includes(e.target.id)) return; const v = res.variants[pick]; v.headline = $('#eh').value; v.sub = $('#es').value; v.cta = $('#ec').value; render(); });
  $$('input[name=size]').forEach(x => x.addEventListener('change', render));
  $('#prev').addEventListener('click', e => { const a = e.target.closest('[data-dl]'); if (!a) return; const c = $(`#prev canvas[data-size="${a.dataset.dl}"]`); a.href = c.toDataURL('image/png'); });

  // The language switch reloads the page: the brief's results and pictures come back with it (a minute at most)
  // One listener per page visit (the router runs mount() on every visit)
  if (keepState) document.removeEventListener('well:before-lang', keepState);
  keepState = () => {
    if (!res) return;
    const keep = { res, pick, drawn: drawn?.src || '', img: img ? small(img, 1024).toDataURL('image/jpeg', 0.9) : '' };
    try { sessionStorage.setItem('well-design', JSON.stringify(keep)); } catch { try { sessionStorage.setItem('well-design', JSON.stringify({ ...keep, img: '' })); } catch {} }
  };
  document.addEventListener('well:before-lang', keepState);
  await shell({ active: 'design', title: 'التصميم' });
  let motion = null;
  const showKind = kind => {
    const isMotion = kind === 'motion';
    $$('#kind [data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === (isMotion ? 'motion' : 'image'))));
    $('#imageFlow').hidden = isMotion; $('#motionFlow').hidden = !isMotion;
    if (isMotion) motion ||= import('/modules/design/motion.js').then(m => m.mountMotion()).catch(err => say($('#mmsg'), err.message));
  };
  $('#kind').onclick = ev => {
    const b = ev.target.closest('[data-kind]');
    if (!b) return;
    const u = new URL(location.href);
    if (b.dataset.kind === 'motion') u.searchParams.set('type', 'motion'); else { u.searchParams.delete('type'); u.searchParams.delete('id'); }
    history.replaceState(history.state, '', u);
    showKind(b.dataset.kind);
  };
  showKind(new URL(location.href).searchParams.get('type'));
  let kept = null;
  try { kept = JSON.parse(sessionStorage.getItem('well-design') || 'null'); sessionStorage.removeItem('well-design'); } catch {}
  if (kept?.res) {
    res = kept.res; pick = kept.pick || 0;
    drawn = kept.drawn ? await picture(kept.drawn).catch(() => null) : null;
    img = kept.img ? await picture(kept.img).catch(() => null) : null;
    thumbs(); drawResult(); await render();
  }
  await loadBrand();
}
