# UAT sign-off report

**Target:** https://orizons.xyz · **Branch:** `uat` · **Date:** 2026-09-10

## Recommendation: NO-GO for sign-off

Not because the application is failing. Because **the suite has never been
executed**, so there is no evidence to sign off on. Two blockers put every
result in this programme in the "authored and statically checked" category
rather than the "observed passing" one.

This report states that plainly rather than presenting 190 authored tests as a
passing run.

## What was delivered

| item | count |
| --- | --- |
| Acceptance criteria defined | 78 |
| Criteria Covered | 66 |
| Criteria Blocked | 12 (EV-01..EV-04, AM-03/AM-04 on-chain, AM-05, PR-04, WM-02..WM-04, RE-03, RE-04) |
| Criteria Not covered | 1 (WL-04 field validation), stated reason |
| Criteria Covered by configuration | 1 (RS-07) |
| Test blocks authored | 190 across 13 spec files |
| Shared fixtures | 549 lines |
| Defects logged | 22 |
| Commits on `uat` | 164 |

Parameterized sweeps expand well past the raw test count at runtime: the a11y
and resilience suites alone run their assertions across 12 routes and up to 4
browser projects.

## Exit criteria

| criterion | status |
| --- | --- |
| Every criterion Pass, or Blocked with a reason | **Met** — matrix has no empty cells |
| No open Blocker or Critical defect | **Not met** — D-001, D-002 Blocker; D-003, D-008 Critical |
| Traceability matrix complete | **Met** |
| Typecheck, lint, full suite green in CI | **Not met** — D-002, D-003 |
| Browser/viewport matrix recorded as run | **Not met** — nothing was run |

## Blockers

**D-001 — target is mainnet, programme is testnet-only.** `/api/stellar/network`
reports `mainnet` with mainnet contract ids. The registration evidence journey
requires signing a real transaction; on this target that spends real XLM
against non-upgradable contracts. EV-01..EV-04 are Blocked, not Failed. The
suite reads the expected network from `UAT_EXPECTED_NETWORK`, so a flip to a
testnet target needs no test edit.

**D-002 — this suite has still never been run.** `npm ci` failed three times on
the authoring machine (3.83 GB RAM: two OOM kills, one file lock) and succeeded
only on a fourth attempt in a fresh clone — of the *frontend* repository, not
this one. So the frontend fixes are now executed and green, but the 190
Playwright blocks that are the substance of this programme remain authored and
statically checked, never observed passing. Static checking did catch a real
defect (two spec files silently truncated mid-programme); when the frontend
toolchain finally ran, it caught two more that static checking had missed
entirely. Expect the same here: a wrong selector or a false assertion is
exactly what this class of verification cannot see.

**D-003 — CI cannot run.** The GitHub token lacks `workflow` scope, so
`.github/workflows/` is rejected on push. The workflow is complete but parked
at `ci/e2e.workflow.yml`.

**D-008 — evidence block names a build-time network.** The register page takes
the network from the build-time passphrase env, not from the live endpoint that
the topbar, wallet and events pages all use. If the two disagree, the evidence
block prints the wrong chain and emits explorer links for it. This is live now,
and it is the one defect to fix *before* the testnet flip, because the flip is
exactly when build-time and runtime network diverge.

## Defects by severity

| severity | ids |
| --- | --- |
| Blocker | D-001, D-002 |
| Critical | D-003, D-008 |
| Major | D-004, D-005, D-010 |
| Minor | D-006, D-007, D-009 |

D-004, D-005, D-006, D-007, D-008 and D-010 are owned by the frontend
repository; D-009 by the backend.

**All frontend defects now have fixes prepared** on branches in the frontend
repo — `fix/registration-evidence-network` (D-008), `fix/mobile-nav-inert`
(D-010), `fix/overview-fetch-guards` (D-005), `fix/skills-input-length`
(D-004), `fix/icons-and-titles` (D-006, D-007), `fix/settlement-asset-symbol`
(D-014) and `fix/wallet-picker-a11y` (D-017), 35 commits in total. None has
been pushed: the account has no write access to that repo (403 on push, though
fetch works — D-012), so they are also exported as patches.

