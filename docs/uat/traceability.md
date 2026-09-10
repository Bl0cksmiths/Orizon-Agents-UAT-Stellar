# Traceability matrix

Every acceptance criterion in `test-plan.md` maps to the test that verifies it.
No cell is empty: a criterion is Covered, Added (written during this
programme), Blocked (with a defect id), or Not covered (with a stated reason).

**Verification status of the whole matrix:** every test below was authored and
statically checked, but **none has been executed** — see defect D-002. "Covered"
here means "a test exists that would fail if the behaviour broke", not "observed
passing".

## EV — registration evidence

| criterion | spec | status |
| --- | --- | --- |
| EV-01 | — | **Blocked** — D-001, needs a signed registration on a testnet target |
| EV-02 | — | **Blocked** — D-001 |
| EV-03 | — | **Blocked** — D-001; `verify_registration.py` needs a real tx hash |
| EV-04 | — | **Blocked** — D-001 |
| EV-05 | evidence.spec.ts | Covered — 4 tests, incl. live `/api/stellar/network` round-trip |

## MK — marketing · CN — console

| criterion | spec | status |
| --- | --- | --- |
| MK-01 | marketing.spec.ts | Covered — title, meta description, Open Graph |
| MK-02 | marketing.spec.ts | Covered — JSON-LD parses, declares expected @type entries |
| MK-03 | marketing.spec.ts | Covered — 5 nav links + Launch App CTA |
| MK-04 | marketing.spec.ts | Covered — all eight section headings in order |
| MK-05 | marketing.spec.ts | Covered — robots, sitemap, and their cross-consistency |
| MK-06 | marketing.spec.ts | Covered — 404 status and a route back |
| MK-07 | marketing.spec.ts | Covered — console/network clean, favicon allowlisted per D-006 |
| CN-01 | console.spec.ts | Covered — 11 nav items, topbar, main landmark |
| CN-02 | console.spec.ts | Covered — 11 per-route tests plus aria-current movement |
| CN-03 | console.spec.ts | Covered — dialog role, Escape, focus return, background `inert` |
| CN-04 | console.spec.ts | Covered — loading vs loaded vs failed, never a bare 0 |
| CN-05 | console.spec.ts | Covered — DAG renders, and fails loudly |
| CN-06 | console.spec.ts | Covered — feed live vs unavailable |
| CN-07 | console.spec.ts | Covered — shell survives a total backend failure |

## RG — registry · OR — orchestrator

| criterion | spec | status |
| --- | --- | --- |
| RG-01 | registry.spec.ts | Covered — headers plus name, skills and price per row |
| RG-02 | registry.spec.ts | Covered — table survives a failed reputation batch |
| RG-03 | registry.spec.ts | Covered — manage panel withheld without a wallet |
| RG-04 | registry.spec.ts | Covered — 4 tests, exact messages from `register-validation.ts` |
| RG-05 | registry.spec.ts | Covered — `agt_` refused client-side before any async call |
| RG-06 | registry.spec.ts | **Added** — taken id reported before any signature is requested |
| RG-07 | registry.spec.ts | Covered — submit stays disabled without a wallet |
| RG-08 | registry.spec.ts | Covered — 4 cases incl. prior-only, saturated, below-floor |
| RG-09 | registry.spec.ts | Covered — real rows or a truthful empty state |
| OR-01 | orchestrator.spec.ts | Covered — labelled textarea, 4 preset buttons |
| OR-02 | orchestrator.spec.ts | Covered — Enter submits, Shift+Enter inserts a newline |
| OR-03 | orchestrator.spec.ts | Covered — disabled while empty and while in flight |
| OR-04 | orchestrator.spec.ts | Covered — six-step demo-kit plan |
| OR-05 | orchestrator.spec.ts | Covered — totals equal the sum of step prices |
| OR-06 | orchestrator.spec.ts | Covered — simulated path open, on-chain path gated |
| OR-07 | orchestrator.spec.ts | Covered — role=alert, never a blank plan card |
| OR-08 | orchestrator.spec.ts | Covered — empty state and invalid-task-id error |
| OR-09 | orchestrator.spec.ts | Covered — tablist ARIA and arrow/Home/End |
| OR-10 | orchestrator.spec.ts | Covered — iframe sandbox without `allow-same-origin` |

## WL — wallet and money · AZ — authorization

