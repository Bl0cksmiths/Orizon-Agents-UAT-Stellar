import { test, expect, type Page } from "@playwright/test";

/**
 * E2E coverage for the Orizon Agents core workflow: /app/orchestrator →
 * /app/trace. Selectors are derived from the live source:
 *   - app/app/orchestrator/page.tsx
 *   - app/app/orchestrator/_components/execution-plan.tsx
 *   - app/app/orchestrator/_components/fiat-fund.tsx
 *   - app/app/trace/page.tsx
 *   - components/ui/{artifact-viewer,code-viewer,tx-status,stellar-link,
 *     reputation-badge,error-note,skeleton}.tsx
 *   - lib/api.ts, lib/use-async-action.ts, lib/types.ts
 *
 * Environment realities baked into this file (see inline comments at each
 * use site for why):
 *   - No wallet is available in CI. Freighter never injects into the
 *     browser, so `wallet.connected` is always false and the on-chain
 *     "Authorize & Execute" path (execution-plan.tsx `authorize` action,
 *     which calls buildAuthorize → wallet.signXdr → submitSigned) cannot be
 *     exercised at all — there is no signer. We only assert that path is
 *     correctly *gated* behind a connect prompt.
 *   - The simulated execute path (`execute(plan.plan_id)` with no
 *     `auth_id_hex`/`payer`) requires no wallet — confirmed by reading
 *     `simulate` in execution-plan.tsx, which calls `execute()` with only
 *     the plan id. That path is covered end-to-end.
 *   - Only the four curated "demo kit" intents (tetris / calculator /
 *     snake / pomodoro — the exact PRESETS array in page.tsx) are
 *     deterministic and LLM-free. Every test that submits an intent uses
 *     one of these preset buttons; no test types a free-form intent.
 *   - The backend (Render free tier) cold-starts in 25-60s on the first
 *     request in a run. Any test that triggers the first network call of a
 *     suite run needs a correspondingly long timeout — see COLD_START_MS.
 */

const BASE_URL = "https://orizons.xyz";

// Render free-tier cold start is documented as 25-60s; padded for jitter.
const COLD_START_MS = 65_000;
// Cold start + the demo kit's own ~1.4-2.4s simulated decompose delay,
// rounded up generously so a slow first-call-of-the-run never flakes.
const DECOMPOSE_TIMEOUT_MS = COLD_START_MS + 15_000;
// A full run (decompose → execute → agents actually generate the artifact)
// is not bounded by the demo kit's fixed decompose delay — real step work
// happens after execute. Generous ceiling for the one full e2e test.
const FULL_RUN_TIMEOUT_MS = 240_000;

const PRESET_INTENTS = [
  "tetris game in html",
  "calculator web app",
  "snake game in html",
  "pomodoro timer with sound",
] as const;

async function gotoOrchestrator(page: Page) {
  await page.goto(`${BASE_URL}/app/orchestrator`);
}

/**
 * Clicks the "calculator web app" preset (a demo-kit intent — deterministic,
 * no LLM call) and submits via the Decompose button. Resolves once the
 * Execution plan card has rendered.
 *
 * Callers query the plan via `page.getByRole(...)` rather than a scoped
 * container locator: the plan card is the only place on either page that
 * renders an <ol>/<li> list or the "total est." / "wallet required" copy
 * (confirmed against app/app/_components/{sidebar,topbar}.tsx, which render
 * no lists of their own), so an unscoped query is unambiguous and avoids a
 * brittle DOM-parent traversal.
 */
async function decomposeCalculatorPlan(page: Page) {
  await gotoOrchestrator(page);
  await page
    .getByRole("button", { name: "calculator web app" })
    .click();
  await page.getByRole("button", { name: /Decompose/ }).click();
  const heading = page.getByRole("heading", {
    name: "Execution plan",
    level: 2,
  });
  // First network call of a cold-started backend can take up to ~60s; the
  // demo kit's own simulated delay adds a little more on top.
  await expect(heading).toBeVisible({ timeout: DECOMPOSE_TIMEOUT_MS });
}

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — intent form
// ─────────────────────────────────────────────────────────────────────────

