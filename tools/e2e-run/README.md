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

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `E2E_STATE` | (required) | Directory **outside the repository** for the buyer key and the run records. The tool refuses a path inside the repo. |
| `E2E_INTENT` | (required for `run`) | What the buyer asks for. Word it toward an agent that has an on-chain owner and a working endpoint. |
| `E2E_API` | `https://orizon-agents-be-stellar.onrender.com` | The deployed backend (the frontend's `/api` proxies to it). |
| `E2E_MAX_TOTAL_XLM` | `0.05` | The most the plan may cost. A dearer plan is refused before anything is signed. |
| `E2E_TASK_BUDGET_S` | `600` | How long to poll the task before giving up. |
| `E2E_ALLOW_UNREACHABLE` | unset | `1` runs a plan whose agent fails the backend's own endpoint probe, to watch the failure path. |
| `SSL_CERT_FILE` | unset | A CA bundle, when TLS is intercepted on the way out. |

## Other commands

```sh
python tools/e2e-run/run.py fund            # a fresh buyer in $E2E_STATE/buyer.json, funded by friendbot
python tools/e2e-run/run.py verify RECORD   # re-read a recorded run's artifacts from the ledger and check them again
```

`fund` refuses to overwrite an existing buyer. `verify` writes nothing; it
prints each check and exits non-zero on any FAIL.

## What a passing run needs

A charged payout needs an agent the planner routes to that has an on-chain
owner (read from the AgentRegistry's `owner_of`, not from the API) **and** a
bound endpoint that answers a dispatch. Before signing, the tool asks the
backend's own `GET /api/agents/{id}/readiness` probe and refuses an agent whose
`reachable` step failed, so a run that cannot pay anybody costs nothing.

Exit codes: `0` the run finished settled and sealed and every check passed;
`1` the run stopped part-way or a check failed (the record says which, under
`stopped` and `checks`); `2` refused before anything ran; `64` usage.

The latest run and its findings: `docs/uat/evidence/6.04-e2e-run.md`.
