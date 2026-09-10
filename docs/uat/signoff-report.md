# UAT sign-off report

**Target:** https://orizons.xyz · **Branch:** `uat` · **Date:** 2026-09-10

## Recommendation: NO-GO for sign-off

Not because the application is failing. Because **the suite has never been
executed**, so there is no evidence to sign off on. Two blockers put every
result in this programme in the "authored and statically checked" category
rather than the "observed passing" one.

This report states that plainly rather than presenting 177 authored tests as a
passing run.

## What was delivered

| item | count |
| --- | --- |
| Acceptance criteria defined | 63 |
| Criteria Covered | 55 |
| Criteria Blocked | 8 (EV-01..EV-04, AM-03/AM-04 on-chain, AM-05, PR-04) |
| Criteria Not covered | 1 (WL-04 field validation), stated reason |
| Criteria Covered by configuration | 1 (RS-07) |
| Test blocks authored | 177 across 11 spec files |
| Shared fixtures | 549 lines |
| Defects logged | 13 |
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

**D-002 — no runtime verification anywhere.** `npm ci` failed three times on
the authoring machine (3.83 GB RAM: two OOM kills, one file lock). Every commit
was verified statically only — brace balance, import resolution, and a
line-for-line diff against the authored source. That pass did catch a real
defect (two spec files silently truncated mid-programme), but it cannot catch a
wrong selector or a false assertion.

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

**All six frontend defects now have fixes prepared** on branches in the
frontend repo — `fix/registration-evidence-network` (D-008),
`fix/mobile-nav-inert` (D-010), `fix/overview-fetch-guards` (D-005),
`fix/skills-input-length` (D-004) and `fix/icons-and-titles` (D-006, D-007),
26 commits in total. None has been pushed: the repository token is read-only
for that repo (403 on push, though fetch works). Each carries its own
regression test, and none has been executed.

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
