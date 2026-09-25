# UAT test plan — Orizon Agents

## Scope

User-acceptance testing for the deployed Orizon Agents stack: the Next.js
frontend, the FastAPI backend it proxies to, and the four Soroban contracts
both read from.

## Target environment

| layer | value |
| --- | --- |
| Frontend | `UAT_BASE_URL`, default `https://orizons.xyz` |
| Backend | proxied same-origin at `/api/*` |
| Network | read from `GET /api/stellar/network`, asserted against `UAT_EXPECTED_NETWORK` |

The expected network is **configuration, not a constant**. At the time of
writing the deployment reports `network: "mainnet"` while this programme is
specified as testnet-only, so no test may sign a transaction until that is
reconciled — see `defects.md` D-001.

## What this application is not

The generic UAT checklist assumes a database, user accounts, roles, and
third-party payment/email/SMS integrations. This system has none of them:

- **No database.** Backend state is in-process (`app/state.py`), bounded to the
  most recent 200 tasks and lost on restart. Durable facts live on-chain.
- **No user accounts.** There is no sign-up, login, password reset, or session.
  Identity is a Stellar keypair held by a browser wallet extension.
- **No role table.** Authorization is three distinct mechanisms, documented in
  the actor matrix below.

Test plan sections that would only restate an absent feature are omitted
deliberately rather than filled with fabricated coverage.

## Feature inventory — frontend routes

| route | purpose | wallet needed |
| --- | --- | --- |
| `/` | marketing landing page | no |
| `/app` | console overview, metrics, recent tasks | no |
| `/app/agents` | agent registry table, owner-gated manage panel | to manage |
| `/app/register` | register an agent on-chain | to submit |
| `/app/reputation` | reputation explainer, leaderboard, score calculator | no |
| `/app/orchestrator` | intent decompose, plan, execute | to pay on-chain |
| `/app/trace` | live SSE trace, artifact viewer | no |
| `/app/events` | Soroban contract event feed, polled from the browser | no |
| `/app/send` | send native XLM | yes |
| `/app/wallet` | balance, session, deployed contract addresses | partial |
| `/app/flow` | agent-graph visualiser | no |
| `/app/pdax` | PHP fiat on/off-ramp panels | no (API-key gated upstream) |

## Feature inventory — backend endpoints

Open (no credential):

| method | path |
| --- | --- |
| GET | `/health`, `/api/health`, `/readiness`, `/` |
| GET | `/api/agents`, `/api/agents/{id}` |
| POST | `/api/orchestrator/decompose`, `/api/orchestrator/execute` |
| GET | `/api/tasks`, `/api/tasks/{id}`, `/api/tasks/{id}/artifact` |
| GET | `/api/trace/{id}`, `/api/trace/{id}/stream` (SSE) |
| GET | `/api/metrics/overview`, `/api/flow/default` |
| POST | `/api/payments/x402` |
| GET | `/api/stellar/network`, `/agent/{id}`, `/agent-id-available/{id}` |
| GET | `/api/stellar/reputation`, `/reputation/params`, `/reputation/{id}` |
| GET | `/api/stellar/attestation/{job_id}`, `/new-id` |
| POST | `/api/stellar/build/{register-agent,update-price,set-active,authorize}` |
| POST | `/api/stellar/submit`, `/api/stellar/agents/sync` |
| GET | `/api/pdax/environment`, `/health`, `/reference*` |

API-key gated (`X-API-Key`):

| method | path |
| --- | --- |
| POST | `/api/stellar/server/charge`, `/api/stellar/server/seal` |
| GET/POST | `/api/pdax/*` except the open routes above — balances, trade, fiat and crypto withdraw, ramp, webhooks/register |

## Actor and permission matrix

There is no role table. Authorization is three independent mechanisms:

| actor | credential | may do | must be blocked from |
| --- | --- | --- | --- |
| Anonymous visitor | none | read every open route; decompose; execute simulated | server charge/seal; any PDAX money route; managing an agent they do not own |
| Wallet owner | Stellar keypair in a browser wallet | register an agent; update price / set active for agents they own; authorize an escrow payment; send XLM | mutating another owner's agent — enforced on-chain by `owner.require_auth()`, not by the API |
| Operator | `X-API-Key` | server-signed charge and seal; all PDAX routes | nothing additional; the key is the highest privilege in the system |
| Backend settler | `STELLAR_SIGNING_KEY` (server-side only) | `PaymentEscrow.charge`, `AttestationRegistry.seal`, `ReputationLedger.submit` | never exposed to any client |

Two properties worth testing explicitly because they are easy to regress:

- Ownership is enforced by the **contract**, not the build endpoint. The API
  will happily build unsigned XDR for an agent the caller does not own; the
  transaction fails on-chain. A UAT test must assert the build succeeds and the
  submission fails, not that the build is refused.
- With `TASK_AUTH_REQUIRED` off (the deployed default) every task id is
  world-readable. That is a deliberate demo posture, not a defect — but it is
  worth pinning so a future flip is a conscious change.

## Acceptance criteria — EV, registration evidence capture (parent 6.01, verifies 1.07)

**EV-01** — Given a successful registration, When the success card renders,
Then it shows the transaction hash, a `stellar.expert` transaction link, and
the owner rendered as a `stellar.expert` **account** link.

**EV-02** — Given the success card, When the reviewer clicks *Copy evidence*,
Then the clipboard holds a complete block containing agent id, owner, tx hash,
both `stellar.expert` links, the network name, and a timestamp.

**EV-03** — Given a captured tx hash and agent id, When a reviewer runs
`python scripts/verify_registration.py --tx <hash> --agent <id> --api-base <url>`,
Then it prints PASS and exits 0, having confirmed the transaction exists on
Horizon, succeeded, its source matches the owner, and the agent is listed with
`source: onchain` and a matching owner.

**EV-04** — Given only the `stellar.expert` transaction link, When a
non-technical reviewer opens it, Then the registration is confirmable without
running code and without a follow-up question.

**EV-05** — Given the evidence block, When the network is read from it, Then it
names the network the deployment actually reports at `/api/stellar/network`,
never a hardcoded value.

Blocked pending the testnet flip: EV-01 through EV-04 require a real
registration, which requires signing a transaction with a funded wallet on the
target network. See `defects.md` D-001. EV-05 is testable now against the
evidence builder's pure logic.

## Acceptance criteria — MK, marketing and discovery

**MK-01** — Given a first-time visitor, When `/` loads, Then title, meta
description and Open Graph tags are present and describe this product.

**MK-02** — When the JSON-LD block is parsed, Then it is valid JSON and
declares the expected `@type` entries.

**MK-03** — When each primary nav link and the Launch App CTA is activated,
Then it resolves to a real route that returns 200.

