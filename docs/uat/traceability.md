# Traceability matrix

Every acceptance criterion in `test-plan.md` maps to the test that verifies it.
No cell is empty: a criterion is Covered, Added (written during this
programme), Blocked (with a defect id), or Not covered (with a stated reason).

Defect ids below link to the Bug issue filed in the repository that owns the
code; the full defect → issue table is under "Bug issues" in `defects.md`.

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

**Every row names the surface it was verified on, and the two disagree.** The
backend suite runs against `main`; the browser specs run against the deployed
orizons.xyz, which is 284 commits behind it (defect D-031). Three defects are
fixed on one surface and still present on the other, so a row that said only
"Pass" would be true of one build and false of the other.

| criterion | spec | status |
| --- | --- | --- |
| RF-01 | BE `tests/test_floor_boundaries.py` | **Pass** — cold-start agent offered to the free-form planner |
| RF-02 | BE `tests/test_floor_boundaries.py` | **Pass** — cold-start agent keeps its kit step, not substituted |
| RF-03 | BE `tests/test_floor_boundaries.py` | **Pass** — named in no notice on either path; routable silently |
| RF-04 | BE `tests/test_floor_disclosure.py` | **Pass** — kit exclusion notice names the agent and both deciding numbers |
| RF-05 | BE `tests/test_floor_disclosure.py` | **Partial** (`main`) — absent from the prompt (pass); still hired if the model names it anyway (xfail, D-028 open) |
| RF-06 | BE `tests/test_floor_boundaries.py` | **Pass** — lower bound exactly on the floor is admitted (`>=`) |
| RF-07 | BE `tests/test_floor_boundaries.py` | **Pass** — one basis point above the floor is admitted |
| RF-08 | BE `tests/test_floor_boundaries.py` | **Pass** — one bp below fails `passes_floor` and is kept out of both paths |
| RF-09 | BE `tests/test_floor_visibility.py` | **Pass** (`main`) — outage degrades every agent to the prior and still plans, on both paths |
| RF-10 | BE `tests/test_floor_visibility.py` | **Pass** (`main`) — exactly one warning per batch, naming agents, reason and both numbers |
| RF-11 | BE `tests/test_floor_visibility.py` | **Pass** (`main`) — outage plan reports `reputation_degraded: true`, cold start reports `false`; was D-024, marker removed. Neither field exists on the deployed build (D-031) |
| RF-12 | BE `tests/test_floor_disclosure.py` | **Pass** — kit backstop flags each step and states why the floor was relaxed |
| RF-13 | BE `tests/test_floor_disclosure.py` | **Pass** (`main`) — free-form now discloses the relaxation; was D-029, marker removed. Still absent on the deployed build (D-031) |
| RF-14 | `tests/reputation-floor.spec.ts` | **Partial** (deployed) — per-step reputation and source render in one frame; the floor panel ships collapsed so its actions do not (`test.fail()`, D-034). Below-floor step lacks an accessible name (D-035) |
| RF-15 | BE `tests/test_floor_visibility.py` | **Pass** (`main`) — startup warning added upstream; was D-030, marker removed |
| RF-16 | BE `tests/test_floor_boundaries.py` | **Partial** — arithmetic and rating direction pass; end-to-end blocked, see test-plan note |
| RF-17 | `tests/reputation-floor.spec.ts` | **Pass** (deployed) — `docs/evidence/rf-17-reputation-floor-plan.png`, with a provenance note asserted by test, stating the plan was supplied by the test and why the live target cannot produce one |

## EX — external agent execution path (story 6.05)

Recorded run 2026-09-17 on the **deployed** backend, which predates `main`
(D-036). "Run" is the evidence in `evidence/6.05-external-dispatch.md`; "Spec"
is re-checked live on every suite run.

| criterion | spec | status |
| --- | --- | --- |
| EX-00 | `tests/external-dispatch.spec.ts` — `EX-00 the settlement evidence route is deployed` | **Blocked** — `test.fail()`, D-036 |
| EX-01 | `tests/external-dispatch.spec.ts` — `EX-01 EX-07 the run's binding still reads back…`; run §1–§2 | **Pass** (deployed) — registration tx `64ad14cd…fa3e` |
| EX-02 | `tests/external-dispatch.spec.ts` — `EX-02 EX-07 a matching intent is decomposed…`, `EX-02 the captured dispatch envelope carries the documented fields`; run §3–§4 | **Partial** — routed ✔; envelope lacks `deadline_ms` (`test.fail()`, D-040) |
| EX-03 | `tests/external-dispatch.spec.ts` — three `EX-03` tests; run §5 | **Pass** (deployed) — verifies; tampered and replayed both rejected |
| EX-04 | run §6 (needs a payer key — not in CI) | **Pass** with D-039 — output in trace, artifact and `spent`; never charged |
| EX-05 | run §7 (needs a payer key — not in CI) | **Fail** — D-037, all six cases read `failed` with no class; continuation and `spent` exclusion hold |
| EX-06 | run §8 — ReputationLedger `getEvents`, 0 events | **Fail** — D-038 against 2.03 |
| EX-07 | `tests/external-dispatch.spec.ts` — the EX-01/EX-02 tests, re-run after the observed restart; run §9 | **Pass** — binding and routing survive; tasks do not (D-041) |
| EX-08 | `evidence/6.05-external-dispatch.md`, `evidence/6.05/dispatch-ok.json` | **Pass** — 2.04 capture table filled on a local backend branch (backend push is 403, D-027) |

