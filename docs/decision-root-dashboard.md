# Decision: what happens to «/» (the full dashboard)

UX audit 2026-11-12, note 8 and fix 11. **Recommendation: keep `/`, name it «اللوحة الكاملة», and link it from the performance summary** (done: link under the period bar in `/overview/`).

## What exists
- `/` is the pipeline-built dashboard (`pipeline/template.html` + `pipeline/dash/*.js`): campaigns, platforms, ads table, organic mode (`?mode=organic`), and it is what `/dept/*` and `/c/` are cut from. The sidebar sends «ملخص الأداء» there when the Overview module is off for the company or the user (`public/assets/sidebar.js`).
- `/overview/` is the newer React page. Overview and Creative **already share one period bar** (`public/assets/period.js`: week, month, this month, all time, custom; default 30 days; week and month end on the last day with data; the chosen range is printed above the numbers), so those two no longer disagree.
- `/` still has its own date code (`pipeline/dash/02-dates-state.js`): same end-day rule (last full day), but other labels («آخر أسبوع», «آخر شهر») and no «هذا الشهر».

## Options
| | what | cost | risk |
|---|---|---|---|
| A (chosen) | keep `/` as the full dashboard, linked from Overview | one link | none |
| B | redirect `/` to `/overview/` for users who have it | gate change by module | loses campaigns/platforms/organic views that Overview does not have yet |
| C | rebuild the full dashboard's sections inside Overview, then retire `/` | weeks | the right end state, not a quick fix |

## To finish the unification (not done here)
Make `02-dates-state.js` use the same presets and labels as `period.js`. It changes the generated pages, so the parity goldens (`tests/parity`) must be updated in the same PR, and the three department and creative copies are built from the same script. Until then a number on `/` and the same number on `/overview/` can differ only by label and by the period you picked; the rule for the end day is the same.
