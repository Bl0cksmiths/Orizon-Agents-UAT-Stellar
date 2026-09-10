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
  test('CN-01 the sidebar lists all 11 workspace nav items alongside the topbar and a single main landmark', async ({
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
    test(`CN-02 "${item.label}" navigates to ${item.href} and marks itself current via aria-current`, async ({
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

  test('CN-02 aria-current moves with the route instead of sticking to the first-painted link', async ({
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

  test('CN-03 the hamburger opens the nav as a modal dialog exposing the full workspace list', async ({
    page,
  }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'open menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
  });

  test('CN-03 Escape closes the drawer and returns focus to the hamburger that opened it', async ({
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

  test('CN-03 background content is marked inert while the drawer is open, and interactive again once closed', async ({
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
  test('CN-04 announces a loading state to assistive tech while the first payload is in flight', async ({
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

  test('CN-04 never renders a metric as a bare 0 or dash on failure — every tile says "unavailable"', async ({
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

  test('CN-04 the sidebar network panel reports the same backend failure independently of the page body', async ({
    page,
  }) => {
    await failApi(page, '/metrics/overview');
    await page.goto('/app');
    const nav = page.getByRole('complementary', { name: 'Navigation' });
    // Regression: the sidebar runs its own fetch of the same endpoint; it
    // must not silently show placeholder dashes when that fetch fails.
    await expect(nav.getByText('network metrics unavailable')).toBeVisible({ timeout: 30_000 });
  });

  test('CN-04 renders real network metrics once the cold-start backend responds', async ({ page }) => {
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

test.describe('Flow — DAG renders nodes and edges, and fails loudly instead of an empty canvas', () => {
  test('CN-05 shows an explicit offline error in place of the graph when the flow fetch fails', async ({
    page,
  }) => {
    await failApi(page, '/flow/default');
    await page.goto('/app/flow');
    const main = page.getByRole('main');
    await expect(main.getByRole('alert').first()).toContainText('backend offline', { timeout: 30_000 });
    // Regression: the stat row (Nodes/Edges/Parallel branches) is computed
    // from the loaded flow and must stay hidden on failure rather than
    // rendering a fabricated "0 nodes".
    await expect(main.getByText('Nodes', { exact: true })).toHaveCount(0);
  });

  test('CN-05 renders the live DAG with real node and edge counts once the backend responds', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto('/app/flow');
    const main = page.getByRole('main');
    // Same Render cold-start budget as Overview — wide window, no fixed sleep.
    await expect(main.getByText(/^\d+ nodes · \d+ edges$/)).toBeVisible({ timeout: 120_000 });
    // The stat row is gated on the same payload, so it should now be present.
    await expect(main.getByText('Nodes', { exact: true })).toBeVisible();
    await expect(main.getByText('Edges', { exact: true })).toBeVisible();
    await expect(main.getByText('Parallel branches', { exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Events (/app/events)
// ---------------------------------------------------------------------------

test.describe('Events — feed distinguishes connecting, empty, live, and failed states', () => {
  test('CN-06 shows a feed-unavailable error — never the "no events yet" empty copy — when the contract list fails to load', async ({
    page,
  }) => {
    await failApi(page, '/stellar/network');
    await page.goto('/app/events');
    const main = page.getByRole('main');
    await expect(main.getByText('feed unavailable', { exact: false })).toBeVisible({ timeout: 30_000 });
    // Regression: a feed that never started must not be indistinguishable
    // from a healthy feed that simply has nothing to show yet.
    await expect(main.getByText('No events yet', { exact: false })).toHaveCount(0);
  });

  test('reaches a settled "live" state — not stuck on "connecting" — once the contract list loads', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.goto('/app/events');
    const main = page.getByRole('main');
    // Cold-start backend (contract id list) plus the first Soroban RPC round
    // trip: give both legs room instead of a fixed sleep.
    await expect(main.getByText('Connecting to the event feed…')).toBeHidden({ timeout: 120_000 });
    // Scoped to <main> because the topbar also renders a "live" backend badge.
    await expect(main.getByText('live', { exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Route-level failure never white-screens the console
// ---------------------------------------------------------------------------

test.describe('Route-level failure never white-screens the console', () => {
  test('shell chrome and the page heading stay mounted when every backend call fails', async ({
    page,
  }) => {
    await page.route('**/api/**', (route) => route.abort('failed'));
    await page.goto('/app');
    await expect(page.getByRole('complementary', { name: 'Navigation' })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    // Regression: a render-time crash falls through to Next's route
    // error.tsx ("SUBSYSTEM FAULT") or a blank document — a purely
    // network-level failure, handled in component state, must not.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);
    await expect(page.getByText('SUBSYSTEM FAULT')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// No horizontal overflow
// ---------------------------------------------------------------------------

test.describe('No horizontal overflow', () => {
  const viewports = [
    { name: 'mobile 390x844', width: 390, height: 844 },
    { name: 'desktop 1440x900', width: 1440, height: 900 },
  ] as const;

  for (const route of ROUTES) {
    for (const vp of viewports) {
      test(`${route} never overflows horizontally at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route);
        await expect(page.getByRole('main')).toBeVisible();
        await assertNoHorizontalOverflow(page);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Accessibility smoke
// ---------------------------------------------------------------------------

test.describe('Accessibility smoke', () => {
  for (const route of ROUTES) {
    test(`${route} has exactly one h1 and no skipped heading levels`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

      const headings = await page.getByRole('heading').all();
      const levels = await Promise.all(
        headings.map((h) => h.evaluate((el) => Number(el.tagName.slice(1)))),
      );
      for (let i = 1; i < levels.length; i++) {
        // Regression: a jump like h1 -> h3 (skipping h2) breaks screen-reader
        // document-outline navigation even though it looks fine visually.
        expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
      }
    });

    test(`${route} gives every button and link an accessible name`, async ({ page }) => {
      await page.goto(route);
      const controls = [...(await page.getByRole('button').all()), ...(await page.getByRole('link').all())];
      expect(controls.length).toBeGreaterThan(0);
      for (const el of controls) {
        const name = await el.evaluate(
          (node) =>
            node.getAttribute('aria-label')?.trim() ||
            node.textContent?.trim() ||
            node.getAttribute('title')?.trim() ||
            '',
        );
        // Regression: an icon-only button/link with no aria-label reads as
        // "button" with no name to a screen reader.
        expect(name).not.toBe('');
      }
    });

    test(`${route} shows a visible keyboard focus ring while tabbing`, async ({ page }) => {
      await page.goto(route);
      await page.keyboard.press('Tab'); // "Skip to content"
      await page.keyboard.press('Tab'); // first real interactive control
      const boxShadow = await page.evaluate(
        () => window.getComputedStyle(document.activeElement as Element).boxShadow,
      );
      // lib/ui.ts's shared `focusRing` paints an inset cyan ring via
      // Tailwind's focus-visible:ring-2 utility (a box-shadow, not an
      // outline, because the cyber clip-paths clip outside box-shadows).
      // "none" here means a keyboard user can't see where focus is.
      expect(boxShadow).not.toBe('none');
    });
  }
});
