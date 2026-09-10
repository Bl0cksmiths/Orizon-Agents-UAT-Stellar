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

**Correction to this entry** — the messages are not merely unreachable; the
charset message IS reachable, and reaching it produces a dead end. `sanitize`
in `skills-input.tsx` filters the character set but **not the token length**,
so a skill over 32 characters enters state, `validateSkills` fails it,
`canSubmit` goes false, and the Register button disables — while the
explanatory message stays hidden behind `touched.skills`, which only a submit
sets, and a disabled button never submits. The user is blocked with nothing on
screen telling them why. That is worse than dead code.

**Resolution path** — Reject the over-long token at entry, the way the charset
and the chip cap already are, and say why.

**Fix prepared** — frontend branch `fix/skills-input-length`, 5 commits:
`maxLen` (default 32, matching `AGENT_ID_RE`) enforced in `addTokens`; the
boolean `rejected` replaced by a `refusal` message so `aria-invalid` has
something to point at; the reason rendered in a `role="status"` region wired
through `aria-describedby`; an `onBlur` prop added to `SkillsInput` and
`touch("skills")` wired on the register page so any residual invalid state
surfaces instead of silently disabling submit.

**Regression test** — `components/ui/skills-input.test.tsx`, "refuses a token
longer than maxLen and says why". Both pre-existing cap tests still pass
unchanged. Owned by the frontend repo, not this one.

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

**Fix prepared** — frontend branch `fix/overview-fetch-guards`, 3 commits.

A full move to `useFetch` was considered and rejected: `useFetch` fetches
once, it does not poll, so swapping it in would have silently dropped the 5s
refresh this page exists to provide. Instead the page keeps `usePolling` and
adopts the two things it was missing:

1. A monotonic run guard inside `load`, so the poll tick and the manual retry
   can no longer clobber each other. The race was never only in `retry()` —
   `load` wrote state unconditionally, so a stale in-flight request overwrote
   a newer result whichever caller started it. `load` now returns whether its
   result was the one applied, and `retry` only dates the data when it was.
2. Classification with the same exported `isTransientFetchError` predicate the
   `useFetch` routes use, so a 5xx reads as recoverable and a 404 as terminal.

**Reproduction test** — `tests/resilience.spec.ts`, "[RS-02] /app: a transient
500 is presented as recoverable, distinctly from a terminal 404", marked
`test.fail` until the fix is deployed.

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
the assertion tightens.

**Fix prepared** — frontend branch `fix/icons-and-titles`, commit `53e3c62`.
A `force-static` route handler at `app/favicon.ico/route.ts` serves the
existing 512px brand PNG. A hand-built `.ico` was rejected: the source is
512x512, an ICO entry caps at 256, and no image library is available to
resample it — inventing a second icon asset would also let the two drift.
Every browser that requests this path accepts a PNG payload.

Once deployed, drop `/favicon.ico` from the allowlist in
`tests/fixtures.ts` (`collectConsoleErrors`) so MK-07 tightens.

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

**Correction to this entry** — flow and events are not outliers. **All eleven**
console pages are `"use client"`, so none of them can export `metadata`, and
every one ships `Console — Orizon Agents`. The `template: "%s · Orizon Agents"`
declared in `app/app/layout.tsx` is dead configuration: nothing ever supplies
`%s`. Severity is unchanged, but the scope is ten routes, not two.

**Resolution path** — A client component cannot export `metadata`, so each
route needs a server `layout.tsx` that supplies the title.

**Fix prepared** — frontend branch `fix/icons-and-titles`, 10 commits: one
`layout.tsx` per console route (agents, register, reputation, orchestrator,
trace, events, send, wallet, flow, pdax), each exporting a title that the
existing layout template completes. `/app` itself needs none — the layout's
`default` is already correct for the overview.

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

---

## D-010 — Off-screen mobile nav links stay keyboard-focusable when the drawer is closed

- **Severity:** Major
- **Status:** Open
- **Affects:** AX-04, AX-07

**Steps to reproduce** — Load any `/app` route at a mobile viewport (390x844)
with the drawer closed. Press Tab repeatedly from the top of the page.

**Expected** — Focus reaches the "open menu" button. The eleven navigation
links are off screen and must not be in the tab order until the drawer opens.

**Actual** — Focus moves through all eleven off-screen navigation links first.
They precede the topbar hamburger in DOM order, so a keyboard user presses Tab
eleven times against invisible targets before reaching the control that would
reveal them.

**Cause — confirmed in source.** `app/app/_components/sidebar.tsx:361-366`
hides the drawer with a transform only:

```
open ? "translate-x-0" : "-translate-x-full",
"md:translate-x-0",
```

A transform moves an element out of view but leaves it rendered, visible to
the accessibility tree, and focusable — unlike `display:none`,
`visibility:hidden`, or `inert`. The `<aside>` carries `tabIndex={-1}`
(line 357), which affects only the aside itself, never its children, and the
`<Link>` elements have no conditional `tabIndex`. The `aria-hidden={!open}` at
line 346 is on the backdrop, not on the drawer.

**Why it is not trivial to fix** — the same element must stay focusable at
`md:` and above, where `md:translate-x-0` makes it a permanently visible
sidebar. So the fix is viewport-conditional and cannot be pure CSS.

**Impact** — Fails WCAG 2.4.3 Focus Order for every keyboard and
switch-control user on a small viewport, on every console route. The project
already solved the mirror-image problem correctly — `console-content.tsx`
applies the native `inert` attribute to background content while the drawer is
*open* — so the pattern to reuse exists in the codebase.

