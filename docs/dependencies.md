# Dependencies: state and plan (2026-11-06)

## TypeScript 7 (Dependabot PR #3, closed)
Blocked, confirmed: `@astrojs/check@0.9.12` declares `typescript: ^5.0.0 || ^6.0.0` and `typescript-eslint` declares `>=4.8.4 <6.1.0`, so
`npm ci` fails with ERESOLVE on TypeScript 7.0.2 (the CI log of PR #3). Dependabot ignores TypeScript major bumps (`.github/dependabot.yml`).
When to lift the ignore: `npm view @astrojs/check peerDependencies` and `npm view typescript-eslint peerDependencies` both list 7. Then bump
TypeScript in one PR and run `npm run typecheck` (the TS 7 compiler is a native rewrite: expect stricter results).

## `npm audit`
Before: 10 moderate, one root cause: `minimatch` 7.0.0–11.0.0 (DoS through globparts, GHSA-g3hv-75wg-m249), reached only through the
ESLint chain (dev tooling, never shipped). CI gates on `--audit-level=high`, so nothing was blocking.
`npm audit fix --force` would downgrade ESLint to 9: not taken. Instead `overrides.minimatch = ^11.0.5` in `package.json`: 0 vulnerabilities,
lint, typecheck, build and tests unchanged. Remove the override once ESLint and typescript-eslint require minimatch above 11.0.0 themselves.

## Outdated (npm outdated, all patch/minor within the ranges; none urgent)
| Package | Now | Available | Plan |
|---|---|---|---|
| astro | 7.4.4 | 7.4.7 | Dependabot patch PR; merge with staging check |
| @astrojs/cloudflare | 14.4.3 | 14.4.6 | with astro (same release train) |
| @astrojs/react | 7.1.2 | 7.1.4 | with astro |
| hono | 4.13.14 | 4.13.16 | patch, API sweep tests cover it |
| wrangler | 4.156.0 | 4.158.0 | patch; the smoke suite runs `wrangler dev`, so it checks it |
| vitest | 5.0.5 | 5.1.0 | minor, dev only |
| @playwright/test | 1.64.1 | 1.65.0 | minor, dev only; the smoke and parity jobs install the matching Chromium |
| tailwindcss, @tailwindcss/vite | 4.3.3 | 4.3.4 | patch, together |
| lucide-react | 1.66.0 | 1.70.0 | minor, icons only |
| @anthropic-ai/sdk | 1.2.0 | 1.6.0 | minor; read the changelog first (model and streaming behaviour), test the AI tabs on staging |
| @tanstack/react-table | 8.21.3 | 9.3.1 | **major**, skip until a table needs it: v9 is a rewrite |
| typescript | 6.0.3 | 7.0.2 | blocked, see above |

Order: (1) astro + adapter + react together, merge after a green staging deploy and the smoke suite; (2) hono, wrangler, vitest, playwright,
tailwind (one PR each or Dependabot's own); (3) @anthropic-ai/sdk by itself with a staging check of the AI tabs.
The Dependabot security alerts feature is **disabled** for this repository (GitHub API 403): turn it on in Settings → Code security so a
vulnerable dependency opens a PR by itself instead of waiting for `npm audit`.
