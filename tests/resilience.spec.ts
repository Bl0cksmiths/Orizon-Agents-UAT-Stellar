import { test, expect, type Page } from "@playwright/test";
import {
  ROUTES,
  APP_ROUTES,
  COLD_START_TIMEOUT,
  blockApi,
  failApi,
  hangApi,
  stubWalletSession,
  expectNoHorizontalOverflow,
  collectConsoleErrors,
} from "./fixtures";

/**
 * Resilience + performance sweep.
 *
 * `e2e/failure-states.spec.ts` in the FE repo already covers "every /app
 * route announces a total outage instead of shimmering". This file keeps
 * that invariant (broadened: more routes, more fabricated-zero shapes) and
 * goes further — telling apart *why* the backend failed (outright outage vs
 * a 500 vs a stalled connection vs a 429), since the app's own retry logic
 * (lib/use-fetch.ts `isTransientFetchError`) treats those differently and a
 * regression collapsing that distinction is invisible to a single
 * "is there an alert" check.
 */

// ---------------------------------------------------------------------------
// Fabricated-zero guards
// ---------------------------------------------------------------------------

/**
 * Patterns that would mean a failed fetch rendered as a plausible-looking
 * real value instead of an announced failure — the exact bug class
 * `lib/wallet.tsx`'s four-state balance model and `app/app/agents/page.tsx`'s
 * `!error` skeleton gate exist to prevent. Each is commented with the
 * concrete UI it mimics.
 */
const FABRICATED_ZERO_PATTERNS: { re: RegExp; describes: string }[] = [
  { re: /\b0\.000\b/, describes: "USDC amount formatted to 3dp" },
  { re: /\$0\.00\b/, describes: "dollar-formatted amount" },
  { re: /\b0\.00 USDC\b/, describes: "USDC amount formatted to 2dp" },
  { re: /\b0 agents?\b/i, describes: "agent count" },
  { re: /\b0 tasks?\b/i, describes: "task count" },
  { re: /\b0 events?\b/i, describes: "event count" },
  { re: /\b0%\b/, describes: "a percentage (e.g. trust/reputation score)" },
];

async function expectNoFabricatedZero(page: Page): Promise<void> {
  const main = page.locator("main");
  for (const { re, describes } of FABRICATED_ZERO_PATTERNS) {
    // A failed fetch must never render as a real-looking zero — it must be
    // an announced error instead. Regression this catches: an error path
    // that falls through to a `?? 0` / `?.length ?? 0` default instead of
    // rendering the error state.
    await expect(
      main,
      `found "${describes}" pattern (${re}) while the API was down — a failure must never render as this value`,
    ).not.toContainText(re);
  }
}

/** A page is "up" if something meaningful painted — not a blank <body>. */
async function expectNotAWhiteScreen(page: Page): Promise<void> {
  const main = page.locator("main");
  await expect(main).toBeVisible();
  const text = await main.innerText();
  expect(
    text.trim().length,
    "main landmark rendered but contains no visible text — looks like a white screen",
  ).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Real backend: cold start always resolves, never hangs forever
// ---------------------------------------------------------------------------

