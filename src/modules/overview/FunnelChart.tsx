// رحلة العميل كشريط واحد أفقي ينساب من اليمين لليسار (ومن اليسار لليمين بالإنجليزي): ارتفاعه عند كل مرحلة من حجمها، ويضيق بين المرحلتين حسب قوة الخطوة.
// يتحرك بنعومة لما تتغير الفترة أو المنصة (إلا إذا الجهاز طالب حركة أقل). حمّله متأخر: d3-shape و motion هنا بس.
import * as React from 'react';
import { area, curveMonotoneX } from 'd3-shape';
import { animateValue } from 'motion';
import { FUNNEL_COLOURS, type JStage, type JStat } from './analytics';
import { type Step, type Verdict, linkX, points, shape, stageX } from './funnel';
import { val } from './format';
import { Delta } from './Delta';
import { pageLang, pick } from './lang';

const W = 960, H = 250, MID = 118, MAX_H = 170, MIN_H = 26;
const LEVEL = { bad: 'text-destructive', watch: 'text-amber-700 dark:text-amber-400', ok: 'text-primary' } as const;

const band = area<{ x: number; h: number }>().x(p => p.x).y0(p => MID - p.h / 2).y1(p => MID + p.h / 2).curve(curveMonotoneX);
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Active = { kind: 'stage' | 'link'; i: number } | null;
interface Props { stages: JStage[]; steps: Step[]; verdict: Verdict; was: (x: JStat) => number | null }