| criterion | spec | status |
| --- | --- | --- |
| WL-01 | wallet.spec.ts | Covered — connect prompt, no numeric balance while disconnected |
| WL-02 | wallet.spec.ts | **Added** — loading, failed and genuine-zero states each distinct |
| WL-03 | wallet.spec.ts | Covered — four contracts, explorer segment from reported network |
| WL-04 (route gating) | wallet.spec.ts | Covered — form unmounted, connect prompt offered |
| WL-04 (field validation) | — | **Not covered** — the destination and amount inputs only mount once `wallet.connected` is true, and no wallet extension exists in this environment. `stubWalletSession` reaches gated UI but cannot make signing work. Recorded as a comment in the spec, not a skipped test. |
| WL-05 | wallet.spec.ts | Covered — no lifecycle indicator while idle |
| WL-06 | wallet.spec.ts | Covered — 5 tests, no fabricated number, address or price |
| AZ-01 | api-contract.spec.ts | Covered — charge and seal both 401 without a key |
| AZ-02 | api-contract.spec.ts | Covered — 24 gated PDAX routes probed for refusal |
| AZ-03 | api-contract.spec.ts | Covered — envelope shape across 401/422/404/400 |
| AZ-04 | api-contract.spec.ts | Covered — bad charset and non-hex job id both 422 |
| AZ-05 | api-contract.spec.ts | Covered — reserved `agt_` namespace refused |
| AZ-06 | api-contract.spec.ts | Covered — XDR returned for a non-owner, pinning the on-chain boundary |
| AZ-07 | api-contract.spec.ts | Covered — 413 with hardening headers |
| AZ-08 | api-contract.spec.ts | Covered — three hardening headers on every response |
| AZ-09 | api-contract.spec.ts | Covered — no credential in any reachable JS chunk |

## AX — accessibility · PF — performance · RS — resilience

| criterion | spec | status |
| --- | --- | --- |
| AX-01 | a11y.spec.ts | Covered — 12-route sweep, one h1, no skipped levels |
| AX-02 | a11y.spec.ts | Covered — 12-route sweep |
| AX-03 | a11y.spec.ts | Covered — 12-route sweep |
| AX-04 | a11y.spec.ts | Covered — focused vs blurred computed style diff |
| AX-05 | a11y.spec.ts | Covered — landmarks and `html[lang]` |
| AX-06 | a11y.spec.ts | Covered — inline links not colour-only |
| AX-07 | a11y.spec.ts | **Added** — 6 keyboard journeys incl. drawer focus trap |
| PF-01 | resilience.spec.ts | Covered — 12 routes, TTFB/DCL/Load/LCP/CLS |
| PF-02 | resilience.spec.ts | Covered — cold start resolves within budget |
| RS-01 | resilience.spec.ts | Covered — outage sweep, no blank page, no fabricated zero |
| RS-02 | resilience.spec.ts | Covered — 500 auto-retried, 404 not |
| RS-03 | resilience.spec.ts | Covered — hang surfaces a timeout |
| RS-04 | resilience.spec.ts | Covered — 429 with and without `Retry-After` |
| RS-05 | resilience.spec.ts | **Added** — SSE drop, badge stops claiming live, polling fallback |
| RS-06 | resilience.spec.ts | Covered — 12 routes × 3 breakpoints |
| RS-07 | playwright.config.ts | Covered by configuration — chromium-desktop, chromium-mobile, webkit-desktop, firefox-desktop. Every spec is engine-agnostic; the matrix supplies the browsers. |

## AM — operator agent management (verifies 1.08)

| criterion | spec | status |
| --- | --- | --- |
| AM-01 | agent-management.spec.ts | Covered — owner wallet sees the manage action |
| AM-02 | agent-management.spec.ts | Covered — 2 tests: a non-owning wallet, and seeded `owner: null` rows checked against the *owning* wallet |
| AM-03 (copy) | agent-management.spec.ts | Covered — future-plans-only and signed-price wording asserted verbatim |
| AM-03 (on-chain) | — | **Blocked** — D-001, needs a signed transaction |
| AM-04 (copy) | agent-management.spec.ts | Covered — in-flight unaffected, history/reputation retained, never a delete |
| AM-04 (on-chain) | — | **Blocked** — D-001 |
| AM-05 | — | **Blocked** — D-001, needs a signed transaction that lands |
| AM-06 | api-contract.spec.ts | Covered — 404 `agent_not_found` on both endpoints, plus 422 validation on both |
