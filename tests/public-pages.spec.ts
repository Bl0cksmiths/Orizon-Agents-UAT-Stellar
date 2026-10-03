import { test, expect, devices, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
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

  /**
   * With no script there is no player, so the page must still hand over
   * everything: a named link to each part on YouTube, and, for each
   * deliverable the evidence table names, its transaction to open on the
   * testnet explorer, with the words that say that is how to check it.
   */
  test("PP-05 /demo with JavaScript off links each part's video and says how to verify each deliverable", async ({
    browser,
  }) => {
    test.setTimeout(COLD_START_TIMEOUT * 2);
    await visit(
      browser,
      "/demo",
      async (page) => {
        await expect(page.locator('[data-demo="published"]')).toHaveCount(1);
        const parts = await page.getByRole("heading", { level: 2, name: /^Part \d+:/ }).count();
        expect(parts, "/demo shows no part").toBeGreaterThan(0);
        for (let n = 1; n <= parts; n++) {
          await expect(page.getByRole("link", { name: `Watch part ${n} on YouTube`, exact: true })).toHaveAttribute(
            "href",
            /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/,
          );
        }
        const evidence = page.locator("section", { has: page.getByRole("heading", { level: 2, name: "On-chain evidence" }) });
        await expect(evidence).toContainText(/open one to check it yourself/i);
        const rows = evidence.locator("tbody tr");
        expect(await rows.count(), "the evidence table is empty").toBeGreaterThan(0);
        for (const row of await rows.all()) {
          await expect(row.getByRole("cell", { name: /^D\d+$/ })).toHaveCount(1);
          await expect(row.getByRole("link", { name: /on Stellar Expert/ })).toHaveAttribute(
            "href",
            /^https:\/\/stellar\.expert\/explorer\/testnet\/tx\/[0-9a-f]{64}$/,
          );
        }
      },
      { javaScriptEnabled: false },
    );
  });
});

test.describe("PP-06 /evidence printed to PDF", () => {
  /**
   * The site's chrome outside the article (the header with its navs, the
   * footer, the skip link) takes no visible space on paper: under print
   * media nothing of it is laid out larger than a pixel (the skip link is
   * already clipped to one on screen until it is focused, so on screen only
   * its presence is checked). Every link printing its URL is RV-06's
   * (evidence-reverify.spec.ts).
   */
  test("PP-06 the header, navigation, footer and skip link are not shown in print", async ({ browser }) => {
    test.setTimeout(COLD_START_TIMEOUT * 2);
    await visit(browser, "/evidence", async (page) => {
      const chrome = () =>
        page.evaluate(() => {
          const outsideMain = (sel: string) => Array.from(document.querySelectorAll(sel)).filter((el) => !el.closest("main"));
          const parts: Record<string, Element[]> = {
            header: outsideMain("header"),
            nav: outsideMain("nav"),
            footer: outsideMain("footer"),
            "skip link": Array.from(document.querySelectorAll('a[href="#main"]')),
          };
          return Object.entries(parts).map(([part, els]) => ({
            part,
            count: els.length,
            shown: els.filter((el) => Array.from(el.getClientRects()).some((r) => r.width > 1 && r.height > 1)).length,
          }));
        });
      // Below lg the navigation sits behind "Open menu": opened, it is on
      // screen, so the print check below has something to hide.
      const menu = page.getByRole("button", { name: "Open menu" });
      if (await menu.isVisible()) await menu.click();
      for (const { part, count, shown } of await chrome()) {
        expect(count, `/evidence has no ${part} to hide`).toBeGreaterThan(0);
        if (part !== "skip link") expect(shown, `the ${part} is not shown on screen`).toBeGreaterThan(0);
      }
      await page.emulateMedia({ media: "print" });
      for (const { part, shown } of await chrome()) {
        expect(shown, `the ${part} is still shown in print`).toBe(0);
      }
    });
  });
});

test.describe("PP-07 each public page can be navigated by landmarks and headings", () => {
  for (const { path, label } of PAGES) {
    /**
     * What a screen reader's landmark and heading lists are built from, as
     * the engine's own accessibility tree reports it: one main, one banner,
     * one contentinfo; every section, nav and aside named, so a landmark list
     * does not read "region, region, navigation"; and every h2 on the page
     * present in the tree under its own words. Listening to it is the
     * device checklist's half of PP-07.
     */
    test(`PP-07 ${label} (${path}) has named landmarks and every h2 in the accessibility tree`, async ({ browser }) => {
      test.setTimeout(COLD_START_TIMEOUT * 2);
      await visit(browser, path, async (page) => {
        await expect(page.getByRole("main")).toHaveCount(1);
        await expect(page.getByRole("banner")).toHaveCount(1);
        await expect(page.getByRole("contentinfo")).toHaveCount(1);

        const unnamed = await page
          .locator("section:not([role]), nav:not([role]), aside:not([role]), [role=region], [role=navigation], [role=complementary]")
          .evaluateAll((els) =>
            els
              .filter((el) => {
                const byIds = (el.getAttribute("aria-labelledby") ?? "")
                  .split(/\s+/)
                  .map((id) => document.getElementById(id)?.textContent ?? "")
                  .join(" ");
                return !(el.getAttribute("aria-label") ?? byIds).trim();
              })
              .map((el) => `<${el.tagName.toLowerCase()} class="${el.className}">`),
          );
        expect(unnamed, `${path}: sections, navs and asides with no name`).toEqual([]);

        const h2s = await page
          .locator("h2")
          .evaluateAll((hs) => hs.filter((h) => h.checkVisibility()).map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim()));
        expect(h2s.length, `${path} has no h2`).toBeGreaterThan(0);
        const inTree = page.getByRole("heading", { level: 2 });
        await expect(inTree).toHaveCount(h2s.length);
        for (const [i, text] of h2s.entries()) await expect(inTree.nth(i)).toHaveAccessibleName(text);
      });
    });
  }
});

