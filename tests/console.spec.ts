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

test.describe('Mobile navigation drawer', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the hamburger opens the nav as a modal dialog exposing the full workspace list', async ({
    page,
  }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'open menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  });

  test('Escape closes the drawer and returns focus to the hamburger that opened it', async ({
    page,
  }) => {
    await page.goto('/app');
    const hamburger = page.getByRole('button', { name: 'open menu' });
    await hamburger.click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toBeHidden();
    // Regression: a dialog that doesn't return focus strands keyboard users
    // wherever the drawer happened to leave them.
    await expect(hamburger).toBeFocused();
  });

  test('background content is marked inert while the drawer is open, and interactive again once closed', async ({
    page,
  }) => {
    await page.goto('/app');
    const main = page.getByRole('main');
    const wrapperIsInert = () =>
      main.evaluate((el) => el.parentElement?.hasAttribute('inert') ?? false);

    await expect.poll(wrapperIsInert).toBe(false);
    await page.getByRole('button', { name: 'open menu' }).click();
    // Regression: without `inert` on the background wrapper, aria-modal is a
    // lie — Tab could still reach the topbar/page content stacked behind the
    // drawer even though it visually reads as blocked. (The hamburger itself
    // is now inside that inert wrapper and unreachable, so the drawer is
    // closed via Escape below, not by clicking it again.)
    await expect.poll(wrapperIsInert).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(wrapperIsInert).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Overview (/app)
// ---------------------------------------------------------------------------

test.describe('Overview — loading, loaded, and failed states stay visually and semantically distinct', () => {
  test('announces a loading state to assistive tech while the first payload is in flight', async ({
    page,
  }) => {
    await hangApi(page, '/metrics/overview');
    await hangApi(page, '/tasks');
    await page.goto('/app');
    const main = page.getByRole('main');
    // The skeleton tiles are aria-hidden by design; this sr-only status is
    // the only accessible signal that data is loading, not absent.
    await expect(main.getByRole('status', { name: 'Loading metrics…' })).toBeAttached();
    // Regression: tile labels must render immediately so "no data yet" never
    // reads as "no such metric" while the fetch is pending.
    await expect(main.getByText('Agents online', { exact: true })).toBeVisible();
  });

  test('never renders a metric as a bare 0 or dash on failure — every tile says "unavailable"', async ({
    page,
  }) => {
    await failApi(page, '/metrics/overview');
    await failApi(page, '/tasks');
    await page.goto('/app');
    const main = page.getByRole('main');
    await expect(main.getByText('backend offline', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(main.getByRole('alert').first()).toContainText("couldn't reach the backend");
    // Regression: this is the core invariant — metrics render from `overview`,
    // which stays null on failure, so all 4 tiles must show the labeled
    // failure state, never a fabricated "0" a viewer could mistake for real.
    await expect(main.getByText('unavailable', { exact: true })).toHaveCount(4);
    await expect(main.getByText('throughput unavailable', { exact: false })).toBeVisible();
    await expect(main.getByText('skill mix unavailable', { exact: false })).toBeVisible();
    await expect(main.getByText("couldn't load recent tasks", { exact: false })).toBeVisible();
  });

  test('the sidebar network panel reports the same backend failure independently of the page body', async ({
    page,
  }) => {
    await failApi(page, '/metrics/overview');
    await page.goto('/app');
    const nav = page.getByRole('complementary', { name: 'Navigation' });
    // Regression: the sidebar runs its own fetch of the same endpoint; it
    // must not silently show placeholder dashes when that fetch fails.
    await expect(nav.getByText('network metrics unavailable')).toBeVisible({ timeout: 30_000 });
  });

  test('renders real network metrics once the cold-start backend responds', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('/app');
    const main = page.getByRole('main');
    const agentsValue = main
      .getByText('Agents online', { exact: true })
      .locator('xpath=following-sibling::*[1]');
    // Render's free-tier backend can take 25-60s to cold-start, and the
    // client's own GET deadline is 60s — no fixed sleep, just a wide
    // web-first retry window on this one assertion.
    await expect(agentsValue).toContainText(/\d/, { timeout: 120_000 });
  });
});

// ---------------------------------------------------------------------------
// Flow (/app/flow)
// ---------------------------------------------------------------------------

