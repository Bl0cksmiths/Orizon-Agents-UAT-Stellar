# E2E run (story 6.04, OV-08)

One complete validation workflow on the deployed dApp's backend, on testnet, as
UAT's own buyer: decompose → authorize (signed by the buyer) → execute → poll →
settle → seal → settlement record. Every artifact is written to a JSON record
the moment it is seen, then read back from Horizon and Soroban RPC and checked.
The record and its checks are evidence; the API's word for an outcome is what
gets checked, never the source of truth.

It spends testnet XLM, so it is a tool to run by hand, not a CI step.

## The one command

```sh
E2E_STATE=/path/outside/the/repo E2E_INTENT="<what the buyer asks for>" \
  "$BACKEND/.venv/Scripts/python.exe" tools/e2e-run/run.py run
```

`$BACKEND` is a checkout of Orizon-Agents-BE-Stellar; its virtualenv has the
two libraries this needs (`httpx`, `stellar_sdk`). On a POSIX machine the
interpreter is `$BACKEND/.venv/bin/python`.
