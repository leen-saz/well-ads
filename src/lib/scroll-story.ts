// Scroll storytelling for the public pages (/welcome/, /profile/, /security/), driven by data attributes so the
// pages stay plain HTML. Built on GSAP ScrollTrigger following the vendored skills gsap-scrolltrigger,
// gsap-performance and scroll-experience (references/sharp_edges.md): transforms and opacity only, one
// ScrollTrigger per scene, pins only on wide screens, and nothing moves when the reader asked for reduced motion.
//
//   [data-progress]        bar that fills with the page scroll
//   [data-reveal]          fades up once when it enters (siblings stagger)
//   [data-words]           paragraph whose words light up as you scroll through it (split on spaces, never letters:
//                          splitting Arabic letters breaks the joining)
//   [data-steps]           sticky visual + [data-step] blocks: the visual gets data-active="<n>" for the step in view
//   [data-hscroll]         pinned section whose [data-track] slides sideways (RTL aware); a swipe row on phones
//   [data-depth="0.3"]     parallax: moves at a different speed than the page
//   [data-count="248"]     counts up once when it enters, in the page's digits
//   [data-type]            children appear one after another, like lines printed by a terminal
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const root = document.documentElement;
const rtl = () => root.dir === 'rtl';
const arDigits = (n: number) => root.lang === 'ar' ? n.toLocaleString('ar-SA') : n.toLocaleString('en-US');

// The English switch translates text nodes after load (public/assets/i18n.js). Splitting a paragraph into word spans
// before that would leave it untranslated, so on English wait until the Arabic is gone (or give up after 2 s).
function translated(): Promise<void> {
  if (root.lang !== 'en') return Promise.resolve();
  const els = [...document.querySelectorAll<HTMLElement>('[data-words]')];
  const t0 = performance.now();
  return new Promise(done => {
    const tick = () => (!els.some(e => /[؀-ۿ]/.test(e.textContent ?? '')) || performance.now() - t0 > 2000) ? done() : requestAnimationFrame(tick);
    tick();
  });
}

function splitWords(el: HTMLElement) {
  const words = (el.textContent ?? '').trim().split(/\s+/);
  el.setAttribute('aria-label', words.join(' '));
  el.textContent = '';
  for (const w of words) {
    const s = document.createElement('span');
    s.className = 'w'; s.textContent = w; s.setAttribute('aria-hidden', 'true');
    el.appendChild(s); el.appendChild(document.createTextNode(' '));
  }
  return el.querySelectorAll<HTMLElement>('.w');
}

function steps(box: HTMLElement) {
  const items = [...box.querySelectorAll<HTMLElement>('[data-step]')];
  const visual = box.querySelector<HTMLElement>('[data-steps-visual]') ?? box;
  const line = box.querySelector<HTMLElement>('[data-steps-line]');
  const set = (i: number) => {
    visual.dataset.active = String(i);
    items.forEach((it, j) => it.classList.toggle('on', j === i));
  };
  set(0);
  items.forEach((it, i) => ScrollTrigger.create({
    trigger: it, start: 'top 60%', end: 'bottom 60%',
    onEnter: () => set(i), onEnterBack: () => set(i),
  }));
  if (line) gsap.fromTo(line, { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: box, start: 'top 60%', end: 'bottom 60%', scrub: true } });
}

function motion() {
  // Word spans change line breaks (and so heights): split before anything is measured
  const wordSets = [...document.querySelectorAll<HTMLElement>('[data-words]')].map(el => [el, splitWords(el)] as const);
  // Pins first: a pin adds space to the page, so every trigger below it must be measured after it exists
  // (gsap-scrolltrigger skill: create ScrollTriggers in page order, or they start in the wrong place)
  // Sideways scene: wide screens pin it, phones keep the native swipe row (CSS)
  const mm = gsap.matchMedia();
  mm.add('(min-width: 900px)', () => {
    for (const sec of document.querySelectorAll<HTMLElement>('[data-hscroll]')) {
      const track = sec.querySelector<HTMLElement>('[data-track]');
      if (!track) continue;
      const dist = () => Math.max(0, track.scrollWidth - track.clientWidth);
      gsap.to(track, {
        x: () => (rtl() ? 1 : -1) * dist(), ease: 'none',
        scrollTrigger: { trigger: sec, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 0.5, invalidateOnRefresh: true, anticipatePin: 1 },
      });
    }
  });
  const bar = document.querySelector<HTMLElement>('[data-progress]');
  if (bar) gsap.to(bar, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.2 } });

  // Reveal: hide only what is still below the fold, so the first screen never flashes
  const pending = [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter(e => e.getBoundingClientRect().top > innerHeight * 0.92);
  gsap.set(pending, { autoAlpha: 0, y: 28 });
  ScrollTrigger.batch(pending, {
    start: 'top 88%', once: true,
    onEnter: b => gsap.to(b, { autoAlpha: 1, y: 0, duration: 0.8, ease: 'power3.out', stagger: 0.08, overwrite: true }),
  });

  for (const [el, ws] of wordSets) {
    gsap.fromTo(ws, { opacity: 0.16 }, {
      opacity: 1, ease: 'none', stagger: 0.1,
      scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 42%', scrub: 0.6 },
    });
  }

  for (const box of document.querySelectorAll<HTMLElement>('[data-steps]')) steps(box);

  for (const el of document.querySelectorAll<HTMLElement>('[data-depth]')) {
    const d = Number(el.dataset.depth) || 0.2;
    gsap.to(el, { yPercent: -d * 100, ease: 'none', scrollTrigger: { trigger: el.closest('section') ?? el, start: 'top bottom', end: 'bottom top', scrub: true } });
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
    const to = Number(el.dataset.count) || 0, o = { v: 0 };
    el.textContent = arDigits(0);
    gsap.to(o, { v: to, duration: 1.4, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 85%', once: true }, onUpdate: () => { el.textContent = arDigits(Math.round(o.v)); } });
  }

  for (const box of document.querySelectorAll<HTMLElement>('[data-type]')) {
    const lines = box.children;
    gsap.set(lines, { autoAlpha: 0, x: rtl() ? 12 : -12 });
    gsap.to(lines, { autoAlpha: 1, x: 0, duration: 0.35, stagger: 0.32, ease: 'power1.out', scrollTrigger: { trigger: box, start: 'top 75%', once: true } });
  }

}

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
root.classList.add(reduce ? 'st-static' : 'st-motion');
if (!reduce) {
  translated().then(() => {
    motion();
    // Fonts change line lengths: measure again once they are in
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
    document.fonts?.ready.then(() => ScrollTrigger.refresh());
  });
} else {
  // Steps still follow the reader, without animation
  for (const box of document.querySelectorAll<HTMLElement>('[data-steps]')) steps(box);
}
