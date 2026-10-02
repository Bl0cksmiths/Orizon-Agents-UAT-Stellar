import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  COLD_START_TIMEOUT,
  EXPECTED_NETWORK,
  collectConsoleErrors,
} from "./fixtures";

/**
 * RF-14 / RF-17 — what the execution-plan card tells a buyer about the
 * reputation floor.
 *
 * Selectors are derived from the deployed frontend's source:
 *   - app/app/orchestrator/page.tsx                      (preset buttons, form)
 *   - app/app/orchestrator/_components/execution-plan.tsx (step rows, floor panel)
 *   - components/ui/reputation-badge.tsx                  (the badge + its label)
 *
 * This file is deliberately split into three parts, and each test's title
 * says which it belongs to:
 *
 *   1. LIVE — nothing intercepted. A kit intent is decomposed by the real
 *      backend and the card is asserted as rendered. Includes the honest
 *      negative: today's live registry produces `notices: []`, so the
 *      "reputation floor" panel must NOT render.
 *
 *   2. SUPPLIED PLAN — only `POST /api/orchestrator/decompose` is fulfilled
 *      by the test, with a body shaped exactly like the backend's
 *      `DecomposeResponse`. Everything downstream (the deployed frontend,
 *      its rendering, its accessibility semantics) is real. This exists
 *      because the live testnet registry holds no on-chain evidence for any
 *      of its 12 agents — every one reads `source: "prior"`,
 *      `lower_bound_bps: 5677` against a `floor_bps: 5500` — so no agent can
 *      be below the floor and the real backend cannot produce a
 *      floor-acted plan on this target at all.
 *
 *   3. EVIDENCE — the single-frame capture for SOW §6.1 Deliverable 2,
 *      written to docs/evidence/ with a provenance note that says, in
 *      plain words, that the plan behind the frame was supplied by the test.
 */

/**
 * Every test in this file drives the SAME shared, free-tier deployment: one
 * Vercel edge, one Render backend behind a whole-service rate-limit bucket,
 * and (in part 3) a screenshot whose frame must be reproducible. Running them
 * concurrently makes each one slower than the thing it is measuring — two
 * browsers against this target reliably exhaust the navigation budget — so
 * they run one at a time regardless of the project's `fullyParallel` setting.
 * Nothing here is skipped or conditional: serial ordering is the only change.
 */
test.describe.configure({ mode: "serial" });

/** The kit preset this stream drives. One of the four LLM-free presets in
 * page.tsx, so the live plan is deterministic run to run. */
const EVIDENCE_INTENT = "tetris game in html";

/**
 * ReputationBadge renders its whole meaning as a sentence — "prior estimate
 * 3.50 — no on-chain ratings yet" or "on-chain reputation 3.50 from 10 rated
 * jobs · clears the 2.75 network floor". That sentence, not the chip's colour,
 * is what carries score AND source to a buyer and to assistive tech, so every
 * assertion in this file reads it.
 *
 * The deployed chip (components/ui/reputation-badge.tsx at frontend 7e292ca8)
 * carries it twice: as the text of an `.sr-only` span, which is what a screen
 * reader announces, and as the chip's `title`. It no longer rides on
 * `aria-label`, which ARIA prohibits on a role-less span. The chip is found by
 * its `title` and its announced text is read from the sr-only span.
 */
const REP_BADGE = '[title^="prior estimate "], [title^="on-chain reputation "], [title^="estimate "]';

/** The text a screen reader announces for a badge. */
function badgeSpeech(badge: Locator): Locator {
  return badge.locator(".sr-only");
}

/** The announced sentence must always open with the source phrase and a 0–5
 * score to two decimals (`bps / 2000` in reputation-badge.tsx). */
const REP_LABEL_SHAPE = /^(prior estimate|on-chain reputation|estimate) \d+\.\d{2}\b/;

/**
 * Drives the orchestrator form with a preset intent and waits for the card.
 *
 * Raises the calling test's budget first. The suite's per-test timeout is 60s,
 * but this helper can legitimately spend the navigation budget (90s) plus four
 * COLD_START_TIMEOUT waits (75s each) before anything is actually wrong —
 * roughly 390s against a cold edge and a sleeping Render backend. A test
 * killed below the sum of its own waits reports "test timeout" instead of the
 * specific wait that overran, which says nothing about the deployment.
 */
async function decomposeIntent(page: Page, intent: string): Promise<void> {
  test.setTimeout(COLD_START_TIMEOUT * 6);
  await page.goto("/app/orchestrator");
  // The preset buttons are client-rendered, so they appear only once the
  // console shell has hydrated. Waiting for them explicitly (rather than
  // letting the click inherit the suite's 15s actionTimeout) is the
  // difference between "the deployment is slow today" and an unreadable
  // click timeout — hydration on a cold edge can outlast 15s.
  const preset = page.getByRole("button", { name: intent });
  await expect(preset).toBeVisible({ timeout: COLD_START_TIMEOUT });
  // Both clicks carry an explicit budget rather than the suite's 15s
  // actionTimeout. Playwright holds a click until the target is stable, and
  // the card/step rows animate in (framer-motion); on a loaded machine
  // running several browsers the renderer can take longer than 15s to settle,
  // which reports as a click timeout that says nothing about the app.
  await preset.click({ timeout: COLD_START_TIMEOUT });
  await page
    .getByRole("button", { name: "Decompose ▸" })
    .click({ timeout: COLD_START_TIMEOUT });
  await expect(
    page.getByRole("heading", { name: "Execution plan" }),
  ).toBeVisible({ timeout: COLD_START_TIMEOUT });
}

/**
 * Heading of the floor panel. The deployed card
 * (app/app/orchestrator/_components/exclusions-panel.tsx:368 at frontend
 * 7e292ca8) renders it as a collapsed `<details>` whose `<summary>` carries
 * `<h3>Reputation floor · N changes</h3>`, or "· no changes" when every
 * notice is an unbound endpoint rather than a floor action.
 *
 * The panel renders whenever `plan.notices` is non-empty, unbound-endpoint
 * notices included, so on today's registry it is present on every live plan.
 */
const FLOOR_PANEL_HEADING = "Reputation floor";

/** The floor panel itself: the `<details>` whose summary heading is the one
 * above. Matched through the heading rather than by tag alone so it stays
 * precise if the page ever grows a second disclosure. */
function floorPanel(page: Page) {
  return page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: FLOOR_PANEL_HEADING }) });
}

/** The `<ol>` of step rows inside the execution-plan card. */
function stepRows(page: Page) {
  return page.locator("ol").first().getByRole("listitem");
}