**These have now been executed.** Applied to a clean clone and run: typecheck
passes, lint passes at `--max-warnings=0`, and the full unit suite passes —
476 tests across 25 files, coverage 95.53 / 92.77 / 94.80 / 97.59 against
thresholds of 86 / 78 / 88 / 89. The first run **failed**, on two type errors
introduced by the fixes themselves; both are corrected and the numbers above
are from the corrected branches. See D-002.

**A correction to an earlier statement in this report.** An earlier version
said each branch carries its own regression test. It did not. The coverage
report proved it: `lib/settlement-asset.ts` sat at **0%** — never imported by
any test — and `lib/wallet-picker-a11y.ts`, the D-017 keyboard-trap fix, at
64% statements / 33% branches. The suite was clearing its thresholds on the
strength of the rest of `lib/`, not because these were covered.

**Both gaps are now closed.** `lib/settlement-asset.test.tsx` (11 tests) takes
that module to 100% statements, branches and functions;
`lib/wallet-picker-a11y.test.ts` (13 tests) takes its module to 100 / 91.66 /
100 / 100. The suite is 500 tests across 27 files, coverage 96.71 / 93.88 /
96.40 / 98.74.

Three branches still carry no test — `fix/overview-fetch-guards`,
`fix/icons-and-titles` and `fix/mobile-nav-inert`. Those are Next metadata, a
route handler and a DOM effect on a client component; client components are
outside the unit suite's coverage gate by design and belong to the Playwright
suite, which has never been run.

Three of the six defect write-ups were corrected once the code was read
properly — D-008's mechanism, D-004's severity, D-007's scope. Anyone reading
the remaining entries should weigh that hit rate.

## Notable findings

- **D-010** — eleven off-screen mobile nav links stay in the tab order because
  the drawer is hidden with a CSS transform, which leaves elements focusable.
  WCAG 2.4.3, every console route. The codebase already applies `inert`
  correctly in the mirror-image case, so the fix pattern exists in-repo.
- **D-004** — skills validation messages in `register-validation.ts` are
  unreachable: the input sanitises before they can fire, and the page never
  calls `touch("skills")`. Dead code implying coverage the form lacks.
- **AZ-06** — the API returns unsigned XDR for an agent the caller does not
  own. Verified live. Ownership is enforced only by `owner.require_auth()`
  on-chain. The test pins this deliberately so a future change is conscious.
- **D-009** — the money routes *are* protected (401 verified on every gated
  route), but only because an operator set `API_KEY` by hand; the config guard
  that should require it keys on `"production"` and the deployment runs
  `stage`.

## Operator agent management (verifies 1.08)

Assessed this round. **The copy requirements pass outright** — all three
statements 1.08 demands are present verbatim in
`app/app/agents/manage-panel.tsx`: a price change applies to future plans only
and an already-authorized buyer is charged the price they signed against;
delisting leaves in-flight authorized work unaffected and retains reputation
and history; and delisting is named as reversible and "never a delete".

Owner-gating is correct by construction: `app/app/agents/page.tsx` gates on
`wallet.connected && !!a.owner && a.owner === wallet.address`, comparing
against the **on-chain** owner. Seeded catalog agents carry `owner: null`, so
they can never offer a management action — the strongest negative case, and
the one a naive loosening of the gate would still pass. It is asserted
explicitly.

`AM-06` passes live: an unregistered id on either management endpoint returns
a plain `agent_not_found` 404 in the standard envelope, and malformed input
returns 422 `validation_error` rather than an opaque build failure.