**MK-04** — When the page is read top to bottom, Then every marketing section
renders in the expected document order.

**MK-05** — When `/robots.txt` and `/sitemap.xml` are fetched, Then both are
served and the sitemap URL named in robots matches the real sitemap route.

**MK-06** — When an unknown path is requested, Then the 404 page renders with
a route back into the app.

**MK-07** — When `/` finishes loading, Then no console error and no failed
network request occurs, excluding a documented allowlist.

## Acceptance criteria — CN, console shell and read-only journeys

**CN-01** — Given any console route, When it loads, Then the shell renders a
sidebar with all eleven nav items, a topbar, and a `main` landmark.

**CN-02** — When a sidebar item is activated, Then the app navigates to that
route and the item marks itself current.

**CN-03** — Given a mobile viewport, When the hamburger is activated, Then the
drawer opens with `role="dialog"` and `aria-modal`, Escape closes it, focus
returns to the opener, and background content carries `inert` while open.

**CN-04** — Given the overview, When metrics are loading, Then skeletons show;
When loaded, values render; When the fetch fails, an error surfaces — and a
failure is never rendered as a zero or a dash.

**CN-05** — When `/app/flow` loads, Then the agent graph renders its nodes and
edges, or fails loudly.

**CN-06** — When `/app/events` loads, Then the feed renders, or shows a
truthful connecting/empty/unavailable state.

**CN-07** — Given a failed data load on any console route, When the page
settles, Then the shell still renders and no white screen occurs.

## Acceptance criteria — RG, registry, registration and reputation

**RG-01** — When `/app/agents` loads, Then the table renders with its expected
columns and every row shows a name, skills and a price.

**RG-02** — Given a reputation read that fails, When the table renders, Then
seeded values still display and the table does not white-screen.

**RG-03** — Given no wallet, When `/app/agents` renders, Then the owner-gated
manage panel is not offered.

**RG-04** — Given `/app/register`, When each field is left invalid, Then the
exact message from `lib/register-validation.ts` is shown for a bad id charset,
an over-length name, a non-positive price, and a price above the cap.

**RG-05** — Given a reserved `agt_` prefix, When the id is submitted for
availability, Then it is refused as reserved.

**RG-06** — Given an id already registered on-chain, When availability is
checked, Then it is reported taken before any signature is requested.

**RG-07** — Given no wallet, When the form is otherwise valid, Then submit
remains disabled and the connect prompt is offered.

**RG-08** — Given `/app/reputation`, When mean and weight are entered into the
score calculator, Then the smoothed score and lower bound match
`lib/reputation-math.ts` for the prior-only, mid-evidence and saturated cases.

**RG-09** — When the reputation leaderboard loads, Then it renders rows or a
truthful empty/loading state.

## Acceptance criteria — OR, orchestrator and trace

**OR-01** — Given `/app/orchestrator`, When the page loads, Then the intent
textarea has an associated label and each of the four preset buttons populates
it verbatim.

**OR-02** — When Enter is pressed in the textarea, Then the form submits; when
Shift+Enter is pressed, Then a newline is inserted.

**OR-03** — When the intent is empty or a decompose is in flight, Then submit
is disabled.

**OR-04** — Given a curated demo-kit intent, When decompose returns, Then a
six-step plan renders, each step showing an agent, a price and a rationale.

**OR-05** — Given a rendered plan, When the totals row is read, Then it equals
the sum of the step prices within rounding tolerance.

**OR-06** — Given no wallet, When the plan renders, Then the on-chain
authorize path is gated behind a connect prompt and the simulated path remains
available.

**OR-07** — Given a decompose that fails, When the page settles, Then a
visible `role="alert"` is shown and no blank plan card is mounted.

**OR-08** — Given `/app/trace` with no task parameter, Then a truthful empty
state renders; with an unknown task id, Then an error renders, not a white
screen.

**OR-09** — Given the trace view, When the tablist is used, Then roles,
`aria-selected` and arrow/Home/End navigation behave correctly.

**OR-10** — Given a rendered artifact, When the preview iframe is inspected,
Then it carries `sandbox="allow-scripts"` and does **not** carry
`allow-same-origin`.

## Acceptance criteria — WL, wallet, payments and fiat ramp

**WL-01** — Given no wallet, When `/app/wallet` renders, Then the connect
prompt is shown and no numeric balance appears anywhere on the page.

**WL-02** — Given the four states of a balance read (disconnected, loading,
failed, genuinely zero), When each renders, Then all four are distinguishable
and none of the first three renders as `0`.

**WL-03** — When the contracts grid resolves, Then it shows four contract
addresses, each linking to `stellar.expert` on the network the deployment
reports — never a hardcoded segment.

**WL-04** — Given no wallet, When `/app/send` renders, Then the payment form
is not mounted and the connect prompt is offered.

**WL-05** — Given no wallet, When `/app/send` is idle, Then no transaction
lifecycle indicator is shown.

**WL-06** — Given `/app/pdax` and an unauthenticated upstream, When the panels
settle, Then each shows real data or a labelled error — never a fabricated
number, address or price.

## Acceptance criteria — AZ, authorization and API contract

**AZ-01** — Given no credential, When `POST /api/stellar/server/charge` is
called, Then it is refused, and the same for `/server/seal`.

**AZ-02** — Given no credential, When each API-key-gated PDAX route is called,
Then every one is refused with a consistent error shape.

**AZ-03** — Given any error response, When the body is read, Then it carries
the unified envelope: a `detail` field plus an `error` object with `code`,
`message` and `request_id`.

**AZ-04** — Given a malformed path parameter (bad agent id charset, non-hex
job id), When the endpoint is called, Then it answers 422 without a stack
trace and without a Soroban round-trip.

**AZ-05** — Given an id in the reserved `agt_` namespace, When
`/build/register-agent` is called, Then it is refused as reserved.

**AZ-06** — Given an agent the caller does not own, When `/build/update-price`
is called, Then unsigned XDR is still returned — ownership is enforced on
chain, not here — and this is asserted deliberately so a future change is a
conscious one.

**AZ-07** — Given a request that exceeds the body limit, Then it is refused
with 413 carrying the hardening headers.

**AZ-08** — Given every response, When headers are inspected, Then
`x-content-type-options`, `referrer-policy` and `x-frame-options` are present.

**AZ-09** — Given the client bundle, When it is searched, Then no signing key,
API key or PDAX credential appears in it.

## Acceptance criteria — AX, accessibility

**AX-01** — Given each of the twelve routes, When the document is inspected,
Then it has exactly one `h1` and heading levels do not skip.

**AX-02** — Given each route, When images are inspected, Then every one has an
`alt` attribute.

**AX-03** — Given each route, When interactive elements are inspected, Then
every one has an accessible name.

