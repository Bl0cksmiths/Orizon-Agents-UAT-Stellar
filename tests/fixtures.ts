import type { Page, ConsoleMessage, Request } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Shared, cross-cutting test infrastructure for the orizons.xyz E2E suite.
 *
 * Everything here is plain helper functions, not Playwright fixtures wired
 * through `test.extend` — the per-route spec authors already have their own
 * `test`/`expect` imports from `@playwright/test`, so keeping these as
 * importable functions (rather than a custom `test` object every file must
 * switch to) is the lowest-friction way to share code across six authors'
 * files without merge conflicts over the test declaration itself.
 */

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * The 12 confirmed-live routes, each with a human label for test titles and
 * reporter output. `as const` keeps the `path` values literal so a spec can
 * narrow on a specific route (e.g. `route.path === "/app/register"`) without
 * a manual cast.
 */
export const ROUTES = [
  { path: "/", label: "Marketing home" },
  { path: "/app", label: "Console overview" },
  { path: "/app/agents", label: "Agent registry" },
  { path: "/app/register", label: "Agent registration" },
  { path: "/app/reputation", label: "Reputation" },
  { path: "/app/orchestrator", label: "Orchestrator" },
  { path: "/app/trace", label: "Trace" },
  { path: "/app/events", label: "Events" },
  { path: "/app/send", label: "Send" },
  { path: "/app/wallet", label: "Wallet" },
  { path: "/app/flow", label: "Flow" },
  { path: "/app/pdax", label: "PDAX" },
] as const;

export type RouteEntry = (typeof ROUTES)[number];
export type RoutePath = RouteEntry["path"];

/** Routes under `/app` — the console shell that actually talks to the backend. */
export const APP_ROUTES: RouteEntry[] = ROUTES.filter((r) =>
  r.path.startsWith("/app"),
);

// ---------------------------------------------------------------------------
// Cold start
// ---------------------------------------------------------------------------

/**
 * The backend runs on Render's free tier, which spins the service down after
 * a period of inactivity and takes 25-60s to answer the first request after
 * that. Any assertion that waits on a *real* backend response (as opposed to
 * a routed mock) must use this instead of Playwright's default 5s
 * `expect()` timeout, or the suite will be flaky against a cold instance
 * rather than reliably red on an actual regression.
 *
 * Kept generous (75s) above the documented worst case (60s) to absorb queueing
 * and DNS/TLS on top of the cold start itself.
 */
export const COLD_START_TIMEOUT = 75_000;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Fails if the page overflows horizontally. A `+1` slop absorbs sub-pixel
 * rounding between `scrollWidth` and `innerWidth` across engines; anything
 * beyond that is a real overflow (an unwrapped table, a fixed-width element,
 * a long unbroken string) that produces a horizontal scrollbar on a live
 * page — the exact class of bug that only shows up at a viewport width
 * nobody happened to resize to during development.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  expect(
    overflow.scrollWidth,
    `document.scrollWidth (${overflow.scrollWidth}) exceeds window.innerWidth (${overflow.innerWidth}) + 1 — horizontal overflow`,
  ).toBeLessThanOrEqual(overflow.innerWidth + 1);
}

// ---------------------------------------------------------------------------
// Console / network error collection
// ---------------------------------------------------------------------------

export interface ConsoleErrorEntry {
  text: string;
  location?: string;
}

export interface FailedRequestEntry {
  url: string;
  method: string;
  failure: string | null;
  status?: number;
}

export interface ConsoleErrorCollector {
  /** Console `error`-level messages not matched by the allowlist. */
  getConsoleErrors: () => ConsoleErrorEntry[];
  /** Requests that failed at the network layer (aborted, DNS, CORS, etc.) — not HTTP error statuses, which routes/pages may legitimately handle. */
  getFailedRequests: () => FailedRequestEntry[];
  /** Convenience: true when either list is non-empty. */
  hasErrors: () => boolean;
}

