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

## PR — on-chain provenance in the marketplace (verifies 1.02 / 1.08)

| criterion | spec | status |
| --- | --- | --- |
| PR-01 (API) | api-contract.spec.ts | Covered — both directions asserted, plus owner cross-checked against the raw contract read |
| PR-01 (UI) | provenance.spec.ts | Covered — on-chain id is not `agt_`-prefixed beside exactly 12 seeded rows; price and status match the API |
| PR-02 | provenance.spec.ts, api-contract.spec.ts | Covered for the render path and the `active → status` mapping; the write half is **Blocked** — D-001 |
| PR-03 | provenance.spec.ts | Covered for the render path; write half **Blocked** — D-001 |
| PR-04 | — | **Blocked** — D-001, needs a signed price change to observe |
| PR-05 | api-contract.spec.ts | Covered — sync returns a numeric count and is idempotent for an unchanged chain |

Supporting: `price` fidelity (`marketplace price == raw / 1e7`, zero explicitly
allowed) is asserted in api-contract.spec.ts, and an empty agent list rendering
a truthful empty state is asserted in provenance.spec.ts.

## VR — registration validation and rate-limit recovery (verifies 1.03 / 1.09)

| criterion | spec | status |
| --- | --- | --- |
| VR-01 | api-contract.spec.ts, registry.spec.ts | Covered — `id_malformed` for both a bad charset and a 35-char id at the availability gate; RG-04 covers the inline form message |
| VR-02 | api-contract.spec.ts, registry.spec.ts | Covered — `id_reserved`; RG-05 covers the form |
| VR-03 | api-contract.spec.ts, registry.spec.ts | Covered — `id_taken` returns the current owner; RG-06 covers pre-signature timing |
| VR-04 | registry.spec.ts | Covered by RG-04 — price 0 and price above the cap |
| VR-05 | registration-validation.spec.ts | Covered — `owner_account_unfunded`'s verbatim sentence |
| VR-06 | registration-validation.spec.ts, resilience.spec.ts | Covered — RS-04 pins the wait copy; VR-06 pins that all typed values survive |
| VR-07 | registration-validation.spec.ts | Covered — zero availability requests while typing, exactly one on blur |

Supporting: a well-formed, never-registered id returns `available: true`
(proving the gate is not hardcoded to refuse), and `build/register-agent`'s
Pydantic guard is pinned as a **separate** mechanism answering 422
`validation_error` rather than `id_malformed` — so unifying the two layers
cannot silently remove the pre-signature gate.

## WM — wallet × browser registration matrix (verifies 1.05)

| criterion | spec | status |
| --- | --- | --- |
| WM-01 | wallet-picker.spec.ts | Covered — all six allowlisted wallets listed; picker dismissible without connecting; no auto-connect |
| WM-02 | — | **Not covered by automation.** The guard needs a real wallet reporting a network. Worse, it *cannot* fire for Albedo or LOBSTR at all — defect D-015. Verify per cell, by hand. |
| WM-03 | — | **Manual.** 25 cells in `wallet-browser-matrix.md`. Needs real extensions and a human signature; cannot be automated. |
| WM-04 | — | **Manual.** Recorded live in `docs/evidence/1.07-friction-log.md` (backend repo) by an observer, during the run. |

WM-03 and WM-04 have no automated cell and never will — that is a property of
the criteria, not a gap in the suite. Automating them would fabricate the
evidence they exist to gather.

## RE — end-to-end registration on testnet (verifies 1.04 / 1.05 / 1.02)

| criterion | spec | status |
| --- | --- | --- |
| RE-01 | registration-validation.spec.ts | Covered — register renders all three fields editable with a connect prompt; `/app/send` mounts no payment form. Both sides asserted in one test, since the criterion is the contrast. |
| RE-02 | registration-validation.spec.ts | Covered — blurring a free id shows the affirmative available state, no error, `aria-invalid="false"` |
| RE-03 | — | **Blocked** — D-001 (target is mainnet) and needs a human approving a wallet prompt |
| RE-04 | — | **Blocked** — same; requires a confirmed on-chain registration to observe |

RE-03 and RE-04 cannot be automated even after the flip: they need a funded
external wallet and an unaided human. See also D-022 — following the flip
runbook exactly would leave `orizon_batch` unregistered on testnet, so the
settlement half of this journey would fail at charge time.

## RF — reputation floor and routing boundaries (story 6.02)

Backend criteria are verified in the **backend** repo's pytest suite, against
the real service and both real planners with only the Soroban `rep_state` read
stubbed (test-plan.md, method B). Browser criteria are verified here.

| criterion | spec | status |
| --- | --- | --- |
| RF-01 | BE `tests/test_floor_boundaries.py` | Pending |
| RF-02 | BE `tests/test_floor_boundaries.py` | Pending |
| RF-03 | BE `tests/test_floor_boundaries.py` | Pending |
| RF-04 | BE `tests/test_floor_disclosure.py` | Pending |
| RF-05 | BE `tests/test_floor_disclosure.py` | Pending |
| RF-06 | BE `tests/test_floor_boundaries.py` | Pending |
| RF-07 | BE `tests/test_floor_boundaries.py` | Pending |
| RF-08 | BE `tests/test_floor_boundaries.py` | Pending |
| RF-09 | BE `tests/test_floor_visibility.py` | Pending |
| RF-10 | BE `tests/test_floor_visibility.py` | Pending |
| RF-11 | BE `tests/test_floor_visibility.py` | Pending |
| RF-12 | BE `tests/test_floor_disclosure.py` | Pending |
| RF-13 | BE `tests/test_floor_disclosure.py` | Pending |
| RF-14 | `tests/reputation-floor.spec.ts` | Pending |
| RF-15 | BE `tests/test_floor_visibility.py` | Pending |
| RF-16 | BE `tests/test_floor_boundaries.py` | Pending |
| RF-17 | `tests/reputation-floor.spec.ts` | Pending |
