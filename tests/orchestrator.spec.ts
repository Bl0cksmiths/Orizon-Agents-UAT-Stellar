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