test.describe("RF-14 live plan — per-step reputation (no interception)", () => {
  test("RF-14 every step of a live kit plan carries a reputation badge naming its score and its source", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await decomposeIntent(page, EVIDENCE_INTENT);

    const steps = stepRows(page);
    const stepCount = await steps.count();
    // A card that rendered zero steps would pass every per-step assertion
    // below vacuously.
    expect(stepCount, "the live plan rendered no steps").toBeGreaterThan(0);

    // Exactly one badge per step — not "at least one somewhere on the card".
    for (let i = 0; i < stepCount; i++) {
      await expect(
        steps.nth(i).locator(REP_BADGE),
        `step ${i + 1} of ${stepCount} has no reputation badge`,
      ).toHaveCount(1);
    }

    const labels = await badgeSpeech(page.locator(REP_BADGE)).allTextContents();
    expect(labels).toHaveLength(stepCount);
    for (const label of labels) {
      expect(label, "reputation badge label does not name a source and a score").toMatch(
        REP_LABEL_SHAPE,
      );
    }

    expect(
      errors.getConsoleErrors(),
      JSON.stringify(errors.getConsoleErrors(), null, 2),
    ).toEqual([]);
  });

  /**
   * The kit pipeline's six agents all clear the floor on the live registry
   * (lower bounds 5679–5718 against 5500 on 2026-10-02), so the floor acts on
   * none of them. The live response still carries notices — one
   * `unbound_endpoint` exclusion per on-chain agent with no endpoint bound —
   * and the panel renders for them. What it must not do is credit those to
   * the floor: the summary has to read "no changes" and count the unbound
   * agents separately.
   */
  test("RF-14 a live kit plan the floor did not act on says 'no changes' and counts unbound agents apart", async ({
    page,
  }) => {
    // Registered before the navigation, so it spans BOTH the shell hydration
    // and the backend's cold-start wake — hence twice the single-wait budget.
    const decomposed = page.waitForResponse(
      (r) =>
        r.url().includes("/api/orchestrator/decompose") &&
        r.request().method() === "POST",
      { timeout: COLD_START_TIMEOUT * 2 },
    );
    await decomposeIntent(page, EVIDENCE_INTENT);
    const plan = (await (await decomposed).json()) as {
      notices: { reason_code?: string }[];
    };

    // The premise, asserted rather than assumed: every live notice is an
    // unbound endpoint, none is a floor action. If a kit agent ever falls
    // below the floor this fails first, and the assertions below have to be
    // revisited with it.
    const floorActions = plan.notices.filter(
      (n) => n.reason_code !== "unbound_endpoint",
    );
    expect(
      floorActions,
      "the live backend reported a floor action on the kit plan — the premise behind this test no longer holds",
    ).toEqual([]);
    const unbound = plan.notices.length;
    expect(
      unbound,
      "the live plan carries no unbound-endpoint notice, so there is no panel to read",
    ).toBeGreaterThan(0);

    const panel = floorPanel(page);
    await expect(
      panel.getByRole("heading", { name: `${FLOOR_PANEL_HEADING} · no changes` }),
      "the floor panel credits the floor with changes it did not make",
    ).toBeVisible();
    await expect(panel.locator("summary")).toContainText(
      `${unbound} with no endpoint bound`,
    );

    // ...and the card itself did render, so the summary above describes a
    // plan that arrived.
    await expect(stepRows(page).first()).toBeVisible();
  });
});

/**
 * D-031 recorded a split stack: a current frontend against a backend whose
 * decompose response carried no `floor_bps` and no `reputation_degraded`, and
 * whose reputation route carried no `degraded`. RF-11 (an outage told apart
 * from a cold start) and the applied-floor half of RF-14 could not be met on
 * the deployed surface at all. These read the deployed backend directly.
 *
 * An outage cannot be induced from UAT, so RF-11 is checked as far as the
 * live surface allows: the signal is served, and it reads `false` on a
 * healthy read, so it does not cry wolf on a cold start.
 */
test.describe("RF-11 live — the reputation signals the split deploy withheld (D-031)", () => {
  test("RF-11 a live decompose carries the applied floor and a plan-level and per-step degraded signal, false on a healthy read", async ({
    request,
  }) => {
    test.setTimeout(COLD_START_TIMEOUT * 3);
    const paramsRes = await request.get("/api/stellar/reputation/params", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(paramsRes.ok()).toBe(true);
    const floorBps = ((await paramsRes.json()) as { floor_bps: number }).floor_bps;

    const res = await request.post("/api/orchestrator/decompose", {
      data: { intent: EVIDENCE_INTENT },
      timeout: COLD_START_TIMEOUT,
    });
    expect(res.ok(), `decompose answered ${res.status()}`).toBe(true);
    const plan = (await res.json()) as {
      floor_bps?: number;
      reputation_degraded?: boolean;
      steps: { agent_id: string; rep_lower_bound_bps?: number; rep_degraded?: boolean }[];
    };

    expect(plan.floor_bps, "the plan does not state the floor it was built under").toBe(
      floorBps,
    );
    expect(
      plan.reputation_degraded,
      "the plan carries no outage signal, or reports one on a healthy read",
    ).toBe(false);
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const step of plan.steps) {
      expect(
        step.rep_degraded,
        `step ${step.agent_id} carries no per-step outage signal`,
      ).toBe(false);
      expect(
        typeof step.rep_lower_bound_bps,
        `step ${step.agent_id} carries no lower bound, so the card cannot judge it against the floor`,
      ).toBe("number");
    }

    const repRes = await request.get(
      `/api/stellar/reputation/${plan.steps[0]?.agent_id ?? ""}`,
      { timeout: COLD_START_TIMEOUT },
    );
    expect(repRes.ok()).toBe(true);
    const rep = (await repRes.json()) as { degraded?: boolean };
    expect(
      rep.degraded,
      "the reputation route still drops the degraded flag at the API boundary (D-024)",
    ).toBe(false);
  });

  /**
   * `FloorSummary` (floor-summary.tsx) returns null when `plan.floor_bps` is
   * absent, so on the split deploy the live card never stated the floor it was
   * built under. With the field served it must, on the 0–5 scale the badges
   * use (`bps / 2000`).
   */
  test("RF-14 the live plan card states the routing floor it was built under", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await decomposeIntent(page, EVIDENCE_INTENT);

    const summary = page.getByRole("region", { name: "routing floor" });
    await expect(summary, "the floor summary did not render on a live plan").toBeVisible();
    await expect(summary).toContainText(`floor ${(FLOOR_BPS / 2000).toFixed(2)} · applied`);

    expect(
      errors.getConsoleErrors(),
      JSON.stringify(errors.getConsoleErrors(), null, 2),
    ).toEqual([]);
  });
});

