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
  test("RG-01 renders one h1 and the full set of column headers", async ({ page }) => {
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

  test("RG-01 renders agent rows with a name, skills badges, and a price formatted to 3 decimals", async ({ page }) => {
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
    // Name column renders the agent's display name — every catalog agent has one.
    await expect(cells.nth(0)).not.toBeEmpty();
    // Skills render as badge chips — every catalog agent has at least one.
    await expect(cells.nth(1)).not.toBeEmpty();
    // Price column renders `price.toFixed(3)` — asserting the shape (not a
    // specific seeded value) so this survives catalog data changing.
    await expect(cells.nth(2)).toHaveText(/^\d+\.\d{3}$/);
  });

  test("RG-03 does not offer the owner-gated manage panel without a connected wallet", async ({ page }) => {
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

  test("RG-02 keeps rendering the table when the on-chain reputation batch fails to load", async ({ page }) => {
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

test.describe("/app/register — registration form", () => {
  test("renders every field behind a real <label>, plus the connect-wallet prompt", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    await expect(page.getByRole("heading", { level: 1, name: "Register an Agent" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    // getByLabel only resolves when a real <label htmlFor> (or aria-label)
    // wires to the control — this is the label-association check itself.
    await expect(page.getByLabel("agent id")).toBeVisible();
    await expect(page.getByLabel("display name")).toBeVisible();
    await expect(page.getByLabel("skills")).toBeVisible();
    await expect(page.getByLabel("price per step (USDC)")).toBeVisible();

    await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
    // Two separate elements both contain the substring "connect a wallet"
    // (the owner-status line and the submit-button hint) — the longer,
    // unique string avoids a strict-mode multi-match here.
    await expect(page.getByText("connect a wallet to register")).toBeVisible();

    // Submit is gated shut before anything has been entered.
    await expect(page.getByRole("button", { name: /Register agent/i })).toBeDisabled();
  });

  test("RG-04 flags a malformed agent id with the exact charset message, announced as an alert", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    const idField = page.getByLabel("agent id");
    await idField.fill("bad id!");
    await idField.blur();

    // ErrorNote renders role="alert" — this is the aria-live surface the
    // source uses for every validation message (checked in
    // components/ui/error-note.tsx).
    const alert = page.getByRole("alert").filter({
      hasText: "Letters, digits and underscore only, 1-32 characters",
    });
    await expect(alert).toBeVisible();
  });

  test("flags the agt_ prefix as reserved for the seeded catalog", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    const idField = page.getByLabel("agent id");
    await idField.fill("agt_anything");
    await idField.blur();

    // Reserved is checked before charset (source comment: id_reserved
    // pre-empts the pattern check), so this exact message must win even
    // though "agt_anything" is also charset-valid.
    await expect(
      page.getByRole("alert").filter({
        hasText: "agt_ ids are reserved for the seeded catalog",
      }),
    ).toBeVisible();
  });

  test("flags a display name over 100 characters with the exact length message", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    const nameField = page.getByLabel("display name");
    await nameField.fill("x".repeat(101));
    await nameField.blur();

    await expect(
      page.getByRole("alert").filter({ hasText: "100 characters maximum" }),
    ).toBeVisible();
  });

  test("flags a non-positive price with the exact message", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    const priceField = page.getByLabel("price per step (USDC)");
    // The price input strips every non-digit/non-"." character as you type
    // (register/page.tsx: `.replace(/[^0-9.]/g, "")`), so a literal "-5" can
    // never actually land in the field — "0" is the reachable non-positive
    // case through real keyboard input.
    await priceField.fill("0");
    await priceField.blur();

    await expect(
      page.getByRole("alert").filter({ hasText: "Price must be greater than 0" }),
    ).toBeVisible();
  });

  test("flags a price above the 10000 USDC cap with the exact message", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    const priceField = page.getByLabel("price per step (USDC)");
    await priceField.fill("10000.01");
    await priceField.blur();

    await expect(
      page.getByRole("alert").filter({ hasText: "10000 USDC maximum" }),
    ).toBeVisible();
  });

  test("skills: an empty list is valid — no error is shown", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    // lib/register-validation.ts's validateSkills explicitly allows an empty
    // list ("the backend defaults `skills` to an empty list") — this is the
    // opposite of an error case. Asserting it stays this way guards against a
    // regression that starts requiring at least one skill client-side out of
    // step with the backend contract.
    const skillsField = page.getByLabel("skills");
    await skillsField.click();
    await skillsField.blur();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("skills: a 17th chip is silently rejected rather than surfacing a message", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    const skillsField = page.getByLabel("skills");
    for (let i = 0; i < 17; i++) {
      await skillsField.fill(`skill${i}`);
      await skillsField.press("Enter");
    }

    // Regression this catches: SkillsInput caps additions at 16
    // (`next.length >= max`) but the register page never marks the skills
    // field "touched" (no onBlur handler wires touch("skills") — checked in
    // app/app/register/page.tsx), so `validateSkills`'s "16 skills maximum"
    // message can never actually render. If a future edit makes 17 skills
    // reachable, this assertion is what would catch skills silently
    // exceeding the backend's cap with no operator-visible feedback.
    await expect(page.getByRole("alert")).toHaveCount(0);
    // The cap is only ever surfaced via aria-invalid on the field itself —
    // SkillsInput's own `rejected` state, set independently of the page's
    // (broken) touched-skills wiring above.
    await expect(skillsField).toHaveAttribute("aria-invalid", "true");
    // Exactly 16 chips landed — the 17th token was refused, not appended.
    await expect(page.getByRole("button", { name: /^remove skill\d+$/ })).toHaveCount(16);
  });

  test("the id-availability check announces 'checking availability' immediately on blur", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    const idField = page.getByLabel("agent id");
    await idField.fill(freshAgentId());
    await idField.blur();

    // useAsyncAction sets `pending: true` synchronously inside run(), before
    // the network call resolves, so this text is not itself waiting on the
    // (possibly cold-starting) backend — only its eventual replacement is.
    await expect(page.getByText("◉ checking availability…")).toBeVisible();
  });

  test("a fresh id resolves to available, and the submit button stays disabled without a wallet", async ({ page }) => {
    // Generous overall budget: this exercises the real GET
    // /stellar/agent-id-available/<id> round trip, which can cold-start
    // 25-60s on first hit.
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/app/register`);

    await page.getByLabel("agent id").fill(freshAgentId());
    await page.getByLabel("agent id").blur();
    await expect(page.getByText("✓ available")).toBeVisible({ timeout: COLD_START_TIMEOUT });

    await page.getByLabel("display name").fill("QA Test Agent");
    await page.getByLabel("skills").fill("qa");
    await page.getByLabel("skills").press("Enter");
    await page.getByLabel("price per step (USDC)").fill("1.5");
    await page.getByLabel("price per step (USDC)").blur();

    // Every synchronous field is valid and the id is confirmed available —
    // the only remaining gate is the connected wallet. This is the
    // regression that matters most on this form: submit must never become
    // clickable while wallet.connected is false, however "ready" the rest of
    // the form looks.
    const submit = page.getByRole("button", { name: /Register agent/i });
    await expect(submit).toBeDisabled();
    await expect(page.getByText("connect a wallet to register")).toBeVisible();
  });

  test("keyboard-only navigation reaches the submit button", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/register`);
    await page.getByLabel("agent id").focus();
    const submit = page.getByRole("button", { name: /Register agent/i });
    const reached = await tabUntilFocused(page, submit);
    expect(reached).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/reputation
// ─────────────────────────────────────────────────────────────────────────

test.describe("/app/reputation — score calculator", () => {
  // Every test in this block holds GET /stellar/reputation/params off so the
  // calculator falls back to DEFAULT_REP_PARAMS deterministically
  // (`ScoreCalculator`: `p = params ?? DEFAULT_REP_PARAMS`). Without this, a
  // live params response that differs from the client's own defaults would
  // make the hand-computed expected values below intermittently wrong —
  // a flake with nothing to do with the math actually under test.
  test.beforeEach(async ({ page }) => {
    await page.route("**/stellar/reputation/params", (route) => route.abort());
  });

  test("renders one h1", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/reputation`);
    await expect(page.getByRole("heading", { level: 1, name: "Reputation" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("default inputs (mean 85/100, 25 USDC evidence) match lib/reputation-math.ts", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/reputation`);
    // The params fetch failing is itself announced, not swallowed.
    await expect(
      page.getByRole("alert").filter({ hasText: "params unavailable" }),
    ).toBeVisible();

    const card = getCalculatorCard(page);
    const expectedSmoothed = smoothedBps(85 * 100, 25); // 8013 -> ★4.01
    const expectedLower = lowerBoundBps(expectedSmoothed, 25); // 7357 -> ★3.68

    await expect(card.getByText(`★ ${scoreOutOfFive(expectedSmoothed)}`)).toBeVisible();
    await expect(card.getByText(`★ ${scoreOutOfFive(expectedLower)}`)).toBeVisible();
    // Above the 5500bps floor, so the routable chip must show.
    await expect(card.getByText("✓ routable")).toBeVisible();
  });

  test("zero settled evidence collapses the score to the prior, regardless of the mean slider", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/reputation`);
    const meanSlider = page.getByLabel("raw on-chain mean");
    const weightSlider = page.getByLabel("settled evidence");

    // Push the mean to its max (100/100) *and* zero the evidence weight —
    // if the mean leaked into the zero-weight formula this would visibly
    // move the score away from the pure prior.
    await meanSlider.press("End");
    await weightSlider.press("Home");
    await expect(weightSlider).toHaveValue("0");

    // smoothedBps with weight=0 reduces to exactly prior_bps (7000) no
    // matter what meanBps is — the defining property of the "zero evidence"
    // case, and the one most worth locking down: it's easy to accidentally
    // let a stray mean*weight term survive a refactor of this formula.
    const card = getCalculatorCard(page);
    const expectedSmoothed = smoothedBps(100 * 100, 0); // 7000 -> ★3.50
    const expectedLower = lowerBoundBps(expectedSmoothed, 0); // 5677 -> ★2.84

    await expect(card.getByText(`★ ${scoreOutOfFive(expectedSmoothed)}`)).toBeVisible();
    await expect(card.getByText(`★ ${scoreOutOfFive(expectedLower)}`)).toBeVisible();
  });

  test("max mean + max evidence pushes the score near the ceiling and stays routable", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/reputation`);
    await page.getByLabel("raw on-chain mean").press("End");
    await page.getByLabel("settled evidence").press("End");

    const card = getCalculatorCard(page);
    const expectedSmoothed = smoothedBps(100 * 100, 500); // 9929 -> ★4.96
    const expectedLower = lowerBoundBps(expectedSmoothed, 500); // 9892 -> ★4.95

    await expect(card.getByText(`★ ${scoreOutOfFive(expectedSmoothed)}`)).toBeVisible();
    await expect(card.getByText(`★ ${scoreOutOfFive(expectedLower)}`)).toBeVisible();
    await expect(card.getByText("✓ routable")).toBeVisible();
  });

  test("min mean + max evidence drops below the routing floor and flags it", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/reputation`);
    await page.getByLabel("raw on-chain mean").press("Home");
    await page.getByLabel("settled evidence").press("End");

    const card = getCalculatorCard(page);
    const expectedSmoothed = smoothedBps(0, 500); // 164 -> ★0.08
    const expectedLower = lowerBoundBps(expectedSmoothed, 500); // 108 -> ★0.05
    expect(expectedLower).toBeLessThan(DEFAULT_REP_PARAMS.floor_bps);

    await expect(card.getByText(`★ ${scoreOutOfFive(expectedSmoothed)}`)).toBeVisible();
    await expect(card.getByText(`★ ${scoreOutOfFive(expectedLower)}`)).toBeVisible();
    // Regression this catches: routing gates on the Wilson *lower bound*
    // against the floor, never the smoothed score directly — a fat-fingered
    // `smoothed >= floor` swap here would silently mark unroutable agents as
    // routable.
    await expect(card.getByText("⚑ below floor — excluded at decompose")).toBeVisible();
  });
});

test.describe("/app/reputation — leaderboard and stats", () => {
  test("render real data or a truthful empty/error state, never a blank page", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/app/reputation`);

    // The <section aria-labelledby="rep-leaderboard-heading"> gets an
    // implicit accessible name from that heading, so it's addressable as a
    // named region rather than by any CSS structure.
    const leaderboardRegion = page.getByRole("region", { name: "Leaderboard" });
    await expect(leaderboardRegion.getByRole("heading", { level: 2 })).toBeVisible();

    // Stats: either the announced-error alert, or the real tiles — but the
    // tile label always renders once the fetch has settled either way.
    const statsAlert = page.getByRole("alert").filter({ hasText: "reputation ledger unavailable" });
    const statsTile = page.getByText("agents tracked");
    await expect(statsAlert.or(statsTile)).toBeVisible({ timeout: COLD_START_TIMEOUT });

    // Leaderboard: at least one data row beyond the header row, the explicit
    // "no agents" copy, or the explicit failure row — anything but a table
    // that never resolves past its header (which is what "silently keeps
    // seeded values" must never degrade into for a completely failed
    // agents read).
    const dataRows = leaderboardRegion.getByRole("table").locator("tbody tr");
    const noAgentsCopy = leaderboardRegion.getByText("no agents in the registry.");
    const failedCopy = leaderboardRegion.getByText("leaderboard could not be loaded", {
      exact: false,
    });
    await expect(dataRows.first().or(noAgentsCopy).or(failedCopy)).toBeVisible({
      timeout: COLD_START_TIMEOUT,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layout: no horizontal overflow at 390x844 and 1440x900, all three routes
// ─────────────────────────────────────────────────────────────────────────

const ROUTES: { path: string; label: string; h1: string }[] = [
  { path: "/app/agents", label: "agent registry", h1: "Agent Registry" },
  { path: "/app/register", label: "register form", h1: "Register an Agent" },
  { path: "/app/reputation", label: "reputation dashboard", h1: "Reputation" },
];

const VIEWPORTS = [
  { width: 390, height: 844, label: "mobile 390x844" },
  { width: 1440, height: 900, label: "desktop 1440x900" },
];

test.describe("layout — no horizontal overflow", () => {
  for (const route of ROUTES) {
    for (const vp of VIEWPORTS) {
      test(`${route.label} has no horizontal overflow at ${vp.label}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${BASE_URL}${route.path}`);
        // Wait for hydration to settle (h1 present) before measuring —
        // measuring against an unhydrated/partial DOM would under-report.
        await expect(page.getByRole("heading", { level: 1, name: route.h1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
      });
    }
  }
});
