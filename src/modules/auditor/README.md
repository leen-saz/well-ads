# «المدقق» — the verdict auditor (owner only)

An independent checker of what the marketing judge (`overview/funnel.ts`) says. Page: `/maestro/audit/` («تدقيق القرارات»,
under «المدير»); a short result badge next to the verdict on `/overview/` for the owner only.

| File | What it does |
|---|---|
| `contract.ts` | `Claim` = what a verdict says (steps, owner, SAR at stake, confidence, coverage, range, targets). Optional fields are skipped when absent. The auditor's own owner table and thresholds. |
| `facts.ts` | Recomputes every number from raw `dash.json` (own code path, nothing imported from the judge). |
| `checks.ts` | Integrity + consistency: quoted vs recomputed numbers, rates multiply (ctr × click→lead × close = booked ÷ impr ÷ coverage), SAR sums, minimum sample, «no problem» only if every step meets target, owner vs rule table, confidence vs coverage. |
| `advocate.ts` | Devil's advocate (rules, no key): small sample, Simpson across platforms, attribution gap larger than the effect (closing-rate range), timing (lead-date cohort maturity), a default target nobody set, holes in the comparison period. Each says contradicts / weakens and what data would settle it. |
| `audit.ts` | Runs both, returns confirmed / weakened / contradicted for the verdict and for each step. |
| `backtest.ts` | Replays the judge over past windows. Counts only. |
| `critic.ts` | Optional draft by Claude Sonnet (a different family from the rule-based judge), rubric with a reason before each score, structured input, fixed order, cost in `ai_usage` (provider `anthropic`). Needs `ANTHROPIC_API_KEY`; nothing else does. |
| `adapter.ts` | **The only file that knows the judge.** When the judge gains fields (SAR at stake, confidence, editable targets, range), map them here. |
| `owner-routes.ts` | `GET /api/maestro/audit`, `POST /api/maestro/critique` (owner only; gate in `src/lib/gate.ts`). Disagreements go to `audit_log` (`verdict_audit`) as ids, never figures. |

The repo is public: no figure is ever logged; `synth.ts` makes the made-up data (Leen's proportions) the tests use.
