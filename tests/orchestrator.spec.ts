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