**AX-04** — Given each route, When Tab is pressed, Then the focused element
has a visible focus indicator.

**AX-05** — Given each route, When landmarks are inspected, Then `main` and
`nav` are present and `html` carries a `lang` attribute.

**AX-06** — Given inline prose links, When they are inspected, Then they do
not rely on colour alone to be distinguishable.

**AX-07** — Given each core journey, When navigated by keyboard only, Then it
is completable without a pointer.

## Acceptance criteria — PF, performance

Budgets are regression guardrails against the deployed free-tier stack, not
vendor SLAs. Measured with the API stubbed, to isolate frontend render cost
from backend cold-start variance.

| metric | budget |
| --- | --- |
| TTFB | 2.0 s |
| DOMContentLoaded | 4.0 s |
| Load | 6.0 s |
| LCP | 3.5 s |
| CLS | 0.1 |

**PF-01** — Given each of the twelve routes, When loaded with the API stubbed,
Then every metric above is within budget.

**PF-02** — Given a cold backend, When the first request is made, Then the app
resolves to content or a truthful error within the documented cold-start
budget, and never hangs indefinitely.

## Acceptance criteria — RS, resilience and error recovery

**RS-01** — Given a total backend outage, When each `/app` route loads, Then
the shell renders and a visible error state is shown — never a blank page and
never a fabricated zero value.

**RS-02** — Given a backend returning 500, When a route loads, Then the
failure is presented as transient and recoverable, distinctly from a terminal
404.

**RS-03** — Given a backend that hangs, When the client deadline elapses, Then
a timeout error surfaces rather than an indefinite spinner.

**RS-04** — Given a 429 carrying `Retry-After`, When the response is handled,
Then the wait is communicated with the copy from
`lib/rate-limit-message.ts`, not a generic failure.

**RS-05** — Given the SSE trace stream drops, When the client recovers, Then
it reconnects or falls back to history polling, and the UI stops claiming to
be live while disconnected.

**RS-06** — Given each route at 390×844, 768×1024 and 1440×900, When rendered,
Then no horizontal overflow occurs.

**RS-07** — Given Chromium, Firefox and WebKit, When each core journey runs,
Then it passes on all three.

## Entry criteria

- The target deployment answers `GET /api/health` with 200.
- `GET /api/stellar/network` reports the network named by `UAT_EXPECTED_NETWORK`.
- The suite installs from a clean checkout with `npm ci`.
- No Blocker defect is open against the target build.

## Exit criteria

- Every criterion above is Pass, or is Blocked with a defect id and a written
  reason. No criterion is left untested and unexplained.
- No open Blocker or Critical defect.
- The traceability matrix has no empty cells.
- Typecheck, lint and the full suite are green in CI on the `uat` branch.
- The sign-off report records the browser and viewport matrix actually run,
  not the matrix intended.

## Defect severity

| severity | definition |
| --- | --- |
| Blocker | UAT cannot proceed, or the defect risks funds or data. Fix before any further testing in that area. |
| Critical | A core journey is unusable with no workaround, or a security control does not hold. |
| Major | A journey is degraded or a non-core feature is broken; a workaround exists. |
| Minor | Cosmetic, copy, or a low-impact inconsistency with no functional effect. |

## Acceptance criteria — AM, operator agent management (parent 6.01, verifies 1.08)

**AM-01** — Given a connected wallet whose address equals an agent's on-chain
owner, When its row is opened on `/app/agents`, Then a management action is
offered (change price, delist/relist).

**AM-02** — Given an agent the connected wallet does not own — including every
seeded agent, which has no on-chain owner at all — Then no management action is
present anywhere on that row.

**AM-03** — Given the price control, When it is read, Then the confirmation
states that a price change applies to future plans only and that a buyer who
already authorized a workflow is charged the price they signed against.

**AM-04** — Given the delist control, When delist is chosen, Then the
confirmation states that in-flight authorized work is unaffected and that
reputation and history are retained, and never presents the action as a delete.

**AM-05** — Given a signed price change or delist, When the transaction lands,
Then the marketplace listing and future plans reflect it, and relisting
restores a delisted agent.

**AM-06** — Given an unregistered agent id sent directly to
`/api/stellar/build/update-price` or `/build/set-active`, Then the response is
a plain `agent_not_found` 404 in the standard error envelope, not an opaque
build failure.

AM-05 is blocked: it requires signing a real transaction, and the target
reports mainnet while this programme is testnet-only (D-001). AM-03 and AM-04
are split — the confirmation copy is verified now; the on-chain landing is
blocked with AM-05. No test may click a control that triggers a signature.

## Acceptance criteria — PR, on-chain provenance in the marketplace (parent 6.01, verifies 1.02 / 1.08)

**PR-01** — Given an agent registered on-chain, When `/api/agents` is read,
Then it carries `source: "onchain"` and a non-null `owner`, and is thereby
distinguishable from the seeded catalog, whose entries carry `agt_` ids,
`source: "seeded"` and a null `owner`.

**PR-02** — Given an owned agent is delisted on-chain, When the sync completes,
Then it reports `status: "offline"` and stays present in the marketplace with
its skills, price and owner intact — never removed, and never presented as
deleted. Its reputation lives in ReputationLedger, independent of the listing
flag, so it survives a delist by construction.

**PR-03** — Given a delisted agent, When it is relisted, Then it returns to
`status: "online"`.

**PR-04** — Given an owned agent's price is changed on-chain, When the
marketplace is read again, Then the new price is reflected without waiting for
the next scheduled sync pass.

**PR-05** — Given the on-demand sync endpoint, When `POST
/api/stellar/agents/sync` is called, Then it returns the number of agents
mirrored, which is the mechanism that makes PR-04 immediate rather than
eventual.

PR-02, PR-03 and PR-04's write halves are blocked: each needs a signed
transaction, and the target reports mainnet while this programme is
testnet-only (D-001). PR-01 and PR-05 are verified now, and the
`active → status` mapping PR-02/PR-03 depend on is asserted against the
contract that produces it.

## Acceptance criteria — VR, registration validation and rate-limit recovery (parent 6.01, verifies 1.03 / 1.09)

**VR-01** — Given an agent id with a disallowed character, or longer than 32
characters, When availability is checked, Then it is refused as `id_malformed`
before any signature is requested.

**VR-02** — Given an `agt_`-prefixed id, Then it is refused as `id_reserved`.

**VR-03** — Given an id already registered on-chain, Then it is refused as
`id_taken` at check time — before signing, not only as the contract's
`AlreadyExists` — and the response names the current owner.

**VR-04** — Given a price of 0, or above the 10,000 cap, Then a validation
error is shown and submit stays blocked.

