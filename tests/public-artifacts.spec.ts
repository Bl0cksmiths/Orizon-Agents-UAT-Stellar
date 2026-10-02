import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { COLD_START_TIMEOUT, collectConsoleErrors } from "./fixtures";

/**
 * OV-05 (story 6.04) — the public artifacts a reviewer is sent to, the
 * registration page, the integration guide and the demo video, are each
 * reachable by someone with no wallet and no session.
 *
 * Every test opens its own browser context with no storage state, which is
 * what a private window is: no cookies, no localStorage, and no wallet
 * extension (the suite's Chromium has none installed). The context is created
 * here rather than taken from the `page` fixture so the "nothing carried in"
 * premise is asserted, not assumed.
 *
 * Paths and markup are read from the deployed frontend's source (frontend
 * origin/main 0c8a10b7):
 *   - app/app/register/page.tsx               (registration form)
 *   - app/(marketing)/guide/page.tsx          (guide index)
 *   - app/(marketing)/guide/[slug]/page.tsx   (guide article)
 *   - app/(marketing)/demo/page.tsx           (demo page, content/demo/demo.json)
 */

/** Opens a context with nothing in it and proves it: no cookies, no origins. */
async function openFreshContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  const state = await context.storageState();
  expect(state.cookies, "the fresh context carries cookies").toEqual([]);
  expect(state.origins, "the fresh context carries stored origin data").toEqual([]);
  return context;
}

/**
 * Navigates a fresh page to `path`, asserts a 200 and no console error, and
 * hands the page to `body` for the artifact's own checks. The context is
 * closed whatever happens, because the machine running this suite has little
 * memory to spare.
 */
async function visitFresh(
  browser: Browser,
  path: string,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await openFreshContext(browser);
  try {
    const page = await context.newPage();
    const errors = collectConsoleErrors(page);
    const res = await page.goto(path, { timeout: COLD_START_TIMEOUT });
    expect(res?.status(), `${path} did not answer 200`).toBe(200);

    await body(page);

    await page.waitForLoadState("networkidle", { timeout: COLD_START_TIMEOUT });
    expect(
      errors.getConsoleErrors(),
      JSON.stringify(errors.getConsoleErrors(), null, 2),
    ).toEqual([]);
  } finally {
    await context.close();
  }
}

test.describe("OV-05 the registration page, with no wallet and no session", () => {
  /**
   * Registering signs a transaction, so the submit control rightly waits for
   * a wallet. What must not wait for one is the page itself: a visitor reads
   * what registration asks for, and fills it in, before connecting anything.
   */
  test("OV-05 /app/register renders its form, and asks for a wallet only to sign", async ({
    browser,
  }) => {
    await visitFresh(browser, "/app/register", async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Register an Agent" }),
      ).toBeVisible();
      for (const field of ["agent id", "display name", "skills", "price per step (XLM)"]) {
        await expect(
          page.getByRole("textbox", { name: field, exact: true }),
          `the "${field}" field is walled off without a wallet`,
        ).toBeEditable();
      }
      // The one thing a wallet is needed for, and the page says so.
      await expect(
        page.getByRole("button", { name: "Register agent ▸" }),
      ).toBeDisabled();
      await expect(page.getByText("connect a wallet to register")).toBeVisible();
    });
  });
});

/** Where the integration guide SOW milestone m09 names is served. */
const GUIDE_PATH = "/guide/list-your-agent";
const GUIDE_TITLE = "List your agent on Orizon";

