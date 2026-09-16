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
 * ReputationBadge renders its whole meaning into `aria-label` (and the
 * identical `title`) — "prior estimate 3.50 — no on-chain ratings yet" or
 * "on-chain reputation 4.08 from 9 rated jobs". That string, not the chip's
 * colour, is what carries score AND source to a buyer and to assistive
 * tech, so every assertion in this file reads it.
 */
const REP_BADGE = '[aria-label^="prior estimate "], [aria-label^="on-chain reputation "]';

/** The accessible label must always open with the source phrase and a 0–5
 * score to two decimals (`bps / 2000` in reputation-badge.tsx). */
const REP_LABEL_SHAPE = /^(prior estimate|on-chain reputation) \d+\.\d{2}\b/;

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
 * Heading of the floor panel, read from the DEPLOYED markup rather than from
 * the frontend repo's working tree — the two have diverged. The live build
 * renders the panel as a collapsed `<details>` whose `<summary>` carries
 * `<h3>Reputation floor · N changes</h3>`; the source checkout still shows an
 * always-open `<div>` headed "reputation floor — why this plan changed shape",
 * a string that appears nowhere on the deployment. Asserting the old string
 * was absent could therefore never fail, whatever the card did.
 *
 * The panel renders only when `plan.notices` is non-empty, so this handle is
 * both how a test asserts the panel IS there and how it asserts it is NOT.
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

    const labels = await page.locator(REP_BADGE).evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? ""),
    );
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

  test("RF-14 a live plan reporting no floor actions does not render the floor panel", async ({
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
    const plan = (await (await decomposed).json()) as { notices?: unknown[] };

    // The premise, asserted rather than assumed. If this ever fails because
    // the live registry gained on-chain evidence and a real agent fell below
    // the floor, the honest negative below is no longer the right assertion —
    // and the RF-17 provenance note stops being true. Both must be revisited
    // together, which is why this is a hard assertion and not a branch.
    expect(
      plan.notices,
      "the live backend reported floor actions — the cold-start premise behind this file no longer holds",
    ).toEqual([]);

    // A panel that renders when nothing happened is as wrong as one that
    // stays hidden when something did.
    await expect(
      floorPanel(page),
      "the floor panel rendered for a plan with no floor actions",
    ).toHaveCount(0);

    // ...and the card itself did render, so the count above is a real absence
    // and not a plan that never arrived.
    await expect(stepRows(page).first()).toBeVisible();
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
 * POST /api/orchestrator/decompose on 2026-09-17): explicit
 * `substituted_for: null` and `degraded: false` on ordinary steps rather than
 * omitted keys. That response carries no `floor_bps` and no
 * `reputation_degraded` on this deployment, so neither is invented here — the
 * applied floor reaches the card only inside the notice `reason` text.
 */
type SuppliedPlanStep = {
  agent_id: string;
  agent_name: string;
  rationale: string;
  est_price_usdc: number;
  est_eta_seconds: number;
  rep_bps: number;
  rep_source: "onchain" | "prior";
  substituted_for: string | null;
  degraded: boolean;
};

type SuppliedNotice = {
  kind: "excluded" | "substituted" | "degraded";
  agent_id: string;
  agent_name: string;
  replacement_id?: string;
  replacement_name?: string;
  reason: string;
};

type SuppliedPlan = {
  plan_id: string;
  intent: string;
  steps: SuppliedPlanStep[];
  total_usdc: number;
  total_eta: number;
  notices: SuppliedNotice[];
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
      substituted_for: "agt_12r0",
      degraded: false,
    },
    {
      agent_id: "agt_08j2",
      agent_name: "deploy.v0",
      rationale: "seal artifact + record on-chain proof",
      est_price_usdc: 0.011,
      est_eta_seconds: 0.4,
      rep_bps: 5210,
      rep_source: "onchain",
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
      reason: `below routing floor (4200 < ${FLOOR_BPS} bps)`,
    },
    {
      kind: "substituted",
      agent_id: "agt_12r0",
      agent_name: "code.critic",
      replacement_id: "agt_14q8",
      replacement_name: "code.review.pro",
      reason: `below routing floor (5090 < ${FLOOR_BPS} bps)`,
    },
    {
      kind: "degraded",
      agent_id: "agt_08j2",
      agent_name: "deploy.v0",
      reason: `kept by starvation backstop, below routing floor (5210 < ${FLOOR_BPS} bps)`,
    },
  ],
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
 * The plan card passes the badge neither `count` nor `floorBps`, so neither
 * the "from N rated jobs" clause nor the "below the X network floor" clause
 * can appear on a step. That absence is itself worth pinning: it means a step
 * routed BELOW the floor is announced to a screen reader exactly like any
 * other on-chain score, and only the separate "below floor" chip distinguishes
 * it.
 */
function expectedBadgeLabel(step: SuppliedPlanStep): string {
  const score = (step.rep_bps / 2000).toFixed(2);
  return step.rep_source === "prior"
    ? `prior estimate ${score} — no on-chain ratings yet`
    : `on-chain reputation ${score}`;
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

  test("RF-14 the opened floor panel names every floor action — its kind, the agent, the replacement, and the reason carrying the applied floor in bps", async ({
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
      // ...and that reason carries the floor that was applied, in bps.
      await expect(
        row,
        `${where} does not state the applied floor in basis points`,
      ).toContainText(`${FLOOR_BPS} bps`);

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
      // Exact, not a pattern: the score AND whether it came from the chain or
      // the prior both have to survive into the accessible name.
      await expect(
        badge,
        `${where} announces the wrong score or the wrong source`,
      ).toHaveAttribute("aria-label", expectedBadgeLabel(step));

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
  lowerBoundsBps: number[];
  liveDecomposeKeys: string[];
  liveNoticeCount: number;
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
  const uniqueLowerBounds = Array.from(new Set(f.lowerBoundsBps)).sort(
    (a, b) => a - b,
  );
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
    `${f.agentCount} agents and **${f.agentsWithOnchainEvidence} of them had any`,
    "on-chain rating at all** — every agent reads `count: 0`, `source: \"prior\"`,",
    `with a Wilson lower bound of ${uniqueLowerBounds.join(" / ")} bps against a`,
    `routing floor of ${f.floorBps} bps. Nothing on that registry sits below the`,
    "floor, so the real backend has no floor action to report and cannot produce",
    "a floor-acted plan on this target. A live decompose of the same intent, run",
    `in the same session, returned \`notices: []\` (${f.liveNoticeCount} notices).`,
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
    "5210 bps — plus three floor actions: `seo.brief` excluded at 4200 bps,",
    "`code.critic` substituted by `code.review.pro` at 5090 bps, and `deploy.v0`",
    "kept below the floor at 5210 bps by the starvation backstop.",
    "",
    "**On the live target (measured this run):** every agent on the prior, no",
    "on-chain evidence anywhere, no agent below the floor, no notices.",
    "",
    "## Which build this is",
    "",
    "The deployment exposes no build identifier: `GET /api/health` returns a",
    `hardcoded \`"version": "${f.healthVersion}"\` (defect D-026). The best`,
    "available anchor is the capture date above plus the response shape observed",
    "in the same run:",
    "",
    `- \`POST /api/orchestrator/decompose\` top-level keys: ${f.liveDecomposeKeys.map((k) => `\`${k}\``).join(", ")}`,
    "  — no `floor_bps`, no `reputation_degraded`.",
    `- \`GET /api/stellar/reputation/{agent_id}\` carries ${f.reputationHasDegradedKey ? "a" : "no"} \`degraded\` key`,
    "  (defect D-024: the backend strips the flag at the API boundary, so no",
    "  client can tell an RPC outage from a cold start).",
    "",
    "Later builds add those fields; a frame captured against one of them would",
    "show a different shape here.",
    "",
    "## What this frame proves, and what it does not",
    "",
    "**Proves:** given a plan whose shape the floor changed, the deployed card",
    "renders, in one frame, a reputation badge per step carrying the score and",
    "whether it came from the chain or the prior, and — once the disclosure is",
    "open — each floor action with the agent named, the action taken, the",
    "replacement where there was one, and the reason including the applied floor",
    "in basis points.",
    "",
    "**Does not prove:** that the live backend produced any of it. It did not.",
    "Nor does it cover the free-form intent path: on that path the floor is",
    "applied only while building the planner prompt and is never re-checked",
    "afterwards, and a floor relaxation there emits no notice at all (defects",
    "D-028, D-029). The notices rendered here are, on this build, only ever",
    "produced by the demo-kit path.",
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
    // the note's central claim is that no agent here can be below the floor,
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
    // The premise of the whole note.
    expect(
      withEvidence,
      "an agent now carries on-chain evidence, so the note's claim that this registry cannot produce a sub-floor agent is no longer true",
    ).toBe(0);

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
      notices?: unknown[];
    };

    const note = buildProvenanceNote({
      capturedAt: new Date().toISOString(),
      baseUrl: new URL(page.url()).origin,
      network,
      floorBps: params.floor_bps,
      priorBps: params.prior_bps,
      agentCount: reputations.length,
      agentsWithOnchainEvidence: withEvidence,
      lowerBoundsBps: reputations.map((r) => r.lower_bound_bps),
      liveDecomposeKeys: Object.keys(live).sort(),
      liveNoticeCount: live.notices?.length ?? 0,
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
