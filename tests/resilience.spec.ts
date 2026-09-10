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
 *
 * RS-07 (Chromium/Firefox/WebKit) is not a distinct test here: every check
 * in this file is plain `@playwright/test` API with no engine-specific
 * branching, so it is satisfied by running this file under each configured
 * project. `playwright.config.ts` (owned by the lead, not this file) already
 * defines chromium-desktop, chromium-mobile and webkit-desktop; it has no
 * firefox project yet.
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
    test(`[PF-02] ${path}: the loading state clears — to data or to an error — within the cold-start budget, never indefinitely`, async ({
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
    test(`[RS-01] ${route.label} (${route.path}): still renders its shell and announces the outage`, async ({
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

  test("[RS-01] /app/events: the empty state never renders underneath the error (feedLoading must not go false on error)", async ({
    page,
  }) => {
    await blockApi(page);
    await page.goto("/app/events");

    await expect(page.locator('[role="alert"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/No events yet/i)).toHaveCount(0);
  });

  test("[RS-01] marketing home (/) renders fully and silently — static content has no backend dependency", async ({
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
  test("[RS-02] /app/agents: a transient 500 is retried automatically (the retry control turns into a disabled 'retrying…' state)", async ({
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

  test("[RS-02] /app/agents: a 404 outage is NOT auto-retried — the control stays a manual 'retry' action", async ({
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

  test("[RS-03] /app: a connection that never answers is held on its loading state until the client's own deadline, then fails — never earlier, never never", async ({
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

test.describe("resilience: a 429 tells the user how long to wait, not that something is broken", () => {
  test("[RS-04] /app/register: a rate-limited build surfaces lib/rate-limit-message.ts's copy verbatim", async ({
    page,
  }) => {
    // This test only exercises the rate-limit-message wiring on the
    // register form's submit path — NOT registration correctness (field
    // validation, tx lifecycle, evidence card), which belongs to the
    // registry route's own spec. The minimum valid form is filled here
    // purely to reach the POST that gets rate-limited.
    await stubWalletSession(page);
    await page.route("**/api/stellar/agent-id-available/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: true }),
      }),
    );
    // lib/api.ts formats Retry-After as seconds; rate-limit-message.ts turns
    // that into "wait {n}s" — assert the exact number round-trips.
    const retryAfterSeconds = 37;
    await page.route("**/api/stellar/build/register-agent", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": String(retryAfterSeconds) },
        body: JSON.stringify({
          error: { code: "rate_limited", message: "Too Many Requests" },
        }),
      }),
    );

    await page.goto("/app/register");
    await page.fill("#reg-agent-id", "e2e_rate_limit_probe");
    await page.locator("#reg-agent-id").blur();
    await expect(page.getByText(/✓ available/i)).toBeVisible({
      timeout: 15_000,
    });

    await page.fill("#reg-name", "Rate Limit Probe");
    await page.fill("#reg-price", "1");
    await page.getByRole("button", { name: /register/i }).click();

    // The exact copy from lib/rate-limit-message.ts — proves the 429 path
    // is wired to the friendly "nothing was lost" message, not swallowed
    // into the generic "Could not prepare the registration" fallback that
    // sits right next to it in the same catch block.
    await expect(
      page.getByText(
        `Too many requests — wait ${retryAfterSeconds}s and try again. Nothing was lost.`,
      ),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("[RS-04] /app/register: a 429 with no Retry-After header still reads as a wait, not a generic failure", async ({
    page,
  }) => {
    await stubWalletSession(page);
    await page.route("**/api/stellar/agent-id-available/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: true }),
      }),
    );
    await page.route("**/api/stellar/build/register-agent", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        // Deliberately no Retry-After header — rate-limit-message.ts must
        // fall back to "a moment", not print "undefined" or "NaNs".
        body: JSON.stringify({
          error: { code: "rate_limited", message: "Too Many Requests" },
        }),
      }),
    );

    await page.goto("/app/register");
    await page.fill("#reg-agent-id", "e2e_rate_limit_probe2");
    await page.locator("#reg-agent-id").blur();
    await expect(page.getByText(/✓ available/i)).toBeVisible({
      timeout: 15_000,
    });
    await page.fill("#reg-name", "Rate Limit Probe 2");
    await page.fill("#reg-price", "1");
    await page.getByRole("button", { name: /register/i }).click();

    await expect(
      page.getByText(
        "Too many requests — wait a moment and try again. Nothing was lost.",
      ),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Performance budgets — guardrails against regression, not absolute targets
// ---------------------------------------------------------------------------

/**
 * These numbers are deliberately generous. They exist to catch a step-change
 * regression (a bundle that suddenly doubles, a synchronous render-blocking
 * call, a memory-leaking effect that stalls `load`) — NOT to assert a
 * competitive Core Web Vitals score. Tune them down over time as the app's
 * real numbers are observed in CI; loosen them if the hosting tier changes.
 *
 * `/api/*` is stubbed with an immediate, generically-shaped response for
 * these tests specifically to remove Render's cold-start variance (25-60s)
 * from the measurement — that variance is a backend/infra concern the
 * budgets below are not trying to catch, and would otherwise make every
 * budget here either always-fails-cold or meaninglessly loose. Some routes
 * may render an error state under this generic stub (their guards reject an
 * unshaped payload) — that's fine, only render-completion timing is
 * asserted here, not content correctness.
 */
const PERF_BUDGET_MS = {
  // Time to an interactive DOM (scripts parsed, DOMContentLoaded fired).
  domContentLoaded: 4_000,
  // Time to the `load` event (all sync sub-resources settled).
  load: 6_000,
  // Largest Contentful Paint — the single number users equate with "loaded".
  lcp: 3_500,
  // Time to first byte of the navigation document itself (hosting/CDN, not
  // app code) — kept separate so a slow TTFB doesn't get misread as a slow
  // app.
  ttfb: 2_000,
  // Cumulative Layout Shift — unitless; sum of unexpected layout-shift
  // scores not preceded by user input. 0.1 is the "good" Core Web Vitals
  // threshold. Reads back as 0 (and trivially passes) on an engine without
  // the Layout Instability API, same fallback shape as the LCP check below.
  cls: 0.1,
} as const;

async function stubFastApi(page: Page): Promise<void> {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    }),
  );
}

async function measurePerf(page: Page): Promise<{
  ttfb: number;
  domContentLoaded: number;
  load: number;
  lcp: number;
  cls: number;
}> {
  return page.evaluate(() => {
    const [nav] = performance.getEntriesByType(
      "navigation",
    ) as PerformanceNavigationTiming[];
    const lcpEntries = performance.getEntriesByType(
      "largest-contentful-paint",
    ) as PerformanceEntry[];
    const last = lcpEntries[lcpEntries.length - 1] as
      | (PerformanceEntry & { renderTime?: number; loadTime?: number })
      | undefined;
    return {
      ttfb: nav ? nav.responseStart - nav.startTime : NaN,
      domContentLoaded: nav
        ? nav.domContentLoadedEventEnd - nav.startTime
        : NaN,
      load: nav ? nav.loadEventEnd - nav.startTime : NaN,
      lcp: last ? last.renderTime || last.loadTime || 0 : 0,
      cls:
        (window as unknown as { __clsValue?: number }).__clsValue ?? 0,
    };
  });
}

test.describe("performance budgets (regression guardrails, not SLAs — see comment above PERF_BUDGET_MS)", () => {
  for (const route of ROUTES) {
    test(`[PF-01] ${route.label} (${route.path}): navigation timing and LCP stay within budget`, async ({
      page,
    }) => {
      // Set up the LCP observer before any page script runs, or early paints
      // are missed entirely.
      await page.addInitScript(() => {
        (window as unknown as { __lcpObserved?: boolean }).__lcpObserved =
          true;
        try {
          new PerformanceObserver(() => {
            /* buffered entries are read directly from the timeline in
               measurePerf; this observer's only job is to force the browser
               to keep recording LCP candidates past first input, per the
               API's own semantics. */
          }).observe({
            type: "largest-contentful-paint",
            buffered: true,
          } as PerformanceObserverInit);
        } catch {
          // LCP unsupported in this engine — lcp reads back as 0 and the
          // budget check is skipped below.
        }
        // Layout-shift entries have no "read the buffer later" API like
        // navigation timing does — they only ever arrive through the
        // observer's callback, so the running total must be accumulated
        // here, before any layout happens.
        (window as unknown as { __clsValue: number }).__clsValue = 0;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & {
              value?: number;
              hadRecentInput?: boolean;
            })[]) {
              if (!entry.hadRecentInput) {
                (
                  window as unknown as { __clsValue: number }
                ).__clsValue += entry.value ?? 0;
              }
            }
          }).observe({
            type: "layout-shift",
            buffered: true,
          } as PerformanceObserverInit);
        } catch {
          // layout-shift unsupported in this engine — cls reads back as 0
          // and trivially passes the budget check below.
        }
      });

      if (route.path.startsWith("/app")) {
        await stubFastApi(page);
      }
      await page.goto(route.path, { waitUntil: "load" });

      const perf = await measurePerf(page);

      expect(
        perf.ttfb,
        `TTFB ${perf.ttfb.toFixed(0)}ms exceeds ${PERF_BUDGET_MS.ttfb}ms budget`,
      ).toBeLessThanOrEqual(PERF_BUDGET_MS.ttfb);
      expect(
        perf.domContentLoaded,
        `DOMContentLoaded ${perf.domContentLoaded.toFixed(0)}ms exceeds ${PERF_BUDGET_MS.domContentLoaded}ms budget`,
      ).toBeLessThanOrEqual(PERF_BUDGET_MS.domContentLoaded);
      expect(
        perf.load,
        `load ${perf.load.toFixed(0)}ms exceeds ${PERF_BUDGET_MS.load}ms budget`,
      ).toBeLessThanOrEqual(PERF_BUDGET_MS.load);
      if (perf.lcp > 0) {
        expect(
          perf.lcp,
          `LCP ${perf.lcp.toFixed(0)}ms exceeds ${PERF_BUDGET_MS.lcp}ms budget`,
        ).toBeLessThanOrEqual(PERF_BUDGET_MS.lcp);
      }
      // Unconditional (unlike the LCP check above): 0 is both "no shift
      // observed" and "unsupported engine", and both trivially satisfy the
      // budget, so there is no ambiguous case to special-case around.
      expect(
        perf.cls,
        `CLS ${perf.cls.toFixed(3)} exceeds ${PERF_BUDGET_MS.cls} budget`,
      ).toBeLessThanOrEqual(PERF_BUDGET_MS.cls);
    });
  }
});

// ---------------------------------------------------------------------------
// No horizontal overflow across breakpoints
// ---------------------------------------------------------------------------

const VIEWPORTS = [
  { width: 390, height: 844, label: "mobile (390x844)" },
  { width: 768, height: 1024, label: "tablet (768x1024)" },
  { width: 1440, height: 900, label: "desktop (1440x900)" },
] as const;

test.describe("layout: no horizontal scrollbar at any tested breakpoint", () => {
  for (const route of ROUTES) {
    test(`[RS-06] ${route.label} (${route.path}): fits its viewport at mobile, tablet, and desktop widths`, async ({
      page,
    }) => {
      await page.goto(route.path);
      for (const vp of VIEWPORTS) {
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize({ width: vp.width, height: vp.height });
        // eslint-disable-next-line no-await-in-loop
        await expectNoHorizontalOverflow(page);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// SSE trace-stream drop: reconnect / degrade-to-polling, never a silent lie
// ---------------------------------------------------------------------------

/**
 * Routes every `/api/*` call to an inert 200, then overrides the SSE
 * trace-stream endpoint specifically so the connection is accepted but never
 * answered. `openTraceStream` (lib/api.ts) pairs this with its own
 * STREAM_CONNECT_TIMEOUT_MS (12s, a plain `setTimeout`) — EventSource itself
 * never fires `error` on a request that simply hangs, so that client-side
 * deadline is the only thing standing between this and an indefinite
 * "streaming…" claim. Registered after the catch-all so it wins for stream
 * URLs (Playwright resolves the most-recently-added matching route first).
 */
async function hangTraceStream(page: Page): Promise<void> {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    }),
  );
  await page.route("**/api/trace/*/stream**", () => {
    // Deliberately never fulfill/abort — the EventSource connection stays
    // pending, exactly like a sleeping Render instance or a dead proxy.
  });
}

test.describe("resilience: an SSE trace-stream drop reconnects, and the UI stops claiming to be live while disconnected", () => {
  test("[RS-05] /app/trace: a stalled connection is treated as dropped — the badge stops claiming to be live once the connect deadline passes", async ({
    page,
  }) => {
    // Virtual clock: STREAM_CONNECT_TIMEOUT_MS (12s) and the reconnect
    // backoff (1s/2s/4s, lib/api.ts BACKOFF_MS) are real durations this test
    // must cross without actually waiting them out.
    await page.clock.install();
    await hangTraceStream(page);
    await page.goto("/app/trace?task=e2e_sse_probe_1");

    // Before the connect deadline: EventSource is still "connecting", so the
    // live claim is correct.
    await expect(page.getByText("streaming…", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // Cross STREAM_CONNECT_TIMEOUT_MS (12s) plus the first reconnect's 1s
    // backoff — the point where onReset fires and the UI must stop claiming
    // to be live.
    await page.clock.fastForward(14_000);

    await expect(
      page.getByText(
        "connection dropped — reconnecting; the lines above are the last received",
      ),
    ).toBeVisible();
    await expect(page.getByText("streaming…", { exact: true })).toHaveCount(
      0,
    );
  });

  test("[RS-05] /app/trace: once the reconnect budget is exhausted, the stream falls back to history polling and still never claims to be live", async ({
    page,
  }) => {
    await page.clock.install();
    await hangTraceStream(page);
    await page.goto("/app/trace?task=e2e_sse_probe_2");

    // Exhaust all MAX_RECONNECTS (3) reconnect attempts (lib/api.ts): each
    // costs one STREAM_CONNECT_TIMEOUT_MS (12s) connect deadline, and the
    // three BACKOFF_MS gaps (1s/2s/4s) sit between the four connect attempts
    // this makes — 4 * 12s + (1s + 2s + 4s) = 55s — after which
    // openTraceStream gives up on SSE and falls back to polling
    // GET /api/trace/{id}. A few seconds of slack, but not enough to reach
    // the fallback's own first poll retry (TRACE_POLL_MS later).
    await page.clock.fastForward(57_000);

    await expect(
      page.getByText(
        "live stream unavailable — following the recorded trace instead",
      ),
    ).toBeVisible();
    await expect(page.getByText("streaming…", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText(
        "connection dropped — reconnecting; the lines above are the last received",
      ),
    ).toHaveCount(0);
  });
});
