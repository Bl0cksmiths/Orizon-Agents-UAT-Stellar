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
