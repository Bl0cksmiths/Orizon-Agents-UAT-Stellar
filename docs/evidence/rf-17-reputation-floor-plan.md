# RF-17 — reputation floor evidence frame

**Artifact:** `rf-17-reputation-floor-plan.png`  
**Satisfies:** SOW §6.1 Deliverable 2 — one frame showing per-agent
reputation alongside an excluded sub-floor agent.  
**Captured:** 2026-09-16T18:43:48.672Z at 1440×1600, Chromium.  
**Produced by:** `tests/reputation-floor.spec.ts` — the RF-17 test, which
asserts every element below is inside the single frame before it captures it.

## Read this first: the plan was supplied by the test

The decompose response behind this screenshot was **written by the test**,
not produced by the live backend deciding anything. The test fulfilled
`POST /api/orchestrator/decompose` itself with a response containing three
floor notices (one excluded, one substituted, one kept below the floor).

It had to. On the day of capture the live testnet registry held
17 agents and **0 of them had any
on-chain rating at all** — every agent reads `count: 0`, `source: "prior"`,
with a Wilson lower bound of 5677 bps against a
routing floor of 5500 bps. Nothing on that registry sits below the
floor, so the real backend has no floor action to report and cannot produce
a floor-acted plan on this target. A live decompose of the same intent, run
in the same session, returned `notices: []` (0 notices).

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
5210 bps — plus three floor actions: `seo.brief` excluded at 4200 bps,
`code.critic` substituted by `code.review.pro` at 5090 bps, and `deploy.v0`
kept below the floor at 5210 bps by the starvation backstop.

**On the live target (measured this run):** every agent on the prior, no
on-chain evidence anywhere, no agent below the floor, no notices.

## Which build this is

The deployment exposes no build identifier: `GET /api/health` returns a
hardcoded `"version": "0.1.0"` (defect D-026). The best
available anchor is the capture date above plus the response shape observed
in the same run:

- `POST /api/orchestrator/decompose` top-level keys: `intent`, `notices`, `plan_id`, `steps`, `total_eta`, `total_usdc`
  — no `floor_bps`, no `reputation_degraded`.
- `GET /api/stellar/reputation/{agent_id}` carries no `degraded` key
  (defect D-024: the backend strips the flag at the API boundary, so no
  client can tell an RPC outage from a cold start).

Later builds add those fields; a frame captured against one of them would
show a different shape here.

## What this frame proves, and what it does not

**Proves:** given a plan whose shape the floor changed, the deployed card
renders, in one frame, a reputation badge per step carrying the score and
whether it came from the chain or the prior, and — once the disclosure is
open — each floor action with the agent named, the action taken, the
replacement where there was one, and the reason including the applied floor
in basis points.

**Does not prove:** that the live backend produced any of it. It did not.
Nor does it cover the free-form intent path: on that path the floor is
applied only while building the planner prompt and is never re-checked
afterwards, and a floor relaxation there emits no notice at all (defects
D-028, D-029). The notices rendered here are, on this build, only ever
produced by the demo-kit path.
