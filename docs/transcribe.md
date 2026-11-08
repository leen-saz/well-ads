# Transcribe

Phase 2 of the DaVinci PRD (the idea only: transcription as its own tool with per-provider cost; no DaVinci code or prompts). Code: `src/modules/transcribe/`, `src/lib/gemini.ts` (reached through `src/lib/llm.ts`), migration `supabase/migrations/023_transcribe.sql`.

## Flow
1. **Upload** (`POST /api/transcribe/upload`): the file is the request body (type in `Content-Type`, length in `Content-Length`; title, purpose and length in seconds in the query). It is stored in R2 under `transcribe/<company>/<random>` and a job row is created. Limit 95 MB per file (a Worker request body is about 100 MB); a longer recording is split before the upload. Types: mp3, m4a, aac, wav, ogg, flac, webm, mp4, mov. At most 3 open jobs per company.
2. **Steps** (`POST /api/transcribe/step`, or the 5-minute cron): step 0 streams the file from R2 to Google's Files API (never held in memory); then one step per 10-minute window (video gets start and end offsets, audio gets the window in the prompt); the last step makes the summary, saves the library draft, and deletes the file from R2 and from Google. Each step takes the job's lock first, so the page and the cron never run the same step. A busy provider (429) waits a minute without using an attempt; three other failures end the job in plain words.
3. **Result**: summary and action items (meeting) or hook, offer and summary (ad or clip), the timed transcript, and a warning when a phone number, an ID number or a patient is mentioned (counts only, never the numbers). The library item (`module = transcribe`, a draft) carries the compliance result.

## Rules
- Locked for every company until the owner opens it (Settings → Modules).
- Every Gemini call is recorded in `ai_usage` (tab `transcribe`, provider `gemini`, audio input at the audio rate) and stops at the tab's monthly cap: there is no free fallback for audio, so it says so in plain words.
- No key: «ما اكتمل تجهيزه، بلّغ الإدارة» for everyone; the owner also sees which secret to add (`GEMINI_API_KEY`).
- Nothing technical reaches the page: no model, provider, storage key or file name of the provider.

## Not verified
Never run against the real Gemini API (no key here): request shapes follow Google's REST documentation and are tested with fakes. Arabic dialect accuracy and the cost per hour of audio need a first real file; the prices in `src/lib/prices.ts` are estimates until the invoice check.
