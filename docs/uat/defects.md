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
- **Status:** Partly resolved — see "Update" below
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

**Update — the frontend half now runs.** `npm ci` succeeded on the fourth
attempt in a *fresh* clone of the frontend repository, with no partial
`node_modules` to contend with: 1234 packages in 18 minutes under
`--max-old-space-size=1024`. All seven prepared frontend fix branches were
applied there and the toolchain executed:

| check | result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` (`--max-warnings=0`) | no warnings or errors |
| `npm run test:coverage` | 500 tests, 27 files, all passing |
| coverage | 96.71 / 93.88 / 96.40 / 98.74 vs thresholds 86 / 78 / 88 / 89 |

The first execution **failed**, on two type errors introduced by the fixes
themselves — a changed return type that no longer satisfied `usePolling`'s
callback signature, and a renamed state setter left behind in one branch of
`skills-input.tsx`. Both had survived every static pass. The second is the
sharper lesson: the grep meant to catch the rename was case-sensitive and so
could never have matched `setRejected`. **The verification had a hole shaped
exactly like the bug it was supposed to find.** This is the concrete cost this
defect was logged to warn about, and it is now measured rather than predicted.

**A second gap the coverage report exposed.** Two of the fixed modules had no
test at all — `lib/settlement-asset.ts` at 0% and `lib/wallet-picker-a11y.ts`
(the D-017 keyboard-trap fix) at 64% statements / 33% branches — despite the
handoff notes claiming every branch carried its own regression test. Both are
now covered: 11 tests and 13 tests respectively, taking the first module to
100% across statements, branches and functions and the second to 100 / 91.66 /
100 / 100. Passing thresholds had been hiding two entirely untested modules.

**What is still blocked.** This repository's own Playwright suite — the 190
test blocks that are the substance of the programme — has still never been
installed or run. Nothing below the frontend unit layer has been executed:
no `pytest` against the backend, no `cargo test` against the contracts. The
sign-off recommendation is unchanged.

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

---

## D-014 — The stack settles in XLM while naming the asset USDC throughout

- **Severity:** Critical
- **Status:** Partially fixed; the remainder is deliberately deferred
- **Affects:** every priced surface, and three safety limits

**Actual — verified end to end.** `scripts/deploy_testnet.sh` defaults
`ASSET="${ASSET:-native}"`, i.e. the XLM SAC. `payment-escrow` stores that
address under `DataKey::Usdc`. `GET /api/stellar/network` reported a hardcoded
`asset: "native"`. Meanwhile the codebase says USDC in 658 places across 90
files — `usdc_to_i128`, `max_charge_usdc`, `max_amount_usdc`, `total_usdc`,
`MAX_WEIGHT` ("100 USDC per rating"), and the marketplace UI.

**Impact.** Three limits are denominated in a different asset from the one
their names claim:

| limit | reads as | actually is |
| --- | --- | --- |
| `max_charge_usdc = 100.0` | 100 USD of value | 100 XLM |
| `MAX_WEIGHT = 1_000_000_000` | 100 USDC per rating | 100 XLM |
| `reputation_max_rating_weight_usdc = 100.0` | 100 USD | 100 XLM |

A buyer reading "0.166 USDC" on a plan authorizes against a figure whose unit
is wrong, and reputation weight — which is meant to make ratings proportional
to settled value — is scaled against a different asset than intended.

**What was fixed** — backend `fix/settlement-asset-symbol` (5 commits) and
frontend `fix/settlement-asset-symbol` (3 commits):

- `STELLAR_ASSET_SYMBOL` added, documented, and defaulted to `XLM`, giving the
  deployment one place that states which token settles.
- `/api/stellar/network` now reports it instead of the hardcoded `"native"` —
  which was correct by accident today and would have lied outright the moment
  anyone deployed with `ASSET="USDC:G..."`.
- A `useSettlementAsset()` hook reads that value **live**, and the two
  money-critical surfaces use it: the orchestrator plan total (the figure a
  buyer authorizes against) and the operator's price control. Its fallback is
  the neutral `"units"`, never a guessed token name — guessing is the same
  mistake in miniature.
- Both value caps now carry an explicit denomination warning at their
  definitions.

**What was deliberately NOT done, and why**

*Renaming the 658 identifiers.* `usdc_to_i128`, `total_usdc` and the rest are a
7-decimal **unit convention**, not a currency claim. Renaming them is a large
mechanical change across three repos with zero runtime verification available
(D-002) — high regression risk for no behavioural gain. The names should be
neutralised, but as a tracked refactor with a green suite behind it.

*Marketing copy.* `hero.tsx` quotes agent prices "(0.009 USDC)" and
`reputation.tsx` claims a "100 USDC" cap and "backed by settled USDC". These
are factual claims about the deployed system and are currently wrong, but they
are content decisions for the team, not a unilateral code edit.

*The on-chain constants.* `MAX_WEIGHT` is compiled into a non-upgradable
contract. It cannot be retuned without a redeployment.

**The real decision this defect surfaces** — either deploy against an actual
USDC SAC so the names become true, or accept XLM as the settlement asset and
neutralise the naming. The fixes above make the system *honest about which it
is*; they do not make that choice.

---

## D-015 — The wrong-network guard cannot fire for two of the five SOW wallets

- **Severity:** Major
- **Status:** Open
- **Affects:** WM-02, and story 1.05's "never silently signed" requirement

**The requirement.** Per the 1.05 matrix: *"connection succeeds and the network
reads testnet — a wrong-network wallet is caught, never silently signed."*

**What the guard does, and does well.** `lib/wallet.tsx`'s `signXdr` checks the
connect-time snapshot, then **re-probes the wallet immediately before signing**
— correct, because a user can switch networks in the extension between connect
and sign, and the stale snapshot would miss it.

**Where it cannot work.** The probe depends on `getNetwork()`, and the code
says plainly which wallets do not implement it:

> Not every wallet implements getNetwork() (Albedo and Lobstr reject with code
> -3), so any failure or malformed response resolves to null — "unknown",
> never a false alarm.

`walletNetworkMismatch` requires a non-null `walletNetwork`, so for **Albedo**
and **LOBSTR** the probe returns null, no mismatch is ever asserted, and
signing proceeds.

**Impact.** For 2 of the 5 SOW §3.3 wallets — 40% of the matrix — a
wrong-network wallet is **not** caught up front. The transaction is signed
against the app's expected passphrase and then fails downstream, so this is not
a fund-loss path; but the user gets a confusing late failure instead of the
upfront catch the criterion requires, which is exactly the friction the 1.05
matrix exists to surface.

**Resolution options** (a product decision, not a code fix I should make
unilaterally):

1. Surface the *unknown* state in the UI before signing — "this wallet cannot
   report its network; confirm you are on testnet" — turning a silent gap into
   an informed choice.
2. Verify after the fact: submit and map the resulting `tx_bad_auth` to a
   wrong-network message rather than a generic failure.
3. Accept and document it in the 5.03 integration guide as a known limitation
   of those two wallets.

Option 1 is the smallest change that satisfies "never silently signed" in
spirit. Whichever is chosen, the matrix should not record Albedo or LOBSTR as
a clean pass on WM-02 without it.

---

## D-016 — The wallet allowlist and SOW §3.3 disagree

- **Severity:** Minor
- **Status:** Open
- **Affects:** WM-01

**Actual.** `lib/wallet.tsx`'s `SUPPORTED_WALLET_IDS` allowlists **six**
wallets: `freighter`, `xbull`, `albedo`, `lobstr`, `hana`, **`rabet`**.

SOW §3.3, as quoted in the 1.05 matrix, names **five**: Freighter, xBull,
Albedo, LOBSTR, Hana. Rabet is supported by the build but is not in the
contracted list, so it is shipped, offered to users, and untested by the
matrix.

The belt documentation disagrees a third way: `WHITEBELT.md:22` and
`YELLOWBELT.md:7,22,28` list **"Hot Wallet"**, which is in neither the
allowlist nor the SOW.

**Impact.** Low — supporting an extra wallet harms nobody. But three sources
name three different sets, so "which wallets do we support?" has no single
answer, and a user who connects with Rabet is on a path the acceptance matrix
never exercises.

**Resolution path** — pick one source of truth. If Rabet is intended, add it to
the SOW list and to the matrix as a sixth column; if not, drop it from the
allowlist. Either way correct the belt docs, which name a wallet the code has
never supported.

---

## D-017 — The wallet picker is a keyboard trap: no Escape, and its close button has no accessible name

- **Severity:** Major
- **Status:** Open
- **Affects:** WM-01, AX-07, and every wallet journey's first step

**Steps to reproduce** — On `/app/register`, activate Connect Wallet to open
the picker. Try to dismiss it with the keyboard alone.

**Expected** — Escape closes it, or the close control announces itself, as the
app's own mobile nav drawer already does (`sidebar.tsx` handles Escape and
returns focus to the opener).

**Actual — verified by reading the dependency's source.** The picker is
`@creit.tech/stellar-wallets-kit@2.6.0`'s own modal, rendered as plain Preact
appended to `document.body` (no shadow DOM). Extracting the published tarball
and grepping the whole package:

- **no `Escape`, `keydown` or `onKeyDown` handler exists anywhere in it** — the
  modal cannot be dismissed by keyboard;
- **no `aria-label` appears anywhere in it** — the close control is icon-only
  with no accessible name, so a screen reader announces an unnamed button.

Both greps return zero matches across the entire package.

**Impact.** Connecting a wallet is step one of *every* wallet journey — the
matrix's own entry point. A keyboard-only or screen-reader user who opens the
picker has no announced way out and no Escape. This sits directly against
AX-07, and it is a sharper failure than anything found in the app's own code,
which handles this pattern correctly elsewhere.

**Not the app's bug, but the app's problem.** The defect is in a third-party
dependency; it ships in the product regardless. The UAT spec works around it
with an SVG-path selector for the close control, documented in a comment,
because there is no accessible name to target.

**Resolution options** — upstream an `aria-label` and an Escape handler to the
kit; or wrap/patch the modal locally; or replace the picker with an in-house
one that reuses the drawer's existing, correct focus handling.

**Fix prepared** — frontend branch `fix/wallet-picker-a11y`, 4 commits.

`lib/wallet-picker-a11y.ts` installs an Escape handler and gives the close
button an accessible name, for exactly as long as the picker is open.
`connect()` enables it immediately before `authModal()` and disposes it in a
`finally`, so the listener and observer can never outlive the modal.

Two details that matter:

- Escape fires the kit's **own** `closeEvent` — the same event its close button
  dispatches (`components/shared/header.js`) — rather than synthesising a click
  or removing DOM. One close path, so keyboard and mouse cannot drift apart.
  `./state` is a **declared public export** of the package, not an internal
  reach; verified in its `package.json` exports map.
- The close button is located by its SVG path data, because it carries no id,
  no `aria-label` and no stable class. That is fragile against an upstream icon
  change, so it fails **safe**: if the path stops matching, the button simply
  goes unlabelled again — Escape keeps working regardless. A `MutationObserver`
  waits for the lazily-mounted modal and disconnects the moment it succeeds,
  rather than watching `document.body` forever.

This is a local patch over a third-party defect. The durable fix is an upstream
PR adding both behaviours to the kit; until then the trap is closed here.

---

## D-018 — The picker's wallet label disagrees with the app's own name map

- **Severity:** Minor
- **Status:** Open
- **Affects:** WM-01

**Actual.** `lib/wallet.tsx`'s `prettyName` map renders `hana: "Hana"`, but the
kit's picker displays **"Hana Wallet"** — confirmed in the published package.

**Impact.** Cosmetic only: a user picks "Hana Wallet" in the modal and the app
then calls it "Hana". No functional effect, but the UAT spec must assert the
kit's string, not the app's, and anyone writing the 5.03 integration guide from
`prettyName` would document a label users never see.

**Distinct from D-016**, which is about *which* wallets are supported. This is
about what one of them is called.

---

## D-019 — No TTL management in any contract

- **Severity:** Critical
- **Status:** Fixed in source; not deployable without redeployment
- **Affects:** every stored record in all four contracts

**Actual.** Before this fix, `extend_ttl` appeared **nowhere** in the
repository. Every persistent entry and every contract instance entry was
subject to Soroban archival with no renewal path in code.

**Correction to how this was first reported.** An earlier summary in this
programme said archived attestations would be *lost*. That overstated it.
Since protocol 23, archived **persistent** entries declared in a transaction's
read-write footprint are **restored automatically**, with the caller re-paying
rent. So evidence is not destroyed; it becomes a cost and a friction, and a
plain read via simulation can fail until something restores it.

What is genuinely severe is the **instance** entry. If a contract's instance is
archived, *every* entrypoint fails until it is restored — and these contracts
are non-upgradable.

**Fix prepared** — contracts branch `integration/all-fixes`, 39 commits across
three streams (`ttl-reg`, `ttl-esc`, `ttl-att`):

- `DAY_IN_LEDGERS` / `BUMP_THRESHOLD` (30d) / `BUMP_TO` (120d, under the ~180d
  ceiling) defined per crate — not shared, because they are independent
  contracts.
- Instance TTL extended at the top of every entrypoint in all four contracts.
- Persistent TTL extended on the entries each entrypoint writes.

**Two judgement calls, resolved differently on purpose.** Whether a read-only
view should extend a TTL is a real trade-off — extending lets any caller force
rent; not extending lets untouched evidence lapse.

- `ReputationLedger`'s five views do **not** extend. That contract documents
  "views must never write", and extending a TTL *is* a write. Verified: zero
  `extend_ttl` calls in `rep_state`, `avg_bps`, `rep_bps`, `dispute_rate_bps`
  and `payer_weight`.
- `AttestationRegistry.get` **does** extend — it carries no such invariant, and
  a verifying read is a legitimate reason to renew evidence meant to be
  verified. `exists()` bumps only the instance, since a bare presence probe
  should not cost a persistent write.
- `PaymentEscrow.receipt()` extends (settlement evidence, never rewritten after
  `charge`, so a read is its only renewal point); `authorization()` does not
  (already refreshed by every write that touches it, and a spent or expired
  auth *should* be allowed to archive).

**One trap avoided:** `extend_ttl` traps on a key that is not present, so
`receipt()` performs its existence check first. A naive extend-then-read would
have turned a clean `NotFound` into a panic.

**Not deployable in place.** The contracts are non-upgradable; this reaches the
chain only through a fresh deployment. Until then, an external keep-alive using
`ExtendFootprintTTLOp` is the mitigation — anyone may extend any entry's TTL,
no contract auth required.

---

## D-020 — PaymentEscrow had no settler rotation or kill switch

- **Severity:** Critical
- **Status:** Fixed in source; not deployable without redeployment
- **Affects:** recovery from a settler key compromise

**Actual.** `__constructor` stored an `Admin` address and **never read it
again**. There was no `set_settler`. Both sibling contracts already had this
exact pattern — `AttestationRegistry.set_sealer` and
`ReputationLedger.set_scorer`, each gated by `admin.require_auth()` — so
PaymentEscrow was the outlier, and it is the one that moves money.

**Impact.** An attacker holding the settler hot key can call `charge` against
every outstanding authorization up to its `max_amount`. With no rotation, no
pause and no upgrade path, there was no on-chain recourse at all.

**Compounding it:** `scripts/deploy_testnet.sh` points settler, sealer *and*
scorer at `$ADMIN_ADDR`, and the same admin key is used on testnet and mainnet.
The documented role separation does not exist as deployed, so one leaked key is
all three roles on both networks.

**Fix prepared** — `set_settler(env, new_settler)`, gated by
`admin.require_auth()`, reading the previously-dead `Admin` key and publishing
an event consistent with the contract's existing ones.

The verifying test asserts the property that actually matters: after rotation a
`charge` from the **old** settler fails `Unauthorized`, and one from the new
settler succeeds. Asserting only that the stored field changed would have
proven nothing about access.

**Still open, and not a code fix:** the deploy script's role collapse and the
shared testnet/mainnet admin key. Rotation gives you a recovery path; it does
not undo three roles sharing one key.

---

## D-021 — AgentRegistry's id list could grow without bound

- **Severity:** Major
- **Status:** Fixed in source; not deployable without redeployment
- **Affects:** contract liveness

**Actual.** `register()` pushed to a `Vec<Symbol>` at `DataKey::Ids` in
**instance** storage with no cap, and `register()` is permissionless. The
`list_ids` doc comment claimed the list was "capped: workspace agrees to bound
registrations" — an unenforced social agreement, now corrected in the source.

**Why instance storage makes this serious.** The Stellar reference is explicit:
instance storage is capped at **64 KB serialized on mainnet**, and per-user or
unbounded data must never live there. The instance entry is loaded on *every*
invocation, so growth raises the cost of every entrypoint, and the wall is
unrecoverable on a non-upgradable contract.

*(An earlier note in this programme put that ceiling at ~128 KiB. The
authoritative figure is 64 KB.)*

**Fix prepared** — `MAX_AGENTS = 256`, enforced before any write, returning a
new `Error::CapacityExceeded = 102`. The bound is derived rather than guessed:
64 KB total, worst case 20 bytes per `Symbol` in a `Vec`, and only an eighth of
the budget (8,192 bytes) handed to the id list to leave headroom for `Admin`
and future fields → a ceiling near 409 entries, with 256 sitting ~37% under it.
The arithmetic is stated in a comment so the next person can re-derive it.

`102` was checked against every error enum in all four contracts (1-8, 100, 101
were in use) and against `orizon_shared::codes`.

---

## D-022 — The testnet flip runbook omits the on-chain batch agent, and its own verification would not catch it

- **Severity:** Major
- **Status:** Open
- **Affects:** RE-04, and the execute→settle path after any flip

**Context.** `docs/testnet-flip-runbook.md` (backend repo) is the procedure that
unblocks this whole testnet programme. It is otherwise careful and correct —
verified against the code: the FE really does default to testnet in
`lib/env.ts`; the build guards there really do fail `next build` on a half-flip;
registration really is client-signed, so 1.07 works with an empty server key;
and the `render.yaml` lines 49-66 it cites really do still hold the mainnet
Stellar block.

**The gap.** The runbook never mentions `orizon_batch` — zero occurrences of it
or of `scripts/register_batch_agent.py`.

That agent is a **per-network on-chain registration**. The flip repoints
`STELLAR_AGENT_REGISTRY` at the testnet contract, where `orizon_batch` will not
exist unless someone registered it there. `PaymentEscrow.charge` cross-calls
`AgentRegistry.owner_of(auth.agent_id)`, and the frontend authorizes against
`agent_id: "orizon_batch"` (`execution-plan.tsx`), so on a freshly flipped
testnet every Authorize & Execute settlement fails `NotFound` at charge time.

**Why the runbook's own verification misses it.** Step 4 checks
`curl .../api/agents | jq 'length'` expecting `>= 12`. The seeded catalog alone
satisfies that — the check passes with **zero** on-chain agents. Nothing in the
procedure would reveal the missing registration until a buyer's payment failed.

**Knock-on.** Post-flip the marketplace would carry 12 seeded agents and no
on-chain ones, so PR-01's provenance assertions would have nothing to assert
against, and D-013 (zero externally operated agents) becomes strictly worse.

**Resolution path** — add a step between the current 3 and 4: run
`python scripts/register_batch_agent.py` against the flipped backend, and extend
the step-4 verification from a bare length check to one that asserts at least
one agent with `source: "onchain"`. The script already handles the
already-registered case, so it is safe to re-run.

---

## D-023 — SOW §3.3 claims five wallets; zero have been verified end to end

- **Severity:** Blocker (to story 6.01 sign-off)
- **Status:** Open — decision required, not a code fix
- **Affects:** every 6.01 acceptance criterion that names a wallet

**Story 6.01 sets the rule itself:**

> Every wallet named in the SOW is tested, or the SOW's claim is trimmed to what
> was actually verified. Those are the only two honest options.

**Where this programme actually stands.** Of Freighter, xBull, Albedo, LOBSTR
and Hana, **none** has completed a registration. Not one. What exists is:

| verified | not verified |
| --- | --- |
| The picker offers all six allowlisted wallets (WM-01) | That any of them can sign |
| The wrong-network copy is correct (`wallet-errors.test.ts`) | That the guard fires for a real wallet |
| Registration is client-signed, so no server key is needed | That a signature is accepted end to end |
| The form survives a 429 (VR-06) | That it survives a real signature rejection |

Three independent things block the testing, and none is a code defect:

1. The target reports **mainnet** while the story is testnet-only (D-001). The
   flip is a dashboard operation only the account owner can perform.
2. Each cell needs a real extension and a **human** approving a prompt. Albedo
   and LOBSTR are not extensions at all — a web redirect and a mobile/
   WalletConnect flow.
3. Two of the five, **Albedo and LOBSTR, cannot satisfy the wrong-network
   criterion at all** (D-015) — they do not implement `getNetwork()`, so the
   guard is structurally unable to fire for them.

**The decision this forces.** Point 3 means even a perfectly executed manual
matrix cannot return a clean pass for all five on every criterion. So the
choice is not "test them later" — it is:

- **(a)** run the matrix once a testnet target exists, and record Albedo and
  LOBSTR as passing registration but *not* satisfying the wrong-network
  criterion, with that limitation carried into the 5.03 integration guide; or
- **(b)** trim the SOW claim to the wallets that can satisfy every criterion.

Option (a) is the honest and likely intended outcome, but it requires the SOW's
wallet claim to carry a documented caveat rather than an unqualified five.

**What must not happen** is the third path: leaving the claim unqualified while
no wallet has been verified. That is the state today.

---

## D-024 — The reputation `degraded` flag is computed, logged, and then discarded at the API boundary

- **Severity:** Major
- **Status:** **Resolved in `main`, not yet deployed** — see D-031
- **Affects:** RF-11

**Steps to reproduce**

```
curl -s https://orizons.xyz/api/stellar/reputation/agt_11c0
```

**Expected** — a `degraded` field distinguishing "the chain was unreadable and
this is a fallback" from "this agent genuinely has no ratings yet". The
frontend already declares it (`lib/types.ts`, `ReputationInfo.degraded`) and its
own comment calls it *"the only thing separating 'we could not read the chain'
from a genuine cold-start newcomer, which `source: 'prior'` alone reports
identically."*

**Actual**

```json
{"agent_id":"agt_11c0","smoothed_bps":7000,"lower_bound_bps":5677,"avg_bps":0,
 "count":0,"weight":0,"disputed":0,"dispute_rate_bps":0,"source":"prior"}