test.describe("OV-05 the integration guide, with no wallet and no session", () => {
  test("OV-05 /guide lists the integration guide and links to it", async ({
    browser,
  }) => {
    await visitFresh(browser, "/guide", async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Operator guides" }),
      ).toBeVisible();
      await expect(page.getByText("No guides are published yet.")).toHaveCount(0);
      const entry = page.getByRole("link", { name: new RegExp(GUIDE_TITLE) });
      await expect(entry, "the guide index does not list the integration guide").toBeVisible();
      await expect(entry).toHaveAttribute("href", GUIDE_PATH);
    });
  });

  /**
   * The guide's nine steps, in order, as the article's own headings. Content
   * a visitor can read end to end, not a teaser behind a connect prompt.
   */
  test("OV-05 the integration guide renders all nine steps, with no wallet wall", async ({
    browser,
  }) => {
    await visitFresh(browser, GUIDE_PATH, async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: GUIDE_TITLE }),
      ).toBeVisible();
      const steps = page.getByRole("heading", { level: 2, name: /^Step \d+:/ });
      await expect(steps).toHaveCount(9);
      const titles = await steps.allTextContents();
      expect(titles.map((t) => Number(/^Step (\d+):/.exec(t)?.[1]))).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
      // The site nav carries a Connect Wallet control on every page; what
      // must not carry one is the article a reader came for.
      await expect(
        page.getByRole("main").getByRole("button", { name: /connect wallet/i }),
        "the guide puts a wallet prompt in front of someone who only came to read",
      ).toHaveCount(0);
    });
  });

  /**
   * Every internal link on both guide pages resolves: each same-origin page
   * answers below 400 to a client with no session, and each in-page anchor
   * names an element that exists. External links (GitHub, Stellar Expert,
   * friendbot) are not this site's to keep and are left out.
   */
  for (const path of ["/guide", GUIDE_PATH]) {
    test(`OV-05 every internal link on ${path} resolves`, async ({ browser }) => {
      test.setTimeout(COLD_START_TIMEOUT * 3);
      await visitFresh(browser, path, async (page) => {
        const origin = new URL(page.url()).origin;
        const hrefs = await page
          .locator("a[href]")
          .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href));
        const internal = hrefs.map((h) => new URL(h)).filter((u) => u.origin === origin);
        expect(internal.length, `${path} carries no internal link at all`).toBeGreaterThan(0);

        const here = new URL(page.url()).pathname;
        const anchors = new Set(
          internal.filter((u) => u.pathname === here && u.hash).map((u) => u.hash.slice(1)),
        );
        for (const id of anchors) {
          await expect(
            page.locator(`[id="${decodeURIComponent(id)}"]`),
            `${path} links to #${id}, which names no element`,
          ).toHaveCount(1);
        }

        const pages = new Set(internal.map((u) => u.pathname));
        const broken: string[] = [];
        for (const target of pages) {
          const res = await page.request.get(target, { timeout: COLD_START_TIMEOUT });
          if (res.status() >= 400) broken.push(`${target} → ${res.status()}`);
        }
        expect(broken, `${path} links to pages that do not resolve`).toEqual([]);
      });
    });
  }
});

/**
 * SOW milestone m10 wants a "3–5 min demo video published". The page that
 * would carry it is /demo, built from content/demo/demo.json at frontend
 * 0c8a10b7, whose manifest reads `"status": "unpublished"`, `"video": null`.
 */
const DEMO_PATH = "/demo";
const UNPUBLISHED_NOTICE =
  "The demo video has not been recorded yet. It will show only real testnet transactions. Until then, here is how to verify each deliverable yourself.";

test.describe("OV-05 the demo video, with no wallet and no session", () => {
  /**
   * What is there today: the page is public and says plainly that there is
   * no video yet, and offers the deliverables to verify instead. It does not
   * stage one. If a video is published this test fails on the notice, and
   * the pinned test below starts passing.
   */
  test("OV-05 /demo is public and says honestly that no video is recorded yet", async ({
    browser,
  }) => {
    await visitFresh(browser, DEMO_PATH, async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Orizon Agents, end to end" }),
      ).toBeVisible();
      await expect(page.locator('[data-demo="unpublished"]')).toHaveCount(1);
      await expect(page.getByRole("note").filter({ hasText: UNPUBLISHED_NOTICE })).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: "Verify each deliverable yourself" }),
      ).toBeVisible();
      await expect(page.locator("main video, main iframe")).toHaveCount(0);
    });
  });

  /**
   * OV-05 asks for the demo video to be reachable, and there is no video to
   * reach (D-NEW-PUB-1). The published player (components/demo/demo-player.tsx)
   * embeds the video in an iframe, so that is what a reachable video looks
   * like on this page.
   *
   * Marked `test.fail()`: the gap is real and is not this suite's to close.
   * When the video is published this passes unexpectedly, which is the signal
   * to drop the marker.
   */
  test("OV-05 the demo video is published on /demo and its player is on the page", async ({
    browser,
  }) => {
    test.fail();
    await visitFresh(browser, DEMO_PATH, async (page) => {
      await expect(page.locator('[data-demo="published"]')).toHaveCount(1);
      await expect(page.locator("main iframe, main video").first()).toBeVisible();
    });
  });
});