export default function FunnelChart({ stages, steps, verdict, was }: Props) {
  const l = pageLang(), rtl = l !== 'en', t = (ar: string, en: string) => pick(l, ar, en);
  const linkStep = (i: number) => steps.find(s => s.link === i && s.key !== 'cpl')!;
  const target = shape(stages.map(s => s.main.now), [0, 1, 2].map(i => linkStep(i).score), MAX_H, MIN_H);
  const key = [...target.heights, ...target.waists].map(v => v.toFixed(1)).join(',');
  const path = React.useRef<SVGPathElement>(null);
  const from = React.useRef(shape([null, null, null, null], [1, 1, 1], MIN_H * 0.4, MIN_H * 0.4));

  // Morph from the shape on screen to the new one (and grow in on first load)
  React.useEffect(() => {
    const a = from.current, b = target;
    const draw = (t: number) => {
      const mix = (x: number[], y: number[]) => x.map((v, i) => v + (y[i]! - v) * t);
      const now = { heights: mix(a.heights, b.heights), waists: mix(a.waists, b.waists) };
      from.current = now;
      path.current?.setAttribute('d', band(points(now, W, rtl)) ?? '');
    };
    if (reduced()) { draw(1); return; }
    const anim = animateValue({ keyframes: [0, 1], duration: 700, ease: [0.22, 1, 0.36, 1], onUpdate: draw });
    return () => anim.stop();
  }, [key, rtl]); // the shape key holds every number the target uses

  const [active, setActive] = React.useState<Active>(null);
  const bottleneckLink = verdict.step && verdict.level !== 'ok' && verdict.step !== 'cpl' ? steps.find(s => s.key === verdict.step)?.link ?? null : null;
  const cplWeak = verdict.step === 'cpl' && verdict.level !== 'ok';
  const saleMissing = stages[3]!.main.now == null;
  const on = (x: Active) => ({
    onMouseEnter: () => setActive(x), onMouseLeave: () => setActive(null), onFocus: () => setActive(x), onBlur: () => setActive(null),
    onClick: () => setActive(x),
  });

  return (
    <div className="grid min-w-0 gap-3">
      {/* Wide on phones: the funnel scrolls inside its own box, the page doesn't */}
      <div className="-mx-2 overflow-x-auto px-2" tabIndex={-1}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[600px]" role="group" aria-label={t('رحلة العميل: الظهور، النقرات، الليدز، الإقفالات', 'Customer journey: impressions, clicks, leads, closings')}>
          <defs>
            <linearGradient id="funnel-fill" x1="0" x2="1" y1="0" y2="0">
              {/* Gradient stops must run in increasing offset: stage 4 first in Arabic, stage 1 first in English */}
              {(rtl ? [3, 2, 1, 0] : [0, 1, 2, 3]).map(i => <stop key={i} offset={stageX(i, 4, W, rtl) / W} stopColor={i === 3 && saleMissing ? '#C9C2E8' : FUNNEL_COLOURS[i]} />)}
            </linearGradient>
          </defs>
          <path ref={path} fill="url(#funnel-fill)" />
          {stages.map((s, i) => {
            const x = stageX(i, 4, W, rtl), hot = active?.kind === 'stage' && active.i === i, cost = s.sub.find(c => c.fmt === 'sar') ?? s.sub[0]!;
            // White inside the band where it is tall enough to hold the text; on a thin band the number sits just above it
            // and its label just below, dark on the card, so no text ever overlaps the band
            const hh = target.heights[i]! / 2, onBand = s.main.now != null && hh * 2 >= 56;
            const halo = onBand ? { paintOrder: 'stroke' as const, stroke: 'rgb(0 0 0 / .18)', strokeWidth: 3 } : undefined;
            const valueY = onBand ? MID - 4 : MID - hh - 8, labelY = onBand ? MID + 18 : MID + hh + 16;
            return (
              <g key={s.n} role="button" tabIndex={0} aria-label={`${s.n}: ${s.main.label} ${val(s.main)}`} className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring" {...on({ kind: 'stage', i })}>
                <rect x={x - 80} y={18} width={160} height={H - 26} rx={12} fill={hot ? 'currentColor' : 'transparent'} fillOpacity={hot ? 0.05 : 0} stroke="transparent" strokeWidth={2} />
                <text x={x} y={22} textAnchor="middle" className="fill-foreground text-[15px] font-semibold">{i + 1}. {s.n}</text>
                <text x={x} y={valueY} textAnchor="middle" className={`${onBand ? 'fill-white' : 'fill-foreground'} text-[22px] font-semibold tabular-nums`} style={halo}>{val(s.main)}</text>
                <text x={x} y={labelY} textAnchor="middle" className={`${onBand ? 'fill-white/90' : 'fill-muted-foreground'} text-[12px]`} style={halo}>{s.main.label}</text>
                <text x={x} y={H - 34} textAnchor="middle" className="fill-muted-foreground text-[12px]">{cost.label}</text>
                <text x={x} y={H - 14} textAnchor="middle" className={`text-[14px] font-semibold tabular-nums ${i === 2 && cplWeak ? 'fill-destructive' : 'fill-foreground'}`}>{val(cost)}</text>
              </g>
            );
          })}
          {[0, 1, 2].map(i => {
            const x = linkX(i, 4, W, rtl), st = linkStep(i), weak = bottleneckLink === i, rate = stages[i + 1]!.rate!, off = st.unattributed;
            // Unattributed: a dashed grey pill «غير مربوط», never the bottleneck and never 0%
            const pill = off ? 'fill-background stroke-muted-foreground' : weak ? 'fill-background stroke-destructive' : 'fill-background stroke-border';
            const ink = off ? 'fill-muted-foreground' : weak ? 'fill-destructive' : st.level === 'watch' ? 'fill-amber-700' : 'fill-foreground';
            return (
              <g key={i} role="button" tabIndex={0} aria-label={`${rate.label}: ${val(rate)}${weak ? t('، عنق الزجاجة', ', bottleneck') : ''}`} className="cursor-pointer outline-none [&:focus-visible>rect:first-child]:stroke-ring" {...on({ kind: 'link', i })}>
                <rect x={x - 44} y={MID - 60} width={88} height={120} fill="transparent" stroke="transparent" strokeWidth={2} rx={10} />
                {weak && <text x={x} y={MID - 34} textAnchor="middle" className="fill-destructive text-[12px] font-semibold">{t('عنق الزجاجة', 'Bottleneck')}</text>}
                <rect x={x - 42} y={MID - 13} width={84} height={26} rx={13} className={pill} strokeWidth={weak ? 2 : 1} strokeDasharray={off ? '4 3' : undefined} />
                <text x={x} y={MID + 5} textAnchor="middle" className={`text-[13px] font-semibold tabular-nums ${ink}`}>{val(rate)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <Detail stages={stages} steps={steps} active={active} was={was} linkStep={linkStep} rtl={rtl} />
    </div>
  );
}

// What the hovered or focused stage or link holds. Nothing until then: the card's subtitle already says to hover.
function Detail({ stages, steps, active, was, linkStep, rtl }: { stages: JStage[]; steps: Step[]; active: Active; was: Props['was']; linkStep: (i: number) => Step; rtl: boolean }) {
  if (!active) return null;
  const arrow = rtl ? '←' : '→';
  if (active.kind === 'link') {
    const rate = stages[active.i + 1]!.rate!, st = linkStep(active.i);
    return (
      <div aria-live="polite" className="grid gap-1 rounded-lg border p-3 text-sm">
        <div className="flex flex-wrap items-baseline gap-2"><b>{stages[active.i]!.n} {arrow} {stages[active.i + 1]!.n}</b>
          <span className="tabular-nums">{rate.label}: <b>{val(rate)}</b></span><Delta now={rate.now} was={was(rate)} lowerIsBetter={false} /></div>
        <p className={st.unattributed ? 'text-muted-foreground' : LEVEL[st.level]}>{st.line}</p>
      </div>
    );
  }
  const s = stages[active.i]!, own = steps.filter(x => (active.i === 2 && x.key === 'cpl') || (active.i > 0 && x.link === active.i - 1 && x.key !== 'cpl'));
  return (
    <div aria-live="polite" className="grid gap-1 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-2"><b>{active.i + 1}. {s.n}</b><span className="text-muted-foreground">{s.hint}</span></div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {[s.main, ...s.sub, ...(s.rate ? [s.rate] : [])].map(x => (
          <span key={x.label} className="tabular-nums">{x.label}: <b>{val(x)}</b> <Delta now={x.now} was={was(x)} lowerIsBetter={x.lowerIsBetter} /></span>
        ))}
      </div>
      {own.map(x => <p key={x.key} className={x.unattributed ? 'text-muted-foreground' : LEVEL[x.level]}>{x.line}</p>)}
    </div>
  );
}