test.describe("PP-08 a long agent name does not break mid-word at 390 px", () => {
  /**
   * Frontend 08cb8066 capped the agent cell at 18rem and let a name wrap
   * inside it (`overflow-wrap: anywhere` on the name), and 0db4b8bf took
   * `break-all` off the status badge for `overflow-wrap: break-word` (frontend
   * origin/main app/app/agents/page.tsx). Re-checked on the live registry at
   * a phone's 390 px, the iPhone 13 profile where the engine takes it: no
   * word that fits its cell is split across lines, in any agent's name or
   * status, and the longest name stays inside its cell and its row. The
   * names are read at run time and never written down: most belong to
   * outside operators.
   */
  test("PP-08 /app/agents at 390 px: names and status badges wrap between words, and the longest name fits its row", async ({
    browser,
    browserName,
  }) => {
    test.setTimeout(COLD_START_TIMEOUT * 3);
    // Firefox has no mobile emulation (`isMobile`), so it gets the width alone.
    const phone = browserName === "firefox" ? { viewport: devices["iPhone 13"].viewport } : devices["iPhone 13"];
    await visit(
      browser,
      "/app/agents",
      async (page) => {
        const table = page.getByRole("table", { name: /^Agent registry/ });
        await expect(table.locator("tbody th[scope=row]").first()).toBeVisible({ timeout: COLD_START_TIMEOUT });
        await expectNoHorizontalOverflow(page);
        const report = await table.evaluate((t) => {
          const statusCol = Array.from(t.querySelectorAll("thead th")).findIndex(
            (th) => (th.textContent ?? "").trim().toLowerCase() === "status",
          );
          const probe = document.createElement("span");
          probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
          document.body.append(probe);
          /** How wide `word` sets on one line in `like`'s font. */
          const widthOf = (word: string, like: Element): number => {
            const s = getComputedStyle(like);
            probe.style.font = s.font;
            probe.style.letterSpacing = s.letterSpacing;
            probe.style.textTransform = s.textTransform;
            probe.textContent = word;
            return probe.getBoundingClientRect().width;
          };
          /**
           * Words in `el` laid over two lines although `room` px would hold
           * them. A hyphen ends a word for this count: the line may break
           * after it, as "(non-" / "executing)", which is not mid-word.
           */
          const splitWords = (el: Element, room: number): number => {
            let split = 0;
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (node.parentElement?.closest(".sr-only")) continue;
              for (const m of (node.textContent ?? "").matchAll(/[^\s\-\u2010]+[\-\u2010]*/g)) {
                const range = document.createRange();
                range.setStart(node, m.index);
                range.setEnd(node, m.index + m[0].length);
                const lines = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
                if (lines.size > 1 && widthOf(m[0], node.parentElement as Element) <= room) split++;
              }
            }
            return split;
          };
          const contentWidth = (el: Element): number => {
            const s = getComputedStyle(el);
            return el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
          };
          const rows = Array.from(t.querySelectorAll("tbody tr")).filter((tr) => tr.querySelector("th[scope=row] span[id]"));
          const out = { rows: rows.length, statusCol, styles: [] as string[], splitNames: [] as number[], splitBadges: [] as number[], longest: { row: -1, chars: 0, overflow: 0, outsideRow: 0 } };
          rows.forEach((tr, i) => {
            const name = tr.querySelector("th[scope=row] span[id]") as HTMLElement;
            const badge = tr.children[statusCol]?.querySelector("span") as HTMLElement | null;
            for (const [what, el, wrap] of [["name", name, "anywhere"], ["badge", badge, "break-word"]] as const) {
              if (!el) { out.styles.push(`row ${i}: no ${what}`); continue; }
              const s = getComputedStyle(el);
              if (s.wordBreak === "break-all" || s.overflowWrap !== wrap) out.styles.push(`row ${i} ${what}: word-break ${s.wordBreak}, overflow-wrap ${s.overflowWrap}`);
            }
            if (splitWords(name, contentWidth(name.parentElement as Element)) > 0) out.splitNames.push(i);
            if (badge && splitWords(badge, contentWidth(badge)) > 0) out.splitBadges.push(i);
            const chars = Array.from(name.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim().length;
            if (chars > out.longest.chars) {
              const cell = name.closest("th") as HTMLElement;
              out.longest = {
                row: i,
                chars,
                overflow: Math.max(cell.scrollWidth - cell.clientWidth, name.getBoundingClientRect().right - cell.getBoundingClientRect().right),
                outsideRow: cell.getBoundingClientRect().right - tr.getBoundingClientRect().right,
              };
            }
          });
          probe.remove();
          return out;
        });
        expect(report.rows, "the registry lists no agent").toBeGreaterThan(0);
        expect(report.statusCol, "the registry has no status column").toBeGreaterThan(0);
        expect(report.styles, "name or badge wrapping rules other than the fix's").toEqual([]);
        expect(report.splitNames, "rows whose agent name splits a word that fits its cell").toEqual([]);
        expect(report.splitBadges, "rows whose status badge splits a word that fits it").toEqual([]);
        expect(report.longest.overflow, `the longest name (${report.longest.chars} chars, row ${report.longest.row}) overflows its cell`).toBeLessThanOrEqual(1);
        expect(report.longest.outsideRow, "the longest name's cell runs past its row").toBeLessThanOrEqual(1);
      },
      phone,
    );
  });
});
