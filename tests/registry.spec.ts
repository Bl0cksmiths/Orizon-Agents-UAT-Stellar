import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * E2E coverage for the agent-registry feature area on the LIVE production
 * site: /app/agents, /app/register, /app/reputation.
 *
 * Ground rules baked into every test below:
 *  - No wallet exists in this environment. Nothing here connects one, signs
 *    anything, or submits a transaction — only client-side validation,
 *    disabled-state gating, and pure-math surfaces are exercised.
 *  - The backend (agents catalog, reputation batch/params, id-availability
 *    check) can cold-start in 25-60s on a first hit. Anywhere an assertion
 *    depends on a real network round trip to that backend, it carries a
 *    generous timeout (COLD_START_TIMEOUT) and a comment saying why; anything
 *    driven by pure client state (form validation, the score calculator) uses
 *    ordinary web-first timeouts.
 *  - Selectors follow getByRole / getByLabel / getByText first; nothing here
 *    reaches for a CSS class or id selector.
 *
 * Error copy and validation rules are taken verbatim from
 * lib/register-validation.ts. Two of the rules named in this suite's brief
 * ("empty skills" as an error, and a per-token bad-charset skills message)
 * turned out, on reading the source, not to be reachable through the UI at
 * all — see the comments in the "skills" tests below for what actually
 * happens instead. Rather than invent a selector/string for behavior that
 * doesn't exist, those tests assert the real (and, for the >16 case,
 * arguably buggy) behavior.
 */

const BASE_URL = "https://orizons.xyz";

/** Generous ceiling for anything that waits on a real backend round trip
 * (agents catalog, reputation batch/params, id-availability). The service
 * cold-starts in 25-60s, so a tight default timeout here is a false negative
 * waiting to happen, not a real regression signal. */
const COLD_START_TIMEOUT = 90_000;

// ── Pure-math mirror of lib/reputation-math.ts ──────────────────────────
// Duplicated (not imported) because this spec ships outside the app's
// TypeScript project and has no module resolution into it. Kept byte-for-byte
// faithful to the source formulas as of this writing so the assertions below
// are checking the UI against the real algorithm, not a paraphrase of it.
// If lib/reputation-math.ts's formulas change, this block must change with it.
type RepMathParams = {
  prior_bps: number;
  prior_weight_usdc: number;
  floor_bps: number;
  wilson_z: number;
};

const DEFAULT_REP_PARAMS: RepMathParams = {
  prior_bps: 7000,
  prior_weight_usdc: 12,
  floor_bps: 5500,
  wilson_z: 1,
};

const clampBps = (v: number) => Math.max(0, Math.min(10_000, v));

function smoothedBps(
  meanBps: number,
  weightUsdc: number,
  p: RepMathParams = DEFAULT_REP_PARAMS,
): number {
  const den = p.prior_weight_usdc + weightUsdc;
  if (den <= 0) return p.prior_bps;
  return clampBps(
    Math.floor((p.prior_weight_usdc * p.prior_bps + meanBps * weightUsdc) / den),
  );
}

function lowerBoundBps(
  meanBps: number,
  weightUsdc: number,
  p: RepMathParams = DEFAULT_REP_PARAMS,
): number {
  const n = p.prior_weight_usdc + Math.max(weightUsdc, 0);
  if (n <= 0) return 0;
  const prob = Math.max(0, Math.min(1, meanBps / 10_000));
  const lb = prob - p.wilson_z * Math.sqrt((prob * (1 - prob)) / n);
  return clampBps(Math.round(lb * 10_000));
}

const scoreOutOfFive = (bps: number) => (bps / 2000).toFixed(2);

// ── Shared helpers ───────────────────────────────────────────────────────

/** The page must never scroll sideways — a wide table/diagram escaping its
 * `overflow-x:auto` wrapper is the usual cause. 1px tolerance for subpixel
 * rounding across browsers. */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

/** Tabs forward from wherever focus currently is until `target` receives
 * focus or `maxPresses` is exhausted. Returns whether it was reached — the
 * honest way to assert "keyboard-only navigation reaches X" without hard
 * -coding how many stops precede it (fragile against layout changes). */
async function tabUntilFocused(
  page: Page,
  target: Locator,
  maxPresses = 40,
): Promise<boolean> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) {
      return true;
    }
  }
  return false;
}

/** A syntactically-fresh agent id (charset-legal, <=32 chars) so the
 * id-availability check has something to say "available" to instead of
 * colliding with whatever another test run already registered on this
 * live, shared backend. */
