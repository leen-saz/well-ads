// Brief → script and shot plan, in Saudi Arabic, for 15, 30 or 60 seconds and 9:16, 1:1 or 16:9.
// The model writes; this file shapes the request, cleans the answer, fixes the shot lengths to what the engine can make, and
// attaches the Saudi health-advertising notices (MOH rules, src/modules/compliance). Notices only: the text is NEVER changed here.
import type { Msg } from '../../lib/llm';
import { check, type Rule } from '../compliance/compliance';
import type { Brief } from './brief';
import { splitSeconds, type Ratio } from './engine';

export interface Shot { no: number; seconds: number; scene: string; line: string; onScreen: string; prompt: string }
export interface Script { voiceover: string; shots: Shot[]; cta: string }
export interface Notice { text: string; where: string; match: string; title: string; fix: string; level: string }

const WORDS_PER_SECOND = 2.3;   // spoken Saudi Arabic, about
const FRAME: Record<Ratio, string> = { '9:16': 'vertical 9:16 for Reels, TikTok and Stories', '1:1': 'square 1:1 for feeds', '16:9': 'horizontal 16:9 for YouTube and websites' };

// The clip lengths the plan must use: the engine's sizes added up to the ad length
export const plan = (seconds: number, clipSeconds: number[]): number[] => splitSeconds(seconds, clipSeconds);

export function scriptPrompt(i: { brief: Brief; seconds: number; ratio: Ratio; clips: number[]; avatar?: string }): Msg[] {
  const b = i.brief;
  const facts = [b.service && `الخدمة: ${b.service}`, b.offer && `العرض: ${b.offer}`, b.benefits.length && `الفوائد: ${b.benefits.join('، ')}`, b.price && `السعر: ${b.price}`, b.audience && `الجمهور: ${b.audience}`, b.cta && `الدعوة: ${b.cta}`].filter(Boolean).join('\n');
  const maxWords = Math.floor(i.seconds * WORDS_PER_SECOND);
  return [
    { role: 'system', content: 'أنت كاتب إعلانات فيديو لشركة صحية سعودية. تكتب بلهجة سعودية بيضاء قريبة ومهنية، جمل قصيرة، بدون مبالغة. ممنوع: وعود علاج أو شفاء مضمون، مقارنة قبل وبعد، تخويف، ألفاظ التفضيل المطلق مثل «الأفضل» و«الوحيد»، أسعار أو خصومات ما هي بالموجز، ومعلومات طبية ما هي بالموجز. استخدم بس الحقائق اللي بالموجز. أرجع JSON فقط بدون شرح.' },
    { role: 'user', content: `الموجز:\n${facts}\n\nمدة الإعلان ${i.seconds} ثانية، المقاس ${i.ratio}. ${i.avatar ? `مقدّم الأفاتار: ${i.avatar}.` : ''}\nقسّمه إلى ${i.clips.length} لقطات بهالمدد بالثواني بالترتيب: ${i.clips.join('، ')}.\nنص التعليق كله ما يزيد عن ${maxWords} كلمة.\nلكل لقطة: scene وصف المشهد بالعربي، line الجملة المنطوقة فيها، onScreen نص قصير على الشاشة (أو فاضي)، prompt وصف بصري للمحرك بالإنجليزي (${FRAME[i.ratio]}): مكان، إضاءة، حركة الكاميرا، بدون نصوص مكتوبة داخل الصورة وبدون وجوه مشاهير.\nالشكل:\n{"shots":[{"scene":"","line":"","onScreen":"","prompt":""}],"cta":"الدعوة الختامية"}` },
  ];
}

const cut = (v: unknown, n: number) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// A model answer (or a hand edit) → a script whose shots have exactly the planned lengths. Extra shots are dropped.
export function cleanScript(raw: unknown, clips: number[]): Script | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (Array.isArray(r.shots) ? r.shots : []).slice(0, clips.length);
  const shots = list.map((s): Omit<Shot, 'no' | 'seconds'> | null => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const line = cut(o.line, 300), prompt = cut(o.prompt, 900);
    return line || prompt ? { scene: cut(o.scene, 300), line, onScreen: cut(o.onScreen, 60), prompt } : null;
  }).filter((s): s is Omit<Shot, 'no' | 'seconds'> => !!s).map((s, k): Shot => ({ ...s, no: k + 1, seconds: clips[k]! }));
  if (!shots.length) return null;
  return { voiceover: voiceoverOf(shots), shots, cta: cut(r.cta, 80) };
}
export const cleanEdit = cleanScript;
export const voiceoverOf = (shots: Shot[]): string => shots.map(s => s.line).filter(Boolean).join(' ');

// The notices on every text the script holds. `where` says which part, so the user knows what to edit.
export function notices(s: Script, rules: Rule[] = []): Notice[] {
  const parts: [string, string][] = [...s.shots.flatMap((x): [string, string][] => [[`لقطة ${x.no}`, x.line], [`لقطة ${x.no}`, x.scene], [`لقطة ${x.no}`, x.onScreen]]), ['الدعوة', s.cta]];
  const out: Notice[] = [], seen = new Set<string>();
  for (const [where, text] of parts) {
    if (!text) continue;
    for (const h of check(text, rules)) { const k = `${where}|${h.rule}|${h.match}`; if (!seen.has(k)) { seen.add(k); out.push({ text, where, match: h.match, title: h.title, fix: h.fix, level: h.level }); } }
  }
  return out;
}

// The spoken text against the ad length: a plain sentence when it will not fit (the text stays as written)
export function fitNote(s: Script, seconds: number): string {
  const words = s.voiceover.split(/\s+/).filter(Boolean).length, need = Math.ceil(words / WORDS_PER_SECOND);
  return need > seconds + 2 ? `التعليق يحتاج نحو ${need} ثانية وإعلانك ${seconds}، اختصره` : '';
}
