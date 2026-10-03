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

/** Runs `fn` over `items`, at most `limit` at a time, keeping their order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * How `url` answers this page's own client (its context, so a real browser's
 * user agent): HEAD first, GET when HEAD is refused, and a 429 waited out by
 * its Retry-After (capped) up to three times. A network failure is reported
 * by its message rather than thrown, so one dead host is one finding.
 */
async function answerOf(page: Page, url: string): Promise<number | string> {
  const opts = { timeout: COLD_START_TIMEOUT, maxRedirects: 10, failOnStatusCode: false };
  try {
    for (let attempt = 0; ; attempt++) {
      let res = await page.request.head(url, opts);
      if (res.status() >= 400 && res.status() !== 429) res = await page.request.get(url, opts);
      if (res.status() !== 429 || attempt === 3) return res.status();
      const retryAfter = Number(res.headers()["retry-after"]);
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000;
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)));
    }
  } catch (err) {
    return (err as Error).message.split("\n")[0] ?? "request failed";
  }
}

/**
 * The status a real browser tab gets for `url`, for a link the request client
 * was refused on: some sites answer bots differently, and the criterion is
 * whether the link works for a reader.
 */
async function browserAnswerOf(page: Page, url: string): Promise<number | string> {
  const tab = await page.context().newPage();
  try {
    const res = await tab.goto(url, { timeout: COLD_START_TIMEOUT, waitUntil: "commit" });
    return res?.status() ?? "no response";
  } catch (err) {
    return (err as Error).message.split("\n")[0] ?? "navigation failed";
  } finally {
    await tab.close();
  }
}

/** The backend's ecosystem adoption read, which the evidence index links. */
const ADOPTION_URL = "https://orizon-agents-be-stellar.onrender.com/api/ecosystem/adoption";

/**
 * LinkedIn answers 999 ("request denied") to every automated client, headless
 * or not, in all three engines and to curl with a browser's user agent, so a
 * run cannot tell a live profile from a dead one. Only that pair is excused,
 * and each is recorded on the test for the person on the device checklist.
 */
function isBotWalled(url: string, status: number | string): boolean {
  return status === 999 && /(^|\.)linkedin\.com$/.test(new URL(url).hostname);
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

    /**
     * Every distinct link, on this site and off it. An in-page anchor must
     * name an element; any other link must answer below 400, first to the
     * page's own request client and, if refused, to a real browser tab.
     */
    test(`PP-01 every link on ${label} (${path}) answers`, async ({ browser }) => {
      test.setTimeout(COLD_START_TIMEOUT * 10);
      await visit(browser, path, async (page) => {
        const here = new URL(page.url());
        const hrefs = await page
          .locator("a[href]")
          .evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href));
        const urls = hrefs.map((h) => new URL(h)).filter((u) => /^https?:$/.test(u.protocol));
        expect(urls.length, `${path} carries no link`).toBeGreaterThan(0);

        const anchors = new Set(
          urls.filter((u) => u.origin + u.pathname === here.origin + here.pathname && u.hash).map((u) => u.hash.slice(1)),
        );
        for (const id of anchors) {
          await expect(page.locator(`[id="${decodeURIComponent(id)}"]`), `${path} links to #${id}, which names no element`).toHaveCount(1);
        }

        // The adoption read has a test of its own, below: it takes minutes.
        const targets = [...new Set(urls.map((u) => u.href.split("#")[0] as string))].filter(
          (url) => url !== ADOPTION_URL,
        );
        const answers = await mapPool(targets, 4, (url) => answerOf(page, url));
        const refused = targets.filter((_, i) => !(typeof answers[i] === "number" && (answers[i] as number) < 400));
        const broken: string[] = [];
        for (const url of refused) {
          const status = await browserAnswerOf(page, url);
          if (typeof status === "number" && status < 400) continue;
          if (isBotWalled(url, status)) {
            test.info().annotations.push({
              type: "bot-walled link",
              description: `${url} → ${status}: refuses every automated client, so a person checks it (6.11 device checklist)`,
            });
            continue;
          }
          broken.push(`${url} → ${status}`);
        }
        expect(broken, `${path}: links that do not answer, to a client or to a browser`).toEqual([]);
      });
    });

    /**
     * A link that opens a new tab says so in its accessible name, in the
     * site's own words ("(opens in a new tab)", as on /demo's explorer links).
     * "(opens GitHub)" says where a link goes, not that it leaves this tab.
     */
    test(`PP-01 every new-tab link on ${label} (${path}) says it opens a new tab`, async ({ browser }) => {
      // D-09x (pending id): the shared site footer's new-tab links (ERC-8004,
      // x402, Contracts, Docs, API, Status, Changelog, GitHub, LinkedIn) say
      // nothing of the new tab on every page, and the evidence and litepaper
      // links say "(opens GitHub)" / "(opens Stellar Expert)" instead.
      test.fail(true, "D-09x (pending id): new-tab links that do not say so");
      test.setTimeout(COLD_START_TIMEOUT * 2);
      await visit(browser, path, async (page) => {
        const names = await page.locator("a[target=_blank]").evaluateAll((links) =>
          links.map((a) => {
            const byIds = a
              .getAttribute("aria-labelledby")
              ?.split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ");
            const name = a.getAttribute("aria-label") ?? byIds ?? a.textContent ?? "";
            return { name: name.replace(/\s+/g, " ").trim(), href: a.getAttribute("href") ?? "" };
          }),
        );
        expect(names.length, `${path} has no new-tab link`).toBeGreaterThan(0);
        const unnamed = names.filter((l) => !/opens in a new tab/i.test(l.name)).map((l) => `${l.name.slice(0, 70)} → ${l.href}`);
        expect(unnamed, `${path}: new-tab links whose name does not say so`).toEqual([]);
      });
    });
  }

  /**
   * D-09x (pending id): the evidence index links the backend's adoption read,
   * and on a warm service (/health answering in under 2 s) a GET to it took
   * 223 s and 252 s, or had not answered at 280 s, in six tries on
   * 2026-10-03. A link a reader waits minutes on does not work; 30 s is
   * already generous for one JSON read.
   */
  test("PP-01 the evidence index's adoption link answers within 30 s", async ({ browser }) => {
    test.fail(true, "D-09x (pending id): /api/ecosystem/adoption takes minutes to answer");
    test.setTimeout(COLD_START_TIMEOUT + 60_000);
    await visit(browser, "/evidence", async (page) => {
      await expect(page.locator(`a[href="${ADOPTION_URL}"]`).first(), "the evidence index no longer links the adoption read").toBeAttached();
      const res = await page.request.get(ADOPTION_URL, { timeout: 30_000, failOnStatusCode: false });
      expect(res.status()).toBe(200);
    });
  });
});