## OS — operator surfaces (story 6.06)

Deployed dApp, 2026-09-17. "Checklist" rows need a person with real wallet
extensions and a real phone and have **not been run yet**.

| criterion | verification | status |
| --- | --- | --- |
| OS-01 | `evidence/6.06-operator-surfaces.md` §1 — clean-clone walk, transcripts | **Fail** — D-042 ([agent#2](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/2)), D-047 ([#3](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/3)), D-048 ([#4](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/4)), D-049 ([#5](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/5)); step 2 not walked (no Render account) |
| OS-02 | `checklists/6.06-wallet-and-phone.md` B | **Pending** (checklist not run); D-046 ([frontend#72](https://github.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/issues/72)) from source |
| OS-03 | `tests/operator-surfaces.spec.ts` — `OS-03 the registration page explains both signatures before anything is clicked` | **Pass** (deployed) |
| OS-04 | `checklists/6.06-wallet-and-phone.md` A, B | **Pending** (checklist not run) |
| OS-05 | `tests/operator-surfaces.spec.ts` — `OS-05 an already-bound agent shows the endpoint that reads back…`; 6.05 §2 API rebinds; checklist C | **Partial** — page and API pass; in-browser rebind pending |
| OS-06 | `tests/operator-surfaces.spec.ts` — three `OS-06 a … endpoint is refused before signing` tests, and `OS-06 an unresolvable endpoint…` | **Partial** — 3 pass; unresolvable `test.fail()`, D-043 ([backend#66](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/66)) |
| OS-07 | `tests/operator-surfaces.spec.ts` — no-wallet, owns-nothing, several-agents counts, failed-lookup-not-zero (pass); not-online `test.fail()` D-044 ([frontend#70](https://github.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/issues/70)); not-routable `test.fail()` D-045 ([#71](https://github.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/issues/71)); escrow note now passes (D-036 resolved 2026-09-24) | **Partial** |
| OS-08 | `tests/operator-surfaces.spec.ts` — two `OS-08 … fits the screen width` tests (emulated); checklist D | **Pending** — emulated width passes; real phone not run |

## EX — re-judged on the redeployed stack (2026-09-24)

The rows above describe the pre-2.06 build. After the redeploy the whole path
was driven again with a new agent (`uat624_ext_op`); see
`evidence/6.05-external-dispatch.md` §13. These rows supersede them.

| criterion | verification | status |
| --- | --- | --- |
| EX-00 | `tests/external-dispatch.spec.ts` — `EX-00 the settlement evidence route is deployed` (marker removed) | **Pass** — D-036 resolved |
| EX-01 | same spec — binding read-back; registration tx `e3f58a12…ce1b` | **Pass** |
| EX-02 | same spec — `EX-02 the captured dispatch envelope carries the documented fields` (marker removed; fixture `6.05/dispatch-2026-09-24.json`) and the routing test | **Pass** — D-040 resolved, `deadline_ms: 100000` |
| EX-03 | same spec — three `EX-03` tests against the new capture | **Pass** |
| EX-04 | run §13.3 (needs a payer key — not in CI) | **Pass** with D-039 ([contracts#3](https://github.com/Bl0cksmiths/Orizon-Agents-Smart-Contract-Stellar/issues/3)) — output in trace, artifact and `spent`; still never charged |
| EX-05 | run §13.3 | **Pass** — five distinct classes (`invalid_response`, `oversize_response`, `response_timeout`, `no_connection`, `error_status`); D-037 resolved |
| EX-06 | `tests/external-dispatch.spec.ts` — `EX-06 the re-run agent carries on-chain ratings…`; run §13.4 | **Pass** — 7 `rated` events, score falls on failure; D-038 resolved |
| EX-07 | same spec — binding and routing re-read after a week and several restarts | **Pass** |
| EX-08 | `evidence/6.05-external-dispatch.md` §13, `evidence/6.05/dispatch-2026-09-24.json` | **Pass** |
| EX-09 (new) | run §13.5 — `GET /api/tasks/{id}/disputes` returns `settlement: null` for a delivered run | **Fail** — D-050 ([backend#67](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/67)), the Epic 4 dispute path is unreachable |

## DP — the dispute happy path (story 6.03a)

Attempted 2026-09-24; `evidence/6.03a-dispute-path.md`. The story's own flow
could not start: no payment settles on this deployment, and refunds are switched
off in it.

| criterion | verification | status |
| --- | --- | --- |
| DP-01 | `tests/dispute-path.spec.ts` — `DP-01 a paid, delivered run exposes a settlement and a window to dispute against` | **Fail** — `test.fail()`, D-050 ([backend#67](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/67)), behind D-039 ([contracts#3](https://github.com/Bl0cksmiths/Orizon-Agents-Smart-Contract-Stellar/issues/3)) |
| DP-02 | same spec — `DP-02 an anonymous caller cannot uphold a dispute` / `… reject …` | **Pass**, with the refusal ambiguous while refunds are off (D-051, D-052) |
| DP-03 | same spec — `DP-03 a dispute challenge for a job that never settled is refused as unknown_job` | **Pass** |
| DP-04 | same spec — `DP-04 a finished run answers the dispute endpoint with a task-shaped payload` | **Pass** |
| DP-05 | needs the settler key and a recorded session | **Blocked** — D-050, D-051; no dispute exists to uphold |
| DP-06 | needs a sealed job id from an attestation | **Blocked** — `proof_tx` is null on every run (D-039) |
| DP-07 | needs a recorded session on an open dispute | **Blocked** — the receipt panel never renders, `settlement` is null |

## DR — the dispute refusal paths (story 6.03b)

Run 2026-09-24; `evidence/6.03b-dispute-refusals.md`. Criteria inferred from the
story title — see the scope note in `test-plan.md`.

| criterion | verification | status |
| --- | --- | --- |
| DR-01 | `tests/dispute-refusals.spec.ts` — two `DR-01 a dispute challenge with …` tests | **Pass** |
| DR-02 | same spec — `DR-02 opening a dispute with a forged nonce and signature is refused…` | **Pass** |
| DR-03 | same spec — three `DR-03 opening a dispute with …` tests | **Pass** |
| DR-04 | same spec — `DR-04 reading a dispute that does not exist…` | **Pass** |
| DR-05 | same spec — `DR-05 a settled run refuses a dispute challenge from a wallet that is not its payer` | **Blocked** — `test.fail()`, D-050 ([backend#67](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/67)) |
| DR-06 | `tests/dispute-path.spec.ts` — `DP-02 an anonymous caller cannot uphold/reject a dispute` | **Pass**, code ambiguous while refunds are off — D-051 ([backend#68](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/68)), D-052 ([backend#69](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/69)) |
| DR-07 | walk by hand once DR-05 passes | **Blocked** — D-050 |
| DR-08 | walk by hand once DR-05 passes | **Blocked** — D-050 |
| DR-09 | walk by hand once DR-05 passes | **Blocked** — D-050, D-051 |
| DR-10 | walk by hand once DR-05 passes | **Blocked** — D-050 |
| DR-11 | walk by hand once DR-05 passes | **Blocked** — D-050, D-051 |

## IB — idempotency on the money path (story 6.03b)

Run 2026-09-24; `evidence/6.03b-idempotency.md`. Nothing could be run on the
deploy (D-050, D-051), so every row is verified in code only, and none counts as
a pass until it resolves on Stellar Expert.

| criterion | verification | status |
| --- | --- | --- |
| IB-01 | code attack of all seven paths, evidence §2; on-chain count once unblocked | **Fail** — D-053, D-058 (both held privately) |
| IB-02 | backend `test_dispute_svc.py`, `test_dispute_store.py` race tests; frontend `dispute-dialog.test.tsx`, `e2e/disputes.spec.ts:373`; live once D-050 clears | **Blocked** — D-050; gap D-057 |
| IB-03 | backend `test_adjudication.py` credited-dispute tests, `test_uphold_script.py`; live once D-050 and D-051 clear | **Blocked** — D-050, D-051 |
| IB-04 | backend `test_dispute_job_id.py`, `test_dispute_rating_flow.py`; Stellar Expert lookup once unblocked | **Blocked** — D-050, D-051 |
| IB-05 | backend cap tests in `test_refund_svc.py` and the uphold script tests; live once D-051 clears | **Blocked** — D-051; D-054, D-055 open |

## WC — who may dispute and when (story 6.03c)

Run 2026-09-24/25; `evidence/6.03c-eligibility.md`. Only the API side of the
reason rules is reachable on the deploy; the rest was run locally against the
real backend and frontend and waits on D-050 for a live run.

| criterion | verification | status |
| --- | --- | --- |
| WC-01 | backend window tests in `test_dispute_svc.py`, local run §2; live once D-050 clears | **Fail** — D-056; live run blocked by D-050 |
| WC-02 | frontend `e2e/disputes.spec.ts:565` (no dialog open), local run §3 | **Fail** — D-060; live run blocked by D-050 |
| WC-03 | frontend `e2e/disputes.spec.ts:283`, `:311`, `:145`; backend `test_a_signature_from_another_wallet_is_refused`; local run | **Blocked** — D-050 (holds locally) |
| WC-04 | backend `test_an_expired_challenge_is_refused_and_says_to_ask_for_another`, `test_the_buyer_s_signature_verifies_once_and_only_once`; local run | **Blocked** — D-050 (holds locally) |
| WC-05 | `tests/dispute-eligibility.spec.ts` — `WC-05` empty and whitespace tests (**pass** live), zero-width and right-to-left tests (`test.fail()`, D-059); frontend `e2e/disputes.spec.ts:158` | **Fail** — D-059 |
| WC-06 | `tests/dispute-eligibility.spec.ts` — `WC-06` multi-byte cap test (**pass** live); `DR-03` 501-character test (**pass** live); frontend `dispute-dialog.test.tsx:388-416` | **Fail** — D-062 |

## DU — durability and the unconfirmed-refund path (story 6.03d)

Run 2026-09-25; `evidence/6.03d-durability.md`. The restarts were run locally
with `tools/restart-drill/` (a real backend on a real Postgres, hard-killed, and
the real frontend). The deploy has no settled step to restart around (D-050).

| criterion | verification | status |
| --- | --- | --- |
| DU-01 | `drill.py du01` (15 checks) and `du01-control`; `browser.spec.ts` "DU-01 an open dispute reads the same after a backend restart"; with task auth on: `drill.py token-gap`, `browser.spec.ts` "DU-01 with TASK_AUTH_REQUIRED on …" (`test.fail()`, D-065) | **Pass** locally; live blocked by D-050; D-065 latent |
| DU-02 | `drill.py du02`, `drill.py token-gap`; `browser.spec.ts` "DU-02 …" (a dispute signed and raised through the dialog after a restart) | **Pass** locally; live blocked by D-050 |
| DU-03 | `drill.py du04` (`crediting`, hash, no amount, no rating, through a restart); `browser.spec.ts` "DU-03 …"; frontend `dispute-status-badge.test.tsx`, `dispute-receipt.test.tsx` | **Pass** locally; live blocked by D-050, D-051 |
| DU-04 | `drill.py du04` (exit 10 then 6, one transfer signed, queue before and after a restart, "DO NOT RE-RUN"; rating checks XFAIL, D-064); `browser.spec.ts` "DU-04 …" (`test.fail()`, D-064) | **Fail** — D-064 |
| DU-05 | `tests/durability.spec.ts` — uptime and binding-older-than-the-process tests (**pass** live); `drill.py du01` boot-log checks (dispute store XFAIL, D-063) | **Pass** on the deploy by proxy; D-063 |

## RC — the reputation consequence and routing (story 6.03e)

Run 2026-09-25; `evidence/6.03e-reputation-consequence.md`. The upheld path ran
on testnet with `tools/reputation-drill/`: a real backend on a real Postgres, and
the drill's own ReputationLedger built from the deployed wasm. The deploy can
uphold nothing (D-050, D-051).

| criterion | verification | status |
| --- | --- | --- |
| RC-01 | `drill.py run` phase_chain: `count` +2, `disputed` +2, `dispute_rate_bps` rose, smoothed score fell, and the average is the weighted mean (0 → 5000 bps and 3333 → 5000 bps, both recorded); `tests/reputation-consequence.spec.ts` "RC-01 …" (`test.fail()`, D-051) | **Pass** on testnet; live blocked by D-050, D-051 |
| RC-02 | `drill.py run` phase_chain: `kind` `dispute`, rating 10, weight 1 000 000 = the quoted price, not the 3 500 000 settled, all decoded from four transaction envelopes | **Pass** on testnet |
| RC-03 | `drill.py run` phase_chain: the rating job id's first 8 bytes equal the sealed job's, the rest differs, and the settler's rating is still under the sealed id (4 of 4) | **Pass** on testnet |
| RC-04 | `drill.py run` phase_api (API path: the plan decomposed at once stamps the new count and rate, **pass**) and phase_script (script path at a 120 s TTL: the old score for 91.9 s, XFAIL, D-066); `tests/reputation-consequence.spec.ts` "RC-04 …" (plan stamp = route, **pass** live); `tools/reputation-drill/browser.spec.ts` badge and plan card (**pass** at a 120 s TTL: ★ 3.44 · 8 ⚑ 50.0% on both) | **Fail**: D-066 on the script path; the display half passes |
| RC-05 | `drill.py run` phase_open: two open disputes; the route at once, the route after the TTL, and a plan are all unchanged | **Pass** on testnet |
