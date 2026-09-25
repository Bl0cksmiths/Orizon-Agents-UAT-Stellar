# Reputation drill — story 6.03e

What an upheld dispute costs the agent, measured on testnet: real ratings on a
real ReputationLedger, read back through the real API and off the chain. The
drill runs locally because no dispute can be upheld on the deploy (D-050,
D-051). It never uses the deployment's signer, ledger or money: it deploys its
own ledger instance from the wasm the deployed ledger already runs, and pays
credits in a test asset it issues itself.

## What it needs

- Python with `stellar_sdk`, and network access to testnet RPC, Horizon and
  friendbot.
- A backend checkout and its virtualenv (uvicorn, asyncpg, stellar_sdk).
- A Postgres the drill may write to, e.g. the one described in
  `tools/restart-drill/README.md`.
- For the browser half: a frontend checkout with its `node_modules`.

`DRILL_STATE` must be a directory outside the repo: `setup_testnet.py` writes
the drill's three secret keys there (`rc-testnet.json`).

## Run it

```sh
export DRILL_STATE=/tmp/rc-state             # outside the repo: holds secret keys
export DRILL_BACKEND=/path/to/Orizon-Agents-BE-Stellar
export DRILL_DSN=postgresql://drill@127.0.0.1:55432/orizon_drill
export DRILL_PYTHON=$DRILL_BACKEND/.venv/bin/python

# once: fund three accounts, create the ledger and the test asset
$DRILL_PYTHON tools/reputation-drill/setup_testnet.py

# the story at the production read TTL (15 s), then at 120 s, where a stale
# cache on the script path can no longer hide inside the TTL (D-066)
$DRILL_PYTHON tools/reputation-drill/drill.py run
DRILL_TTL=120 $DRILL_PYTHON tools/reputation-drill/drill.py run

# browser half: the marketplace badge and the plan card
export DRILL_FRONTEND=/path/to/Orizon-Agents-FE-Stellar
npx playwright test --config tools/reputation-drill/playwright.drill.config.ts
```

Each run adds four ratings to the agent, so the before numbers of a second run
are the after numbers of the first. The drill exits non-zero on any FAIL, and
on any XPASS: a check pinned to an open defect that now passes, whose pin must
then come off. `$DRILL_STATE/logs/record.json` holds every number the evidence
quotes.
