# Dispute UI drill — story 6.03f

Every state of the dispute receipt, read on the real trace page. Built on the
6.03e reputation drill (`tools/reputation-drill/`): its own ReputationLedger,
its test asset UATUSD and its settler, which is that ledger's scorer. So every
refund and every rating a receipt links to is a real testnet transaction, and
nothing of the deployment's is touched. Local only: the deploy cannot hold a
dispute until D-050 and D-051 are fixed.

```sh
# the 6.03e environment (see tools/reputation-drill/README.md), after its setup_testnet.py
export DRILL_STATE=... DRILL_BACKEND=... DRILL_DSN=... DRILL_PYTHON=...
export DRILL_FRONTEND=/path/to/Orizon-Agents-FE-Stellar
export NODE_EXTRA_CA_CERTS=...   # only behind an intercepting proxy, for the Horizon reads

$DRILL_PYTHON tools/dispute-ui-drill/seed.py      # every state, into $DRILL_STATE/ui-seed.json
cd tools/dispute-ui-drill && npx playwright test -c playwright.drill.config.ts
```

The "live" and "gap" states are changed by the run (FS-09 upholds one, FS-10
rates the other), so seed again before each run. The phone project runs only
the `@phone` tests.

| State | How seed.py reaches it |
| --- | --- |
| open | a settlement, and a dispute opened with the payer's real signature |
| credited | `POST /api/disputes/{id}/uphold`: a real refund and a real rating |
| rejected | `POST /api/disputes/{id}/reject`, after the same route refuses no reason and a blank one |
| crediting | the claim taken as uphold takes it, a real transfer, recorded as a transfer TIMEOUT records it |
| rating_pending | a real refund and a real rating, recorded as a rating TIMEOUT records it (`rating_confirmed=false`) |
| gap | a real refund recorded, no rating yet; `seed.py rate-gap` lands and records the rating |
| upheld | a dispute moved to `upheld` with no transfer, where a refused or failed transfer leaves it |
| live | left open for FS-09 to uphold through the route |

`serve.py` runs the backend with each task's read token registered, as
`/api/orchestrator/execute` registers it for the tab that ran the task. The
browser spec puts the token in the payer's tab where the tab that ran the task
would hold it. It leaves the token out to test every other viewer.
