# AI cost tracking

Phase 1 of the DaVinci PRD («تتبع تكلفة الـ AI»). Code: `src/lib/usage.ts`, `src/lib/prices.ts`, `src/modules/maestro/usage.ts`, migration `supabase/migrations/019_ai_usage.sql`.

## What is recorded
Every model call through `generate()`, `stream()` or `aiFor()` in `src/lib/llm.ts` that is given a context (`usageCtx(cfg, user, tab?)`) writes one `ai_usage` row: company, user id, tab, provider, model, input and output tokens, cost in **USD** (the unit the providers invoice in), the same cost in **SAR** at the rate used (`USD_SAR = 3.75`, the riyal peg, the same number as `pipeline/fetch_data.py`), and whether the model had a price.

Never recorded: the prompt, the answer, an email. Nothing logs a cost or a total (the repo is public); the figures exist only in the database and in the owner-only screen.

A stream that is cut, or whose reader leaves (stop button, closed tab), is still recorded, in a `finally`: the provider bills what it wrote. When no usage event arrived the tokens are estimated from the characters received (`estimated = true`).

Recording is best effort: it runs after the answer (`waitUntil` through `withWaiter`, set in `src/app.ts`) and swallows every error, so it can never slow or break a model call.

Gemini (audio, video, images, speech: `src/lib/gemini.ts`, through the same adapter) is recorded the same way as provider `gemini`, with audio and video input at the audio rate. It has no free fallback, so a tab that reaches its cap stops with a plain message instead of moving to Workers AI.

OpenRouter calls are recorded as provider `openrouter` with the **cost OpenRouter returned** (`usage.cost`, asked for with `usage: { include: true }`), not from the price table; a call that comes back without a cost is recorded as «بدون سعر». The same monthly caps apply (see `docs/ai-providers.md`).

The Debugger's Claude calls are recorded (provider `anthropic`, tab `debugger`) and stop at the tab's monthly cap. Grok live search and images are recorded as estimates (flat fee per call, `estimated`). Not recorded: anything called without a company context. Callers without a user, such as cron jobs, are recorded with a null user (Listening passes its company).

## Prices
**The prices in the table are unverified.** Nobody has matched them with a real invoice yet, so every cost on the screen is an estimate until Leen runs the invoice check (Maestro → «طابق الصرف مع الفاتورة») against a real invoice and the difference is within 5%. Until then, do not treat the totals or the caps as accurate.

`src/lib/prices.ts`: USD per million tokens, each row with its source and the date it was last looked at. They are **estimates until the owner has matched a real invoice** (`verified: false`). A model with no row is recorded with `priced=false` and cost 0, and shows as «بدون سعر» instead of looking free. Workers AI is recorded as 0 (free inside Cloudflare's daily allowance).

## Monthly cap per tab
`ai_budgets (company_id, module, monthly_cap_usd, alert_at_pct)`. **A tab with no row has the default cap (`DEFAULT_CAP_USD` in `src/lib/usage.ts`, 5 USD a month): the owner raises it by saving a cap, or removes the limit by saving an empty one. Only a saved row with an empty cap means no limit.** If the budget or spend read fails, or the table is missing, the default cap applies and the paid call is refused (fail closed). Every paid call goes through the check and the record: text (`generate`/`stream`), Gemini (`gemini()` and the Voice tab's `/api/voice/speak`), OpenAI images and Grok search (flat estimates per call, marked estimated). Only the owner sees or edits it (Maestro → «الصرف على الذكاء الاصطناعي»); the owner types riyals, it is stored in dollars.
- At `alert_at_pct` (default 80) the screen shows an alert, and the audit log gets one `ai_budget_alert` row.
- At 100% that tab's calls go to Workers AI (`ai_budget_capped` in the audit log). If Workers AI is not bound the call stops with `cap_reached` instead of spending more.
- The motion plan is billed to the Design tab.

**Cache:** the caps and the month's spend are read once a minute per company **in each Worker isolate**, not once per model call (`ai_spend` and `ai_budgets`). Each isolate adds its own calls to its count between reads, but isolates do not share it. So a cap can be passed by up to a minute of calls, and more when several isolates are serving at once; the next read then moves the tab to Workers AI.

## Checking against an invoice (the PRD gate: within 5%)
Maestro → «طابق الصرف مع الفاتورة»: pick the invoice (the two paid providers), the month, and type the invoice total in USD. The route sums what was recorded for that provider and month (Riyadh time) and shows the difference in percent; ±5% passes. The figures appear only on screen and in the response, and the audit log keeps only provider, month and the percentage.

What this cannot prove without real invoices: that the price table matches what the providers charge, and that no call path is missing. The invoice also includes things not recorded (see "Not recorded yet").

## Secrets and migrations
No new secrets. Migration `019_ai_usage.sql` is applied by the owner in Supabase → SQL Editor; until then the screen says so and the default cap applies (paid calls stop).


## Recorded against expected (owner screen)
`GET /api/maestro/usage` also returns `models`: per provider and model for the month, the recorded cost beside the cost our price table gives for the same tokens (`ai_models_spend`, migration 031). A gap is expected where the provider reports its own cost (OpenRouter) or the record is an estimate. Every price is still `verified: false` until Leen matches a real invoice with the reconcile form; this screen does not change that.