/** What a reader gets from a page's `main`: its outline, its words, its links. */
type Reading = { headings: string[]; textLength: number; hrefs: string[] };

async function readingOf(browser: Browser, path: string, javaScriptEnabled: boolean): Promise<Reading> {
  let reading: Reading = { headings: [], textLength: 0, hrefs: [] };
  await visit(
    browser,
    path,
    async (page) => {
      reading = await page.locator("main").evaluate((main) => ({
        headings: Array.from(main.querySelectorAll("h1,h2,h3")).map(
          (h) => `${h.tagName}: ${(h.textContent ?? "").replace(/\s+/g, " ").trim()}`,
        ),
        textLength: (main as HTMLElement).innerText.length,
        hrefs: [...new Set(Array.from(main.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href))].sort(),
      }));
    },
    { javaScriptEnabled },
  );
  return reading;
}

test.describe("PP-02 each public page reads in full with JavaScript off and no wallet", () => {
  for (const { path, label } of PAGES) {
    /**
     * The page as served is the page: with no script at all, the same
     * headings in the same order, the same links, and the same text within
     * 2% (the guide's copy buttons, which need script to copy, are the only
     * part allowed to differ, and they are a few words).
     */
    test(`PP-02 ${label} (${path}) with JavaScript off has the same headings, links and text`, async ({
      browser,
    }) => {
      test.setTimeout(COLD_START_TIMEOUT * 3);
      const withScript = await readingOf(browser, path, true);
      const without = await readingOf(browser, path, false);
      expect(withScript.headings.length, `${path} has no heading in main`).toBeGreaterThan(0);
      expect(without.headings, `${path}: the outline differs with JavaScript off`).toEqual(withScript.headings);
      expect(without.hrefs, `${path}: the links differ with JavaScript off`).toEqual(withScript.hrefs);
      const drift = Math.abs(without.textLength - withScript.textLength) / withScript.textLength;
      expect(drift, `${path}: main text ${without.textLength} chars without script, ${withScript.textLength} with`).toBeLessThanOrEqual(0.02);
    });
  }
});

test.describe("PP-05 /demo states its state honestly, and plays with no account", () => {
  /**
   * Published since 2026-10-03, so the honest state is "published": one
   * player per part, each started from the keyboard alone, each swapping its
   * poster for the privacy-enhanced embed. The embed's own request is
   * aborted (see YOUTUBE_EMBED); the frame and its address are what the site
   * controls.
   */
  test("PP-05 /demo is published, and each part's Play button starts its video from the keyboard", async ({
    browser,
  }) => {
    test.setTimeout(COLD_START_TIMEOUT * 2);
    await visit(browser, "/demo", async (page) => {
      await expect(page.locator('[data-demo="published"]')).toHaveCount(1);
      const parts = await page.getByRole("heading", { level: 2, name: /^Part \d+:/ }).count();
      expect(parts, "/demo shows no part").toBeGreaterThan(0);
      const players = page.locator("[data-demo-player]");
      await expect(players).toHaveCount(parts);
      for (let i = 0; i < parts; i++) {
        const player = players.nth(i);
        const play = player.getByRole("button", { name: /^Play video: .+ \(\d+ min(?: \d+ s)?\)$/ });
        await expect(play, `part ${i + 1} has no named Play button`).toBeVisible();
        await play.focus();
        await page.keyboard.press("Enter");
        await expect(player).toHaveAttribute("data-demo-player", "embed");
        await expect(player.locator("iframe")).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}\b/);
      }
    });
  });
});
