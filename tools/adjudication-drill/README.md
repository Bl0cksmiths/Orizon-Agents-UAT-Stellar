# Adjudication drill — story 6.03g

The adjudication door and the refund switch, with refunds ON. The deployed
service runs with `DISPUTE_REFUNDS_ENABLED` off and must stay that way, so the
cases that need the switch on are shown here instead: a backend checkout booted
locally with uvicorn, as Render runs it, once per configuration, on a real
Postgres and on the testnet fixtures of the 6.03e drill
(`tools/reputation-drill`). Nothing of the deployment's is touched, and no
check lets the settler sign: its sequence number on testnet Horizon is read
before and after each batch of refusals and must not move.

| Scenario | Configuration | What it proves |
| --- | --- | --- |
| AD-01 | refunds off, key configured and sent | uphold and reject both 503 `dispute_refunds_disabled`; nothing signed; the dispute still open |
| AD-02 | refunds on, `API_KEY` unset or empty | uvicorn exits non-zero, never answers `/health`, and names `API_KEY` — on testnet and on `mainnet`, `public` and `pubnet` |
| AD-03 | refunds on, key configured | no key, a wrong key, the key minus a character, non-ASCII keys (UTF-8 and latin-1 bytes) and a trailing no-break space: all 401 `invalid_api_key`, alike |
| AD-04 | refunds on, no key | a bad body still gets the guard's 401; reject with malformed JSON is pinned to D-073 |
| AD-05 | refunds on, key sent | a rejection with no, null, empty, whitespace or control-character note is refused; a real one succeeds |
| AD-06 | refunds on, key configured | the buyer challenges and opens a dispute with a wallet signature alone |

## What it needs

- The 6.03e fixtures: run `tools/reputation-drill/setup_testnet.py` once (see
  its README). `DRILL_STATE` is the directory it wrote `rc-testnet.json` to,
  outside the repo, because that file holds secret keys.
- A backend checkout and its virtualenv (uvicorn, asyncpg, stellar_sdk).
- A Postgres the drill may write to, e.g. the one described in
  `tools/restart-drill/README.md`.
- A free port for the drill's backend: 8767 unless `DRILL_PORT` says otherwise.
  The drill refuses to start if something already answers there.
- Network access to testnet RPC and Horizon. On a machine whose TLS is
  intercepted, set `REQUESTS_CA_BUNDLE` and `SSL_CERT_FILE`; they are passed on.

## Run it

```sh
export DRILL_STATE=/tmp/rc-state             # outside the repo: holds secret keys
export DRILL_BACKEND=/path/to/Orizon-Agents-BE-Stellar
export DRILL_DSN=postgresql://drill@127.0.0.1:55432/orizon_drill
export DRILL_PYTHON=$DRILL_BACKEND/.venv/bin/python

$DRILL_PYTHON tools/adjudication-drill/drill.py            # every scenario
$DRILL_PYTHON tools/adjudication-drill/drill.py ad03 ad05  # just these
```

Each server boot writes its output to `$DRILL_STATE/logs/ad-<label>.log`; the
refused boots' logs hold the refusal the drill quotes. The operator key is
random per run and never printed.

The drill exits non-zero on any FAIL, and on any XPASS: a check pinned to an
open defect that now passes, whose pin must then come off. Any 500 from the
adjudication routes fails a check.
