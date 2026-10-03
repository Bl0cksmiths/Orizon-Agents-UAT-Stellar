import { test, expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { COLD_START_TIMEOUT, expectHeadingStructure, expectNoHorizontalOverflow } from "./fixtures";

/**
 * Story 6.11, acceptance criteria PP (docs/uat/test-plan.md): the four public
 * Epic 5 pages are reachable by anyone, on every engine and width in the
 * matrix, with no login, no wallet and no JavaScript.
 *
 * What other specs already prove is not repeated here: /demo published and its
 * player loading (public-artifacts.spec.ts, 6.04/6.10), the guide published as
 * a draft (D-088, same file), and every evidence link printing its URL
 * (evidence-reverify.spec.ts, RV-06).
 */
const PAGES = [
  { path: "/guide/list-your-agent", label: "the integration guide" },
  { path: "/demo", label: "the demo" },
  { path: "/litepaper", label: "the litepaper" },
  { path: "/evidence", label: "the evidence index" },
] as const;

/**
 * YouTube's embed streams for as long as its frame lives, which stalls the
 * context's teardown; no test here needs the video itself, only the frame.
 */
const YOUTUBE_EMBED = /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//;

/**
 * Opens `path` in a context of its own, with nothing carried in (no cookies,
 * no stored origins: no session and no wallet), and closes it whatever
 * happens, because the machine running this suite has little memory to spare.
 */
async function visit(
  browser: Browser,
  path: string,
  body: (page: Page) => Promise<void>,
  options: BrowserContextOptions = {},
): Promise<void> {
  const context = await browser.newContext(options);
  try {
    const state = await context.storageState();
    expect(state.cookies, "the fresh context carries cookies").toEqual([]);
    expect(state.origins, "the fresh context carries stored origin data").toEqual([]);
    await context.route(YOUTUBE_EMBED, (route) => route.abort());
    const page = await context.newPage();
    const res = await page.goto(path, { timeout: COLD_START_TIMEOUT });
    expect(res?.status(), `${path} did not answer 200`).toBe(200);
    await body(page);
  } finally {
    await context.close();
  }
}

/**
 * Font sizes of the body text in `main`: paragraphs of prose, at least eight
 * words. Shorter paragraphs here are labels set small on purpose (the
 * "Operator guide" eyebrow, a callout's "Note", an evidence item's id).
 */
async function bodyFontSizes(page: Page): Promise<{ text: string; px: number }[]> {
  return page.locator("main p").evaluateAll((ps) =>
    ps
      .map((p) => ({ text: (p.textContent ?? "").trim(), px: parseFloat(getComputedStyle(p).fontSize) }))
      .filter((p) => p.text.split(/\s+/).length >= 8),
  );
}

test.describe("PP-01 each public page renders fully, with no session", () => {
  for (const { path, label } of PAGES) {
    test(`PP-01 ${label} (${path}) loads, does not scroll sideways, and reads at a legible size`, async ({
      browser,
    }) => {
      await visit(browser, path, async (page) => {
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectHeadingStructure(page);
        const body = await bodyFontSizes(page);
        expect(body.length, `${path} has no paragraph of body text`).toBeGreaterThan(0);
        const small = body.filter((p) => p.px < 12).map((p) => `${p.px}px: ${p.text.slice(0, 60)}`);
        expect(small, `${path} sets body text below 12px`).toEqual([]);
      });
    });
  }
});