```

No `degraded` key, in any state.

**Cause** — `app/routers/stellar.py` declares its own `ReputationInfo` mirror
model (line 49) that has no `degraded` field, and builds it with
`ReputationInfo(**info.model_dump())`. Pydantic drops the unknown key silently,
and `response_model` then serializes only the declared fields. The same applies
to the batch route. On the plan path the flag is lost one step earlier:
`orchestrator_svc._rep_fields` stamps only `rep_bps` and `rep_source` onto a
`PlanStep`, so a `DecomposeResponse` cannot carry it either.

`reputation_svc.RepInfo.degraded`'s own comment anticipated this — *"the
routers' mirror models drop unknown keys, so no client contract changes"* — but
what reads as a compatibility note is in fact the defect: there is no client
contract, because the field can never leave the process.

**Impact** — Story 3.05 made the fail-open visible **in the logs** and that half
works. The client half does not exist. During a Soroban outage every agent is
served at the prior with `source: "prior"`, which is byte-identical to twelve
genuine newcomers, while the routing floor is failing open underneath. A buyer
reading the plan card, and the reputation page's own "prior estimate" badge,
are told a confident cold-start story about a system that has simply lost sight
of the chain. This is the exact condition the flag was added to surface.

**Resolution path** — Add `degraded: bool = False` to the router's
`ReputationInfo` mirror, and carry it onto `PlanStep` from `_rep_fields` so the
plan card can distinguish the two states. Both are additive with a safe default.

**Resolution** — Both halves are fixed upstream, the second in a better shape
than suggested here. The router's `ReputationInfo` mirror now declares
`degraded: bool = False`, so the reputation routes carry it. On the plan the
signal is `DecomposeResponse.reputation_degraded` — a property of the whole
plan rather than a per-step flag, and deliberately not called `degraded`,
because that word already means "re-admitted below the floor by the starvation
backstop" on both `PlanStep` and `PlanFloorNotice.kind`; a third meaning in one
payload would be its own defect. Verified by
`test_rf11_client_can_tell_an_outage_plan_from_a_cold_start_plan`, which now
asserts an outage plan reports `reputation_degraded: true` and a genuine cold
start reports `false` — the flag has to distinguish the two states without
crying wolf on every newcomer.

---

## D-025 — Firefox and WebKit browser binaries cannot be downloaded on the authoring machine

- **Severity:** Minor (process, not product)
- **Status:** Open
- **Affects:** the browser matrix of every browser-run criterion, RF-14 and RF-17 included

**Steps to reproduce**

```
npx playwright install firefox webkit
```

**Expected** — all three engines install, so `playwright.config.ts`'s four
projects (chromium-desktop, chromium-mobile, webkit-desktop, firefox-desktop)
can all run.

**Actual** — Chromium and its headless shell install. Firefox fails twice, on
separate attempts:

```
Failed to install browsers
Error: Failed to download Firefox 155.0 (playwright firefox v1543), caused by
Error: Download failure, code=1
```

WebKit is never reached, because the command aborts on the first failure.

**Impact** — Browser-run criteria are verified on Chromium desktop and mobile
only. This is an environment limit, not an application defect: nothing about
the product is known to be broken on Firefox or WebKit, and nothing about it is
known to work there either. Recorded so that a green run is not mistaken for
cross-browser sign-off.

**Resolution path** — Re-run the install on a machine with a working route to
`cdn.playwright.dev`, or let CI install them (CI runners download all three as
part of `npx playwright install --with-deps`). The suite needs no change: the
four projects are already declared in `playwright.config.ts`.

---

## D-026 — `/api/health` reports a build-independent version, so a tester cannot say which build they tested

- **Severity:** Minor
- **Status:** Open
- **Affects:** UAT entry criteria (identifying the build under test)

**Steps to reproduce**

```
curl -s https://orizons.xyz/api/health
```

**Expected** — enough to identify the deployed build: a commit sha, a build id,
or a version that changes when the deployment does.

**Actual**

```json
{"status":"ok","version":"0.1.0","uptime_seconds":2690.3}
```

`SERVICE_VERSION` is the literal `"0.1.0"` in `app/config.py:22` and has never
changed. `uptime_seconds` tells you the process restarted, not what it restarted
into.

**Impact** — Every defect in this log names a target URL and a date, because
that is the most precise thing available. Two runs a week apart against
different builds are indistinguishable from the API, so a fixed defect and a
flaky one look the same on re-test, and a regression cannot be bisected to a
deploy. The frontend has the same gap: nothing served identifies its build
either.

**Resolution path** — Both hosts already inject the commit: Render sets
`RENDER_GIT_COMMIT`, Vercel sets `VERCEL_GIT_COMMIT_SHA`. Read it into the
health payload (falling back to the static version when unset, so local and
test runs are unaffected), and surface the frontend's on a `/api/version` route
or in the UAT banner. `tests/test_health_api.py` asserts against
`SERVICE_VERSION` and would need the same fallback.

---

## D-027 — The repository account cannot push to the backend repo either

- **Severity:** Blocker (process, not product)
- **Status:** Open
- **Affects:** delivery of every RF criterion verified in the backend repo

**Steps to reproduce**

```
cd Orizon-Agents-BE-Stellar && git push -u origin uat
```

**Expected** — the branch reaches the remote, and CI runs the fast checks on it.

**Actual**

```
remote: Permission to Bl0cksmiths/Orizon-Agents-BE-Stellar.git denied to rie-hash14.
fatal: ... The requested URL returned error: 403
```

`git ls-remote --heads origin` confirms no `uat*` branch exists on the remote.

**Impact** — This extends D-012, which recorded the same 403 for the frontend
and contract repos; the backend was the one write path that still worked when
D-012 was written, and it no longer does. Concretely: story 6.02's backend
verification — the floor boundary tests, the disclosure tests and the
degradation/startup tests, which are where most of these criteria are actually
decided — exists as local commits on three branches that cannot be published,
and backend CI cannot run them. The work is real and runnable from the
worktrees; it is simply undeliverable through git by this account.

The UAT repository itself is unaffected: `rie-hash14` owns it and every commit
in this programme has pushed normally.

**Resolution path** — Grant `rie-hash14` write access to
`Bl0cksmiths/Orizon-Agents-BE-Stellar`, or have a maintainer pull the three
branches from the worktrees under `be-worktrees/` and open the PR. A CI trigger
for `uat`/`uat-*` branches is already committed locally on the backend `uat`
branch and ships with that push.

---

## D-028 — The free-form planner never re-checks the reputation floor, so a sub-floor agent the model names is hired

- **Severity:** Major
- **Status:** Open
- **Affects:** RF-05

**Steps to reproduce** — `tests/test_floor_disclosure.py::test_rf05_sub_floor_agent_is_absent_from_the_free_form_plan`
in the backend repo (currently `xfail(strict=True)`). Give one agent a
reputation whose lower bound is 4200 against the 5500 floor, then return a plan
naming it from the orchestrator LLM.

**Expected** — the sub-floor agent is dropped from the returned plan. The kit
path enforces exactly this: `_build_kit_plan` calls `passes_floor` on every
pipeline agent and substitutes or drops the ones that fail.

**Actual**

```
AssertionError: assert ['agt_11c0', 'agt_09l5'] == ['agt_09l5']
```

`agt_11c0` is correctly absent from the prompt's `AVAILABLE_AGENTS` block and
is still hired, and still stored in `state.plans[...]`.

**Cause** — `app/services/orchestrator_svc.py:341`. The clamp over model-returned
steps is `if not agent or get_worker(agent.id) is None: continue`. It checks
registry membership and worker presence and never calls
`reputation_svc.passes_floor`. The floor is applied when building the prompt and
never again, so it is advisory on the way in and absent on the way out.

**Impact** — The routing guarantee holds only as long as the planner confines
itself to the agents it was offered, and there are two ordinary ways it does
not. First, when the `_MIN_ROUTABLE_AGENTS` backstop fires, sub-floor agents are
deliberately placed *into* the prompt; the model then names them legitimately
and they are hired with no `degraded` flag on the step, while the kit path in
the same situation marks every re-admitted step `degraded=True`. The two paths
disagree about the same event. Second, the intent is attacker-controllable and
is spliced into the prompt (fenced, but fencing is a mitigation, not a
guarantee) — an intent naming a specific agent id is a plausible route to
hiring an agent the floor excluded. A structural check after the model returns
costs one call and does not depend on the model's cooperation.

**Resolution path** — Add `reputation_svc.passes_floor(reps.get(agent.id))` to
the clamp, and record what it dropped (see D-029, which supplies the disclosure
channel the free-form path currently lacks).

---

## D-029 — The free-form path relaxes the reputation floor and tells the buyer nothing

- **Severity:** Major
- **Status:** **Resolved in `main`, not yet deployed** — see D-031
- **Affects:** RF-13

**Steps to reproduce** — `tests/test_floor_disclosure.py::test_rf13_free_form_response_discloses_that_the_floor_was_relaxed`
in the backend repo (currently `xfail(strict=True)`). Put most agents below the
floor so fewer than `_MIN_ROUTABLE_AGENTS` clear it, then decompose a free-form
intent.

**Expected** — the `DecomposeResponse` carries a notice stating the floor was
relaxed, as the kit path does: `_build_kit_plan` appends a `degraded`
`PlanFloorNotice` for every agent the backstop re-admits.

**Actual**

```
AssertionError: free-form plan was built with the floor relaxed but disclosed nothing
assert False
```

`resp.notices` is empty. The plan itself builds correctly.

**Cause** — Two places. `app/services/orchestrator_svc.py:385`, the free-form
branch's `return DecomposeResponse(...)`, omits `notices=` entirely, where the
kit branch passes it. And the relaxation itself is decided inside
`_registry_prompt_fragment` (line ~155, `routable = sorted(...)[:_MIN_ROUTABLE_AGENTS]`),
which returns a prompt string and has no channel to report what it did — its
only trace is a `logger.warning`.

**Impact** — A log line is an operator signal, not buyer disclosure. On the kit
path a buyer sees "the floor was relaxed to keep this plan workable" and can
decide whether to proceed; on the free-form path the identical event produces an
identical-looking plan with nothing to distinguish it. That is precisely the
silently reshuffled pipeline story 3.02 exists to prevent, surviving on the path
3.02 did not cover. It compounds with D-028: the backstop is what puts sub-floor
agents in front of the planner, and nothing afterwards either re-checks them or
mentions them.

**Resolution path** — Give `_registry_prompt_fragment` a way to report the
relaxation (return the notices alongside the prompt, or split the routable-set
computation out of it), then pass `notices=` on the free-form
`DecomposeResponse` the way the kit branch already does. The schema needs no
change — `DecomposeResponse.notices` already exists and already defaults to an
empty list, and the frontend already renders it.

**Resolution** — Fixed upstream along the line suggested: `_routable_registry`
replaces `_registry_prompt_fragment` and returns `(registry_block, notices)`,
with the notice construction factored into a new `app/services/plan_notices.py`,
and the free-form `DecomposeResponse` now passes `notices=`. The response also
gained `floor_bps`, so the card can state the threshold and not only the
verdict. Verified by `test_rf13_free_form_response_discloses_that_the_floor_was_relaxed`,
written as a strict `xfail` against the old behaviour and now passing against
`main` with the marker removed.

---

## D-030 — A reputation floor above the prior lower bound booted silently, killing permissionless onboarding

- **Severity:** Major
- **Status:** **Resolved in `main`, not yet deployed** — see D-031
- **Affects:** RF-15

**Steps to reproduce** — `tests/test_floor_visibility.py::test_rf15_floor_above_the_prior_bound_warns_at_startup`
in the backend repo. Set `REPUTATION_FLOOR_BPS=9000`, above the prior's own
lower bound of 5677 bps, and start the application.

**Expected** — a startup warning naming both numbers and stating the
consequence: a cold-start agent is scored on the prior bound, so no newly
registered agent can ever be routed.

**Actual (at the time of the finding)** — nothing. `prior_clears_floor()`
existed but was called only from `_log_degraded`, i.e. only when an RPC outage
happened to trigger a degradation warning. A config that silently ends
permissionless onboarding started quietly, and the failure mode is silence:
registration keeps succeeding and nobody new is ever hired.

**Resolution** — Fixed upstream in `app/main.py` by
`_report_cold_start_routability()`, called as the first statement of `lifespan`.
It reports the healthy case at INFO and the broken case at WARNING, naming the
floor, the prior lower bound, the prior parameters and the margin, and spelling
out the trap: *"never routed means never rated, and never rated means it can
never clear the floor."* It also names the remedy and notes that the value in
force is whatever the Render dashboard sets.

Verified by the RF-15 test above, which was written as a strict `xfail` against
the old behaviour and now XPASSes against `main` — the marker has been removed
and the test stands as a regression guard.

---

## D-031 — The UAT target is a split-version stack: a current frontend against a backend 284 commits behind

- **Severity:** Major (process)
- **Status:** Open
- **Affects:** the standing of every RF result, and of this whole programme's verdict

**Steps to reproduce**

```
curl -s -X POST https://orizons.xyz/api/orchestrator/decompose \
  -H "Content-Type: application/json" -d '{"intent":"tetris game in html"}'