**What is not verified:** AM-05, and the on-chain halves of AM-03 and AM-04.
Each needs a signed transaction that actually lands. The target reports
mainnet, so signing here would be a real transaction against non-upgradable
contracts — no test attempts it, and no test clicks "Update price" or "Confirm
delist". Clicking "Delist" is safe and is used to reveal the confirmation copy:
its handler is `setConfirmingDelist(true)`, pure local state, verified in
source before any click was written.

**Correction to an earlier observation.** The single on-chain agent,
`orizon_batch`, reports a price of **0.0**, which was first flagged here as a
symptom of missing price validation. It is not. `scripts/register_batch_agent.py`
passes `sc.i128(0)` deliberately, commented "free — the authorize max is set by
the payer per-workflow": it is a free meta-agent by design, and the payer sets
the spend cap through `PaymentEscrow.authorize` instead. Zero is a legitimate
price in this system.

The genuine gap sits next to it: `AgentRegistry.register` and `update_price`
validate the price *not at all*, so a **negative** price is storable by calling
the contract directly, bypassing the backend's `gt=0` check. Fixed on contracts
branch `fix/price-validation` — negative rejected with `BadAmount` (101,
matching `orizon_shared::codes`), zero still allowed, with a regression test
that fails if anyone tightens the guard to `<= 0` and breaks `orizon_batch`.

## To reach GO

1. Add `workflow` scope to the token; move the workflow into place (D-003).
2. Run the suite in CI and triage real failures. Expect selector fixes on the
   first run — that is normal for an unexecuted suite of this size and is not
   evidence the tests are wrong.
3. Fix D-008 before pointing UAT at testnet.
4. Point `UAT_BASE_URL` and `UAT_EXPECTED_NETWORK` at a testnet deployment and
   re-run the EV suite to clear D-001.
5. Re-issue this report with observed results replacing authored ones.

---

# Story 6.02 — reputation floor and routing boundaries

## The result depends on which build you mean

This story was verified twice over, on two surfaces that do not agree, and no
single verdict is true of both:

| surface | what it is | how it was verified |
| --- | --- | --- |
| backend `main` | `6867f45` plus this story's tests | pytest, real service, both real planners, only the Soroban `rep_state` read stubbed |
| the deployment | orizons.xyz, 284 commits behind `main` | Playwright against the live site |

Three defects this story raised — D-024, D-029, D-030 — are **fixed on `main`
and still present on the deployment** (D-031). A row saying only "Pass" would be
true of one build and false of the other, so every criterion below names its
surface, and so does every row of `traceability.md`.

The gap is invisible from outside the deployment: `/api/health` reports a
hardcoded `"version":"0.1.0"` (D-026), so nothing served identifies the build.
It was found by diffing the API's response shape against the source tree.

## The two behaviours that look like bugs, and are not

Both were verified as correct and neither is filed. The story was explicit that
they must be checked rather than "fixed", and they were.

**The floor fails open during an RPC outage.** Verified: with the ledger
unreadable, every agent falls back to the Bayesian prior, whose lower bound is
5677 bps against a 5500 floor, so every agent stays routable and the plan still
builds. This is deliberate and argued in `reputation_svc.py`'s module docstring
— an unreadable ledger genuinely means "reputation unknown", and the product's
answer to unknown reputation is "routable". Failing closed would drop every
agent below the floor at once and hand routing to the starvation backstop,
which picks a top-N by identical prior scores: the same agents hired, with
weaker semantics.

What this story *did* insist on is that the fail-open be visible, and that is
where the real defects were (D-024, and the logging half that story 3.05 had
already fixed).

**A brand-new agent with zero ratings is routable.** Verified on both planning
paths, and verified to be routable *silently* — a cold-start agent appears in no
exclusion, substitution or degradation notice. It is also verified live: every
one of the twelve seeded agents on the deployment reads `lower_bound_bps: 5677`
against `floor_bps: 5500`, so the cold-start invariant that Deliverable 1
depends on holds on the real target, not only in tests.

