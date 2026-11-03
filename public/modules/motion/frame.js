// What is on screen at second t of a motion plan (src/modules/maestro/motion.ts). Pure: no DOM, tested in motion.test.ts.
// draw() turns one frame into canvas calls; the page and the export both use it, so the download matches the preview.
export const SIZE = { '9:16': [720, 1280], '1:1': [1080, 1080], '16:9': [1280, 720] };
const IN = 0.45, OUT = 0.3;
const clamp = x => Math.min(1, Math.max(0, x));
export const ease = x => 1 - Math.pow(1 - clamp(x), 3);

function layer(s, t) {
  const a = ease((t - s.from) / IN), z = ease((s.to - t) / OUT);
  const l = { text: s.text, pos: s.pos, size: s.size, alpha: Math.min(a, z), dx: 0, dy: 0, scale: 1, chars: s.text.length };
  if (s.anim === 'rise') l.dy = (1 - a) * 0.06;
  else if (s.anim === 'pop') { l.scale = 0.7 + 0.3 * a; l.alpha = Math.min(clamp(a * 1.5), z); }
  else if (s.anim === 'slide') l.dx = (1 - a) * 0.12;
  else if (s.anim === 'type') { l.alpha = z; l.chars = Math.ceil(s.text.length * clamp((t - s.from) / Math.max(0.6, (s.to - s.from) * 0.6))); }
  return l;
}

export function frame(spec, t) {
  const p = clamp(t / spec.seconds);
  const bg = { scale: spec.move === 'in' ? 1 + 0.12 * p : spec.move === 'out' ? 1.12 - 0.12 * p : spec.move === 'none' ? 1 : 1.08,
    dx: spec.move === 'left' ? 0.04 - 0.08 * p : spec.move === 'right' ? -0.04 + 0.08 * p : 0 };
  const layers = spec.scenes.filter(s => t >= s.from && t < s.to).map(s => layer(s, t));
  const c = spec.cta && t >= spec.cta.from ? ease((t - spec.cta.from) / IN) : 0;
  return { bg, layers, cta: c ? { text: spec.cta.text, alpha: c, scale: 0.9 + 0.1 * c } : null };
}

// Arabic lines that fit the width (words kept whole)
function wrap(ctx, text, max) {
  const out = [];
  let cur = '';
  for (const w of text.split(' ')) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > max) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export function draw(ctx, spec, f, img, font = '"Thmanyah Sans", sans-serif') {
  const { width: W, height: H } = ctx.canvas, m = Math.min(W, H);
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (img?.width) {
    const k = Math.max(W / img.width, H / img.height) * f.bg.scale, w = img.width * k, h = img.height * k;
    ctx.drawImage(img, (W - w) / 2 + f.bg.dx * W, (H - h) / 2, w, h);
  }
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of f.layers) {
    const px = Math.round(m * { s: 0.05, m: 0.068, l: 0.092 }[l.size]);
    ctx.font = `700 ${px}px ${font}`;
    const lines = wrap(ctx, l.text.slice(0, l.chars), W * 0.8), lh = px * 1.35;
    const y0 = H * { top: 0.18, center: 0.5, bottom: 0.78 }[l.pos] + l.dy * H, x = W / 2 + l.dx * W;
    const bw = Math.max(...lines.map(s => ctx.measureText(s).width)) + px, bh = lines.length * lh + px * 0.5;
    ctx.save();
    ctx.globalAlpha = l.alpha;
    ctx.translate(x, y0); ctx.scale(l.scale, l.scale);
    ctx.fillStyle = spec.colors.band; ctx.globalAlpha = l.alpha * 0.85;
    ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, px * 0.4); ctx.fill();
    ctx.globalAlpha = l.alpha; ctx.fillStyle = spec.colors.text;
    lines.forEach((s, k) => ctx.fillText(s, 0, (k - (lines.length - 1) / 2) * lh));
    ctx.restore();
  }
  if (f.cta) {
    const px = Math.round(m * 0.06);
    ctx.font = `700 ${px}px ${font}`;
    const bw = ctx.measureText(f.cta.text).width + px * 1.6, bh = px * 1.8;
    ctx.save();
    ctx.globalAlpha = f.cta.alpha; ctx.translate(W / 2, H * 0.9); ctx.scale(f.cta.scale, f.cta.scale);
    ctx.fillStyle = spec.colors.accent; ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = spec.colors.text; ctx.fillText(f.cta.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