```

**Expected** — a response shaped like the `DecomposeResponse` on `main`, which
now carries `floor_bps` (the floor this plan was built under) and
`reputation_degraded` (at least one reputation read fell back to the prior).

**Actual** — the response carries neither; its keys are `plan_id`, `intent`,
`steps`, `total_usdc`, `total_eta`, `notices`. `GET /api/stellar/reputation/{id}`
likewise returns no `degraded` field. Both were added upstream in the week-2
backend consolidation (PR #56, 284 commits), which is merged to `main` and not
deployed.

**Impact** — Three defects in this log (D-024, D-029, D-030) are fixed in
`main` and still present on the target this programme tests. Any RF result
taken through the browser describes the old build; any result taken through the
backend suite describes `main`. The two disagree, and a reader of the sign-off
cannot tell which one a given line refers to unless it says so explicitly —
which is why every RF row in `traceability.md` now names the surface it was
verified on.

This is also D-026 with consequences: because `/api/health` reports a hardcoded
`"version":"0.1.0"`, nothing served by the target identifies its build, so the
284-commit gap is invisible from the outside. It was found only by diffing the
API's response shape against the source tree.

**Refinement after further checking** — only the *backend* is stale. The
deployed frontend is current with `main`: `/app/bind` serves 200 and the nav
carries the new Bind and My Agents entries, both of which post-date the old
build. So the stack is split, and the two halves fail silently against each
other rather than loudly:

- `FloorSummary` ships in the deployed frontend and returns `null` when
  `plan.floor_bps` is absent — deliberately, since defaulting to a constant
  "would narrate a threshold nobody applied". The backend never sends the field,
  so the component renders nothing and the applied floor goes unstated on the
  live plan card. Nothing errors; a feature simply is not there.
- The same holds for `reputation_degraded`: the frontend can distinguish an
  outage from a cold start, and the backend gives it nothing to distinguish
  with.

A silent split like this is exactly what D-026 makes hard to notice, and it is
why a withdrawn defect (D-032) was filed against the frontend for a backend
cause.

**Resolution path** — Deploy the backend `main` to the UAT target and re-run the
RF suite; the three resolved defects should then verify on the browser surface
too, and the floor summary should appear without a frontend change. Fix D-026 in
the same pass so the next split announces itself instead of having to be
inferred from response shapes.

---

## D-032 — ~~The plan card states the applied floor only when the floor acted~~ (WITHDRAWN)

- **Severity:** Minor
- **Status:** **Withdrawn — the finding was wrong.** The cause is D-031.
- **Affects:** RF-14

**Steps to reproduce** — Decompose any intent whose plan needs no floor action
(every intent on the current deployment, since no agent has on-chain evidence)
and read the execution-plan card.

**Expected** — story 6.02 asks that the plan card show "reputation, source, the
applied floor, and any exclusions". The threshold is part of the claim: a buyer
told an agent scores 3.50 learns nothing unless they also know what score was
required.

**Actual** — the floor appears nowhere on a clean plan. It is present only
inside a `PlanFloorNotice.reason` string (`below routing floor (4200 < 5500 bps)`),
and that panel renders only when `notices` is non-empty. Per-step reputation and
source do render, so the criterion fails on its third element only.

**Not the same thing as the badge decision, which is correct.**
`execution-plan.tsx` deliberately does not pass `floorBps` to `ReputationBadge`,
and documents why at length: the badge decides below-floor with
`(lowerBoundBps ?? bps) < floorBps`, a `PlanStep` carries only the smoothed
`rep_bps` and no lower bound, so handing it the floor would compare the wrong
number and could clear an agent the planner would have excluded. That reasoning
is sound and this defect does not ask for it to be reversed.

**Impact** — Minor, and now cheap to fix. `DecomposeResponse.floor_bps` was
added upstream precisely so "the card can state the threshold rather than only
the verdict", and the frontend's `lib/types.ts` already declares it — but no
component reads it. The data is being sent and dropped.

**Withdrawal** — This defect was raised against a stale reading of
`execution-plan.tsx` and a grep scoped to that one file. The frontend *does*
state the applied floor at plan level: `FloorSummary`
(`app/app/orchestrator/_components/floor-summary.tsx`) is rendered from
`execution-plan.tsx:200`, prints the floor above the steps, and has its own unit
suite. Its module docstring makes the same argument this defect did — "a buyer
read three verdicts against a threshold nobody stated" — and it was written
before this defect was filed.

It renders nothing on the deployed stack for one reason: it returns `null` when
`plan.floor_bps` is absent, deliberately, because defaulting to a constant "would
narrate a threshold nobody applied". The deployed backend does not send
`floor_bps` — which is **D-031**, the stale deployment, and not a frontend gap.

No code change is wanted. The floor will state itself on the card as soon as the
backend is deployed. Left in the log rather than deleted so the record shows what
was claimed and why it was wrong.

---

## D-033 — A drift-check test asserts a POSIX path and fails on Windows

- **Severity:** Minor
- **Status:** Open
- **Affects:** the backend exit criterion "full suite green" on a non-Linux machine

**Steps to reproduce** — On Windows, from a clean checkout of backend
`origin/main` (`6867f45`):

```
python -m pytest tests/test_contract_drift.py -q
```

**Expected** — pass, as it does on CI.

**Actual**

```
FAILED tests/test_contract_drift.py::test_a_missing_canonical_map_is_a_failure_that_names_where_it_looked
AssertionError: assert '/nowhere/one' in 'cannot find the canonical address book (addresses.json).
  Looked in:\n    - \nowhere\one\n    - \nowhere\two\n ...'
