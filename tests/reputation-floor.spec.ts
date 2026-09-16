import { test, expect, type Page } from "@playwright/test";
import { COLD_START_TIMEOUT, collectConsoleErrors } from "./fixtures";

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
});
