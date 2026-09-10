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
