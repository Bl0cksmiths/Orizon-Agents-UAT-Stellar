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