function freshAgentId(): string {
  return `qa_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

/**
 * The score calculator's own card, scoped away from the rest of
 * /app/reputation. The page also renders live "★ X.XX" star ratings in the
 * stats tiles and the leaderboard (real backend data), so an unscoped
 * `page.getByText("★ 4.01")` could coincidentally collide with a live
 * agent's score or the routing-floor tile — scoping to the card the
 * calculator's own <dt>/<dd> rows live in rules that out structurally
 * instead of hoping the coincidence never happens.
 */
function getCalculatorCard(page: Page) {
  return page
    .locator("div")
    .filter({ has: page.getByRole("heading", { name: "Score calculator", level: 2 }) })
    .first();
}

// ─────────────────────────────────────────────────────────────────────────
// /app/agents
// ─────────────────────────────────────────────────────────────────────────

test.describe("/app/agents — registry table", () => {
  test("renders one h1 and the full set of column headers", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/agents`);
    await expect(page.getByRole("heading", { level: 1, name: "Agent Registry" })).toBeVisible();
    // Exactly one h1 per route (accessibility requirement).
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    // The sr-only "actions" header is real content in the accessibility tree
    // even though it prints nothing — regression: a naive re-skin could drop
    // the <span class="sr-only"> and leave the actions column unlabelled.
    //
    // No `exact: true` here: every header cell carries Tailwind's `uppercase`
    // (CSS text-transform), which Chromium folds into the computed
    // accessible name — an exact, case-sensitive "id" would flake against
    // the rendered "ID". Default matching is case-insensitive, which is
    // correct regardless of whether a given engine applies the transform.
    for (const name of [
      "id",
      "agent",
      "skills",
      "price / call",
      "reputation",
      "runs",
      "status",
      "actions",
    ]) {
      await expect(table.getByRole("columnheader", { name })).toBeVisible();
    }
  });

  test("renders agent rows with skills badges and a price formatted to 3 decimals", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/app/agents`);

    const rows = page.getByRole("table").locator("tbody tr");
    // First real row (not a skeleton, not the error/empty row) has a
    // rowheader cell (the `<th scope="row">` holding the agent id) — wait
    // generously since /agents can cold-start on the live backend.
    await expect(rows.first().getByRole("rowheader")).toBeVisible({
      timeout: COLD_START_TIMEOUT,
    });

    const firstRow = rows.first();
    // Row <td> order after the id <th>: agent name(0), skills(1), price(2),
    // reputation(3), runs(4), status(5), actions(6).
    const cells = firstRow.locator("td");
    // Skills render as badge chips — every catalog agent has at least one.
    await expect(cells.nth(1)).not.toBeEmpty();
    // Price column renders `price.toFixed(3)` — asserting the shape (not a
    // specific seeded value) so this survives catalog data changing.
    await expect(cells.nth(2)).toHaveText(/^\d+\.\d{3}$/);
  });

  test("does not offer the owner-gated manage panel without a connected wallet", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/app/agents`);
    await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible({
      timeout: COLD_START_TIMEOUT,
    });

    // Regression this catches: ownership resolved from anything other than
    // the connected wallet (e.g. a local/seeded "owner" field) would leak a
    // "manage" affordance with no wallet connected at all.
    await expect(page.getByRole("button", { name: /manage/i })).toHaveCount(0);
    // Every row instead shows the disabled, explicitly-"coming soon" view
    // action — at least one such button must exist once rows have loaded.
    await expect(
      page.getByRole("button", { name: "▸ view" }).first(),
    ).toBeDisabled();
  });

  test("a query matching nothing shows the truthful empty state, not a blank table", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/app/agents`);
    const search = page.getByLabel("Search agents by name or skill");
    await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible({
      timeout: COLD_START_TIMEOUT,
    });

    await search.fill("zzz_no_agent_or_skill_matches_this_zzz");
    await expect(page.getByText("no agents match your filters.")).toBeVisible();
  });

  test("keeps rendering the table when the on-chain reputation batch fails to load", async ({ page }) => {
    test.setTimeout(120_000);
    // The agents catalog is seeded/stable; only the live reputation batch is
    // broken here — mirrors the real-world failure mode this page is built
    // to survive (reputation-fetch failure silently keeps seeded values).
    await page.route("**/stellar/reputation", (route) => route.abort());
    await page.goto(`${BASE_URL}/app/agents`);

    // Regression this catches: a reputation-fetch failure white-screening the
    // whole page instead of degrading just the reputation column.
    await expect(page.getByRole("heading", { level: 1, name: "Agent Registry" })).toBeVisible();
    const rows = page.getByRole("table").locator("tbody tr");
    await expect(rows.first().getByRole("rowheader")).toBeVisible({
      timeout: COLD_START_TIMEOUT,
    });
    // Reputation column still renders *something* (the seeded/prior badge),
    // not an empty cell or a thrown error.
    const repCell = rows.first().locator("td").nth(3);
    await expect(repCell).not.toBeEmpty();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/register
// ─────────────────────────────────────────────────────────────────────────