**VR-05** — Given a wallet with no funded account, When the build is
attempted, Then the operator is told to fund the wallet
(`owner_account_unfunded`), not shown a generic failure.

**VR-06** — Given a 429 while registering, When it is handled, Then the wait
is communicated in plain language, **and every value already typed into the
form survives** — the form is recoverable, not dead.

**VR-07** — Given continuous typing in the id field, Then the on-chain
availability check fires on blur, not once per keystroke.

Coverage note: VR-01's charset case, VR-02, VR-03 and VR-04 are already
covered by RG-04, RG-05 and RG-06, and VR-06's message by RS-04. This round
adds only what those miss — the over-length id, the reason codes at the API,
VR-05, VR-06's form-state survival, and VR-07.

## Acceptance criteria — WM, wallet × browser registration matrix (parent 6.01, verifies 1.05)

**WM-01** — Given each SOW §3.3 wallet (Freighter, xBull, Albedo, LOBSTR,
Hana), When the connect picker is opened on `/app/register`, Then that wallet
is offered.

**WM-02** — Given a connected wallet, When its reported network differs from
the network this build expects, Then signing is refused with a wrong-network
error before the signing popup opens — never silently signed.

**WM-03** — Given each wallet × browser cell (5 wallets × Chrome, Firefox,
desktop Safari, mobile Safari, mobile Chrome), When an unaided external
contributor registers an agent, Then the transaction lands and the agent
lists, or the failure is captured.

**WM-04** — Given any hesitation, question, confusion or error during a cell,
Then it is recorded in `docs/evidence/1.07-friction-log.md` with a severity,
whether or not it was a defect. Coaching a step is a finding, not a pass.

**Execution note.** WM-03 and WM-04 are **manual and cannot be automated**.
Each cell needs a real browser extension installed, a human approving a
signature in that extension's own UI, and — per the friction log's own
instructions — an *external, non-Blocksmiths* contributor working unaided with
an observer recording friction live. Playwright cannot install these
extensions, cannot drive their popups, and cannot be "unaided". Automating any
part of it would fabricate the evidence the exercise exists to gather.
WM-01 and WM-02 are automatable and are covered here.

## Acceptance criteria — RE, end-to-end registration on testnet (parent 6.01, verifies 1.04 / 1.05 / 1.02)

**RE-01** — Given no connected wallet, When `/app/register` is opened, Then the
form is visible and fillable with a connect prompt beside submit — it is **not**
hard-gated the way `/app/send` is, where the whole form is unmounted.

**RE-02** — Given a valid id, When the id field loses focus, Then the
availability check confirms it is free and shows no error.

**RE-03** — Given a completed form and an approved wallet prompt, When Register
is clicked, Then the status advances building → signing → broadcasting →
success and the success card shows a transaction hash within the confirm
window. A FAILED transaction shows a decoded reason plus the hash — never a
crash.

**RE-04** — Given a confirmed registration, When the marketplace is read within
about 15 seconds, Then the agent appears in `GET /api/agents` and on
`/app/agents` with `source: "onchain"` and the registering wallet as `owner`.

**Execution status.** RE-01 and RE-02 are automatable and covered. **RE-03 and
RE-04 are blocked** on two independent counts:

1. The target still reports **mainnet** (D-001). This task is specified
   testnet-only, and its own setup step requires "the testnet-configured
   orizons.xyz". Running it as-is would mean a real mainnet registration
   spending real XLM against non-upgradable contracts.
2. Even on testnet it needs a **funded external wallet and a human approving a
   signing prompt**, unaided. No automation can supply that, and supplying it
   from a Blocksmiths key would violate the task's own premise.

## Story 6.01 — coverage map against its seven acceptance criteria

6.01 is the parent of the QA tasks already executed in this programme. Its
criteria map onto existing coverage as follows, rather than being re-tested.

| 6.01 criterion | covered by | status |
| --- | --- | --- |
| Registration succeeds on every SOW wallet | — | **Not verified.** Needs 5 wallets, a funded testnet account each, and a human at the signing prompt. |
| Cross-browser behaviour verified | WM-01 (picker), RS-07 (4 browser projects) | Partial — the picker and page behaviour are covered; per-wallet *signing* behaviour is not. |
| Rejection preserves form state | inspection + `wallet-errors.test.ts` (`user_rejected`) | Behaviour correct in source; the register page's own rejection branch is **untested** — see below. |
| Wrong-network caught with clear message | `wallet-errors.test.ts` ("switch-network advice"), D-015 | Copy verified; **unsatisfiable for Albedo and LOBSTR**, which cannot report their network. |
| Mobile registration on a real phone | RS-06, AX sweep (viewports) | Viewport rendering covered; a real device is not. |
| All validation cases behave | RG-04, RG-05, RG-06, VR-01, VR-02, VR-03 | **Covered.** |
| Every defect filed as a linked Bug | `defects.md` | Recorded here; this programme has no issue-tracker access, so none is filed as a tracker Bug. |

**Why the rejection branch is untested.** `app/app/register/page.tsx` keeps
every field and shows a neutral notice when a signature is declined — verified
by reading it. It cannot be exercised automatically: driving it requires making
`wallet.signXdr` reject with a user-rejected error, and the session stub used
elsewhere in this suite seeds `localStorage` only — it cannot control the
wallet layer. The frontend's own unit suite deliberately gates coverage to
`lib/**`, excluding page components, so there is no second place to test it
either. Recorded as a known gap rather than papered over.

## Acceptance criteria — RF, reputation floor and routing boundaries (story 6.02)

The floor is interesting only at its edges. This section tests four states —
cold start, exactly at the floor, one basis point either side of it, and a
total RPC outage — on **both** planning paths (free-form and demo-kit), plus
the two backstops that keep a battered registry workable.

**Two behaviours here are correct and must not be "fixed".** Both are argued in
`reputation_svc.py`'s module docstring and are verified, not filed:

1. **The floor fails open during an RPC outage.** Unreadable evidence means
   "reputation unknown", and the product's answer to unknown reputation is
   "routable". Failing closed would drop every agent below the floor at once
   and hand routing to the starvation backstop, which picks a top-N by
   identical prior scores — the same agents hired, with weaker semantics.
2. **A brand-new agent with zero ratings is routable.** That is the cold-start
   invariant permissionless registration (Deliverable 1) depends on.

### How the four reputation states are produced

Producing a genuinely sub-floor agent is the hard part of this story, and it is
planned here rather than improvised. Reputation is derived, not settable: the
only inputs are `sum_w` / `weight` / `count` / `disputed` in the
`ReputationLedger` contract, written by the backend settler after a settled
workflow. There are exactly three ways to reach a chosen state, and each buys a
different grade of evidence:

