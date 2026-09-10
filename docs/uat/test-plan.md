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