test.describe("Orchestrator intent form", () => {
  test("renders the intent textarea with an associated label", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    // getByLabel resolves via the <label htmlFor="intent"> / <textarea
    // id="intent"> pairing in page.tsx. Regression this catches: the label
    // and textarea silently losing their htmlFor/id link, which would make
    // the field anonymous to screen readers even though it looks fine.
    const intent = page.getByLabel(/intent/i);
    await expect(intent).toBeVisible();
    await expect(intent).toHaveAttribute(
      "placeholder",
      'e.g. "code a calculator web app"',
    );
  });

  test("has exactly one h1 reading Orchestrator", async ({ page }) => {
    await gotoOrchestrator(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Orchestrator");
  });

  for (const intent of PRESET_INTENTS) {
    test(`preset button "${intent}" populates the textarea verbatim`, async ({
      page,
    }) => {
      await gotoOrchestrator(page);
      // Accessible name is "▸ {intent}" (page.tsx prefixes every preset with
      // the ▸ glyph), so match by substring rather than the exact string.
      await page.getByRole("button", { name: intent }).click();
      // Regression: a preset that populates the wrong string (or a
      // truncated one) would silently send a different — possibly
      // non-demo-kit, LLM-routed — intent to decompose.
      await expect(page.getByLabel(/intent/i)).toHaveValue(intent);
    });
  }

  test("Enter submits the form", async ({ page }) => {
    await gotoOrchestrator(page);
    await page.getByRole("button", { name: "calculator web app" }).click();
    const textarea = page.getByLabel(/intent/i);
    await textarea.press("Enter");
    // Regression: if Enter stopped submitting, users would be forced to
    // reach for the mouse for every single decompose — the textarea's
    // whole reason for intercepting Enter (page.tsx `submitOnEnter`) would
    // be dead code.
    await expect(
      page.getByRole("button", { name: /Decomposing/ }),
    ).toBeVisible();
  });

  test("Shift+Enter inserts a newline instead of submitting", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    const textarea = page.getByLabel(/intent/i);
    await textarea.fill("line one");
    await textarea.press("Shift+Enter");
    await textarea.type("line two");
    // Regression: this is explicit, commented behavior in page.tsx
    // (submitOnEnter checks `!e.shiftKey`) — losing it would make
    // multi-line intents impossible to compose.
    await expect(textarea).toHaveValue("line one\nline two");
    // And critically: it must not have submitted.
    await expect(
      page.getByRole("button", { name: "Decompose ▸" }),
    ).toBeEnabled();
  });

  test("submit is disabled while the intent is empty or whitespace-only", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    const submit = page.getByRole("button", { name: /Decompose/ });
    // Regression: an enabled submit on an empty textarea lets a blank
    // intent reach POST /orchestrator/decompose, which the backend has
    // nothing meaningful to plan against.
    await expect(submit).toBeDisabled();

    const textarea = page.getByLabel(/intent/i);
    await textarea.fill("   ");
    await expect(submit).toBeDisabled();

    await textarea.fill("calculator web app");
    await expect(submit).toBeEnabled();

    await textarea.fill("");
    await expect(submit).toBeDisabled();
  });

  test("submit is disabled and shows a pending label while decompose is in flight", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    await page.getByRole("button", { name: "calculator web app" }).click();
    await page.getByRole("button", { name: "Decompose ▸" }).click();
    // Regression: a submit left enabled mid-flight lets a second click fire
    // an overlapping decompose request (use-async-action.ts explicitly
    // guards against overlapping runs winning out of order — the button
    // should never let a user create that race in the first place).
    const pending = page.getByRole("button", { name: /Decomposing/ });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — decompose result (demo-kit intent, deterministic)
// ─────────────────────────────────────────────────────────────────────────

test.describe("Orchestrator decompose result", () => {
  test("a demo-kit intent returns a plan with step rows, totals, and per-step detail", async ({
    page,
  }) => {
    test.setTimeout(DECOMPOSE_TIMEOUT_MS + 30_000);
    await decomposeCalculatorPlan(page);

    // The demo kit is documented as returning a fixed 6-step plan.
    // Regression: a step count drifting from 6 for a curated intent means
    // the backend's demo-kit shortcut stopped matching and this intent fell
    // through to the real (slow, non-deterministic) LLM path.
    const steps = page.getByRole("listitem");
    await expect(steps).toHaveCount(6);

    let sumOfSteps = 0;
    const count = await steps.count();
    for (let i = 0; i < count; i++) {
      const text = (await steps.nth(i).innerText()).replace(/\s+/g, " ");
      // Regression: losing the "→" between the agent badge and the
      // rationale would mean the rationale is no longer distinguishable
      // from the agent name in the rendered row.
      expect(text).toContain("→");
      // Regression: price/eta format drifting (execution-plan.tsx renders
      // `${price.toFixed(3)} · ${eta.toFixed(1)}s`) breaks the totals-sum
      // assertion below and, for a real user, the estimate they're shown
      // before authorizing spend.
      const priceMatch = text.match(/(\d+\.\d{3})\s*·\s*\d+\.\d+s/);
      expect(priceMatch, `step ${i} should render a price · eta`).toBeTruthy();
      sumOfSteps += parseFloat(priceMatch![1]);

      // Rationale: whatever text sits between "→" and the trailing price
      // block must be non-empty — an empty rationale is a silently broken
      // plan step.
      const rationale = text.split("→")[1]?.replace(priceMatch![0], "").trim();
      expect(rationale?.length ?? 0).toBeGreaterThan(0);
    }

    // "total est." / "eta" only ever appear inside the plan card (confirmed
    // against sidebar.tsx / topbar.tsx, which render neither), so reading
    // the whole page's text is unambiguous and avoids a brittle DOM-parent
    // traversal to scope a container that has no test id.
    const pageText = (await page.locator("body").innerText()).replace(
      /\s+/g,
      " ",
    );
    const totalMatch = pageText.match(/total est\.\s*(\d+\.\d{3}) USDC/);
    expect(totalMatch, "totals row should render total est. in USDC").toBeTruthy();
    const displayedTotal = parseFloat(totalMatch![1]);

    // Regression: the totals row is exactly what a user reads before
    // authorizing on-chain spend. If it silently drifted from the sum of
    // the steps actually listed, users could authorize more (or be shown
    // less) than what the plan really costs. Tolerance accounts only for
    // per-step display rounding to 3 decimals.
    expect(Math.abs(displayedTotal - sumOfSteps)).toBeLessThanOrEqual(
      0.0005 * count + 0.0005,
    );

    const etaMatch = pageText.match(/eta\s*(\d+\.\d+)s/);
    expect(etaMatch, "totals row should render an eta in seconds").toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — execution plan actions (simulate vs. on-chain gating)
// ─────────────────────────────────────────────────────────────────────────

test.describe("Execution plan actions", () => {
  test("offers a simulated execute path that requires no wallet", async ({
    page,
  }) => {
    test.setTimeout(DECOMPOSE_TIMEOUT_MS + 30_000);
    await decomposeCalculatorPlan(page);

    // No wallet extension is present in this environment, so this button
    // must be reachable and usable in the disconnected state — this is the
    // only execute path this suite can exercise end-to-end.
    const simulate = page.getByRole("button", { name: /simulate/i });
    await expect(simulate).toBeVisible();
    await expect(simulate).toBeEnabled();

    await simulate.click();
    // execution-plan.tsx `simulate` calls execute(plan.plan_id) with no
    // auth_id/payer, then router.push(`/app/trace?task=${task_id}`).
    // Regression: if the simulated path started requiring a wallet or an
    // auth id, this navigation would never happen (or would throw).
    await expect(page).toHaveURL(/\/app\/trace\?task=/, {
      timeout: FULL_RUN_TIMEOUT_MS,
    });
  });

  test("gates the on-chain Authorize & Execute path behind a wallet connect prompt", async ({
    page,
  }) => {
    test.setTimeout(DECOMPOSE_TIMEOUT_MS + 30_000);
    await decomposeCalculatorPlan(page);

    // Regression: this is the core safety property of the on-chain path —
    // without a connected wallet there is no signer, so the UI must show a
    // connect prompt instead of a clickable Authorize button that would
    // throw on `wallet.address` being undefined mid-flow.
    await expect(page.getByText(/wallet required/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect Wallet" }),
    ).toBeVisible();

    // The on-chain button only renders in the connected branch of
    // execution-plan.tsx — asserting its absence (not just "disabled")
    // confirms the gate is structural, not a crash waiting to happen.
    await expect(
      page.getByRole("button", { name: /Authorize & Execute/ }),
    ).toHaveCount(0);

    // The simulated path and fiat funding remain available while
    // disconnected.
    await expect(
      page.getByRole("button", { name: /simulate/i }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /Pay with Fiat/i }),
    ).toBeEnabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — error path
// ─────────────────────────────────────────────────────────────────────────

