# Orizon Agents — UAT

End-to-end user-acceptance suite for the deployed Orizon Agents stack.

Unlike the unit and component tests that live in the application repos, this
suite runs against a **real deployment** — the same Vercel edge, the same Next
rewrite to the backend, and the same Soroban RPC a visitor hits. There is no
`webServer` block in the Playwright config on purpose: if it passes here, it
passed for a user.

| target | url |
| --- | --- |
| Frontend (default) | https://orizons.xyz |
| Backend | https://orizon-agents-be-stellar.onrender.com |

## Run

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

Against a preview deployment instead of production:

```bash
UAT_BASE_URL=https://orizon-agents-fe-stellar-<sha>.vercel.app npm test
```

Useful subsets:

```bash
npm run test:a11y      # accessibility sweep only
npm run test:ui        # interactive runner
npm run report         # open the last HTML report
```

## Layout

| file | covers |
| --- | --- |
| `tests/fixtures.ts` | shared helpers: route registry, overflow/heading/alt/name assertions, console-error collector, API outage + 5xx + 429 + hang interception, wallet-session stub |
| `tests/marketing.spec.ts` | `/` — metadata, JSON-LD, nav, sections, footer, robots/sitemap/manifest, 404 |
| `tests/console.spec.ts` | `/app`, `/app/flow`, `/app/events` — shell, sidebar, mobile drawer, state distinction |
| `tests/registry.spec.ts` | `/app/agents`, `/app/register`, `/app/reputation` — table, form validation, score calculator |
| `tests/orchestrator.spec.ts` | `/app/orchestrator`, `/app/trace` — intent form, decompose, plan, trace tabs, artifact sandbox |
| `tests/wallet.spec.ts` | `/app/wallet`, `/app/send`, `/app/pdax` — disconnected-state correctness |
| `tests/a11y.spec.ts` | all 12 routes — headings, alt text, accessible names, landmarks, focus, colour reliance |
| `tests/resilience.spec.ts` | all 12 routes — outage, 5xx, timeout, 429, performance budgets, breakpoint overflow |
