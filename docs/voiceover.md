# Voiceover (Arabic speech)

Phase 2 of the DaVinci PRD (the idea only: voiceover as its own tool with per-provider cost; no DaVinci code or prompts). Code: `src/modules/voiceover/`, the adapter in `src/lib/gemini.ts`, migration `supabase/migrations/026_voiceover.sql`.

The existing **Voice** tab (brand-voice guide, copy checker, a first speech generator) is not changed. Voiceover is the separate, locked tool that adds what the PRD asks of the speech feature: a brand voice per company, cost tracking under a monthly cap, a compliance check of the script, and saving the script to the library. It reuses Voice's lists of voices, accents and tones.

## Flow
1. `GET /api/voiceover/guide`: the voices, accents (Najdi, Hijazi, Southern Saudi, Gulf, clear Modern Standard), tones, paces, the company's saved brand voice, and whether it is ready.
2. `POST /api/voiceover/check`: the compliance notices for the script (same rules and forbidden words as the rest; notices only).
3. `POST /api/voiceover/speak`: one call to the speech model with a prompt naming the accent, tone and pace. **The answer is passed to the page untouched** (it carries megabytes of audio and the free Workers plan allows 10 ms of CPU): the page wraps the 16-bit PCM in a WAV header, plays it, and offers the download. The audio is not stored.
4. `POST /api/voiceover/settings`: saves the brand voice (voice, accent, tone, pace); every generation starts from it, and what a request sends overrides it for that generation only.

## Cost and cap
The provider's token counts are read from the end of the answer (a regex on the last 3,000 characters, never a parse of the body) and recorded in `ai_usage` (tab `voiceover`, provider `gemini`, the speech model). If the answer carries none, the cost is estimated from the script and the audio size and marked `estimated`. A tab at its monthly cap stops before any call, with a plain message; speech has no free fallback.

## Rules
- Locked for every company until the owner opens it (Settings → Modules).
- No key: «ما اكتمل تجهيزه، بلّغ الإدارة» for everyone; the owner also sees the secret's name. Optional `GEMINI_TTS_MODEL` changes the model without a deploy.
- Never logged or audited: the script or the provider's answer. The audit rows keep sizes and choices.
- No real person's voice is cloned: only the provider's prebuilt voices.

## Not verified
Never run against the real API (no key here). Whether each accent really comes out in that dialect, and the cost per minute of audio, need a first real generation; accent control is a prompt instruction to the model, not a guarantee. The PCM format and the usage fields follow Google's REST documentation and are tested with fakes.
