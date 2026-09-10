# UAT sign-off report

**Target:** https://orizons.xyz · **Branch:** `uat` · **Date:** 2026-09-10

## Recommendation: NO-GO for sign-off

Not because the application is failing. Because **the suite has never been
executed**, so there is no evidence to sign off on. Two blockers put every
result in this programme in the "authored and statically checked" category
rather than the "observed passing" one.

This report states that plainly rather than presenting 167 authored tests as a
passing run.

## What was delivered

| item | count |
| --- | --- |
| Acceptance criteria defined | 58 |
| Criteria Covered | 51 |
| Criteria Blocked | 7 (EV-01..EV-04, AM-03 on-chain, AM-04 on-chain, AM-05) |
| Criteria Not covered | 1 (WL-04 field validation), stated reason |
| Criteria Covered by configuration | 1 (RS-07) |
| Test blocks authored | 167 across 10 spec files |
| Shared fixtures | 549 lines |
| Defects logged | 10 |
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
repository; D-009 by the backend. None is fixable from this repository, so none
was fixed here.

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

## To reach GO

1. Add `workflow` scope to the token; move the workflow into place (D-003).
2. Run the suite in CI and triage real failures. Expect selector fixes on the
   first run — that is normal for an unexecuted suite of this size and is not
   evidence the tests are wrong.
3. Fix D-008 before pointing UAT at testnet.
4. Point `UAT_BASE_URL` and `UAT_EXPECTED_NETWORK` at a testnet deployment and
   re-run the EV suite to clear D-001.
5. Re-issue this report with observed results replacing authored ones.
