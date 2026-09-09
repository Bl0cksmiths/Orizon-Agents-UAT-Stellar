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