/**
 * RF-05 on the live free-form path, against a REAL sub-floor agent.
 *
 * The registry is no longer in cold start: on 2026-10-02 one bound agent
 * (`faulty_test_v2`, a deliberately faulty team-run agent) read a Wilson lower
 * bound of 5459 against the 5500 floor. The agent is found from the live
 * registry rather than named here, so the test follows whichever bound agent
 * is below the floor on the day.
 *
 * The intent names the agent and its skills — the attacker-style route D-028
 * described. The backend (orchestrator_svc.py:1055 at 6da6da7) now holds every
 * model step to the shortlist it was offered, and a sub-floor agent is never
 * offered, so it must be reported as excluded and must not be a step.
 */
test.describe("RF-05 live — a real sub-floor agent named in a free-form intent (D-028)", () => {
  test("RF-05 a bound sub-floor agent named by the intent is excluded with both numbers and is not hired", async ({
    request,
  }) => {
    test.setTimeout(COLD_START_TIMEOUT * 4);
    const [paramsRes, repsRes, agentsRes] = await Promise.all([
      request.get("/api/stellar/reputation/params", { timeout: COLD_START_TIMEOUT }),
      request.get("/api/stellar/reputation", { timeout: COLD_START_TIMEOUT }),
      request.get("/api/agents", { timeout: COLD_START_TIMEOUT }),
    ]);
    expect(paramsRes.ok() && repsRes.ok() && agentsRes.ok()).toBe(true);
    const floorBps = ((await paramsRes.json()) as { floor_bps: number }).floor_bps;
    const reps = ((await repsRes.json()) as {
      reputations: Record<string, { lower_bound_bps: number }>;
    }).reputations;
    const agents = (await agentsRes.json()) as {
      id: string;
      name: string;
      skills: string[];
      bound?: boolean;
    }[];

    const subFloor = agents.find(
      (a) => a.bound === true && (reps[a.id]?.lower_bound_bps ?? floorBps) < floorBps,
    );
    // The premise. Without a bound agent below the floor the live backend has
    // nothing to exclude, and RF-05 falls back to the backend suite alone.
    expect(
      subFloor,
      "no bound agent on the live registry is below the floor — RF-05 cannot be exercised live today",
    ).toBeDefined();
    const target = subFloor ?? agents[0];
    const lower = reps[target?.id ?? ""]?.lower_bound_bps;

    const res = await request.post("/api/orchestrator/decompose", {
      data: {
        intent: `use the agent ${target?.id} (${target?.name}) for this: ${target?.skills.join(" and ")} the word racecar`,
      },
      timeout: COLD_START_TIMEOUT * 2,
    });
    expect(res.ok(), `decompose answered ${res.status()}`).toBe(true);
    const plan = (await res.json()) as {
      steps: { agent_id: string }[];
      notices: { kind: string; agent_id: string; reason_code?: string; reason: string }[];
    };

    expect(
      plan.steps.map((s) => s.agent_id),
      `the sub-floor agent ${target?.id} was hired on the free-form path`,
    ).not.toContain(target?.id);

    const notice = plan.notices.find((n) => n.agent_id === target?.id);
    expect(notice, `no notice tells the buyer ${target?.id} was excluded`).toBeDefined();
    expect(notice?.kind).toBe("excluded");
    expect(notice?.reason_code).toBe("below_floor");
    expect(notice?.reason).toContain(`${lower} < ${floorBps} bps`);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — a decompose response supplied by the test
// ---------------------------------------------------------------------------

/**
 * The routing floor the deployment actually applies, as served by
 * GET /api/stellar/reputation/params (`floor_bps`). Every notice reason in the
 * supplied plan below quotes this number, and the plan card is asserted to
 * print it — so it has to be the real one. A fixture quoting a floor the
 * deployment no longer applies would render just as convincingly and prove
 * nothing, which is what the guard test below exists to prevent.
 */
const FLOOR_BPS = 5500;

/**
 * Mirror of the frontend's `DecomposeResponse` / `PlanStep` /
 * `PlanFloorNotice` (lib/types.ts). Duplicated rather than imported: this
 * suite ships outside the app's TypeScript project and runs against the
 * deployed site, not its source tree — the same rationale as
 * tests/evidence-helpers.ts.
 *
 * The shape has to be exact. lib/api.ts validates every decompose body
 * through `isDecomposeResponse` (lib/guards.ts) and throws on a mismatch, so
 * a body the app cannot parse would render an error alert instead of a plan
 * and every assertion below would be checking nothing.
 *
 * Fields are written as the live backend writes them today (verified against
 * POST /api/orchestrator/decompose on 2026-10-02): explicit
 * `substituted_for: null` and `degraded: false` on ordinary steps rather than
 * omitted keys, each step's own lower bound, rating count and degraded read,
 * and the plan's `floor_bps`.
 */
type SuppliedPlanStep = {
  agent_id: string;
  agent_name: string;
  rationale: string;
  est_price_usdc: number;
  est_eta_seconds: number;
  rep_bps: number;
  rep_source: "onchain" | "prior";
  rep_lower_bound_bps: number;
  rep_count: number;
  rep_dispute_rate_bps: number;
  rep_degraded: boolean;
  substituted_for: string | null;
  degraded: boolean;
};

type SuppliedNotice = {
  kind: "excluded" | "substituted" | "degraded";
  agent_id: string;
  agent_name: string;
  replacement_id: string | null;
  replacement_name: string | null;
  reason: string;
  reason_code: "below_floor" | "floor_relaxed";
  lower_bound_bps: number;
  floor_bps: number;
  count: number;
  dispute_rate_bps: number;
  awaiting_fresh_read: boolean;
};

type SuppliedPlan = {
  plan_id: string;
  intent: string;
  steps: SuppliedPlanStep[];
  total_usdc: number;
  total_eta: number;
  notices: SuppliedNotice[];
  floor_bps: number;
  reputation_degraded: boolean;
  planner_fallback: boolean;
};

/**
 * How the deployed card words each notice kind. Two of the three are the
 * backend's own word; `degraded` is rendered as "kept below floor", which is
 * why this mapping exists rather than asserting `notice.kind` directly — an
 * assertion on the raw enum would fail on the one kind whose wording the card
 * deliberately softens.
 */
const NOTICE_KIND_LABEL: Record<SuppliedNotice["kind"], string> = {
  excluded: "excluded",
  substituted: "substituted",
  degraded: "kept below floor",
};

/**
 * A plan whose shape the reputation floor changed: one agent excluded, one
 * substituted, one re-admitted below the floor by the starvation backstop —
 * alongside steps that cleared the floor on on-chain evidence and one still
 * carrying only the prior.
 *
 * This plan is SUPPLIED BY THE TEST and cannot be obtained from the live
 * target: every one of the deployment's seeded agents reads `count: 0`,
 * `source: "prior"`, so all of them share the same Wilson lower bound of
 * 5677 bps against a 5500 bps floor. Nothing on that registry sits below the
 * floor, so the real backend has no floor action to report.
 */
const FLOOR_ACTED_PLAN: SuppliedPlan = {
  plan_id: "pln_uat_rf14",
  intent: EVIDENCE_INTENT,
  steps: [
    {
      agent_id: "agt_09l5",
      agent_name: "research.pro",
      rationale: "extract feature brief + edge cases for the build",
      est_price_usdc: 0.024,
      est_eta_seconds: 0.6,
      rep_bps: 7000,
      rep_source: "prior",
      rep_lower_bound_bps: 5677,
      rep_count: 0,
      rep_dispute_rate_bps: 0,
      rep_degraded: false,
      substituted_for: null,
      degraded: false,
    },
    {
      agent_id: "agt_02k2",
      agent_name: "design.figma",
      rationale: "lock design tokens: palette, typography, motion",
      est_price_usdc: 0.018,
      est_eta_seconds: 0.4,
      rep_bps: 8150,
      rep_source: "onchain",
      rep_lower_bound_bps: 6900,
      rep_count: 9,
      rep_dispute_rate_bps: 0,
      rep_degraded: false,
      substituted_for: null,
      degraded: false,
    },
    {
      agent_id: "agt_11c0",
      agent_name: "code.gen",
      rationale: "implement single-file HTML using brief + tokens",
      est_price_usdc: 0.054,
      est_eta_seconds: 2.6,
      rep_bps: 7720,
      rep_source: "onchain",
      rep_lower_bound_bps: 6400,
      rep_count: 6,
      rep_dispute_rate_bps: 0,
      rep_degraded: false,
      substituted_for: null,
      degraded: false,
    },
    {
      agent_id: "agt_14q8",
      agent_name: "code.review.pro",
      rationale: "polish pass: a11y, motion, persistence, edge cases",
      est_price_usdc: 0.061,
      est_eta_seconds: 1.8,
      rep_bps: 6480,
      rep_source: "onchain",
      rep_lower_bound_bps: 5600,
      rep_count: 4,
      rep_dispute_rate_bps: 0,
      rep_degraded: false,
      substituted_for: "agt_12r0",
      degraded: false,
    },
    {
      agent_id: "agt_08j2",
      agent_name: "deploy.v0",
      rationale: "seal artifact + record on-chain proof",
      est_price_usdc: 0.011,
      est_eta_seconds: 0.4,
      rep_bps: 6020,
      rep_source: "onchain",
      rep_lower_bound_bps: 5210,
      rep_count: 3,
      rep_dispute_rate_bps: 0,
      rep_degraded: false,
      substituted_for: null,
      degraded: true,
    },
  ],
  total_usdc: 0.168,
  total_eta: 5.8,
  notices: [
    {
      kind: "excluded",
      agent_id: "agt_05x7",
      agent_name: "seo.brief",
      replacement_id: null,
      replacement_name: null,
      reason: `below routing floor (4200 < ${FLOOR_BPS} bps)`,
      reason_code: "below_floor",
      lower_bound_bps: 4200,
      floor_bps: FLOOR_BPS,
      count: 7,
      dispute_rate_bps: 0,
      awaiting_fresh_read: false,
    },
    {
      kind: "substituted",
      agent_id: "agt_12r0",
      agent_name: "code.critic",
      replacement_id: "agt_14q8",
      replacement_name: "code.review.pro",
      reason: `below routing floor (5090 < ${FLOOR_BPS} bps)`,
      reason_code: "below_floor",
      lower_bound_bps: 5090,
      floor_bps: FLOOR_BPS,
      count: 5,
      dispute_rate_bps: 0,
      awaiting_fresh_read: false,
    },
    {
      kind: "degraded",
      agent_id: "agt_08j2",
      agent_name: "deploy.v0",
      replacement_id: null,
      replacement_name: null,
      reason: "re-admitted below the floor to keep the plan workable (fewer than 3 agents cleared it)",
      reason_code: "floor_relaxed",
      lower_bound_bps: 5210,
      floor_bps: FLOOR_BPS,
      count: 3,
      dispute_rate_bps: 0,
      awaiting_fresh_read: false,
    },
  ],
  floor_bps: FLOOR_BPS,
  reputation_degraded: false,
  planner_fallback: false,
};

/**
 * Fulfils ONLY `POST /api/orchestrator/decompose`. Every other request the
 * page makes — the document, the bundles, the network and reputation routes —
 * still reaches the real deployment, so what renders is the deployed
 * frontend's own markup and accessibility semantics.
 */
async function supplyPlan(page: Page, plan: SuppliedPlan): Promise<void> {
  await page.route("**/api/orchestrator/decompose", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(plan),
    }),
  );
}

/**
 * The accessible label `ReputationBadge` is expected to build for a step.
 *
 * A faithful duplicate of the label construction in
 * components/ui/reputation-badge.tsx — `bps / 2000` to two decimals behind
 * the source phrase — kept here for the same reason as
 * tests/evidence-helpers.ts: the suite has no module resolution into the app.
 *
 * The plan card (execution-plan.tsx:513-523 at frontend 7e292ca8) passes the
 * badge the step's `rep_count`, its `rep_lower_bound_bps` and — only beside
 * that bound — the plan's `floor_bps`. So an on-chain step announces how many
 * rated jobs back it, and every step announces its floor verdict judged on the
 * lower bound. That verdict is what closes D-035: a step the starvation
 * backstop kept below the floor now announces "below the 2.75 network floor"
 * to a screen reader, where it used to read like any other on-chain score.
 */
function expectedBadgeLabel(step: SuppliedPlanStep, floorBps: number): string {
  const score = (bps: number) => (bps / 2000).toFixed(2);
  const source =
    step.rep_source === "prior"
      ? `prior estimate ${score(step.rep_bps)} — no on-chain ratings yet`
      : step.rep_count > 0
        ? `on-chain reputation ${score(step.rep_bps)} from ${step.rep_count} rated job${step.rep_count === 1 ? "" : "s"}`
        : `on-chain reputation ${score(step.rep_bps)}`;
  const verdict =
    step.rep_lower_bound_bps < floorBps
      ? `below the ${score(floorBps)} network floor`
      : `clears the ${score(floorBps)} network floor`;
  return `${source} · ${verdict}`;
}

/**
 * Opens the floor disclosure by clicking its summary, the way a buyer would.
 * The deployed card ships the panel collapsed, so every per-action detail —
 * agent, replacement, reason, floor in bps — is one interaction away; a
 * closed `<details>` does not render its contents at all, so nothing inside
 * is reachable by role until this runs.
 */
async function openFloorPanel(page: Page): Promise<void> {
  const panel = floorPanel(page);
  await panel.locator("summary").click({ timeout: COLD_START_TIMEOUT });
  await expect(panel).toHaveJSProperty("open", true);
}

test.describe("RF-14 supplied plan — floor actions on the card (decompose intercepted)", () => {
  test("RF-14 the routing floor the deployment applies is the floor the supplied plan quotes", async ({
    request,
  }) => {
    test.setTimeout(COLD_START_TIMEOUT * 2);
    const res = await request.get("/api/stellar/reputation/params", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(
      res.ok(),
      `GET /api/stellar/reputation/params answered ${res.status()}`,
    ).toBe(true);

    const params = (await res.json()) as { floor_bps?: number };
    expect(
      params.floor_bps,
      "the supplied plan's notice reasons quote a floor this deployment does not apply",
    ).toBe(FLOOR_BPS);
  });

  test("RF-14 the opened floor panel names every floor action — its kind, the agent, the replacement, the reason, and the deciding lower bound and floor", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await supplyPlan(page, FLOOR_ACTED_PLAN);
    await decomposeIntent(page, EVIDENCE_INTENT);

    const panel = floorPanel(page);
    await expect(
      panel,
      "the floor panel did not render for a plan carrying floor notices",
    ).toBeVisible();

    await openFloorPanel(page);

    const rows = panel.getByRole("listitem");
    await expect(rows).toHaveCount(FLOOR_ACTED_PLAN.notices.length);

    for (const [i, notice] of FLOOR_ACTED_PLAN.notices.entries()) {
      const row = rows.nth(i);
      const where = `floor notice ${i + 1} (${notice.kind})`;

      // The action taken, as a word the buyer can read — not a colour.
      await expect(row, `${where} does not name the action taken`).toContainText(
        NOTICE_KIND_LABEL[notice.kind],
      );
      // The agent it was taken against.
      await expect(row, `${where} does not name the agent`).toContainText(
        notice.agent_name,
      );
      // The reason, verbatim as the backend words it.
      await expect(row, `${where} does not give the reason`).toContainText(
        notice.reason,
      );
      // ...and the two numbers that decided it: the agent's lower bound and
      // the floor it was judged against, printed on the 0–5 scale the badges
      // use (`scoreOutOfFive` in lib/reputation-math.ts).
      await expect(
        row,
        `${where} does not state the agent's lower bound`,
      ).toContainText(`lower bound ${(notice.lower_bound_bps / 2000).toFixed(2)}`);
      await expect(
        row,
        `${where} does not state the applied floor`,
      ).toContainText(`floor ${(notice.floor_bps / 2000).toFixed(2)}`);
      // A below-floor reason is the backend's own sentence and carries both
      // numbers in bps. The relaxation sentence (plan_notices.relaxation at
      // backend 6da6da7) carries none, so for that kind the bps exist only
      // as the 0–5 figures above.
      if (notice.reason_code === "below_floor") {
        await expect(
          row,
          `${where} does not state the applied floor in basis points`,
        ).toContainText(`< ${FLOOR_BPS} bps`);
      }

      if (notice.replacement_name) {
        await expect(
          row,
          `${where} does not name what was routed in its place`,
        ).toContainText(notice.replacement_name);
      }
    }

    expect(
      errors.getConsoleErrors(),
      JSON.stringify(errors.getConsoleErrors(), null, 2),
    ).toEqual([]);
  });

  test("RF-14 every step of a floor-acted plan carries its own reputation badge, and the substituted and below-floor steps are flagged", async ({
    page,
  }) => {
    await supplyPlan(page, FLOOR_ACTED_PLAN);
    await decomposeIntent(page, EVIDENCE_INTENT);

    const steps = stepRows(page);
    await expect(steps).toHaveCount(FLOOR_ACTED_PLAN.steps.length);

    for (const [i, step] of FLOOR_ACTED_PLAN.steps.entries()) {
      const row = steps.nth(i);
      const where = `step ${i + 1} (${step.agent_name})`;

      await expect(row, `${where} does not name its agent`).toContainText(
        step.agent_name,
      );

      const badge = row.locator(REP_BADGE);
      await expect(badge, `${where} has no reputation badge`).toHaveCount(1);
      // Exact, not a pattern: the score, whether it came from the chain or
      // the prior, and the floor verdict all have to survive into what a
      // screen reader announces.
      await expect(
        badgeSpeech(badge),
        `${where} announces the wrong score, source or floor verdict`,
      ).toHaveText(expectedBadgeLabel(step, FLOOR_ACTED_PLAN.floor_bps));

      if (step.substituted_for) {
        await expect(
          row,
          `${where} does not say whose place it was routed in`,
        ).toContainText(`for ${step.substituted_for}`);
      }

      if (step.degraded) {
        await expect(
          row,
          `${where} was re-admitted below the floor but is not flagged as such`,
        ).toContainText("below floor");
        // D-035: the below-floor status is part of what assistive tech
        // announces, not only of what the page shows.
        await expect(
          badgeSpeech(badge),
          `${where} is kept below the floor but announces as an ordinary step (D-035)`,
        ).toContainText("below the");
      }
    }

    // An excluded agent was never routed, so it must not appear as a step —
    // the panel is the only place it is named.
    const excluded = FLOOR_ACTED_PLAN.notices.find((n) => n.kind === "excluded");
    const excludedName = excluded?.agent_name ?? "";
    expect(excludedName, "the supplied plan has no excluded notice").not.toBe(
      "",
    );
    await expect(
      steps.filter({ hasText: excludedName }),
      `the excluded agent ${excludedName} was rendered as a plan step`,
    ).toHaveCount(0);
  });

  /**
   * RF-14 asks for ONE frame that shows, for every floor action, the agent
   * named, the action taken, and the reason including the applied floor in
   * basis points. The deployed card does not do that: it ships the panel as a
   * collapsed `<details>`, so the frame a buyer first sees carries only the
   * summary counts ("1 excluded · 1 substituted · 1 kept below the floor")
   * and every detail RF-14 names is one click away. A closed `<details>` does
   * not render its contents, so nothing inside it is in the frame at all.
   *
   * Marked `test.fail()` rather than deleted or softened: the gap is real, it
   * is in application code this suite must not change, and it stays proven
   * while the suite stays green. If the card ever ships the panel open (or
   * inlines the actions above the fold), this test starts passing and
   * Playwright reports an unexpected pass — which is the signal to drop the
   * marker, not to widen it.
   */
  test("RF-14 the first frame of a floor-acted plan names every floor action and its reason, with no interaction", async ({
    page,
  }) => {
    test.fail();

    await supplyPlan(page, FLOOR_ACTED_PLAN);
    await decomposeIntent(page, EVIDENCE_INTENT);

    const panel = floorPanel(page);
    await expect(panel).toBeVisible();

    // Deliberately no click: this is the frame as delivered.
    const rows = panel.getByRole("listitem");
    await expect(
      rows,
      "the panel ships collapsed, so no floor action is rendered in the delivered frame",
    ).toHaveCount(FLOOR_ACTED_PLAN.notices.length);

    for (const notice of FLOOR_ACTED_PLAN.notices) {
      const row = rows.filter({ hasText: notice.agent_name });
      await expect(row).toBeVisible();
      await expect(row).toContainText(notice.reason);
    }
  });
});

// ---------------------------------------------------------------------------
// Part 3 — the evidence frame (SOW §6.1 Deliverable 2)
// ---------------------------------------------------------------------------

/** Where the deliverable and its provenance note live, relative to this spec. */
const EVIDENCE_DIR = join(__dirname, "..", "docs", "evidence");
const EVIDENCE_IMAGE = "rf-17-reputation-floor-plan.png";

/**
 * The frame is composed at a fixed size rather than at whatever the executing
 * project happens to use, so the deliverable is the same image whichever
 * project captures it — and so the "it all fits in one frame" assertions
 * below mean something specific rather than something viewport-dependent.
 */
const EVIDENCE_VIEWPORT = { width: 1440, height: 1600 };

/**
 * Fails unless the element's whole box sits inside the viewport — that is,
 * unless it is genuinely IN the frame a viewport screenshot captures, rather
 * than merely present in the document somewhere below the fold. Without this,
 * a screenshot proves only that a file was written.
 */
async function expectInFrame(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  const viewport = page.viewportSize();
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  expect(height, "the page has no fixed viewport to frame against").toBeGreaterThan(0);

  const box = await locator.boundingBox();
  expect(box, `${label} has no layout box — it is not rendered`).not.toBeNull();

  const top = box?.y ?? -1;
  const left = box?.x ?? -1;
  const bottom = top + (box?.height ?? 0);
  const right = left + (box?.width ?? 0);

  expect(top, `${label} starts ${Math.round(-top)}px above the frame`).toBeGreaterThanOrEqual(0);
  expect(
    bottom,
    `${label} extends ${Math.round(bottom - height)}px below the frame`,
  ).toBeLessThanOrEqual(height);
  expect(left, `${label} starts left of the frame`).toBeGreaterThanOrEqual(0);
  expect(right, `${label} extends past the right edge of the frame`).toBeLessThanOrEqual(width);
}

/**
 * Scrolls the execution-plan card to just below the top of the viewport so the
 * frame is composed identically on every run, instead of depending on where
 * the page happened to be left.
 */
async function frameThePlanCard(page: Page): Promise<void> {
  await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("h2")).find(
      (h) => h.textContent?.trim() === "Execution plan",
    );
    if (!heading) throw new Error("execution-plan heading not found");
    const target = window.scrollY + heading.getBoundingClientRect().top - 24;
    window.scrollTo({ top: target, behavior: "instant" });
  });
}

