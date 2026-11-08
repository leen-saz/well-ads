# Vision (image description)

Phase 2 of the DaVinci PRD (the idea only: image analysis as its own tool with per-provider cost; no DaVinci code or prompts). Code: `src/modules/vision/`, the adapter in `src/lib/gemini.ts`, migration `supabase/migrations/025_vision.sql`.

## Flow
1. The browser shrinks the picture to at most 1600 px and re-encodes it as JPEG (faster, cheaper, and the camera's location data is dropped), takes its SHA-256, and sends `{title, mime, data (base64), hash}` to `POST /api/vision/describe`. The request is capped at about 2 MB of base64.
2. The server looks for the hash in the company's analyses first (the same image is never analysed or billed twice). Otherwise one Gemini call returns JSON: a description (one or two sentences), alt text (under 125 characters), the text inside the image as written, the offer, the hook, the call to action, and whether people appear.
3. The text the image says goes through `check()` with the company's forbidden words: the same compliance rules as the rest of the system, as notices only. The result is stored (`vision_analyses`); **the image is not**.
4. «احفظ في المكتبة» saves description, alt text, text, offer, hook and call to action to the library as a draft (`module = vision`, `kind = design`), with its compliance result. That library item is how Design, Knowledge or anything else picks the alt text up; nothing in those tabs is changed.

## Rules
- Locked for every company until the owner opens it (Settings → Modules).
- Every call is recorded in `ai_usage` (tab `vision`, provider `gemini`) and stops at the tab's monthly cap; no free fallback.
- No key: «ما اكتمل تجهيزه، بلّغ الإدارة» for everyone; the owner also sees the secret's name.
- People in the picture: a notice to check their consent first. Nothing technical is shown.

## Not verified
Never run against the real API (no key here). The PRD's gate (Arabic text read right in 9 of 10 test images, with Saudi samples) needs real images and a real key; the request shape follows Google's REST documentation and is tested with fakes.