## How a sub-floor agent was produced

The story warned that this is not a checkbox, and it is not. Reputation is
derived, never set: the only inputs are `sum_w` / `weight` / `count` /
`disputed` in the `ReputationLedger`, written by the settler after a settled
workflow. Three methods were available and each buys a different grade of
evidence (test-plan.md has the full table).

The boundary states were built by **binary-searching the shipped arithmetic**
for ledger inputs whose Wilson lower bound lands exactly on the floor, one basis
point above, and one below — then asserting the search hit the target exactly
and failing loudly if it could not. Under shipped config that is `weight = 5`
USDC with `sum_w` of 289 650 000 000 / 289 820 000 000 / 289 480 000 000. None
of it is hardcoded: `prior_weight_stroops()`, `settings.reputation_floor_bps`
and the real functions are read at fixture time, so a change to the prior, to
`WILSON_Z` or to the floor moves the fixture with it instead of silently
un-testing the edge. The states are fed in as a `rep_state`-shaped map — what
the contract would return — so the real `smoothed_bps` → `lower_bound_bps` →
`passes_floor` chain decides the outcome rather than an asserted number.

**What could not be produced, and why it is not a gap in the product.** A full
workflow was run on the live testnet target (`tsk_9c1d3dbc25edcce8`, 6 agents,
0.168 USDC, `complete`) and reputation did not move. That is correct:
`_submit_ratings` runs only when `_settle_onchain` returned a `charge_tx` and a
`job_id`, which needs a wallet-signed x402 authorization. A simulated run
settles no money, so it mints no reputation — reputation is a record of settled
economic history, exactly as claimed. Moving reputation end to end therefore
needs a funded wallet and a human at a signing prompt, which UAT deliberately
does not hold. RF-16 is verified where the decision is actually made — in
`synthetic_rating` and the smoothing chain it feeds — and recorded as partial.

## Defects raised by this story

| id | severity | status | what |
| --- | --- | --- | --- |
| D-024 | Major | Resolved in `main` | the reputation `degraded` flag was computed, logged, then dropped by the router's mirror model — no client could ever see it |
| D-028 | Major | **Open** | the free-form planner never re-checks the floor on what the model returns |
| D-029 | Major | Resolved in `main` | a floor relaxation on the free-form path told the buyer nothing |
| D-030 | Major | Resolved in `main` | a floor above the prior bound booted silently, ending permissionless onboarding |
| D-031 | Major | Open | the deployment is 284 commits behind `main`, and nothing on it says so |
| D-032 | Minor | Open | the plan card states the applied floor only when the floor acted |
| D-033 | Minor | Open | an upstream drift-check test asserts a POSIX path and fails on Windows |
| D-025 | Minor | Open | Firefox and WebKit binaries will not download on the authoring machine |
| D-026 | Minor | Open | `/api/health` reports a build-independent version |
| D-027 | Blocker | Open | the repository account cannot push to the backend repo |

**The pins did their job.** Every defect above was recorded as a strict
`xfail` test rather than a note, which is why the three fixed upstream announced
themselves: when `main` moved, those tests turned into `XPASS(strict)` — a
*failure* — instead of passing quietly and leaving the defect log stale. Each
marker has since been removed and the test now stands as a regression guard.

**One correction the fixes forced, and it was mine, not theirs.** The RF-11 test
asserted a per-step `degraded` marker. Upstream put the signal on the plan
instead, as `DecomposeResponse.reputation_degraded`, and deliberately avoided
the name `degraded` because that word already means "re-admitted below the floor
by the starvation backstop" on both `PlanStep` and `PlanFloorNotice.kind`. The
criterion asks that an outage and a cold start be *distinguishable*, not that
they be distinguished in a particular field. The test was rewritten to assert
the plan-level flag on both sides — `true` on an outage, `false` on a genuine
cold start, so it cannot cry wolf on every newcomer.
