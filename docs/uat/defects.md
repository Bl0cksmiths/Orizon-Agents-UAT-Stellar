# UAT defects

Severity definitions are in `test-plan.md`.

---

## D-001 — Target deployment is mainnet while the programme is specified testnet-only

- **Severity:** Blocker
- **Status:** Open
- **Affects:** EV-01, EV-02, EV-03, EV-04

**Steps to reproduce**

```
curl -s https://orizons.xyz/api/stellar/network
```

**Expected** — `"network": "testnet"`, matching the QA task's "Week 1 (M1) ·
testnet only" scope and its `--api-base https://orizons.xyz` verification
command.

**Actual**

```json
"network": "mainnet",
"rpc_url": "https://mainnet.sorobanrpc.com",
"network_passphrase": "Public Global Stellar Network ; September 2015"
```

The four contract ids returned are the mainnet deployment.

**Impact** — The registration evidence journey requires signing a real
registration. On this target that is a live mainnet transaction spending real
XLM against non-upgradable contracts. No test may execute it, so EV-01 through
EV-04 cannot be exercised end to end and are recorded Blocked rather than
Failed.

**Resolution path** — Point `UAT_BASE_URL` at a deployment whose
`/api/stellar/network` reports testnet, then re-run the EV suite. The suite
reads the expected network from `UAT_EXPECTED_NETWORK` rather than hardcoding
it, so no test change is needed when the target flips.

---

## D-002 — Cannot install dependencies or execute any test on the authoring machine

- **Severity:** Blocker (process, not product)
- **Status:** Open
- **Affects:** the verification step of every criterion

**Steps to reproduce** — Run `npm ci` in this repo on the authoring machine.

**Expected** — Dependencies install; `npm test` runs.

**Actual** — Three attempts, three failures: two OOM kills (at 689 and 230
packages) and one `ENOTEMPTY` file lock on `node_modules/next/compat`. The
machine reports 3.83 GB total RAM with 0.35–0.78 GB free. A subsequent
recursive delete of `node_modules` also failed.

**Impact** — No commit in this programme has been runtime-verified. Every
commit was checked statically only: brace balance, import resolution, and a
line-for-line diff against the authored source. That static pass did catch a
real defect (two spec files silently truncated during chunked commits), but it
cannot catch a wrong selector or a failing assertion.

**Resolution path** — Either free memory on the authoring machine (pausing
real-time antivirus is the highest-value single step; the failed delete and the
install slowness both point at it), or add `workflow` scope to the GitHub token
so CI becomes the verifier. See D-003.

---

## D-003 — CI cannot run: the GitHub token lacks `workflow` scope

- **Severity:** Critical
- **Status:** Open
- **Affects:** the "CI green on uat" exit criterion

**Steps to reproduce** — Commit a file under `.github/workflows/` and push.

**Actual**

```
! [remote rejected] refusing to allow a Personal Access Token to create or
  update workflow `.github/workflows/e2e.yml` without `workflow` scope
```

**Impact** — The suite has no automated runner. The workflow is complete but
parked at `ci/e2e.workflow.yml`, where GitHub ignores it. Combined with D-002,
nothing in this programme has executed anywhere.

**Resolution path** — Add `workflow` scope to the token, then
`git mv ci/e2e.workflow.yml .github/workflows/e2e.yml`. The workflow already
covers three browser projects, a backend warm-up step, and report artifacts.

---

## D-004 — Skills validation messages are unreachable

- **Severity:** Major
- **Status:** Open
- **Affects:** RG-04

**Expected** — The "16 skills maximum" and per-token charset messages defined
in `lib/register-validation.ts` render when a user violates those rules.

**Actual** — They can never render, for two independent reasons:
`components/ui/skills-input.tsx` sanitises invalid characters as they are typed
and refuses a 17th chip client-side, so the invalid state never occurs; and
`app/app/register/page.tsx` never calls `touch("skills")` — there is no
`onBlur` wiring for the field — so the error text is gated behind a `touched`
flag nothing ever sets. Only `aria-invalid` reflects the cap.

**Impact** — Dead validation code implying coverage the form does not have. A
future refactor of `SkillsInput` that removed the client-side guard would
expose users to a silent failure, because the fallback message still could not
render.

**Resolution path** — Wire `touch("skills")` on blur, or delete the
unreachable messages. Owned by the frontend repo, not this one.

---

## D-005 — Overview cannot distinguish a transient 500 from a terminal 404

- **Severity:** Major
- **Status:** Open
- **Affects:** RS-02

**Expected** — A 5xx presents as transient and recoverable ("retrying…"),
distinctly from a terminal 404, as every other data-backed console route does.

**Actual** — `app/app/page.tsx` drives its own state around `usePolling`
instead of `useFetch`, so it never gets `useFetch`'s transient-error retry
indicator and renders both failure modes identically.

