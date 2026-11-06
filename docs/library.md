# Shared library and favourites

Phase 1 of the DaVinci PRD («المكتبة والمفضلة»). Code: `src/lib/library.ts`, `src/api/routes/library.ts`, page `src/pages/library/index.astro` with `public/modules/library/client.js`, migration `supabase/migrations/020_library.sql`.

## What it holds
`library_items`: the tab it came from (`module`), `kind` (text, design, script, video), title, content, platform, service, `compliance_result`, and the review columns from the PRD: `review_status` (draft, in_review, returned, approved), `reviewed_by`, `approved_by`. Only the columns exist now; the review flow (Anas reviews, Shakib approves) is phase 4.
`library_favorites`: one row per user and item, inside the company.

## Rules
- Every query names its company (`scoped()`); another company's items are invisible and answer 404.
- Reading: the items of the tabs the user may open (copy, content, design, voice, social, journeys). Saving: edit on the tab the output came from.
- The compliance result is computed on the server at save time (same rules as the rest of the system, plus the company's forbidden words), never trusted from the browser. It is a notice only.
- Edit: the owner anything; the person who saved it, until it is approved. A changed text is checked again and an approved item goes back to draft.
- Approve: the owner only. While Anas and Shakib are not wired in (phase 4), the owner holds both roles, which matches the decision that the owner keeps edit and approve power when they are away.
- Every write (`library_saved`, `library_edited`, `library_starred`, `library_unstarred`, `library_approved`) goes to `audit_log` with ids and tab names, never the text.

## Routes
`GET /api/library` (filters `module`, `kind`, `platform`, `service`, `q`, `starred=1`), `POST /api/library` (`star: true` saves and favourites together), `PATCH /api/library/item`, `POST /api/library/star`, `POST /api/library/approve`.

## Where it shows
The copywriter's results have «احفظ في المكتبة» and a star. The page is `/library/`; it is not in the sidebar yet (adding an entry changes every tab's navigation, so it is left for a decision).

## Migration
`020_library.sql`, applied by the owner in Supabase → SQL Editor. Until then the page and the save say which migration is missing.
