// Voiceover: the choices (voice, accent, tone, pace), the prompt, the request to the speech model, and reading the cost back from
// the answer without parsing it (the answer carries megabytes of audio; the free Workers plan allows 10 ms of CPU).
// The voices, accents and tones are the Voice tab's lists (src/modules/voice/voice.ts); the prompt here is this project's own.
import { ACCENTS as VOICE_ACCENTS, TONES, TTS_MODEL, TTS_VOICES } from '../voice/voice';

export { TTS_MODEL, TTS_VOICES, TONES };
export const MAX_CHARS = 1500;
export const ACCENTS: Record<string, string> = { ...VOICE_ACCENTS, janoubi: 'جنوبية سعودية (لهجة أبها)' };
export const PACES = { slow: 'بطيء وواضح', normal: 'عادي', fast: 'سريع' } as const;
export type Pace = keyof typeof PACES;
export interface Choice { voice: string; accent: string; tone: string; pace: Pace }
export const DEFAULTS: Choice = { voice: 'Charon', accent: 'najdi', tone: 'warm', pace: 'normal' };

const pick = <T extends string>(v: unknown, ok: (x: string) => boolean, fallback: T): T => (ok(String(v)) ? String(v) as T : fallback);
// The brand's saved choice, with anything unknown replaced by the default (a stale row never breaks a generation)
export const choice = (b: Record<string, unknown>, base: Choice = DEFAULTS): Choice => ({
  voice: pick(b.voice, x => TTS_VOICES.some(v => v.id === x), base.voice),
  accent: pick(b.accent, x => x in ACCENTS, base.accent),
  tone: pick(b.tone, x => x in TONES, base.tone),
  pace: pick(b.pace, x => x in PACES, base.pace),
});

export function cleanSpeak(b: Record<string, unknown>, base: Choice = DEFAULTS): (Choice & { text: string }) | { error: string } {
  const text = String(b.text || '').trim();
  if (!text) return { error: 'اكتب النص أول' };
  if (text.length > MAX_CHARS) return { error: `النص أطول من ${MAX_CHARS} حرف. قسّمه لأجزاء` };
  return { ...choice(b, base), text };
}

export const prompt = (i: Choice & { text: string }): string =>
  `اقرأ النص التالي بلهجة ${ACCENTS[i.accent]}، بنبرة ${TONES[i.tone]}، وبإيقاع ${PACES[i.pace]}، كأنك معلّق إعلان صوتي لشركة رعاية صحية منزلية. اقرأ النص بحروفه بدون أي إضافة أو تعليق:\n${i.text}`;

export const body = (i: Choice & { text: string }) => ({
  contents: [{ parts: [{ text: prompt(i) }] }],
  generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: i.voice } } } },
});

// The provider's token counts sit at the end of the answer, after the audio: read them there, never parse the whole body
export function usageIn(raw: string): { in: number; out: number } | undefined {
  const tail = raw.slice(-3000), a = /"promptTokenCount"\s*:\s*(\d+)/.exec(tail), b = /"candidatesTokenCount"\s*:\s*(\d+)/.exec(tail);
  return a && b ? { in: Number(a[1]), out: Number(b[1]) } : undefined;
}
// When the answer carries none: from the sizes (about 25 audio tokens a second; 24 kHz, 16-bit mono is 48,000 bytes a second)
export const seconds = (raw: string): number => {
  const m = /"data"\s*:\s*"/.exec(raw);
  if (!m) return 0;
  const end = raw.indexOf('"', m.index + m[0].length);
  return Math.max(0, Math.round(((end - m.index - m[0].length) * 3 / 4) / 48000));
};
export const guessUsage = (text: string, raw: string) => ({ in: Math.ceil(text.length / 3), out: seconds(raw) * 25 });