| method | what is real | what is substituted | used for |
| --- | --- | --- | --- |
| **A — real settled workflows** | everything | nothing | RF-16 (direction of travel) |
| **B — stubbed ledger read, real service + routing** | all scoring arithmetic, the floor, both planners, every log line and response field | only `simulate_read("rep_state")`, the one call that leaves the process | RF-01…RF-13, RF-15 |
| **C — intercepted HTTP response in the browser** | the plan card's rendering | the entire backend | RF-14 only (a UI-rendering criterion) |

**Method B is the workhorse and it is honest.** The sub-floor state is not
asserted into existence — the test supplies the same `rep_state` map the
contract would return for an agent with heavy negative evidence, and the real
`smoothed_bps` → `lower_bound_bps` → `passes_floor` chain decides the outcome.
To sit one basis point below the floor an agent needs a decayed weighted mean
that drags its Wilson lower bound to 5499; those inputs are computed from the
shipped arithmetic in the fixture, never hardcoded, so a change to the prior or
to `WILSON_Z` moves the fixture with it instead of silently un-testing the edge.

**Method A cannot manufacture a sub-floor agent within this programme.** It
would take repeated settled workflows delivering no output (synthetic rating
20/100) against an agent, each one a real testnet settlement signed by
`STELLAR_SIGNING_KEY` — a key UAT deliberately does not hold
(`.env.uat.example`). Method A is therefore used only to prove reputation moves
in the right direction after genuinely settled work (RF-16), which needs no key.

### Cold start and sub-floor, on both planning paths

**RF-01** — Given an agent with zero ratings (a readable ledger returning
`count: 0, weight: 0`), When a free-form intent is decomposed, Then the agent
is offered to the planner as routable.

**RF-02** — Given the same cold-start agent, When a demo-kit intent is
decomposed, Then it keeps its pipeline step and is not substituted.

**RF-03** — Given the same cold-start agent, When either path produces a plan,
Then it appears in no exclusion, substitution or degradation notice — a
newcomer is routable *silently*, not routable-with-a-warning.

**RF-04** — Given an agent whose on-chain evidence puts its lower bound below
the floor, When a demo-kit intent is decomposed, Then it is excluded from the
plan and the response carries a notice naming it, with a reason stating it fell
below the routing floor and the two deciding numbers.

**RF-05** — Given the same sub-floor agent, When a free-form intent is
decomposed, Then it is absent from the planner's `AVAILABLE_AGENTS` block, and
is absent from the returned plan even if the model names it anyway.

### The boundary is tested exactly

**RF-06** — Given an agent whose Wilson lower bound is exactly
`REPUTATION_FLOOR_BPS`, When the floor is evaluated, Then it passes. The
comparison is `>=`; an agent sitting precisely on the line is in, not out.

**RF-07** — Given an agent one basis point above the floor, When the floor is
evaluated, Then it passes.

**RF-08** — Given an agent one basis point below the floor, When the floor is
evaluated, Then it fails — and the same agent, tested through a full decompose
on both paths, is kept out of the plan. A boundary that holds in the arithmetic
but not in the planner is not a boundary.

### An outage fails open, visibly

**RF-09** — Given Soroban RPC is unreachable for every agent in the batch, When
a plan is built, Then every agent falls back to the Bayesian prior, each marked
`degraded: true`, and the decompose still returns a plan rather than an error.

**RF-10** — Given that outage, When the batch degrades, Then **exactly one**
WARNING is logged for the whole batch — not one per agent — and the line names
the affected agents, the failure reason, and which way the floor is failing
with both deciding numbers.

**RF-11** — Given that outage, When the resulting plan reaches the client, Then
the client can tell the outage apart from a genuine cold start. `source:
"prior"` reports both states identically, so the degraded signal must survive
onto the response the plan card reads.

### The backstop is disclosed when it fires

**RF-12** — Given most agents fall below the floor, When a demo-kit plan is
built, Then the `_MIN_ROUTABLE_AGENTS` backstop re-admits the strongest dropped
agents, each re-admitted step is flagged, and the response states the floor was
relaxed and why.

**RF-13** — Given the same registry state, When a free-form plan is built, Then
the backstop keeps the planner supplied with agents **and** the response
discloses that the floor was relaxed. A relaxation the buyer cannot see is the
silent reshuffle story 3.02 exists to prevent.

### What the buyer sees, and what the operator is warned about

**RF-14** — Given a plan whose shape the floor changed, When the plan card
renders, Then a single frame shows, for every step, the agent's reputation and
whether it came from the chain or the prior; and, for every floor action, the
agent named, the action taken, and the reason including the applied floor in
basis points.

**RF-15** — Given `REPUTATION_FLOOR_BPS` configured above the prior's own lower
bound, When the backend starts, Then it logs a warning naming both numbers and
stating the consequence — that no new agent can ever be routed, because a
cold-start agent scores exactly the prior. Config that silently bricks
permissionless onboarding must not start quietly.

**RF-16** — Given an agent that completes settled workflows, When ratings are
submitted for those steps, Then its reputation moves in the direction the
delivered work justifies: an agent that ships artifacts gains, an agent whose
steps produce no output loses, and the movement is bounded by the evidence
weight of the settled value rather than by the number of runs.

**RF-17** — Given a plan showing per-agent reputation alongside an excluded
sub-floor agent, When the evidence screenshot is captured, Then one frame
satisfies SOW §6.1 Deliverable 2, and the evidence index records the image, the
exact intent, the reputation state behind it, and how that state was produced.
Evidence that does not say how it was made is not evidence.

**RF-16 execution note — verified live as far as it can be, then at the service
level.** A full workflow was run against the live testnet target on 2026-09-12
(`calculator web app` → `tsk_9c1d3dbc25edcce8`, 6 agents, 0.168 USDC, status
`complete`). Reputation did **not** move, and that is correct: `_submit_ratings`
in `execution_svc.py` runs only when `_settle_onchain` returned a `charge_tx`
and a `job_id`, which requires a wallet-signed x402 authorization. A simulated
run settles no money, so it mints no reputation — reputation is a record of
settled economic history, exactly as `reputation_svc.py` claims.

The consequence for this programme is that the *direction of travel* cannot be
observed end to end from UAT, for the same structural reason RE-03/RE-04 are
blocked: it needs a funded wallet and a human at a signing prompt, and the
suite deliberately holds no key. RF-16 is therefore verified where the decision
is actually made — `synthetic_rating` and the smoothing/lower-bound chain it
feeds — and recorded as partially blocked rather than claimed as an end-to-end
pass.


## Acceptance criteria — EX, external agent execution path (story 6.05, verifies 2.01–2.04)

One real external agent, driven from registration through dispatch to a rated
result, **against the deployed service** — never localhost, and never through
the stubbed HTTP seam the 2.0x unit tests use. Testnet only.

