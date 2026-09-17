# UAT runbook

## Run the suite from a clean checkout

```bash
git clone https://github.com/Bl0cksmiths/Orizon-Agents-UAT-Stellar.git && \
cd Orizon-Agents-UAT-Stellar && git checkout uat && npm ci && \
npx playwright install --with-deps && npm test
```

Against a different target:

```bash
UAT_BASE_URL=https://<preview>.vercel.app UAT_EXPECTED_NETWORK=testnet npm test
```

## What "deploy" means here

This repository deploys nothing. It is a test harness that runs against a
deployment owned by the frontend and backend repositories. There is therefore
no deploy command to document and no infrastructure to roll back — the
equivalent operations are:

| intent | command |
| --- | --- |
| Point UAT at a new build | set `UAT_BASE_URL` and re-run |
| Roll UAT back to the previous target | set `UAT_BASE_URL` to the prior deployment URL and re-run |
| Roll the suite itself back | `git checkout <previous tag or sha> && npm ci && npm test` |

Rolling back the *application* is a Vercel and Render operation performed in
those dashboards, or by reverting the relevant commit in the frontend/backend
repository. It is deliberately not automated from here: a test harness that can
redeploy the system under test can invalidate its own result.

## Rollback of a bad suite change

Every commit on `uat` is small and independently revertible by design:

```bash
git revert <sha> && git push
```

## Enabling CI

CI is currently inert — see defect D-003. To enable:

```bash
# after adding `workflow` scope to the GitHub token
git mv ci/e2e.workflow.yml .github/workflows/e2e.yml
git commit -m "added e2e workflow module" && git push
```

The workflow runs the four browser projects in a matrix, warms the backend
before the first spec so a cold start does not consume a test's budget, and
uploads the HTML report as an artifact on every run.

## Running the backend half of story 6.02

The RF criteria that concern log output, startup configuration and the routing
floor's arithmetic cannot be observed through a browser — they are verified in
the **backend** repository's pytest suite, against the real service and both
real planners, with only the Soroban `rep_state` read stubbed (test-plan.md,
"How the four reputation states are produced", method B).

From a clean checkout of `Orizon-Agents-BE-Stellar`:

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/python -m pytest tests/test_floor_boundaries.py tests/test_floor_disclosure.py \
                           tests/test_floor_visibility.py -q
```

On Windows the interpreter is `.venv/Scripts/python.exe`. Run the whole suite
(`-m pytest -q`) before sign-off: these three files are additive and must not
have moved any existing test.

## Re-run story 6.05 — the external dispatch path (testnet only)

Needs two throwaway testnet keys (friendbot-funded) and a public HTTPS URL. The
suite itself never holds a key; this procedure is run by hand and recorded in
`docs/uat/evidence/6.05-external-dispatch.md`.

```bash
# 1. the operator endpoint (Node 22.6+ runs the TypeScript directly)
PORT=8787 CAPTURE_FILE=captures.jsonl \
PINNED_SIGNER=$(curl -s https://orizons.xyz/api/stellar/network | jq -r .dispatch_signer) \
BOUND_ENDPOINT_URL=https://<tunnel-host>/dispatch \
node tools/operator-endpoint/server.ts

# 2. publish it (no account needed; the URL changes on every start)
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8787

# 3. switch failure modes — loopback only, never through the tunnel
curl -X POST http://127.0.0.1:8788/mode/malformed   # ok | timeout | oversize | malformed
```

Register, bind, decompose, authorize and execute exactly as the backend's
`docs/evidence/2.04-reference-agent-runbook.md` steps 1–6 describe. Every
dispatch lands in `captures.jsonl` with `signature_verified` already computed.

**Stop it when done.** The endpoint and tunnel are exposed to the internet for as
long as they run. Do **not** unbind or deregister afterwards — they are
on-chain evidence.

**Rollback** — none needed: nothing in this procedure touches the deployed
service's configuration. Re-running it only adds registrations, bindings and
authorizations on testnet.
