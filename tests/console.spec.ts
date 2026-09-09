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

test.describe('Console shell', () => {
  test('the sidebar lists all 11 workspace nav items alongside the topbar and a single main landmark', async ({
    page,
  }) => {
    await page.goto('/app');
    const nav = page.getByRole('complementary', { name: 'Navigation' });
    await expect(nav).toBeVisible();
    for (const item of NAV_ITEMS) {
      await expect(nav.getByRole('link', { name: item.label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('the skip link jumps keyboard users straight to the main landmark', async ({ page }) => {
    await page.goto('/app');
    const skipLink = page.getByRole('link', { name: 'Skip to content' });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });
});

// ---------------------------------------------------------------------------
// Sidebar navigation
// ---------------------------------------------------------------------------

test.describe('Sidebar navigation', () => {
  for (const item of NAV_ITEMS) {
    test(`"${item.label}" navigates to ${item.href} and marks itself current via aria-current`, async ({
      page,
    }) => {
      await page.goto('/app');
      const nav = page.getByRole('complementary', { name: 'Navigation' });
      const link = nav.getByRole('link', { name: item.label, exact: true });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${item.href}$`));
      await expect(link).toHaveAttribute('aria-current', 'page');
    });
  }

  test('aria-current moves with the route instead of sticking to the first-painted link', async ({
    page,
  }) => {
    await page.goto('/app');
    const nav = page.getByRole('complementary', { name: 'Navigation' });
    const overviewLink = nav.getByRole('link', { name: 'Overview', exact: true });
    await expect(overviewLink).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Flow', exact: true }).click();
    // Regression: a stale aria-current would tell assistive tech the user is
    // still on Overview after they have navigated to Flow.
    await expect(overviewLink).not.toHaveAttribute('aria-current', 'page');
  });
});

// ---------------------------------------------------------------------------
// Mobile navigation drawer (390x844)
// ---------------------------------------------------------------------------

