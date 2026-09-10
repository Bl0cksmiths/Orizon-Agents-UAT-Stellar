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