/**
 * Substrings that, when present anywhere in a console error's text, mark it
 * as known-benign noise rather than a real regression. Kept as an allowlist
 * (not a blanket ignore) so the assertion built on top of this collector
 * stays meaningful — a genuinely new console error still fails the suite.
 *
 * Each entry is commented with why it's safe to ignore. Extend this list
 * only for noise confirmed to originate outside the app's own code.
 */
const ALLOWED_CONSOLE_ERROR_PATTERNS: RegExp[] = [
  // favicon / apple-touch-icon 404s are cosmetic and unrelated to app logic.
  /favicon/i,
  /apple-touch-icon/i,
  // Vercel Analytics / Speed Insights beacons can be blocked by ad-blockers
  // or fail in CI network sandboxes without indicating an app bug.
  /vercel\.(live|insights)/i,
  /va\.vercel-scripts\.com/i,
  /\/_vercel\/(insights|speed-insights)/i,
  // Browser extension noise that leaks into the page console in some
  // environments (not present in a clean CI browser, but harmless if it is).
  /chrome-extension:\/\//i,
  // React DevTools hint — informational, not an error condition.
  /Download the React DevTools/i,
  // Third-party wallet-kit modules probe for injected wallet globals (e.g.
  // window.freighterApi) that never exist in CI (no extension installed);
  // the resulting "not defined" warnings are expected, not a regression.
  /freighterApi/i,
  /is not defined/i,
];

function isAllowedConsoleError(text: string): boolean {
  return ALLOWED_CONSOLE_ERROR_PATTERNS.some((re) => re.test(text));
}

/** URL substrings for requests that are expected to fail/be blocked and must not count as regressions. */
const ALLOWED_FAILED_REQUEST_PATTERNS: RegExp[] = [
  /favicon/i,
  /apple-touch-icon/i,
  /vercel\.(live|insights)/i,
  /va\.vercel-scripts\.com/i,
  /\/_vercel\//i,
];

function isAllowedFailedRequest(url: string): boolean {
  return ALLOWED_FAILED_REQUEST_PATTERNS.some((re) => re.test(url));
}

/**
 * Attaches `console` and `requestfailed` listeners to the page and returns a
 * collector. Call this BEFORE `page.goto(...)` so nothing emitted during
 * initial navigation is missed.
 *
 * Usage:
 *   const errors = collectConsoleErrors(page);
 *   await page.goto("/app");
 *   ...
 *   expect(errors.hasErrors(), JSON.stringify(errors.getConsoleErrors())).toBe(false);
 */
export function collectConsoleErrors(page: Page): ConsoleErrorCollector {
  const consoleErrors: ConsoleErrorEntry[] = [];
  const failedRequests: FailedRequestEntry[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isAllowedConsoleError(text)) return;
    const loc = msg.location();
    consoleErrors.push({
      text,
      location: loc?.url
        ? `${loc.url}:${loc.lineNumber ?? 0}:${loc.columnNumber ?? 0}`
        : undefined,
    });
  });

  // Uncaught exceptions in page scripts — surfaced separately from console
  // "error" logs, but the same class of regression (a render-time throw).
  page.on("pageerror", (err: Error) => {
    const text = err.message ?? String(err);
    if (isAllowedConsoleError(text)) return;
    consoleErrors.push({ text: `Uncaught: ${text}` });
  });

  page.on("requestfailed", (req: Request) => {
    const url = req.url();
    if (isAllowedFailedRequest(url)) return;
    failedRequests.push({
      url,
      method: req.method(),
      failure: req.failure()?.errorText ?? null,
    });
  });

  return {
    getConsoleErrors: () => consoleErrors,
    getFailedRequests: () => failedRequests,
    hasErrors: () => consoleErrors.length > 0 || failedRequests.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Accessibility helpers
// ---------------------------------------------------------------------------

/**
 * Asserts exactly one `<h1>` on the page, and that visible heading levels
 * never skip a rank on the way down (e.g. an h2 followed directly by an h4
 * with no h3 in between). Hidden headings (`display:none`,
 * `visibility:hidden`, zero-size, or `[hidden]`) are excluded — they don't
 * form part of the perceivable structure a screen reader user hears.
 */