```

**Cause** — The test builds `Path("/nowhere/one")` and asserts the literal
string `"/nowhere/one"` appears in the error message. `Path` renders with the
host separator, so the message contains `\nowhere\one` on Windows. The
production code is correct; the assertion is not portable.

**Attribution** — Not introduced by this programme. Verified by running the
file in a detached worktree at `origin/main` with none of the RF work present;
the RF branch touches only `.github/workflows/ci.yml` and the three
`tests/test_floor_*.py` files.

**Impact** — Minor and bounded. CI runs `ubuntu-latest`, so this never goes red
there. It does mean "the full suite passes" is untrue on a Windows dev machine,
and it cost this programme a round of investigation to rule out as its own
regression — which is the real cost of a platform-dependent assertion.

**Resolution path** — Assert against the rendered path rather than the literal:
compare with `str(Path("/nowhere/one"))`, or normalise separators before the
`in` check.

---

## D-034 — The reputation-floor panel ships collapsed, so no single frame names the floor's actions

- **Severity:** Minor
- **Status:** Open
- **Affects:** RF-14

**Steps to reproduce** — Decompose a plan the floor acted on and look at the
execution-plan card without touching it.

**Expected** — RF-14 asks that one frame show, for every floor action, the agent
named, the action taken, and the reason including the applied floor in bps.

**Actual** — the panel renders as a closed `<details>`
(`app/app/orchestrator/_components/exclusions-panel.tsx:256`, no `open`
attribute). The delivered frame carries the summary only — *"Reputation floor ·
3 changes / 1 excluded · 1 substituted · 1 kept below the floor"*. A closed
`<details>` does not render its contents at all, so the agent names and reasons
are absent from the DOM and unreachable by role until the summary is activated.

**The disclosure itself is a defensible design, and this is not a request to
delete it.** The component's docstring argues for native `<details>`/`<summary>`
because "it is focusable" and keyboard-operable for free, and the summary
deliberately carries the counts as "the part a buyer who never opens it should
still see". Against a plan with many notices on a 390px viewport, collapsing is
reasonable.

**Impact** — Two concrete consequences, both small. A buyer skimming the card
before authorizing sees that the floor acted three times but not on whom or why.
And the SOW §6.1 Deliverable 2 evidence frame requires one interaction to
produce, which the provenance note must therefore state — evidence that silently
implies "this is what the page shows" when the page shows less is the failure
mode the note exists to prevent.

**Resolution path** — Either default the panel to open when the notice count is
small (`open={notices.length <= 3}`), or promote the first line of each notice
into the summary. Either keeps the disclosure and satisfies the criterion.
Pinned by `RF-14 the first frame of a floor-acted plan names every floor action
and its reason, with no interaction`, marked `test.fail()`; an unexpected pass
is the signal it has been fixed.

---

## D-035 — A step kept below the floor announces to a screen reader as an ordinary step

- **Severity:** Minor
- **Status:** Open
- **Affects:** RF-14 (accessibility of the floor signal)

**Steps to reproduce** — Render a plan in which the starvation backstop
re-admitted a step below the floor, and read the step row with a screen reader
(or inspect its accessible names).

**Expected** — the step's below-floor status is part of what assistive tech
announces, not only of what the page looks like.

**Actual** — the step announces as plain `on-chain reputation 2.60`, identical
to any other step. The distinguishing `▾ below floor` chip is a `<Badge>` inside
a `<span title="Kept by the starvation backstop despite scoring below the
routing floor.">` (`execution-plan.tsx:249`). A `title` on a non-interactive
`<span>` is not reliably exposed as an accessible name, and it is not part of
the reputation badge's own `aria-label`.

