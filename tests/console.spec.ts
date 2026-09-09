import { test, expect, type Page } from '@playwright/test';

/**
 * Console shell + Overview (/app) + Flow (/app/flow) + Events (/app/events)
 * coverage for the live production deployment at https://orizons.xyz.
 *
 * Selectors are derived from the actual source (app/app/_components/*,
 * app/app/{page,flow/page,events/page}.tsx, components/ui/*) and confirmed
 * against the shipped markup via `curl -s https://orizons.xyz/app`. No
 * wallet extension exists in CI, so these tests only ever exercise the
 * disconnected console — they never attempt to connect a wallet.
 *
 * Failure states are simulated deterministically by intercepting the
 * same-origin `/api/*` proxy (see next.config.mjs rewrites + lib/api.ts,
 * which resolves every backend call to `/api/<path>`) rather than by
 * waiting out a real backend outage. Only the few tests that assert real
 * data eventually renders talk to the live backend, and those carry
 * generous, explicitly commented timeouts to tolerate Render's free-tier
 * cold start (25-60s) instead of a fixed sleep.
 */

const NAV_ITEMS = [
  { href: '/app', label: 'Overview' },
  { href: '/app/agents', label: 'Agents' },
  { href: '/app/register', label: 'Register' },
  { href: '/app/reputation', label: 'Reputation' },
  { href: '/app/orchestrator', label: 'Orchestrator' },
  { href: '/app/trace', label: 'Trace' },
  { href: '/app/events', label: 'Events' },
  { href: '/app/send', label: 'Send XLM' },
  { href: '/app/pdax', label: 'PDAX Ramp' },
  { href: '/app/wallet', label: 'Wallet' },
  { href: '/app/flow', label: 'Flow' },
] as const;

const ROUTES = ['/app', '/app/flow', '/app/events'] as const;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Aborts every browser request to one backend proxy path (e.g. "/metrics/overview"). */
async function failApi(page: Page, path: string) {
  await page.route(`**/api${path}`, (route) => route.abort('failed'));
}

/**
 * Intercepts a backend proxy path and never resolves the request — holds the
 * page in its "first fetch still in flight" loading state for the life of
 * the test, without a fixed sleep anywhere in the test itself.
 */
async function hangApi(page: Page, path: string) {
  await page.route(`**/api${path}`, () => {
    // Deliberately never calls fulfill/continue/abort.
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  // 1px tolerance for subpixel layout rounding.
  expect(overflow).toBeLessThanOrEqual(1);
}

// ---------------------------------------------------------------------------
// Console shell
// ---------------------------------------------------------------------------

