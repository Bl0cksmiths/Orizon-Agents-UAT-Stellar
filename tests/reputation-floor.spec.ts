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

/** Drives the orchestrator form with a preset intent and waits for the card. */
async function decomposeIntent(page: Page, intent: string): Promise<void> {
  await page.goto("/app/orchestrator");
  await page.getByRole("button", { name: intent }).click();
  await page.getByRole("button", { name: "Decompose ▸" }).click();
  await expect(
    page.getByRole("heading", { name: "Execution plan" }),
  ).toBeVisible({ timeout: COLD_START_TIMEOUT });
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
});