**The obvious fix is the wrong one, and the code already says why.**
`ExecutionPlan` deliberately does not pass `floorBps` to `ReputationBadge`, with
a long comment explaining that the badge decides below-floor with
`(lowerBoundBps ?? bps) < floorBps` while a `PlanStep` carries only the smoothed
`rep_bps` and no lower bound — so passing the floor would compare the wrong
number and could clear an agent the planner would have excluded. That reasoning
holds. Making the badge itself announce the floor verdict would reintroduce
exactly that bug.

**Impact** — Minor, and bounded: meaning is not carried by colour alone (the
glyph and the words "below floor" are visible text), so a sighted user is
correctly informed. The gap is specifically the non-visual path, on the one step
type the buyer most needs to notice.

**Resolution path** — Give the chip its own accessible name rather than routing
the floor into the badge: move the explanatory sentence onto the `Badge` as an
`aria-label`, or add visually-hidden text inside it. Pinned by the exact
`aria-label` assertion in `RF-14 every step of a floor-acted plan carries its own
reputation badge, and the substituted and below-floor steps are flagged`, which
fails loudly if the label changes.

## D-036 — The deployed backend predates story 2.06: the settlement evidence route is missing

- **Severity:** Blocker (for story 6.05's entry criterion)
- **Status:** **Resolved 2026-09-24** — the backend was redeployed. `GET /api/stellar/settlement/uat605_ext_op` answers `200` with a `SettlementEvidence` body (`{"agent_id":…,"window_days":7.0,"scanned_ledgers":120959,"entries":[],"total_stroops":0,"unavailable":null}`), and the deployed API now also carries `floor_bps`, `planner_fallback` and `reputation_degraded`, so the split stack of D-031 is gone too. Verified by `EX-00 the settlement evidence route is deployed` (marker removed) and by `OS-07 where the money would be, the dashboard names the escrow defect instead of a zero`, which now renders the escrow note for real. The re-run this unblocked is `evidence/6.05-external-dispatch.md` §13
- **Affects:** EX-00 (6.05 precondition); every 6.05 result is therefore a result about the *old* build

**Failing Given/When/Then (story 6.05, Preconditions)** — *"A deployed backend
carrying them. Check this first: … confirm GET /api/stellar/settlement/{id}
returns 200 rather than 404 before starting."*

**Steps to reproduce** (2026-09-17T02:48Z)

```
curl -s https://orizons.xyz/api/stellar/settlement/abc
```

**Expected** — `200` with a `SettlementEvidence` body (route
`app/routers/stellar.py:383` on backend `main`, added 2026-09-16 in
`13b53e1 exposed the settlement evidence route`).

**Actual** — the framework's generic route-miss:

```json
{"detail":"Not Found","error":{"code":"not_found","message":"Not Found","request_id":"233332118cbc4d5b"}}
```

A valid-pattern id (`abc` matches `^[A-Za-z0-9_]{1,32}$`) gets the same body,
so this is not an unknown-agent 404 — the route is not mounted.

**What *is* deployed** — the binding routes (`/api/agents/{id}/bind*`) and
`dispatch_signer` on `/api/stellar/network`, so stories 2.01/2.02 are live. The
run went ahead against that build by the product owner's decision, and every
line of `evidence/6.05-external-dispatch.md` is labelled as describing it.

**Impact** — Two of the three 6.05 defects below (D-037, D-038) are already
fixed on backend `main` and still reproduce on the target. Same class as D-031;
same missing tool as D-026 (no build identifier to tell which is which).

**Resolution path** — Redeploy backend `main`, confirm the route answers 200,
and re-run the 6.05 procedure in `evidence/6.05-external-dispatch.md`. Pinned
by `EX-00 the settlement evidence route is deployed` (`test.fail()` until then).

---

## D-037 — On the deployed build every external failure reads the same: no failure class reaches the trace

- **Severity:** Critical
- **Status:** **Resolved 2026-09-24** — deployed (D-036) and re-verified. Each class now reaches the buyer's trace, one per failure mode, on plan `pln_5541a1c3` against `uat624_ext_op`: malformed JSON → `external.uat624_ext_op failed (invalid_response)` (`tsk_8a053d47246cf746`); 2 MiB body → `(oversize_response)` (`tsk_e8444f9f49f6576e`); no answer → `(response_timeout)` at 106.345 s (`tsk_ed640b5cbccb5db6`); refused TCP on `scanme.nmap.org:444` → `(no_connection)` (`tsk_2fbab8598729c0cf`); origin down behind a live tunnel (proxy 502) → `(error_status)` (`tsk_3c06e3fe4074019b`). The workflow continued in every case and `spent` excluded the failed step
- **Affects:** EX-05 (story 2.03)

**Failing Given/When/Then (story 6.05)** — *Given a timeout, a refused
connection, an oversize response and malformed JSON, When each is triggered,
Then each should produce its own failure class in the trace, the workflow should
continue, and the buyer should not be charged for the failed step.*

The operator guide (`docs/operators/verifying-a-dispatch.md`, "When a dispatch
fails, the buyer sees why") promises `external.<agent id> failed (<class>)`.

**Steps to reproduce** — plan `pln_9b0d8421` (`agt_05x7` → `uat605_ext_op`),
executed once per failure mode against the bound endpoint; full procedure in
`evidence/6.05-external-dispatch.md`.

**Expected** — six different trace lines: `(invalid_response)`,
`(oversize_response)`, `(response_timeout)`, `(error_status)` for a proxy 502,
`(error_status)` for a 530, `(no_connection)` for a refused port.

**Actual** — the identical line in all six, with nothing after it:

| case | task | trace line | at |
| --- | --- | --- | --- |
| malformed JSON | `tsk_95dcf7193c6d283d` | `external.uat605_ext_op failed` | 04.271 |
| 2 MiB body | `tsk_2bdfa9d09615816c` | `external.uat605_ext_op failed` | 06.947 |
| no answer | `tsk_e218509d84b39774` | `external.uat605_ext_op failed` | 102.940 |
| origin down, tunnel up (502) | `tsk_1de17c1c6d80a0b9` | `external.uat605_ext_op failed` | 06.302 |
| tunnel gone (530) | `tsk_4f975e5cc940914d` | `external.uat605_ext_op failed` | 03.659 |
| refused TCP (`scanme.nmap.org:444`) | `tsk_bcf56ce4aa358947` | `external.uat605_ext_op failed` | 04.457 |

Only elapsed time tells a timeout apart; nothing tells the other five apart.

**What did hold** — the workflow continued in every case (`seo.brief` delivered,
run finalized `failed` with `workflow incomplete — 1/2 agents produced output`),
and `spent` was `0.009` — `agt_05x7`'s price only, the failed step excluded.

**Impact** — the operator's only diagnostic is the class; without it the
guide's fix table cannot be used, and an operator has to guess between "my JSON
is wrong", "my body is too big" and "you cannot reach me".

**Resolution path** — deploy `main`; re-run the six cases; each line should end
in its class. `tests/test_dispatch_failure_taxonomy.py` on `main` covers it at
unit level.

---

## D-038 — Non-delivery costs an external agent nothing: no rating reaches the chain, for failure or for success

- **Severity:** Critical
- **Status:** **Resolved 2026-09-24** — deployed (D-036) and re-verified on chain. Seven workflows against `uat624_ext_op` produced seven `rated` events on `ReputationLedger CDCSOBEV…422ZT` (13 in the window counting `agt_09l5`'s six), with **0** `charged` events on the escrow over the same ledgers — so rating no longer depends on settlement. The trace now carries the line, e.g. `proof reputation → UAT 6.24 haiku operator rated 95/100 · tx 0bc33e0ac9…`, and the score moves in both directions: `count 0 source prior` → 95/100 on delivery (`7002`), then `6997 → 6993 → 6989 → 6985 → 6981` across the five failures, back to `6983` on recovery. Non-delivery now has a cost. Pinned by `EX-06 the re-run agent carries on-chain ratings, not the cold-start prior`
- **Affects:** EX-06 (story 2.03, whose premise is that non-delivery has a cost)

**Failing Given/When/Then (story 6.05)** — *Given an external step that fails,
When the run finalizes, Then record whether any rating reaches the chain. If
none does, file it as a Bug against story 2.03.*

**Steps to reproduce** — the eight runs in `evidence/6.05-external-dispatch.md`
(two single-step successes, six failures), then:

```
curl -s https://orizons.xyz/api/stellar/reputation/uat605_ext_op
# getEvents on ReputationLedger CDCSOBEV…422ZT, startLedger 4718140
```

**Expected** — after each failed run a low rating for `uat605_ext_op` on
`ReputationLedger`, and `count` rising; after each delivered run a rating too.

**Actual**

- `GET /api/stellar/reputation/uat605_ext_op` before the first run and after the
  last: `count 0`, `smoothed_bps 7000`, `source "prior"` — unchanged across all
  eight runs.
- Soroban RPC `getEvents` on `ReputationLedger` from ledger 4718140 (before the
  registration) to 4718814 (after the last run): **0 events**.
- `PaymentEscrow` over the same range: 9 `authd` events (one per payer
  pre-authorization) and **0** `charged` events.
- The settler account `GA7AI5TA…5OQV` submitted **0** transactions after
  03:00Z on Horizon.

No trace of any run carries a `reputation →` line. The gate is exactly as the
story predicted: `charge_tx` is always falsy (D-039), so `_submit_ratings` is
never reached.

**Impact** — a dead endpoint keeps its cold-start prior (7000 bps, above the
floor) indefinitely and stays routable; the planner kept offering
`uat605_ext_op` after six consecutive failures. A delivering operator earns no
positive evidence either.

**Resolution path** — deploy `main`; re-run a failing case and expect a rating
tx in the trace and a `ReputationLedger` event for the agent.

---

## D-039 — A buyer is never charged, and the run still reports `complete` with a `spent` that did not happen

- **Severity:** Critical
- **Status:** Open — known contract defect (`PaymentEscrow.charge` needs the payer's `require_auth()`, which only the settler's signature is present for); verified here, not re-diagnosed. **Re-verified 2026-09-24** on the redeployed backend and unchanged: the escrow contract `CBJPTMAP…525PI` has not been redeployed since 2026-09-16, seven fresh workflows produced seven `authd` events and **0** `charged`, every task still finalized `complete` with `charge_tx null`, `spent` set (0.01–0.034) and a trailing `error · on-chain settlement failed`. It is now the only one of the five 6.05 defects still open, and it is what makes D-050 unreachable
- **Affects:** EX-04, EX-05 (stories 2.02, 2.04)

**Failing Given/When/Then (story 6.05)** — *Given the endpoint returns a valid
result, When the run completes, Then the output should appear in the trace and
artifact, and spent should include that step.* The first two clauses pass. The
third passes literally and misleads: `spent` includes the step, and nobody paid.

**Steps to reproduce** — `tsk_788c175e9dacb933` (single step) and
`tsk_7aefc02aa3afae7c`, `tsk_8d326dbaabd6e65e` (two steps), each with a fresh
payer authorization.

**Expected** — `charge_tx` set, a `charged` event on `PaymentEscrow`, the
payer's balance down by `spent`; or, if settlement cannot happen, a status that
says so.

**Actual**

- Task: `"status": "complete"`, `"spent": 0.01` / `0.019`, `"charge_tx": null`,
  `"proof_tx": null`.
- Trace: the last line is `error · on-chain settlement failed`, after the
  artifact line.
- Chain: 0 `charged` events on `CBJPTMAP…525PI` across the run; payer
  `GDJH…PKXJ` moved from 10000 to 9999.9481225 XLM — nine authorization fees
  (≈0.0058 XLM each), nothing else. Owner `GBWM…7BQJ` unchanged since its
  registration fee.

So "the buyer was not charged for the failed step" (EX-05) is true, **for the
wrong reason**: the buyer was not charged for any step.

**Impact** — the buyer-facing number (`spent`) and status (`complete`) describe
a settlement that did not happen; the only honest signal is one `error` trace
line. An operator is never paid through the escrow.

**Resolution path** — contract change (custody at `authorize`, or
`transfer_from` against an allowance) — out of 6.05's scope, see the 2.04
runbook's Settlement position. Until then, finalize with a status or field that
distinguishes "delivered, unsettled" from "complete".

---

## D-040 — The deployed dispatch envelope carries no `deadline_ms`, which the operator guide tells operators to read

- **Severity:** Major
- **Status:** **Resolved 2026-09-24** — deployed (D-036) and re-verified from a fresh capture. The envelope now reads `{"v":2,"agent_id":"uat624_ext_op",…,"network":"testnet","deadline_ms":100000}` — see `evidence/6.05/dispatch-2026-09-24.json`, which replaces the 2026-09-17 capture as the spec's fixture. The measured budget (a `response_timeout` at 106.3 s) matches the 100 s the field now advertises. Pinned by `EX-02 the captured dispatch envelope carries the documented fields` (marker removed)
- **Affects:** EX-02, EX-05 (stories 2.02, 2.03)

**Steps to reproduce** — decode `raw_body_base64` in
`docs/uat/evidence/6.05/dispatch-ok.json`.

**Expected** — per `docs/operators/verifying-a-dispatch.md`: *"must arrive
within `deadline_ms`, the budget carried in the envelope … Read it from the body
rather than hard-coding it"*.

**Actual** — the signed body's keys are `v, agent_id, intent, rationale,
context, dispatch_id, ts, network`. No `deadline_ms`. The effective budget,
observed from the timeout case, is ≈100 s (`match agent` at 02.759, `failed` at
102.940), and nothing tells the operator that.

**Impact** — an operator following the guide has no budget to honour and must
guess; a handler written as the guide says (`body.deadline_ms`) reads
`undefined`. The UAT endpoint fell back to its own 120 s default.

**Resolution path** — deploy `main`. Pinned by `EX-02 the captured dispatch
envelope carries the documented fields`, `test.fail()` until a re-captured
dispatch carries it.

---

## D-041 — A backend restart erases every buyer's task, trace and artifact; only the binding survives

- **Severity:** Major
- **Status:** Open — by design on `main` too (`app/state.py`: "state lives in this one process. Contents are lost on restart")
- **Affects:** EX-07, EX-08 (stories 2.02, 2.04)

**Steps to reproduce** — let the Render free-tier instance idle into a spin-down
(observed: `uptime_seconds` 4055.1 at 03:56Z → 26.1 at 04:19Z), then:

```
curl -s https://orizons.xyz/api/tasks/tsk_8d326dbaabd6e65e      # completed at 03:58Z
curl -s -X POST https://orizons.xyz/api/orchestrator/execute \
  -H 'content-type: application/json' -d '{"plan_id":"pln_9b0d8421"}'
```

**Expected** — a completed task stays readable by its buyer; the artifact the
buyer "paid" for (`spent 0.019`) can be fetched again.

**Actual** — `404 unknown task: tsk_8d326dbaabd6e65e` and `404 unknown
plan_id: pln_9b0d8421` (request `f8d90966d9f54af3`). The binding, in contrast,
read back unchanged and the agent was still decomposed onto (EX-07 passes).

**Impact** — on the free tier a restart follows any ~15-minute quiet period, so
every task and trace this run produced was gone within 20 minutes of the last
one. 6.05's evidence exists only because it was copied out at the time. A buyer
reopening yesterday's run, or an operator asking "why did my step fail", gets
404 — the same answer as a wrong task token.

**Resolution path** — persist terminal tasks, traces and artifacts in the store
the binding already uses; or keep the instance warm and say in the UI that
history does not survive a restart.

---

## D-042 — The reference agent never reads `.env`: a signer pinned there is silently ignored and unsigned dispatches are accepted

- **Severity:** Critical
- **Status:** Open
- **Affects:** OS-01 (story 2.04), repository `Orizon-Agents-Example-Agent-Stellar` at `38a9510`

**Failing Given/When/Then (story 6.06)** — *Given a clean clone and no prior
context, When the README is followed literally, Then each command should do
what it says — and every step that does not should be filed against story 2.04
with the actual output.*

**Steps to reproduce** — clean clone, then exactly what `.env.example` line 1
says (*"Copy to .env and edit"*), pinning the signer the way its comment
instructs:

```
cp .env.example .env
# ORIZON_SIGNER=GB5MKHDFLJZ6OFPAHM7R4HGBUPFV5PZYL3W27VTIUZZ25JMQSDZBKCMR   (from GET /api/stellar/network)
python agent.py
curl -X POST http://localhost:8787/ -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abcdef0123456789' -d '{"v":2,…,"dispatch_id":"abcdef0123456789","ts":<now>,"network":"testnet","deadline_ms":100000}'
```

**Expected** — the agent starts with the signer pinned and refuses the unsigned
request, as README step 1 promises: *"pin a signer and they are refused"*.

**Actual** (2026-09-17 14:08, no signature header sent)

```
WARNING orizon.agent ORIZON_SIGNER is not set: this agent will run UNVERIFIED dispatches. …
INFO orizon.agent listening on http://127.0.0.1:8787 — bound endpoint http://127.0.0.1:8787/dispatch, network testnet, signature NOT CHECKED
WARNING orizon.agent UNSIGNED dispatch accepted: ORIZON_SIGNER is not set, so anyone who can reach this endpoint can run this agent. …
unsigned request with .env pinning a signer -> HTTP 200
```

`agent.py` reads configuration only through `os.environ.get` (`agent.py:100-120`);
nothing loads `.env`, and `requirements.txt` has no dotenv package. README step
1 even says *"With no `.env` present the agent accepts an unsigned envelope"*,
implying the file is honoured.

**Impact** — an operator who does what the example file says believes their
endpoint refuses forged dispatches while it runs anyone's. The startup warning
is the only signal. On Render the `render.yaml` prompts set real environment
variables, so a deployment made through the Blueprint is not affected — a
laptop, VPS or any non-Blueprint host is.

**Resolution path** — either load `.env` in `agent.py` (stdlib parse, no new
dependency), or change `.env.example`'s first line and README step 1 to say
"export these as environment variables". No UAT test can pin this (the repo is
not under test here); the reproduction transcript is in
`evidence/6.06-operator-surfaces.md`.

---

## D-043 — An unresolvable endpoint passes the preflight and is refused only after the owner has signed

- **Severity:** Major
- **Status:** Open
- **Affects:** OS-06 (story 2.01)

**Failing Given/When/Then (story 6.06)** — *Given a plaintext, private, loopback
or unresolvable endpoint, When it is submitted, Then it should be refused before
anything is signed, with a message naming the rule it broke.*

**Steps to reproduce**

```
curl -sG https://orizons.xyz/api/agents/bind/endpoint-check \
  --data-urlencode "url=https://orizon-uat-no-such-host-605.invalid/dispatch"
```

**Expected** — `{"allowed":false,"rule":"unresolvable_host",…}`, and on
`/app/bind` a refusal under the endpoint field with the bind button disabled.

**Actual** — `{"allowed":true,"rule":null,"message":null}`, also for
`https://nonexistent-subdomain-6x06.example.com/dispatch`. `/app/bind` shows
`✓ endpoint allowed` and enables the button. The DNS check exists
(`unresolvable_host` in `endpoint_policy.py`) but runs only inside
`POST /api/agents/{id}/bind`, after the signature — so the owner signs, then is
refused.

Plaintext (`scheme_not_https`), private (`non_public_address`), loopback
(`loopback_host`, and `non_public_address` for `127.0.0.1` / `[::1]`) and the
metadata address are all refused before signing, naming the rule, as the
criterion asks.

**Why it is this way** — `binding.py`'s docstring orders the DNS check after
authorization deliberately, *"so an anonymous caller cannot use this as a free
resolver"*. That is a real concern; it trades against the criterion. A
resolve-only preflight that returns just the rule (no addresses) would satisfy
both.

**Pinned by** `OS-06 an unresolvable endpoint is refused before signing, naming its rule` (`test.fail()`).

---

## D-044 — My Agents shows catalog placeholders as facts: every on-chain agent is "online" with "runs 0"

- **Severity:** Major
- **Status:** Open
- **Affects:** OS-07 (story 2.06)

**Failing Given/When/Then (story 6.06)** — *Given no wallet, a wallet owning
nothing, and a wallet owning several agents, When each is opened, Then each
should state its own situation accurately — and nothing on the page should claim
more than the system actually knows.*

**Steps to reproduce** — `/app/operator` with the session of
`GBI2I3WL…AADBH` (owns `w1_audit_a7x`, `sign_probe_bb5c12`) and of
`GBWMD26I…7BQJ` (owns `uat605_ext_op`).

**Expected** — a status the system can back, or none.

**Actual** (2026-09-17)

- `w1_audit_a7x` and `sign_probe_bb5c12`: badge **`online`** next to
  **`unbound`**. There is no endpoint for anything to be online at.
- `uat605_ext_op`: badge **`online`** while its bound endpoint was a stopped
  tunnel answering `530`; **`runs 0`** although the deployed service dispatched
  to it eight times on 2026-09-17 (`evidence/6.05-external-dispatch.md` §6–§7).
- `GET /api/agents` returns `"status":"online","runs":0` for all six on-chain
  agents. The card renders those fields verbatim (`agent-card.tsx:70-71`); for
  seeded catalog agents they are demo values, for on-chain agents nothing
  computes them.

**Impact** — the two figures an operator reads first to know whether their
service is alive and used are constants. `online` for a dead endpoint is the
opposite of what the operator needs to know.

**Pinned by** `OS-07 an agent with no endpoint bound is not presented as online` (`test.fail()`).
`runs` has no separate test: it cannot be asserted without a known dispatch
count, which a restart erases (D-041).

---

## D-045 — A card says "Not eligible" and, further down, that the same agent "is routable from the day it is registered"

- **Severity:** Minor
- **Status:** Open
- **Affects:** OS-07 (story 2.06)

**Steps to reproduce** — `/app/operator` as `GBI2I3WL…AADBH`; read the
`w1_audit_a7x` card top to bottom.

**Expected** — one answer to "can this agent be picked?".

**Actual** — the Routing standing headline reads `✕ Not eligible — no endpoint is
bound.`, and Gate 2's never-rated note on the same card ends: *"The prior is set
above the floor deliberately, so an agent with no history is routable from the
day it is registered."* That sentence is about the reputation gate only, but
"routable" is the word the product uses for the whole verdict. It is rendered
whenever `source === "prior"` (`routing-standing.tsx`), regardless of Gate 1.

**Impact** — an operator who skims lands on the reassuring sentence. Say
"clears the reputation floor from the day it is registered", or omit the
sentence when Gate 1 fails.

**Pinned by** `OS-07 a card that says its agent is not eligible does not also call it routable` (`test.fail()`).

---


## D-046 — Albedo and Rabet are offered on the bind page but cannot sign the bind message

- **Severity:** Major
- **Status:** Open — from source; confirmation on a real browser is checklist section B
- **Affects:** OS-02 (story 2.01; SOW §3.3 wallet claim)

**Failing Given/When/Then (story 6.06)** — *Given each wallet named in SOW §3.3,
When an endpoint is bound, Then it should succeed — or the wallet's inability to
sign messages should be documented, with the SOW claim corrected to match.*

**Evidence** — `@creit.tech/stellar-wallets-kit` 2.1.0 (frontend `package.json`
pins `^2.1.0`; 2.1.0 is what its checkout installs). In
`esm/sdk/modules/`, Freighter (`freighter.module.js:122`), xBull (`:73`),
LOBSTR (`:72`) and Hana (`:82`) implement `signMessage`; Albedo
(`albedo.module.js:80-83`) and Rabet (`rabet.module.js:84-87`) reject with
`'Albedo does not support the "signMessage" function'` and the Rabet
equivalent. The deployed bundle's resolved version was not inspected. The frontend
has no per-wallet capability check: both wallets stay in the picker on
`/app/bind`, and `classifyError` matches none of its patterns, so the page shows

```
Transaction failed — Albedo does not support the "signMessage" function
```

as an error — possibly after the operator has already registered with that
wallet, since registration is a transaction the kit does support for both.
(That registration itself is still unverified for Albedo: its rows in
`wallet-browser-matrix.md` are empty. Rabet is not a SOW §3.3 wallet at all,
but the build offers it.)

**Impact** — an Albedo or Rabet user who registers cannot then make the agent
routable, and the message calls it a failed transaction. Until the checklist
confirms on a real browser, the SOW §3.3 claim for **binding** should name
Freighter, xBull, LOBSTR and Hana only.

**Resolution path** — hide or disable wallets without `signMessage` on
`/app/bind` (or say "this wallet can register but not bind" before the prompt),
and mention it in the register page's two-signature disclosure.

---

## D-047 — The README preflights and binds a root URL; the agent is configured for `/dispatch`; the signature needs them identical

- **Severity:** Major
- **Status:** Open
- **Affects:** OS-01 (story 2.04), `Orizon-Agents-Example-Agent-Stellar` at `38a9510`

**Failing Given/When/Then (story 6.06)** — *Given a clean clone and no prior
context, When the README is followed literally, Then each command should do what
it says.*

**Steps to reproduce** — read the README and `.env.example` in order, as an
outsider would:

| where | the URL it gives |
| --- | --- |
| README step 1, startup log | `bound endpoint http://127.0.0.1:8787/dispatch` |
| README step 2, liveness curl | `https://YOUR-AGENT.onrender.com/` |
| README step 3, preflight "before you spend a signature on it" | `…/endpoint-check?url=https://YOUR-AGENT.onrender.com/` — then *"paste the same URL you just preflighted"* |
| `.env.example`, `ORIZON_ENDPOINT_URL` | `https://your-agent.onrender.com/dispatch` |
| `agent.py:113` default | `http://127.0.0.1:8787/dispatch` |

**Expected** — one URL, used everywhere.

**Actual** — following step 3 literally binds `https://…onrender.com/`. Setting
`ORIZON_ENDPOINT_URL` from `.env.example` (or `render.yaml`'s prompt, which
gives no example) as `…/dispatch` makes every dispatch fail verification,
because the signed message embeds the bound URL byte-for-byte. `.env.example`
itself calls this *"the single most common setup mistake"*; the README walks the
reader into it. The agent answers on any path, so the mismatch is invisible
until the first real dispatch is refused with `401`.

**Resolution path** — pick one (the root URL is simpler, since the agent serves
any path) and use it in step 1's log, steps 2–3, `.env.example` and the
`agent.py` default. Step 2 should also say to set `ORIZON_ENDPOINT_URL` and
`ORIZON_SIGNER` in Render's prompt — it currently never mentions them.

---

## D-048 — README step 1 does not run on Windows as written

- **Severity:** Minor
- **Status:** Open
- **Affects:** OS-01 (story 2.04), `Orizon-Agents-Example-Agent-Stellar` at `38a9510`

**Steps to reproduce** — Windows 11, Git Bash, Python 3.14.7 from python.org,
clean clone:

```
$ python3 -m venv .venv && . .venv/bin/activate
Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.
exit=49
```

**Expected** — the commands, or a note for Windows.

**Actual** — every `python3` in the README (steps 1 and 5, the smoke curl's
`DISPATCH_ID` line, the test command) resolves to the Microsoft Store alias on a
stock Windows install, and `.venv/bin/activate` is `.venv\Scripts\activate` there.
The README's only environment note covers Debian, Ubuntu, Fedora and Homebrew.
With `python` and `.venv/Scripts/activate` substituted, step 1 then works exactly
as documented: `200` from the smoke curl, `37 passed` from the tests.

Also: `.python-version` pins **3.12**; nothing checks it locally, and 3.14.7 ran
everything without complaint, so the pin binds Render only.

**Resolution path** — one line under step 1: *"On Windows use `python` and
`.venv\Scripts\activate`."* The chapter-onboarding audience makes Windows
laptops likely.

---

## D-049 — The reference README says on-chain rating and attestation "work today"; on the deployed service neither happens

- **Severity:** Major
- **Status:** Open — true of backend `main` for ratings (ADR 0005 D2), not of the deployed build (D-036)
- **Affects:** OS-01 (story 2.04)

**Failing Given/When/Then (story 6.06)** — *Given a clean clone and no prior
context, When the README is followed literally, Then each command should do what
it says.* An outsider plans around the status section; it has to be as true as
the commands.

**The claim** — README, *Getting paid → Works today, end to end*: *"… executing
it, and having the result rated on-chain in the reputation ledger … the
orchestrator records the settlement attempt and seals an attestation against
it."* And under *The one mistake*: an under-delivering response *"is rated
**20 out of 100 on-chain**"*.

**Actual, on orizons.xyz** — story 6.05 ran eight workflows through an external
agent on 2026-09-17: 0 `ReputationLedger` events, reputation `count 0`
throughout, `proof_tx null` on every task (`evidence/6.05-external-dispatch.md`
§6–§8, D-038). No rating of any score, and no attestation, was written.

The *Pending* paragraph on payouts is accurate and matches the dashboard's
escrow note — that part should not change.

**Impact** — an operator reading "works today" expects their reputation to move
with their delivery and plans around the warning about the 20/100 rating; on
the live service nothing they do moves it, good or bad.

**Resolution path** — deploy backend `main` and re-check with a 6.05 re-run; or,
until then, move rating and attestation from *Works today* to *Pending* with a
pointer to D-038.

---

## D-050 — No run can be disputed: the whole Epic 4 dispute path is unreachable behind the escrow defect

- **Severity:** Critical
- **Status:** Open
- **Affects:** EX-04 (stories 4.02, 4.05, 4.06); the dispute UI shipped in the frontend on 2026-09-22

**Steps to reproduce** — run any workflow to completion on the deployed
service, then ask for its disputes (2026-09-24, `tsk_e534ce3029391aee`,
status `complete`, `spent 0.034`, both steps delivered):

```
curl -s https://orizons.xyz/api/tasks/tsk_e534ce3029391aee/disputes
```

**Expected** — a settlement to dispute against, and a window: the backend
stamps `dispute_window_seconds` (default 86 400) onto the settlement record at
settle time, and the trace is supposed to announce
`dispute window open — any delivered step can be disputed until …`.

**Actual**

```json
{"task_id":"tsk_e534ce3029391aee","window_closes_at":null,"now":1790220636.5,"settlement":null,"disputes":[]}
```

No trace in the re-run carried a dispute-window line. `_record_settlement`
returns early when the charge produced no `job_id`
(`execution_svc.py:1060-1061`), and the charge never lands (D-039) — so no
settlement row is ever written, and every finished run is silently
non-disputable. The buyer is not told: the task still reads `complete` with a
non-zero `spent`.

**Impact** — three merged stories' worth of dispute and refund work
(`POST /api/disputes`, the adjudicator routes, the refund executor, the
negative-rating path, and the whole `/app/trace` dispute UI) cannot be reached
by any buyer on testnet. Nothing in the product says so; it looks like a
feature that exists.

**Resolution path** — this is D-039's consequence, not a separate bug in the
dispute code: fix the escrow so a charge lands, then re-check this against a
run whose `charge_tx` is non-null. Until then the dispute UI should say why it
is empty rather than showing nothing. Worth a QA story of its own — Epic 4 has
no acceptance criteria in this plan.

---

## Bug issues

Every open defect from stories 6.05 and 6.06 is filed as a Bug in the repository that owns the code, each quoting the failing Given/When/Then and linking back here. Filed 2026-09-24.

| defect | severity | repo | issue |
| --- | --- | --- | --- |
| D-042 | Critical | Example-Agent | [#2](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/2) |
| D-047 | Major | Example-Agent | [#3](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/3) |
| D-048 | Minor | Example-Agent | [#4](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/4) |
| D-049 | Major | Example-Agent | [#5](https://github.com/Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar/issues/5) |
| D-044 | Major | FE | [#70](https://github.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/issues/70) |
| D-045 | Minor | FE | [#71](https://github.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/issues/71) |
| D-046 | Major | FE | [#72](https://github.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/issues/72) |
| D-043 | Major | BE | [#66](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/66) |
| D-050 | Critical | BE | [#67](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/67) |
| D-039 | Critical | Smart-Contract | [#3](https://github.com/Bl0cksmiths/Orizon-Agents-Smart-Contract-Stellar/issues/3) |
| D-051 | Blocker (6.03a) | BE | [#68](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/68) |
| D-052 | Minor | BE | [#69](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/69) |
| D-054 | Major | BE | [#70](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/70) |
| D-055 | Minor | BE | [#71](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/71) |
| D-056 | Minor | BE | [#72](https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/issues/72) |
| D-057 | Minor | FE | [#73](https://github.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/issues/73) |

D-036, D-037, D-038 and D-040 are not filed: they were resolved by the 2026-09-24 redeploy. D-050 is D-039's consequence and says so in both issues.


## D-051 — The deployment has dispute refunds switched off, so no dispute can ever be upheld

- **Severity:** Blocker (for story 6.03a)
- **Status:** Open — deployment configuration, not code
- **Affects:** DP-01, DP-02 (stories 4.03, 4.04, 6.03a)

**Failing precondition (story 6.03a)** — *"`DISPUTE_REFUNDS_ENABLED=true` and a
non-empty `API_KEY` are set in the Render dashboard."*

**Steps to reproduce** (2026-09-24)

```
curl -s -X POST https://orizons.xyz/api/disputes/dsp_test/uphold \
  -H 'content-type: application/json' -d '{}'
```

**Expected** — `401 invalid_api_key`: the adjudicator guard refusing an
anonymous caller, with the feature itself available to a holder of the key.

**Actual**

```json
{"detail":"dispute_refunds_disabled",
 "error":{"code":"dispute_refunds_disabled","message":"dispute refunds disabled","request_id":"e5ae82462de24666"}}
```
`503`. `dispute_refunds_enabled` defaults to `False` in `app/config.py:254`, and
the deployed service is running with the default. Turning it on also makes
`API_KEY` mandatory at boot, so the two preconditions stand or fall together.

**Impact** — even once a settlement exists (D-050), `scripts/uphold_dispute.py`
cannot credit anything: the route refuses before it reaches the adjudicator
guard. Story 6.03a's flow cannot be completed, and Deliverable 3's two on-chain
artifacts cannot be produced.

**Resolution path** — set `DISPUTE_REFUNDS_ENABLED=true` and a non-empty
`API_KEY` in the Render dashboard and redeploy, then re-run the 6.03a
procedure. Worth confirming `DATABASE_URL` in the same pass: it cannot be
checked from outside, and without it the dispute store is in-memory and every
window dies at the next restart (`dispute_store.py:1443`).

**Pinned by** `DP-02 an anonymous caller cannot uphold a dispute` / `… reject …`,
which accept either refusal today and will narrow to `401` once the switch is
on.

---

## D-052 — The adjudication routes answer an anonymous caller with their configuration state

- **Severity:** Minor
- **Status:** Open
- **Affects:** DP-02 (story 4.04)

**Steps to reproduce** — with no credentials at all:

```
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://orizons.xyz/api/disputes/dsp_test/uphold -H 'content-type: application/json' -d '{}'
```

**Expected** — `401 invalid_api_key`. `require_adjudicator` is documented to
fail closed, and an unauthenticated caller should learn nothing beyond "not for
you".

**Actual** — `503 dispute_refunds_disabled`. The refunds master switch is
checked before the adjudicator guard, so anyone can read a deployment's
`DISPUTE_REFUNDS_ENABLED` state, for any dispute id, without a key. The same
call would presumably answer `401` once refunds are on, which is itself the
signal.

**Impact** — small: the disclosed fact is one boolean about a testnet
deployment, and nothing is adjudicated either way. It is filed because the
guard's own docstring says it fails closed, and here a public caller reaches a
decision the guard was supposed to take first. It also makes a negative
authorization test ambiguous — `DP-02` has to accept two codes to stay honest.

**Resolution path** — run `require_adjudicator` before the feature-flag check,
so an anonymous caller gets `401` whatever the flag says.

---

## D-053 — Adjudication concurrency: a money-path defect, held privately

- **Severity:** Critical (story 6.03b: Urgent, stop-the-line)
- **Status:** Open — details held privately
- **Affects:** IB-01 (story 6.03b)

Found 2026-09-24 by reading and exercising the backend's adjudication code
(origin/main `3347090`) with the signer stubbed. The mechanism and the
reproduction are withheld from this public log on purpose, and have been handed
to the settler key holder and the backend maintainers directly.

What can be said publicly: under one specific interleaving of adjudication
calls, the refund guard does not hold. Triggering it needs adjudicator
credentials, so it is not reachable by a buyer or an anonymous caller, and
nothing has happened on-chain — refunds are switched off on the deploy (D-051).

**Consequence for D-051** — do not switch `DISPUTE_REFUNDS_ENABLED` on until
this is fixed, and until then never run two upholds of one dispute at the same
time, from any mix of the script and the API.

**Reproducing test** — not reachable on the deploy (D-050, D-051); a backend
regression test is part of the private hand-off.

---

## D-054 — `MAX_REFUND_USDC` is not validated, so a bad value silently removes the refund cap

- **Severity:** Major
- **Status:** Open
- **Affects:** IB-05 (story 6.03b)

**Steps to reproduce** — backend origin/main `3347090`, locally, no network:
start the service or build `Settings()` with `MAX_REFUND_USDC=nan`, then ask
`refund_svc.creditable_for` for a 50 USDC step.

**Expected** — the setting is refused at boot, as a missing `API_KEY` is when
refunds are on. The cap is the last thing between a policy mistake and the
platform wallet.

**Actual** — `nan` is accepted (`config.py:247`, no validator), and every
`amount > nan` comparison is false, so both cap checks (`refund_svc.py:227`,
`:285-293`) pass: the 50 USDC step comes back creditable at `50.0`. `inf`
disables the cap the same way; a negative value refuses every credit. A NaN
`settled_usdc` likewise skips the settled-total bound.

**Impact** — only a misconfiguration reaches it, but it fails open, silently,
on the one guard whose job is to bound a loss. At the default `1.0` the cap
holds: the amount is rounded to 7 places before the comparison and converted to
stroops from that same value.

**Resolution path** — validate `MAX_REFUND_USDC` as finite and positive at
boot, and refuse a non-finite amount in the cap check itself.

---

## D-055 — A refund refused at the cap does not tell the caller the amount or the cap

- **Severity:** Minor
- **Status:** Open
- **Affects:** IB-05 (story 6.03b)

**Steps to reproduce** — backend origin/main `3347090`: uphold a dispute whose
computed credit is above `MAX_REFUND_USDC`.

**Expected** — story 6.03b: "the refusal should name the amount and the cap".

**Actual** — the HTTP answer is `{"code":"refund_above_cap","message":"refund
above cap"}` (`routers/disputes.py:431`, message rebuilt from the code in
`main.py:411-422`). The amount and the cap reach only `refund_svc`'s ERROR log
line (`refund_svc.py:102-110`); the second log line, from `dispute_svc.py:1247`,
prints `amount=-` because no amount is passed to it.

**Impact** — no money moves: the refusal comes before anything is signed. An
adjudicator who is refused cannot tell by how much, or what the cap is,
without server log access.

**Resolution path** — carry the amount and the cap in the refusal body, and
pass the amount to `_refuse_credit`.

---

## D-056 — Every dispute refusal except the duplicate loses the service's message on the wire

- **Severity:** Minor
- **Status:** Open
- **Affects:** IB-02, DR-07 (stories 6.03b, 4.02)

**Steps to reproduce** — backend origin/main `3347090`: replay a captured
`POST /api/disputes` body after it succeeded, or dispute a step whose window has
closed.

**Expected** — the service's own message: "…expired or was already used — ask
for a new one", and "…closed at <ISO time>" (`docs/disputes.md:543`: "the
response says when it closed").

**Actual** — `routers/disputes.py:431` raises `HTTPException(status, code)` and
`main.py:412-413` rebuilds the message from the code, so callers get
`"challenge expired"` and `"dispute window closed"`. Only `duplicate_dispute`
keeps its message. `test_dispute_api.py` stubs the message as
`code.replace("_", " ")`, so no test notices.

**Impact** — a replay is still refused, and nothing is paid; the refusal is just
less legible than documented, and the closing time is not stated.

**Resolution path** — pass the service message through to the envelope, and
assert it in a test that does not stub the service.

---

## D-057 — After a 409 whose refetch fails, the step offers Dispute again with no hint it is already disputed

- **Severity:** Minor
- **Status:** Open
- **Affects:** IB-02 (story 6.03b)

**Steps to reproduce** — frontend origin/main `e56a07a`, component level:
`POST /api/disputes` answers `409 duplicate_dispute`, then
`GET /api/tasks/{id}/disputes` answers `503`.

**Expected** — story 6.03b: "the UI showing that dispute rather than a second
form".

**Actual** — the dialog closes silently on the 409 and the section refetches
(`dispute-section.tsx:256-261`). The 409 carries the original dispute, but
`ApiError` keeps no body (`lib/disputes.ts:336-341`), so the UI can only show it
from the refetch. When the refetch fails, the step still offers Dispute and the
only message is a generic "receipt unavailable". Pressing Dispute again costs
another challenge, another wallet prompt and another 409. The same window
exists briefly while a successful refetch is in flight.

**Impact** — nothing is recorded twice: the backend refuses every repeat. The
cost is a confusing loop and extra wallet prompts.

**Resolution path** — keep the dispute carried by the 409 on the error and
render it straight away, without waiting for the refetch.

---

## D-058 — In-memory dispute store: a money-path defect, held privately

- **Severity:** Major (only when `DATABASE_URL` is unset)
- **Status:** Open — details held privately
- **Affects:** IB-01 (story 6.03b)

Found 2026-09-24 in the backend's in-memory dispute store (origin/main
`3347090`), by reading the code; not run end to end. Details are handed to the
backend maintainers directly, with D-053. It does not apply when the service
runs on Postgres.

**Consequence for D-051** — before refunds are switched on, confirm
`DATABASE_URL` is set on Render. It cannot be confirmed from outside today:
`/readiness` does not report which dispute store is in use.

---

## D-059 — A dispute reason made only of invisible characters is accepted as a reason

- **Severity:** Minor
- **Status:** Open
- **Affects:** WC-05 (story 6.03c)

**Steps to reproduce** — live, no wallet needed:

```
curl -s -X POST https://orizon-agents-be-stellar.onrender.com/api/disputes \
  -H 'content-type: application/json' \
  -d '{"job_id_hex":"7fc5bc5ea95f15fc7fc5bc5ea95f15fc","step_index":0,"reason":"\u200b",
       "payer":"GDJHP2I6NRCWYZTB3ZOXRE74V4M4EGXRYORGNPTGQ6BVNJNSSJO4PKXJ",
       "nonce":"00000000000000000000000000000000","signature_b64":"AAAA"}'
```

**Expected** — `422 reason_required`, as `" \t\n "` gets: the reason is mandatory,
and a reason nobody can see is not one.

**Actual** — the reason check passes and the request goes on to the job lookup
(`404 unknown_job`). Run locally against origin/main `3347090` with a seeded
settlement and a real signature, a reason of only U+200B, U+200C, U+2060,
U+FEFF, U+00AD, U+202E (right-to-left override) or U+3164 opens the dispute —
`200`, status `open`, the nonce spent, the stored reason one invisible
character. C1 controls such as U+009B are stored as-is, although
`_require_reason` says C1 is stripped. Cause: `sanitize_untrusted` strips only
`[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]` plus what `.strip()` removes
(`app/agents/workers/prompt_safety.py`).

**Impact** — only the paying wallet, inside its window, can open such a
dispute, and nothing is paid without an adjudicator. The adjudicator is handed
a dispute with no visible reason, and a right-to-left override can reorder how
a reason displays.

**Resolution path** — treat a reason with no visible character (Unicode
categories Cf, Zs, Cc, and fillers) as empty, and strip C1 controls as
documented.

---
