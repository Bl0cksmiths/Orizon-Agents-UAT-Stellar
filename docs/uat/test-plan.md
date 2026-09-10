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
