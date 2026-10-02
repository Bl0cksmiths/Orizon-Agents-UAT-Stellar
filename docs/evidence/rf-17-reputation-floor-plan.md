# RF-17 — reputation floor evidence frame

**Artifact:** `rf-17-reputation-floor-plan.png`  
**Satisfies:** SOW §6.1 Deliverable 2 — one frame showing per-agent
reputation alongside an excluded sub-floor agent.  
**Captured:** 2026-10-02T02:30:14.500Z at 1440×1600, Chromium.  
**Produced by:** `tests/reputation-floor.spec.ts` — the RF-17 test, which
asserts every element below is inside the single frame before it captures it.

## Read this first: the plan was supplied by the test

The decompose response behind this screenshot was **written by the test**,
not produced by the live backend deciding anything. The test fulfilled
`POST /api/orchestrator/decompose` itself with a response containing three
floor notices (one excluded, one substituted, one kept below the floor).

It had to. On the day of capture the live testnet registry held
58 agents; 12 of them carried on-chain
ratings, and 1 sat below the routing floor of 5500 bps
(faulty_test_v2 at 5459 bps). None of those is in the demo-kit
pipeline: the kit agents read Wilson lower bounds of
5679 / 5679 / 5680 / 5689 / 5716 / 5718 bps, every one clear of the floor, so the
deterministic kit path has no floor action to report and cannot produce a
floor-acted plan on this target. A live decompose of the same intent, run in
the same session, returned 8 notices and
**0 floor actions** — every notice was an agent with no
endpoint bound, which the floor did not decide.

The free-form path does exclude a real sub-floor agent live (the RF-05 live
test in the same file proves it), but its plan is written by a language model
and is not the same plan twice, so it cannot back a reproducible frame.

Everything else in the frame is real: the deployed frontend, its markup, its
accessibility semantics, its wording, and every request other than the
decompose call.

## The panel in the frame was opened by one click

The deployed card ships the floor panel as a **collapsed** `<details>`
("Reputation floor · 3 changes"). The frame shows it open because the test
clicked the summary once. As delivered, the first frame a buyer sees carries
only the summary counts, not the agent names or the reasons.

## Target

| | |
| --- | --- |
| URL | https://orizons.xyz |
| Network (`GET /api/stellar/network`) | testnet |
| Routing floor (`GET /api/stellar/reputation/params` → `floor_bps`) | 5500 bps |
| Bayesian prior (`prior_bps`) | 7000 bps |

## The exact intent

    tetris game in html

One of the four demo-kit presets, which are deterministic and LLM-free. The
intent shown in the frame's textarea is this string, submitted through the
page's own preset button and Decompose control.

## The reputation state behind the frame

**In the picture (supplied by the test):** five steps — one scored on the
prior at 7000 bps, four on claimed on-chain evidence at 8150 / 7720 / 6480 /
6020 bps — plus three floor actions, each judged on its lower bound:
`seo.brief` excluded at 4200 bps, `code.critic` substituted by
`code.review.pro` at 5090 bps, and `deploy.v0` kept below the floor at
5210 bps by the starvation backstop.

**On the live target (measured this run):** 12 of
58 agents rated on-chain, 1 below the floor and
outside the kit pipeline, 0 floor actions on the kit plan.

## Which build this is

The deployment exposes no build identifier: `GET /api/health` returns a
hardcoded `"version": "0.1.0"` (defect D-026). The best
available anchor is the capture date above plus the response shape observed
in the same run:

- `POST /api/orchestrator/decompose` top-level keys: `floor_bps`, `intent`, `notices`, `plan_id`, `planner_fallback`, `reputation_degraded`, `steps`, `total_eta`, `total_usdc`
  — carries `floor_bps`, carries `reputation_degraded`
  (both were missing on the split deploy recorded as D-031).
- `GET /api/stellar/reputation` carries a `degraded` key
  (the flag D-024 found stripped at the API boundary, which is what lets a
  client tell an RPC outage from a cold start).

A frame captured against a build with a different response shape would
show a different list here.

## What this frame proves, and what it does not

**Proves:** given a plan whose shape the floor changed, the deployed card
renders, in one frame, a reputation badge per step carrying the score and
whether it came from the chain or the prior, and — once the disclosure is
open — each floor action with the agent named, the action taken, the
replacement where there was one, the reason, and the agent's lower bound
and the applied floor that decided it. A below-floor reason also carries
both numbers in basis points; the floor-relaxed reason carries none.

**Does not prove:** that the live backend produced any of it. It did not.
Nor does it cover the free-form intent path. That path now holds every
model step to the shortlist it was offered and discloses a relaxed floor
(the fixes for defects D-028 and D-029), and the RF-05 live test checks the
exclusion of a real sub-floor agent there, but no frame of it is filed.
