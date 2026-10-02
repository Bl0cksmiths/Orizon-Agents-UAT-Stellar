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
});