This is the one section of the plan that needs signing keys, so it does not run
from CI. The on-chain half is a recorded run with throwaway friendbot-funded
keys (`docs/uat/evidence/6.05-external-dispatch.md`); what can be re-checked
without a key — the signature, the binding, routing, the entry route — is
re-checked live by `tests/external-dispatch.spec.ts`. The operator endpoint is
`tools/operator-endpoint/server.ts`, which records each request byte-for-byte
before parsing and can be switched into each failure mode from loopback.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| EX-00 | 6.05's precondition | `GET /api/stellar/settlement/{id}` on the target | `200`, not the framework 404 — the backend carries 2.06 |
| EX-01 | a wallet you control, funded on testnet | it registers an agent and signs a bind challenge for an HTTPS endpoint you control | the registration tx succeeds, and `GET /api/agents/{id}/binding` reads the binding back with that owner |
| EX-02 | the bound agent | an intent matching its skills is decomposed | the agent is a step of the plan — offered to the planner, not merely listed — and the captured envelope carries the documented fields |
| EX-03 | a received dispatch and the signer at `GET /api/stellar/network` | it is verified with the operator guide's recipe | it verifies; a tampered body and the same signature against a different endpoint URL both fail |
| EX-04 | the endpoint returns a valid result | the run completes | the output appears in the trace and the artifact, and `spent` includes that step |
| EX-05 | a timeout, a refused connection, an oversize response and malformed JSON | each is triggered | each produces its own failure class in the trace, the workflow continues, and the buyer is not charged for the failed step |
| EX-06 | an external step that fails | the run finalizes | a rating for the agent reaches `ReputationLedger` and its score moves — non-delivery has a cost (2.03) |
| EX-07 | a bound agent | the backend restarts | the binding still reads back and the agent is still decomposed onto |
| EX-08 | the completed run | the evidence is filed | it holds the registration tx, the binding, the raw dispatch, the verification output, the traces and every tx hash, and fills the 2.04 runbook's capture table |

**How the failure modes are produced.** Malformed, oversize and timeout are
endpoint modes. A refused connection cannot be produced through a tunnel — a
down origin behind one answers with a proxy 502, a removed tunnel with a
Cloudflare 530 — so both of those were run *and* a genuine TCP refusal was
produced by binding to `https://scanme.nmap.org:444/dispatch`, a host published
for exactly this kind of test traffic.

**What "restart" means here.** Nobody on this programme can restart the Render
service. The free tier restarts it after ~15 idle minutes; EX-07 is observed
across one of those, proven by `/api/health` `uptime_seconds` resetting.

## Acceptance criteria — OS, operator surfaces: reference agent, binding flow, dashboard (story 6.06, verifies 2.01 / 2.04 / 2.05 / 2.06)

6.01's treatment applied to the second signature. Registration is a
transaction (`signTransaction`); binding is a signed message (`signMessage`),
and wallets differ far more on the second. A wallet that registers but cannot
bind is a finding, not something to work around.

Three surfaces, three kinds of verification:

- **What a page shows without a wallet prompt** — disclosure copy, endpoint
  refusals, dashboard states, emulated phone width — is asserted live by
  `tests/operator-surfaces.spec.ts`, with a wallet *session* stubbed where a
  connected address is needed (it cannot sign).
- **What needs a real wallet prompt or a real phone** is run by a person from
  `docs/uat/checklists/6.06-wallet-and-phone.md`.
- **The reference agent** is walked from a clean clone on a laptop, literally,
  and recorded in `evidence/6.06-operator-surfaces.md`.

"No earnings" on the dashboard is expected and is not a defect: zero customer
payments have ever settled. What is tested is whether the page says so honestly.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| OS-01 | a clean clone of the reference agent and no prior context | its README is followed literally | each command does what it says; each that does not is filed against 2.04 with its output |
| OS-02 | each wallet named in SOW §3.3 | an endpoint is bound | it succeeds, or the wallet's inability to sign messages is documented and the SOW claim corrected |
| OS-03 | the registration page | it is read before anything is signed | it already says listing takes two signatures and what the second is for |
| OS-04 | any wallet, at either prompt | the signature is rejected | every form value survives and the message is neutral, not an error |
| OS-05 | an agent already bound | it is bound to a different endpoint | the change succeeds and the new endpoint is what reads back, in the API and on the page |
| OS-06 | a plaintext, private, loopback or unresolvable endpoint | it is submitted | it is refused before anything is signed, with a message naming the rule |
| OS-07 | no wallet, a wallet owning nothing, a wallet owning several agents | each is opened on `/app/operator` | each states its own situation accurately, and no sentence claims more than the system knows |
| OS-08 | a real phone | the binding flow and the dashboard are used | every field, message and figure is usable and legible |

**Fixture wallets for OS-07** — never cleaned up, all testnet: no agents
`GDJHP2I6…PKXJ` (6.05 payer); several unbound `GBI2I3WL…ADBH`
(`w1_audit_a7x`, `sign_probe_bb5c12`); one bound `GBWMD26I…7BQJ`
(`uat605_ext_op`). The spec re-derives counts from `/api/agents` and the binding
reads on every run rather than hard-coding them.

### EX-09 — a finished run can be disputed (added 2026-09-24, stories 4.02 / 4.05 / 4.06)

Epic 4 shipped a dispute window, dispute and adjudication endpoints, a refund
executor and a dispute UI on `/app/trace`, and no criterion in this plan covers
any of it. This is the smallest criterion that says whether a buyer can reach
it at all; the epic still needs QA of its own.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| EX-09 | a workflow that finished and delivered | its disputes are read (`GET /api/tasks/{task_id}/disputes`) | a settlement and a closing time come back, the trace announced the window, and a delivered step can be disputed inside it |

Verified against the run, not in CI: it needs a payer key. On 2026-09-24 it
**fails** — no settlement is ever recorded because the charge never lands
(D-050, behind D-039).

## Acceptance criteria — DP, the dispute happy path (story 6.03a, verifies 4.02–4.06)

One real dispute, from a settled payment to both on-chain artifacts. The story
is deliberately a single sitting with a screen recording running, because the
proof is the sequence: pay → receipt → dispute → uphold → the receipt flipping
to "Refunded" without a reload → both transactions resolving on Stellar Expert.