**Impact** — On the console's landing route, a temporary backend blip is
indistinguishable from a permanently missing resource, so a tester cannot tell
whether waiting will help.

**Resolution path** — Move Overview onto `useFetch`. This also closes an
unguarded manual `retry()` race on the same page. Owned by the frontend repo.

---

## D-006 — `/favicon.ico` returns 404

- **Severity:** Minor
- **Status:** Open
- **Affects:** MK-07

**Steps to reproduce** — `curl -o /dev/null -w "%{http_code}" https://orizons.xyz/favicon.ico`

**Expected** — 200, or no browser request for it.

**Actual** — 404. The page correctly declares `<link rel="icon" href="/icon.png">`,
but Chromium probes `/favicon.ico` unconditionally regardless.

**Impact** — The only failed request on an otherwise clean page load. It had to
be allowlisted in the console/network-error collector (`tests/fixtures.ts`) so
that MK-07 stays a meaningful assertion rather than permanently red.

**Resolution path** — Serve `/favicon.ico`, then remove the allowlist entry so
the assertion tightens. Owned by the frontend repo.

---

## D-007 — `/app/flow` and `/app/events` ship the default page title

- **Severity:** Minor
- **Status:** Open
- **Affects:** none directly; recorded for completeness

**Expected** — Each console route sets its own document title, as the others do.

**Actual** — Both are client components with no `metadata` export, so Next's
title template never overrides the layout default and both render
`Console — Orizon Agents`.

**Impact** — Browser tabs and history entries are ambiguous between two
different routes. No functional effect.

**Resolution path** — Export `metadata` from each route, or move the title into
a shared server-component wrapper. Owned by the frontend repo.

---

## D-008 — The registration evidence block names a build-time network, not the live one

- **Severity:** Critical
- **Status:** Open
- **Affects:** EV-05

**Expected** — The network named in the copied evidence block is the network
the backend actually reports at `GET /api/stellar/network`. That is the entire
point of EV-05: the evidence must describe the chain the transaction really
landed on.

**Actual** — `app/app/register/page.tsx` sources the evidence block's network
from `defaultExplorerNetwork` in `components/ui/stellar-link.tsx`, which is
derived from the **build-time** `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE`
(`IS_MAINNET` in `lib/env.ts`). It never calls the live endpoint. By contrast
`app/app/_components/topbar.tsx`, `app/app/wallet/page.tsx` and
`app/app/events/page.tsx` all call `getStellarNetwork()` for their network
display, so the register page is the outlier.

**Impact** — If the frontend is built with a passphrase env that disagrees with
what the backend reports, the evidence block prints the wrong network with no
runtime guard, and the `stellar.expert` links it emits point at the wrong
explorer. A reviewer following EV-04 would then be shown a link that 404s, or
worse, a link to the same-shaped id on the wrong chain. This is precisely the
failure EV-05 exists to catch, and it is live now: the deployment reports
mainnet while the programme is specified testnet.

**Resolution path** — Source the network in the evidence builder from
`getStellarNetwork()` like the other three call sites, or assert at render time
that the build-time value matches the live one and surface a mismatch. Owned by
the frontend repo.

---

## D-009 — Money-route protection depends on an operator setting, not on a config guard

- **Severity:** Minor (latent; live posture verified safe)
- **Status:** Open
- **Affects:** AZ-01, AZ-02

**Live posture — verified, not assumed.** Every API-key-gated route refuses an
unauthenticated call:

```
POST /api/stellar/server/charge  -> 401 invalid_api_key
GET  /api/pdax/balances          -> 401 invalid_api_key
```

All 24 gated PDAX routes plus `/server/charge` and `/server/seal` behave the
same. `API_KEY` is set on the deployment and `require_api_key` is actively
enforcing. **The money routes are protected today.**

**The latent gap** — nothing in the configuration *forces* that. Both fail-fast
validators in `app/config.py` key on the literal string `"production"`:
`_money_capable_config_requires_api_key` and
`_production_webhooks_require_signature`. The deployment runs
`PDAX_ENVIRONMENT=stage` while provisioning real PDAX credentials, so neither
validator fires. Protection currently rests on the operator having set
`API_KEY` by hand.

**Impact** — A future deploy that omits `API_KEY` under a non-`production`
`PDAX_ENVIRONMENT` would boot cleanly and serve every money-moving route
anonymously, with no startup error. The guard that exists to prevent exactly
this cannot see the configuration it is deployed under.

**Resolution path** — Broaden the validator's trigger from the literal
`"production"` to "any environment where credentials capable of moving real
value are present", or assert `API_KEY` unconditionally whenever PDAX
credentials are set. Owned by the backend repo.

**Note** — This entry supersedes an earlier working assumption in this
programme that the gated routes might be answering anonymously. They are not.
