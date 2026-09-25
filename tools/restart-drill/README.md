# Restart drill — story 6.03d

Durability tested by restarting: a real backend process on a real Postgres,
killed and started again, with the API and the trace page compared on each side.
Local only. The deployed suite cannot restart a backend, and until a settlement
lands on the deploy (D-050) there is no dispute there to restart around.

## What it needs

- A backend checkout and its virtualenv (uvicorn, asyncpg, stellar_sdk).
- A Postgres the drill may write to. A throwaway one is enough, e.g. the EDB
  portable binaries for Windows:
  `initdb -D data -U drill --auth=trust -E UTF8` →
  `pg_ctl -D data -o "-p 55432" start` → `createdb -p 55432 -U drill orizon_drill`.
- For the browser half: a frontend checkout with its `node_modules`.

Nothing is signed and nothing reaches a network. The one substitution is the SAC
transfer's answer, replaced in `run_uphold.py` by the Stellar client's own
`timeout` answer; the uphold script, the dispute service and the store are real.

## Run it

```sh
export DRILL_BACKEND=/path/to/Orizon-Agents-BE-Stellar
export DRILL_DSN=postgresql://drill@127.0.0.1:55432/orizon_drill
export DRILL_LOGS=/tmp/drill-logs          # backend logs, script output, seed file
export DRILL_PYTHON=$DRILL_BACKEND/.venv/bin/python

# API half: every scenario, or name some (du01 du01-control du02 token-gap du04)
$DRILL_PYTHON tools/restart-drill/drill.py

# browser half, after `drill.py browser-seed`
export DRILL_FRONTEND=/path/to/Orizon-Agents-FE-Stellar
export DRILL_CHROMIUM=...                  # only if Playwright's own build is missing
npx playwright test --config tools/restart-drill/playwright.drill.config.ts
```

The drill exits non-zero on any FAIL, and on any XPASS: a check pinned to an
open defect that now passes, whose pin must then come off.

## What each scenario proves

| Scenario | Criteria | What it does |
| --- | --- | --- |
| `du01` | DU-01, DU-05 | opens a dispute, hard-kills the backend, starts a new one; the dispute, the task listing, the settlement and the closing time must be identical; reads the boot log for the store it names |
| `du01-control` | DU-01 | the same restart onto the in-memory store — the dispute must be gone, or the drill is not measuring the store |
| `du02` | DU-02 | seeds a settlement, restarts, then opens a dispute on it with a real signature |
| `token-gap` | DU-01, DU-02 | `TASK_AUTH_REQUIRED=true`: after a restart the per-task listing 404s, while `GET /api/disputes/{id}` and a new dispute still work without a token |
| `du04` | DU-03, DU-04 | a transfer that times out: exit 10 and "DO NOT RE-RUN", `crediting` with the hash and no amount through a restart, in `list_refund_claims()`, a re-run that exits 6 and signs nothing, then the hand-reconcile hint followed to the letter |
| `browser-seed` + `browser.spec.ts` | DU-01 – DU-04 | the payer's trace page reloaded across a restart, a dispute raised through the dialog after one, the `crediting` and hand-reconciled receipts, and the token gap as the payer sees it |
