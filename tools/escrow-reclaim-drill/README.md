# Escrow reclaim drill — story 6.07, EP-04

An authorization that was never executed, reclaimed from the console of the
deployed dApp once it expired. Live, on testnet, with real signatures: the
dApp's own code builds and submits every transaction, and a Freighter shim
(`tools/escrow-path-drill/freighter-shim.ts`, imported, never edited here)
signs it with the QA buyer key.

The one interception is an aborted `POST /api/orchestrator/execute`, as a
dropped connection would leave it. Nothing else is stubbed. A run takes about
35 minutes: the dApp authorizes for 1800 s, and the escrow refuses a reclaim
until the ledger clock passes `expires_at`. The plan card is the only place
the console keeps that authorization, so one page stays open for the whole run.

## Run it

Hold the 6.07 run lock for the whole run. Then, from the repository root:

```sh
ESCROW_DRILL_KEY=/path/outside/repo/buyer.json \
RECLAIM_STATE=/path/outside/repo/reclaim \
npx playwright test --config tools/escrow-reclaim-drill/playwright.drill.config.ts
```

- `ESCROW_DRILL_KEY` is the buyer key file written by
  `tools/escrow-path-drill/buyer.py fund`. It holds a secret and must stay
  outside the repository.
- `RECLAIM_STATE` receives `reclaim-run.json`, every hash, id and time the run
  saw, and Playwright's output. The drill refuses a directory inside the
  repository.

Nothing is cleaned up on chain: every transaction is evidence. The results go
in `docs/uat/evidence/6.07-reclaim.md`.
