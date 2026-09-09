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

test.describe("resilience: against the real backend, a cold start always resolves within budget", () => {
  for (const path of ["/app", "/app/agents"] as const) {
    // Deliberately NOT mocked — this is the one place in the suite that hits
    // the real, possibly-sleeping Render backend, to prove the loading state
    // it drives is bounded. Restricted to two representative routes (rather
    // than all of APP_ROUTES) to keep the live-network cost of the suite
    // reasonable; every route shares the same `useFetch`/`usePolling` +
    // client-side-deadline plumbing, so this is a shared-infrastructure
    // guarantee, not a per-route one.
    test(`${path}: the loading state clears — to data or to an error — within the cold-start budget, never indefinitely`, async ({
      page,
    }) => {
      await page.goto(path);
      // `LoadingStatus` (components/ui/skeleton.tsx) is the sr-only
      // role="status" announcing an in-flight fetch. Regression this
      // catches: a cold Render instance (25-60s to wake) leaving the page
      // stuck on skeletons forever instead of the fetch's own deadline
      // (60s, lib/api.ts GET_TIMEOUT_MS) eventually forcing a resolution.
      await expect(
        page.getByRole("status", { name: /loading/i }),
      ).toHaveCount(0, { timeout: COLD_START_TIMEOUT });
    });
  }
});

// ---------------------------------------------------------------------------
// Total backend outage
// ---------------------------------------------------------------------------

test.describe("resilience: total backend outage never renders as a blank or falsely-empty page", () => {
  for (const route of APP_ROUTES) {
    test(`${route.label} (${route.path}): still renders its shell and announces the outage`, async ({
      page,
    }) => {
      await blockApi(page);
      await page.goto(route.path);

      await expectNotAWhiteScreen(page);
      // The outage-era bug: a 404 on every /api/* call looked exactly like a
      // healthy server answering "no data" — asserting an announced failure
      // is the only way to tell the two apart from the DOM.
      await expect(page.locator('[role="alert"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await expectNoFabricatedZero(page);
    });
  }

  test("/app/events: the empty state never renders underneath the error (feedLoading must not go false on error)", async ({
    page,
  }) => {
    await blockApi(page);
    await page.goto("/app/events");

    await expect(page.locator('[role="alert"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/No events yet/i)).toHaveCount(0);
  });

  test("marketing home (/) renders fully and silently — static content has no backend dependency", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await blockApi(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // No alert anywhere: the outage must not leak into a page that never
    // reads from the backend (a fire-and-forget warm-up ping, if any, must
    // not surface as user-visible failure UI).
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    expect(
      errors.getConsoleErrors(),
      `unexpected console errors on a page with no backend dependency: ${JSON.stringify(errors.getConsoleErrors())}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 500 vs 404-outage vs stalled connection are told apart
// ---------------------------------------------------------------------------

test.describe("resilience: the failure MODE is told apart, not just the failure", () => {
  // These two use /app/agents specifically: it drives its fetch through
  // `useFetch` (lib/use-fetch.ts), which auto-retries transient failures and
  // exposes that as ErrorNote's `retrying` state. /app itself polls via a
  // different hook (`usePolling`) with its own backoff and no automatic
  // "retrying…" button state, so it can't demonstrate this distinction.
  test("/app/agents: a transient 500 is retried automatically (the retry control turns into a disabled 'retrying…' state)", async ({
    page,
  }) => {
    await failApi(page, 500);
    await page.goto("/app/agents");

    await expect(page.locator('[role="alert"]').first()).toBeVisible({
      timeout: 15_000,
    });
    // lib/use-fetch.ts's `isTransientFetchError` treats 5xx as transient and
    // schedules an automatic retry (2s/4s/8s backoff); ErrorNote renders that
    // as a disabled "retrying…" button. Regression this catches: a 500 being
    // reclassified as terminal, silently dropping the auto-recovery that
    // matters most for a backend that free-tier-sleeps mid-session.
    await expect(
      page.getByRole("button", { name: /retrying/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("/app/agents: a 404 outage is NOT auto-retried — the control stays a manual 'retry' action", async ({
    page,
  }) => {
    await blockApi(page);
    await page.goto("/app/agents");

    await expect(page.locator('[role="alert"]').first()).toBeVisible({
      timeout: 15_000,
    });
    // A 404 means "this resource doesn't exist", not "try again later" —
    // `isTransientFetchError` deliberately excludes it so a misrouted/dead
    // proxy doesn't burn the backend's 120 req/min rate-limit budget in a
    // retry storm. Regression this catches: 404 getting swept into the
    // transient bucket, which is exactly what a broken proxy config looks
    // like from the client's point of view.
    await expect(
      page.getByRole("button", { name: /^retry$/i }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /retrying/i }),
    ).toHaveCount(0);
  });

  test("/app: a connection that never answers is held on its loading state until the client's own deadline, then fails — never earlier, never never", async ({
    page,
  }) => {
    // Virtual clock so the real 60s client-side deadline (GET_TIMEOUT_MS in
    // lib/api.ts) can be crossed without the test actually waiting 60s.
    await page.clock.install();
    await hangApi(page);
    await page.goto("/app");

    // Before the deadline: must still look like an in-progress load, not a
    // premature failure — the whole point of the deadline is to give a cold
    // Render instance a real chance to answer before giving up.
    await expect(page.locator('[role="alert"]')).toHaveCount(0);

    // Cross GET_TIMEOUT_MS (60s) plus slack.
    await page.clock.fastForward(65_000);

    // After the deadline: the app must give up and announce it — a stalled
    // connection must not spin its skeleton forever.
    await expect(page.locator('[role="alert"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Rate limiting (429) surfaces the real wait-message copy
// ---------------------------------------------------------------------------