Three things in it are not QA's to do alone: `scripts/uphold_dispute.py` signs
with the settler secret (Dan's), the recording needs a person, and the evidence
is a session artifact rather than a test run. What the suite can hold is
whether the path is reachable at all — which is what DP-01 measures, and why it
is the first criterion rather than a footnote.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| DP-01 | a paid workflow that delivered | its disputes are read | a settlement and a closing window come back, so a step can be disputed |
| DP-02 | no adjudicator credentials | uphold or reject is called | it is refused, and nothing is adjudicated |
| DP-03 | a job that never settled | a dispute challenge is minted for it | it is refused as `unknown_job` |
| DP-04 | any finished run | `GET /api/tasks/{task_id}/disputes` | it answers with that task's id, a `settlement` field and a `disputes` list |
| DP-05 | an upheld dispute | its two transactions are opened on Stellar Expert | a transfer of the credited amount to the buyer and a `kind="dispute"` reputation write both resolve, and the credited amount matches the receipt |
| DP-06 | the dispute rating's transaction | its job id is compared with the sealed job id from the attestation | the first 8 bytes are identical |
| DP-07 | the trace page open on an open dispute | the dispute is upheld and credited | the receipt shows "Refunded" with both links, without a reload, and the recording shows it happening |

DP-05 to DP-07 need the settler key and a recorded session; DP-01 to DP-04 run
in `tests/dispute-path.spec.ts` on every suite run. On 2026-09-24 DP-01 fails
(D-050) and DP-05 to DP-07 are blocked behind it and D-051.

## Acceptance criteria — DR, the dispute refusal paths (story 6.03b, verifies 4.02–4.04)

**Scope is inferred.** The story was supplied as a title only, so these criteria
are QA's reading of "the dispute refusal paths" — every refusal the dispute API
can produce — and are written against behaviour observed on the deployed
service (`evidence/6.03b-dispute-refusals.md`). Replace them if the story's own
criteria differ; the tests assert observed behaviour and will survive a
renumbering.

A refusal is only tested if it can be reached. DR-01 to DR-04 and DR-06 need
nothing but a request; the rest need a settled dispute, which no deployment has
produced yet (D-050), and are pinned rather than assumed.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| DR-01 | a malformed job id or a negative step index | a dispute challenge is requested | it is refused `422`, naming the field that was wrong |
| DR-02 | a forged nonce and signature | a dispute is opened with them | it is refused, and the answer does not reveal whether the signature was the problem |
| DR-03 | a reason past the 500-character cap, a payer that is not a G-address, or no reason | a dispute is opened | it is refused `422` before the job is looked up, naming the field |
| DR-04 | a dispute id that does not exist | it is read | it is refused `404 unknown_dispute`, with a request id and no traceback |
| DR-05 | a settled run and a wallet that is not its payer | that wallet raises a dispute | it is refused for authorization, not for a missing job |
| DR-06 | no adjudicator credentials | uphold or reject is called | it is refused and nothing is adjudicated |
| DR-07 | a dispute window that has closed | a step from that run is disputed | it is refused, and the closing time is stated |
| DR-08 | a step already disputed | the same step is disputed again | `409`, carrying the existing dispute id |
| DR-09 | a dispute already upheld or rejected | it is adjudicated again | it is refused and the first outcome stands |
| DR-10 | a challenge nonce already used | it is replayed | it is refused — one use per nonce |
| DR-11 | a credit that would exceed `max_refund_usdc` | the dispute is upheld | it is refused as over the cap, and nothing is transferred |

Rate limiting (`429`) is advertised by every dispute route and is deliberately
not tripped from the functional suite: the deployed limiter is a whole-service
bucket, so exercising it would throttle the shared target for everyone else.

## Acceptance criteria — IB, idempotency on the money path (story 6.03b, verifies 4.03–4.05)

These are the story's own criteria; they arrived after DR was written from the
title alone. Where they overlap, IB governs: DR-08 is IB-02, DR-10 and DR-11
are attacks under IB-01 and IB-05, and **DR-09 is superseded for upheld
disputes** — re-upholding a credited dispute is not refused, it is answered
with the existing credit and retries the rating only (IB-03).

Every money assertion resolves on Stellar Expert, counting credits from the
settler on the buyer's account; a UI claim is not evidence.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| IB-01 | all seven attacks run against one dispute where they apply (second dispute on a step, double-click, two tabs, replayed signed body, re-uphold, two concurrent upholds, over-cap uphold) | the buyer's account is examined on Stellar Expert | exactly one credit from the settler exists per upheld dispute |
| IB-02 | a step that already has a dispute | it is disputed again | `409 duplicate_dispute` carrying the original dispute, and the UI shows that dispute rather than a second form |
| IB-03 | a credited dispute | the uphold is run again | no transfer is signed, the recorded refund hash is unchanged, and the rating comes back as a replay |
| IB-04 | two upheld disputes against one agent on two steps of one workflow | both ratings are looked up on Stellar Expert | two distinct `kind="dispute"` writes resolve, neither refused as a replay of the other |
| IB-05 | a computed credit above `MAX_REFUND_USDC` | the uphold is attempted | nothing reaches the chain, and the refusal names the amount and the cap |

On 2026-09-24 none can be run on the deploy (D-050, D-051). They were attacked
in code instead — `evidence/6.03b-idempotency.md` — and IB-01 fails there
(D-053, D-058).

## Acceptance criteria — WC, who may dispute and when (story 6.03c, verifies 4.02, 4.05)

A dispute is authorised by the paying wallet's signature over a live
challenge (ADR 0007 D2), not by the task token: the token proves someone holds
the link, not that they paid. Both signature encodings real wallets produce —
raw bytes and SEP-53 — must be accepted. The window's closing time is the one
stamped at settlement, whatever `DISPUTE_WINDOW_SECONDS` says later. A non-payer
sees nothing: no disabled control, no hint.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| WC-01 | disputes attempted just inside and just after the closing time | each is submitted | the first is accepted (`open`) and the second refused, naming when the window closed |
| WC-02 | the trace page open with the window about to close | the closing time passes | every dispute action disappears without a reload |
| WC-03 | a non-payer's wallet connected to the same trace | they look for and attempt a dispute | no dispute action is present, and a signed attempt from that wallet is refused |
| WC-04 | a reused nonce and an expired nonce | each is submitted | both are refused, and neither message reads as "wrong wallet" |
| WC-05 | an empty reason | submission is attempted in the UI and directly against the API | the UI submit stays disabled and the API refuses |
| WC-06 | a reason longer than 500 characters | it is entered | the field caps it, and whatever is submitted is stored whole |

Also exercised under these IDs: a wallet that is not connected sees the receipt,
the window and a prompt to connect the paying wallet (WC-03); an undelivered,
uncharged step has no dispute action and is refused by the API (WC-03).

On 2026-09-25 only the API side of WC-05 and WC-06 can be reached on the deploy
— the reason is checked before the job — and runs in
`tests/dispute-eligibility.spec.ts`. Everything else needs a settled step
(D-050) and was verified by running the backend and frontend locally:
`evidence/6.03c-eligibility.md`.

## Acceptance criteria — DU, durability and the unconfirmed-refund path (story 6.03d, verifies 4.02–4.06)

Durability is tested by restarting, not by reasoning: Render restarts an idle
free-tier service routinely, and `/health` reports `uptime_seconds`, so a
restart can be seen from outside. None of this holds without `DATABASE_URL`;
the store announces itself in the log. A timed-out refund is never retried
automatically — the dispute keeps its claim and stays `crediting` until a
person reconciles it, which is correct behaviour, not a defect.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| DU-01 | an open dispute and a backend restart | the trace page is reloaded | the dispute still exists with its status, reason, amounts and the same closing time |
| DU-02 | a settled workflow and a backend restart | a step is disputed afterwards | the dispute is accepted |
| DU-03 | a refund submitted but not confirmed | the receipt is viewed | it shows a pending refund and a "Refund in progress" badge, and nowhere says the credit is complete |
| DU-04 | a dispute left in `crediting` | the reconciliation queue is read and the script is run again | the dispute is in the queue, and the script refuses and tells the operator not to re-run it |
| DU-05 | the deployed backend | its startup log is read | it names Postgres, not the in-memory fallback |

Also under these IDs: with `TASK_AUTH_REQUIRED` on, a restart loses task tokens
but never a buyer's ability to raise or read a dispute (DU-01, DU-02); a credit
reconciled by hand carries its amount and rating confirmation (DU-04).

On 2026-09-25 only DU-05 could be checked on the deploy, and by proxy rather
than from the log: a binding older than the running process is still served
(`tests/durability.spec.ts`). The restarts behind DU-01 – DU-04 were run locally
with `tools/restart-drill/`: a real backend hard-killed on a real Postgres, the
real uphold script, and the real frontend as the payer.
`evidence/6.03d-durability.md` has the results.

## Acceptance criteria — RC, the reputation consequence and routing (story 6.03e, verifies 3.02 / 4.04)

An upheld dispute is more than a refund: the settler writes a second rating
(kind `dispute`, 10/100) beside its own, never replacing it, so the agent's
`dispute_rate_bps` rises and its score falls. The rating is weighted by the
step's quoted price and filed under a job id derived from the sealed one, whose
first 8 bytes are the sealed job's. A landed rating invalidates the cached score,
so the next plan sees it without waiting out the 15 s read TTL. An unadjudicated
dispute moves nothing. Prerequisite: `/readiness` `ratings.writer` is `scorer`.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| RC-01 | the agent's reputation before an upheld dispute | it is read again afterwards | `dispute_rate_bps` has risen, `count` is one higher, and both numbers are recorded |
| RC-02 | the dispute rating on Stellar Expert | its arguments are inspected | `kind` is `dispute` and the weight is the step's quoted price, not the settled total |
| RC-03 | the rating's job id and the sealed job id | they are compared | the first 8 bytes are identical |
| RC-04 | a dispute rating that has just landed | a new intent is decomposed within seconds | the plan, and the marketplace badge, show the updated score, not the pre-dispute one |
| RC-05 | a dispute that has not been adjudicated | the agent's reputation is read | it is unchanged |

On 2026-09-25 no dispute could be upheld on the deploy (D-050, D-051). There,
`tests/reputation-consequence.spec.ts` checks the scorer prerequisite and that a
plan stamps what the reputation route reads. RC-01 stays pinned as an expected
failure. The upheld path ran on testnet with `tools/reputation-drill/`: a real
backend and Postgres, the drill's own ReputationLedger built from the deployed
wasm, and both ways to uphold (the adjudication route, and
`scripts/uphold_dispute.py` in its own process). `evidence/6.03e-reputation-consequence.md`
has the before and after numbers and every transaction.

## Acceptance criteria — DS, the dispute UI and receipt in every state (story 6.03f, verifies 4.05 / 4.06)

The receipt on the trace page is a recorded evidence artifact (SOW §6.1), so
wording is tested as strictly as behaviour. The rule to hunt for: nothing may
read as done until the chain says so. The buyer's reason and the rejection
reason are for the payer only. Other viewers see the status and the times.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| DS-01 | the five dispute states: open, crediting, credited, credited with the rating unconfirmed, rejected | each is read | each explains itself (open says what is next, rejected says why), and no unconfirmed credit or rating reads as complete |
| DS-02 | a credited dispute | both links are opened | they resolve on Stellar Expert (testnet) to that dispute's refund transfer and dispute rating |
| DS-03 | the credited amount | its line is read | it says the platform funded it and that it was not clawed back from the agent |
| DS-04 | a rejected dispute | it is viewed by the payer and by anyone else | the payer sees the reason, nobody else does (not on screen, in the page source or in any response), and no rejection can be recorded without one |
| DS-05 | the page open on an open dispute | it is upheld and credited | the receipt reaches "Refunded" with both links, with no reload |
| DS-06 | a credited receipt on a phone | it is viewed | there is no horizontal scroll and both links are tappable |
| DS-07 | a screen reader on the receipt | the countdown runs and the status changes | the countdown is not announced, and each status change is announced once |

## Acceptance criteria — AD, the adjudication door and the refund switch (story 6.03g, verifies 4.03)

`POST /api/disputes/{id}/uphold` is the one route that spends the platform's own
balance, on an operator's say-so, with nothing on-chain bounding it. Refunds
ship off (`DISPUTE_REFUNDS_ENABLED=false`). Turning them on makes `API_KEY`
mandatory at boot on every network. The guard (`require_adjudicator`) fails
closed on every request. This is mostly negative testing. Any 500 on this door
is an Urgent Bug, and a refusal must not reveal the route's shape.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| AD-01 | `DISPUTE_REFUNDS_ENABLED=false` | uphold and reject are called, with a valid key and without | both are refused 503 `dispute_refunds_disabled`, and nothing is signed |
| AD-02 | refunds enabled and an empty `API_KEY` | the service starts | it refuses to boot, with a message naming `API_KEY` |
| AD-03 | a missing, wrong, short and non-ASCII key | each calls uphold (and reject) | each is refused 401 (503 while refunds are off), never 500 |
| AD-04 | no key and an invalid body (wrong shape, or malformed JSON) | uphold or reject is called | the guard's refusal answers, not a validation error |
| AD-05 | a reject with no, null, empty or whitespace-only note, and a valid key | each is submitted | each is refused and the dispute does not change state |
| AD-06 | a payer raising a dispute | they submit with only their wallet signature | it is accepted with no API key involved |

The deploy runs with refunds off, and they must stay off until D-053 is fixed,
so nothing on it was toggled. `tests/adjudication-door.spec.ts` holds the
refunds-off answers live. The refunds-on half (AD-02, AD-03 and AD-04 with a
key configured, AD-05, AD-06 and AD-01 with a valid key) runs against a real
local backend in `tools/adjudication-drill/`.