const EVIDENCE_NOTE = "rf-17-reputation-floor-plan.md";
const EVIDENCE_INDEX = "README.md";

/**
 * Everything the provenance note states, gathered from the live deployment in
 * the same run that captures the frame. Nothing here is a constant copied from
 * a brief: evidence that quotes yesterday's numbers is evidence about
 * yesterday.
 */
type ProvenanceFacts = {
  capturedAt: string;
  baseUrl: string;
  network: string;
  floorBps: number;
  priorBps: number;
  agentCount: number;
  agentsWithOnchainEvidence: number;
  subFloorAgents: string[];
  kitLowerBoundsBps: number[];
  liveDecomposeKeys: string[];
  liveNoticeCount: number;
  liveFloorActionCount: number;
  healthVersion: string;
  reputationHasDegradedKey: boolean;
};

/**
 * The provenance note that ships beside the image.
 *
 * Its job is to stop the frame from being read as something it is not. The
 * plan in the picture was supplied by this test; a reader who does not know
 * that would take it as the live backend having excluded a real agent, which
 * it did not and today cannot. That sentence is the first thing under the
 * heading for exactly that reason.
 */
function buildProvenanceNote(f: ProvenanceFacts): string {
  const kitBounds = [...f.kitLowerBoundsBps].sort((a, b) => a - b);
  return [
    "# RF-17 — reputation floor evidence frame",
    "",
    `**Artifact:** \`${EVIDENCE_IMAGE}\`  `,
    "**Satisfies:** SOW §6.1 Deliverable 2 — one frame showing per-agent",
    "reputation alongside an excluded sub-floor agent.  ",
    `**Captured:** ${f.capturedAt} at ${EVIDENCE_VIEWPORT.width}×${EVIDENCE_VIEWPORT.height}, Chromium.  `,
    `**Produced by:** \`tests/reputation-floor.spec.ts\` — the RF-17 test, which`,
    "asserts every element below is inside the single frame before it captures it.",
    "",
    "## Read this first: the plan was supplied by the test",
    "",
    "The decompose response behind this screenshot was **written by the test**,",
    "not produced by the live backend deciding anything. The test fulfilled",
    "`POST /api/orchestrator/decompose` itself with a response containing three",
    "floor notices (one excluded, one substituted, one kept below the floor).",
    "",
    "It had to. On the day of capture the live testnet registry held",
    `${f.agentCount} agents; ${f.agentsWithOnchainEvidence} of them carried on-chain`,
    `ratings, and ${f.subFloorAgents.length} sat below the routing floor of ${f.floorBps} bps`,
    `(${f.subFloorAgents.join(", ") || "none"}). None of those is in the demo-kit`,
    "pipeline: the kit agents read Wilson lower bounds of",
    `${kitBounds.join(" / ")} bps, every one clear of the floor, so the`,
    "deterministic kit path has no floor action to report and cannot produce a",
    "floor-acted plan on this target. A live decompose of the same intent, run in",
    `the same session, returned ${f.liveNoticeCount} notices and`,
    `**${f.liveFloorActionCount} floor actions** — every notice was an agent with no`,
    "endpoint bound, which the floor did not decide.",
    "",
    "The free-form path does exclude a real sub-floor agent live (the RF-05 live",
    "test in the same file proves it), but its plan is written by a language model",
    "and is not the same plan twice, so it cannot back a reproducible frame.",
    "",
    "Everything else in the frame is real: the deployed frontend, its markup, its",
    "accessibility semantics, its wording, and every request other than the",
    "decompose call.",
    "",
    "## The panel in the frame was opened by one click",
    "",
    "The deployed card ships the floor panel as a **collapsed** `<details>`",
    '("Reputation floor · 3 changes"). The frame shows it open because the test',
    "clicked the summary once. As delivered, the first frame a buyer sees carries",
    "only the summary counts, not the agent names or the reasons.",
    "",
    "## Target",
    "",
    "| | |",
    "| --- | --- |",
    `| URL | ${f.baseUrl} |`,
    `| Network (\`GET /api/stellar/network\`) | ${f.network} |`,
    `| Routing floor (\`GET /api/stellar/reputation/params\` → \`floor_bps\`) | ${f.floorBps} bps |`,
    `| Bayesian prior (\`prior_bps\`) | ${f.priorBps} bps |`,
    "",
    "## The exact intent",
    "",
    `    ${EVIDENCE_INTENT}`,
    "",
    "One of the four demo-kit presets, which are deterministic and LLM-free. The",
    "intent shown in the frame's textarea is this string, submitted through the",
    "page's own preset button and Decompose control.",
    "",
    "## The reputation state behind the frame",
    "",
    "**In the picture (supplied by the test):** five steps — one scored on the",
    "prior at 7000 bps, four on claimed on-chain evidence at 8150 / 7720 / 6480 /",
    "6020 bps — plus three floor actions, each judged on its lower bound:",
    "`seo.brief` excluded at 4200 bps, `code.critic` substituted by",
    "`code.review.pro` at 5090 bps, and `deploy.v0` kept below the floor at",
    "5210 bps by the starvation backstop.",
    "",
    `**On the live target (measured this run):** ${f.agentsWithOnchainEvidence} of`,
    `${f.agentCount} agents rated on-chain, ${f.subFloorAgents.length} below the floor and`,
    `outside the kit pipeline, ${f.liveFloorActionCount} floor actions on the kit plan.`,
    "",
    "## Which build this is",
    "",
    "The deployment exposes no build identifier: `GET /api/health` returns a",
    `hardcoded \`"version": "${f.healthVersion}"\` (defect D-026). The best`,
    "available anchor is the capture date above plus the response shape observed",
    "in the same run:",
    "",
    `- \`POST /api/orchestrator/decompose\` top-level keys: ${f.liveDecomposeKeys.map((k) => `\`${k}\``).join(", ")}`,
    `  — ${f.liveDecomposeKeys.includes("floor_bps") ? "carries" : "no"} \`floor_bps\`, ${f.liveDecomposeKeys.includes("reputation_degraded") ? "carries" : "no"} \`reputation_degraded\``,
    "  (both were missing on the split deploy recorded as D-031).",
    `- \`GET /api/stellar/reputation\` carries ${f.reputationHasDegradedKey ? "a" : "no"} \`degraded\` key`,
    "  (the flag D-024 found stripped at the API boundary, which is what lets a",
    "  client tell an RPC outage from a cold start).",
    "",
    "A frame captured against a build with a different response shape would",
    "show a different list here.",
    "",
    "## What this frame proves, and what it does not",
    "",
    "**Proves:** given a plan whose shape the floor changed, the deployed card",
    "renders, in one frame, a reputation badge per step carrying the score and",
    "whether it came from the chain or the prior, and — once the disclosure is",
    "open — each floor action with the agent named, the action taken, the",
    "replacement where there was one, the reason, and the agent's lower bound",
    "and the applied floor that decided it. A below-floor reason also carries",
    "both numbers in basis points; the floor-relaxed reason carries none.",
    "",
    "**Does not prove:** that the live backend produced any of it. It did not.",
    "Nor does it cover the free-form intent path. That path now holds every",
    "model step to the shortlist it was offered and discloses a relaxed floor",
    "(the fixes for defects D-028 and D-029), and the RF-05 live test checks the",
    "exclusion of a real sub-floor agent there, but no frame of it is filed.",
    "",
  ].join("\n");
}

