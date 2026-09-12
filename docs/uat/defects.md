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
- **Status:** Open
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