**Resolution path** — Apply `inert` to the `<aside>` when the drawer is closed
*and* the viewport is below `md`, mirroring the existing
`console-content.tsx` treatment. Owned by the frontend repo.

**Fix prepared** — frontend branch `fix/mobile-nav-inert`, commit `e8a7177`.
A `matchMedia("(min-width: 768px)")` effect sets `inert` on the aside while the
drawer is closed below `md`. It cannot be done in CSS: `inert` is an attribute,
so the `md:` breakpoint is unavailable. The effect is declared *before* the
existing focus effect, because both depend on `open` and React runs them in
order — otherwise `asideRef.current?.focus()` would fire against a still-inert
element and silently do nothing.

**Reproduction test** — `tests/a11y.spec.ts`, "AX-07 — a closed mobile drawer
keeps its nav links out of the tab order", marked `test.fail` while the defect
is live. It flips to a plain `test` in the commit that confirms the deploy.

---

## D-011 — `AgentRegistry` accepts a negative price on both write paths

- **Severity:** Major
- **Status:** Fix prepared, not deployed
- **Affects:** AM-03, AM-05, and marketplace data integrity

**Steps to reproduce** — Call `AgentRegistry.register` (or `update_price`)
directly via RPC with `price = -1`. `register` is permissionless, so no
backend involvement is possible.

**Expected** — Refused.

**Actual** — Stored verbatim. `contract/agent-registry/src/lib.rs` validates
the price in neither `register` (line ~45) nor `update_price` (line ~79). The
backend's `gt=0, le=10_000` check on `/build/register-agent` is bypassed
entirely by talking to the chain directly.

**Impact** — `registry_sync` mirrors on-chain agents into the marketplace as
`price = raw["price"] / 1e7`, so a negative price propagates into listings,
plan totals and the reputation weight derived from step price. The contract is
non-upgradable, so the value cannot be corrected in place once written.

**Not to be confused with** — a price of **zero**, which is legitimate and in
use: `orizon_batch` is registered free on purpose so the payer sets the spend
cap per workflow via `PaymentEscrow.authorize`. A guard of `price <= 0` would
break the deployed system.

**Fix prepared** — contracts branch `fix/price-validation`, 6 commits: a
`BadAmount = 101` variant matching `orizon_shared::codes::BAD_AMOUNT` and
payment-escrow's existing numbering; a `price < 0` guard on both write paths;
and three tests — negative rejected on register, negative rejected on
update_price, and zero still accepted on both. The last one exists so nobody
"tightens" the guard to `<= 0`.

**Not deployed.** These contracts are live and non-upgradable, so this fix
only reaches the chain through a fresh deployment and a migration of the
existing registrations.

---

## D-012 — The repository account cannot push to the frontend or contract repos

- **Severity:** Blocker (process)
- **Status:** Open
- **Affects:** delivery of every prepared fix

**Actual**

```
remote: Permission to Bl0cksmiths/Orizon-Agents-Smart-Contract-Stellar.git
        denied to rie-hash14.
fatal: ... The requested URL returned error: 403
```

The same 403 occurs on `Bl0cksmiths/Orizon-Agents-FE-Stellar`. Fetch works on
both; only writes are refused. Pushes to this UAT repository succeed.

**This is an account-permission problem, not a token-scope one.** The remote
names the account explicitly. Regenerating a Personal Access Token with wider
scopes cannot fix it — a token grants no access the account does not already
hold. Someone with admin on the `Bl0cksmiths` org must grant `rie-hash14`
write access to those two repositories.

**Impact** — 32 prepared commits across six branches (five frontend, one
contracts) exist only on the local machine and cannot be opened as pull
requests.

**Workaround** — export the branches as patches (`git format-patch`) and apply
them from an account that does have write access.

---

## D-013 — The marketplace has one on-chain agent, and it is not externally operated

- **Severity:** Major
- **Status:** Open
- **Affects:** PR-01, and story 1.02's stated purpose

**The requirement.** `app/schemas.py:10-12` states the contract in the code
itself:

> Provenance is contracted evidence, not cosmetics: SOW §6.3's "≥ 2 externally
> operated agents" must be provable from the API, so every agent carries where
> it came from (story 1.02).

**Actual — verified live.** `GET /api/agents` returns 13 agents: 12 seeded
(`agt_` ids, `source: "seeded"`, `owner: null`) and exactly **one** with
`source: "onchain"` — `orizon_batch`.

That one agent's owner is
`GA7AI5TAJEZA27I666DSJC4MUJYBEWUYNNZWPU7R2ONA7IZQVO6R5OQV`, which is byte-for-byte
the `admin` address reported by `GET /api/stellar/network`. It is the platform's
own deploy key.

**Impact.** Against the SOW line the code cites, the deployment currently
evidences **one** on-chain agent, and **zero** externally operated ones — the
single on-chain registration is self-operated. The provenance *mechanism* works
correctly and is the right design; what is missing is the population it exists
to evidence. Anyone reading `/api/agents` to satisfy SOW §6.3 today would not
find two independent operators.

**Not a code defect.** Nothing is broken: `source`, `owner` and the sync path
all behave exactly as specified. This is a deployment-content gap, recorded
because the provenance field's stated reason for existing is a claim this data
does not yet support.

**Resolution path** — register at least two agents from wallets that are not
the admin key. `POST /api/stellar/build/register-agent` plus an owner signature
is the supported path; `scripts/register_batch_agent.py` shows the shape.
