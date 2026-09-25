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