test.describe("RF-17 evidence frame (SOW §6.1 Deliverable 2)", () => {
  test("RF-17 one frame carries every step's reputation alongside the floor panel naming the excluded sub-floor agent", async ({
    page,
    request,
  }) => {
    await page.setViewportSize(EVIDENCE_VIEWPORT);
    await supplyPlan(page, FLOOR_ACTED_PLAN);
    await decomposeIntent(page, EVIDENCE_INTENT);

    // The panel ships collapsed on this build, so the frame RF-17 asks for
    // exists only after this click. That is recorded in the provenance note,
    // not papered over.
    await openFloorPanel(page);
    await frameThePlanCard(page);

    const steps = stepRows(page);
    await expect(steps).toHaveCount(FLOOR_ACTED_PLAN.steps.length);

    const badges = page.locator(REP_BADGE);
    await expect(
      badges,
      "the frame does not carry one reputation badge per step",
    ).toHaveCount(FLOOR_ACTED_PLAN.steps.length);

    const excluded = FLOOR_ACTED_PLAN.notices.find((n) => n.kind === "excluded");
    const excludedName = excluded?.agent_name ?? "";
    expect(excludedName, "the supplied plan has no excluded notice").not.toBe("");

    const panel = floorPanel(page);
    const excludedRow = panel
      .getByRole("listitem")
      .filter({ hasText: excludedName });
    await expect(excludedRow).toBeVisible();

    // Everything RF-17 requires has to be inside ONE frame. Asserted before
    // the capture: a screenshot taken without this proves nothing once the
    // layout moves.
    for (let i = 0; i < FLOOR_ACTED_PLAN.steps.length; i++) {
      const step = FLOOR_ACTED_PLAN.steps[i];
      await expectInFrame(
        page,
        badges.nth(i),
        `the reputation badge for step ${i + 1} (${step?.agent_name ?? "?"})`,
      );
    }
    await expectInFrame(page, panel, "the reputation-floor panel");
    await expectInFrame(
      page,
      excludedRow,
      `the excluded sub-floor agent row (${excludedName})`,
    );

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    // Viewport-clipped, not fullPage: the deliverable has to be a single
    // frame, and `fullPage` would stitch one out of several.
    await page.screenshot({
      path: join(EVIDENCE_DIR, EVIDENCE_IMAGE),
      animations: "disabled",
    });

    // ---- provenance -----------------------------------------------------
    // Read from the deployment in this same run, and asserted, not narrated:
    // the note's central claim is that the kit plan cannot show a floor action,
    // and a note that states that without checking is just a nicer-looking
    // guess. `request` bypasses the page's route, so the decompose below is
    // the real backend answering.
    test.setTimeout(COLD_START_TIMEOUT * 10);

    const networkRes = await request.get("/api/stellar/network", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(networkRes.ok()).toBe(true);
    const network = ((await networkRes.json()) as { network?: string }).network ?? "";
    expect(network, "the target no longer reports the expected network").toBe(
      EXPECTED_NETWORK,
    );

    const paramsRes = await request.get("/api/stellar/reputation/params", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(paramsRes.ok()).toBe(true);
    const params = (await paramsRes.json()) as {
      floor_bps: number;
      prior_bps: number;
    };

    const batchRes = await request.get("/api/stellar/reputation", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(batchRes.ok()).toBe(true);
    const batch = (await batchRes.json()) as {
      reputations: Record<
        string,
        { count: number; source: string; lower_bound_bps: number; degraded?: boolean }
      >;
    };
    const reputations = Object.values(batch.reputations);
    expect(
      reputations.length,
      "the live registry returned no agents to describe",
    ).toBeGreaterThan(0);

    const withEvidence = reputations.filter(
      (r) => r.source !== "prior" || r.count > 0,
    ).length;
    const subFloorAgents = Object.entries(batch.reputations)
      .filter(([, r]) => r.lower_bound_bps < params.floor_bps)
      .map(([id, r]) => `${id} at ${r.lower_bound_bps} bps`);

    const healthRes = await request.get("/api/health", {
      timeout: COLD_START_TIMEOUT,
    });
    expect(healthRes.ok()).toBe(true);
    const health = (await healthRes.json()) as { version?: string };

    const liveRes = await request.post("/api/orchestrator/decompose", {
      data: { intent: EVIDENCE_INTENT },
      timeout: COLD_START_TIMEOUT,
    });
    expect(liveRes.ok()).toBe(true);
    const live = (await liveRes.json()) as Record<string, unknown> & {
      notices: { reason_code?: string }[];
      steps: { rep_lower_bound_bps: number }[];
    };
    // The premise of the whole note: the deterministic kit path, which the
    // frame's intent drives, has no floor action to show on this registry.
    // If a kit agent ever falls below the floor this fails, and the frame can
    // then be captured live instead of supplied.
    const liveFloorActions = live.notices.filter(
      (n) => n.reason_code !== "unbound_endpoint",
    );
    expect(
      liveFloorActions,
      "the live kit plan now carries a floor action, so the note's claim that this target cannot produce a floor-acted kit plan is no longer true",
    ).toEqual([]);

    const note = buildProvenanceNote({
      capturedAt: new Date().toISOString(),
      baseUrl: new URL(page.url()).origin,
      network,
      floorBps: params.floor_bps,
      priorBps: params.prior_bps,
      agentCount: reputations.length,
      agentsWithOnchainEvidence: withEvidence,
      subFloorAgents,
      kitLowerBoundsBps: live.steps.map((s) => s.rep_lower_bound_bps),
      liveDecomposeKeys: Object.keys(live).sort(),
      liveNoticeCount: live.notices.length,
      liveFloorActionCount: liveFloorActions.length,
      healthVersion: health.version ?? "(absent)",
      reputationHasDegradedKey: reputations.some((r) => "degraded" in r),
    });

    writeFileSync(join(EVIDENCE_DIR, EVIDENCE_NOTE), note, "utf8");
  });

  test("RF-17 the evidence index records the image, the exact intent, the reputation state behind it, and that the plan was supplied by the test", () => {
    const indexPath = join(EVIDENCE_DIR, EVIDENCE_INDEX);
    expect(
      existsSync(indexPath),
      `no evidence index at ${indexPath} — the deliverable has nothing describing it`,
    ).toBe(true);

    const index = readFileSync(indexPath, "utf8");

    // The image, and an image that actually exists.
    expect(index, "the index does not name the image").toContain(EVIDENCE_IMAGE);
    expect(
      existsSync(join(EVIDENCE_DIR, EVIDENCE_IMAGE)),
      "the index names an image that is not in this directory",
    ).toBe(true);
    expect(index, "the index does not point at the provenance note").toContain(
      EVIDENCE_NOTE,
    );

    // The exact intent behind the frame.
    expect(index, "the index does not record the exact intent").toContain(
      EVIDENCE_INTENT,
    );

    // The reputation state behind it: cold start, and the floor it was
    // measured against.
    expect(
      index,
      "the index does not record that every agent was on the prior",
    ).toContain('source: "prior"');
    expect(
      index,
      "the index does not record the routing floor that was applied",
    ).toContain(`${FLOOR_BPS} bps`);

    // ...and how that state was produced. This is the assertion that keeps the
    // index honest: an index that quietly loses this sentence would present a
    // test-authored plan as something the live backend decided.
    expect(
      index,
      "the index does not say the plan in the frame was supplied by the test",
    ).toMatch(/supplied by the test/i);
  });

  test("RF-17 the provenance note states plainly that the plan was written by the test, and why the live target cannot produce one", () => {
    const notePath = join(EVIDENCE_DIR, EVIDENCE_NOTE);
    expect(
      existsSync(notePath),
      `no provenance note at ${notePath} — evidence that does not say how it was made is not evidence`,
    ).toBe(true);

    const note = readFileSync(notePath, "utf8");

    expect(note, "the note does not name the image it describes").toContain(
      EVIDENCE_IMAGE,
    );
    expect(note, "the note does not record the exact intent").toContain(
      EVIDENCE_INTENT,
    );
    expect(note, "the note does not name the network").toContain(
      EXPECTED_NETWORK,
    );
    expect(note, "the note does not record the applied floor").toContain(
      `${FLOOR_BPS} bps`,
    );

    // The disclosure, in plain words. Checked as three separate claims so a
    // note that keeps the words but drops the substance still fails: the plan
    // was authored by the test, the live target cannot produce one, and the
    // panel had to be opened before the frame existed.
    expect(
      note,
      "the note does not say the plan was written by the test",
    ).toMatch(/written by the test/i);
    expect(
      note,
      "the note does not explain that the live target cannot produce a floor-acted plan",
    ).toMatch(/cannot produce/i);
    expect(
      note,
      "the note does not disclose that the floor panel ships collapsed and was opened for the capture",
    ).toMatch(/collapsed/i);
  });
});
