# AI cost tracking

Phase 1 of the DaVinci PRD («تتبع تكلفة الـ AI»). Code: `src/lib/usage.ts`, `src/lib/prices.ts`, `src/modules/maestro/usage.ts`, migration `supabase/migrations/019_ai_usage.sql`.

## What is recorded
Every model call through `generate()`, `stream()` or `aiFor()` in `src/lib/llm.ts` that is given a context (`usageCtx(cfg, user, tab?)`) writes one `ai_usage` row: company, user id, tab, provider, model, input and output tokens, cost in **USD** (the unit the providers invoice in), the same cost in **SAR** at the rate used (`USD_SAR = 3.75`, the riyal peg, the same number as `pipeline/fetch_data.py`), and whether the model had a price.

Never recorded: the prompt, the answer, an email. Nothing logs a cost or a total (the repo is public); the figures exist only in the database and in the owner-only screen.

A stream that is cut, or whose reader leaves (stop button, closed tab), is still recorded, in a `finally`: the provider bills what it wrote. When no usage event arrived the tokens are estimated from the characters received (`estimated = true`).

Recording is best effort: it runs after the answer (`waitUntil` through `withWaiter`, set in `src/app.ts`) and swallows every error, so it can never slow or break a model call.

Not recorded yet: the Debugger's Claude calls (own SDK, `src/modules/debugger/explain.ts`), Grok live search (`grokSearch`, per-search fees), and images (`openaiImage`). Callers without a user, such as cron jobs, are recorded with a null user (Listening passes its company).

## Prices
`src/lib/prices.ts`: USD per million tokens, each row with its source and the date it was last looked at. They are **estimates until the owner has matched a real invoice** (`verified: false`). A model with no row is recorded with `priced=false` and cost 0, and shows as «بدون سعر» instead of looking free. Workers AI is recorded as 0 (free inside Cloudflare's daily allowance).

## Monthly cap per tab
`ai_budgets (company_id, module, monthly_cap_usd, alert_at_pct)`. **Empty means no cap and there is no default cap.** Only the owner sees or edits it (Maestro → «الصرف على الذكاء الاصطناعي»); the owner types riyals, it is stored in dollars.
- At `alert_at_pct` (default 80) the screen shows an alert, and the audit log gets one `ai_budget_alert` row.
- At 100% that tab's calls go to Workers AI (`ai_budget_capped` in the audit log). If Workers AI is not bound the call stops with `cap_reached` instead of spending more.
- The motion plan is billed to the Design tab.

**Cache:** the caps and the month's spend are read once a minute per company and isolate (`ai_spend` and `ai_budgets`), not once per model call. This isolate's own calls are added to the count between reads. A cap can therefore be passed by about a minute of calls, and another isolate learns about it within a minute.

## Checking against an invoice (the PRD gate: within 5%)
Maestro → «طابق الصرف مع الفاتورة»: pick the invoice (the two paid providers), the month, and type the invoice total in USD. The route sums what was recorded for that provider and month (Riyadh time) and shows the difference in percent; ±5% passes. The figures appear only on screen and in the response, and the audit log keeps only provider, month and the percentage.

What this cannot prove without real invoices: that the price table matches what the providers charge, and that no call path is missing. The invoice also includes things not recorded (see "Not recorded yet").

## Secrets and migrations
No new secrets. Migration `019_ai_usage.sql` is applied by the owner in Supabase → SQL Editor; until then the screen says so and no cap is enforced.
