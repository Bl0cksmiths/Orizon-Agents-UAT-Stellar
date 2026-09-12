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
