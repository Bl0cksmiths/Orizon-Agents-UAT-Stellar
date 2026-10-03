import { test, expect, type Page } from "@playwright/test";

/**
 * Story 6.10, RV-02, RV-03 and RV-06: the public evidence index re-verified
 * after the escrow v2 changes, judged for honesty from the live /evidence
 * page and the sources it names, never from a copy of its index.
 *
 * Consent: outside operators' agent ids, wallets and hashes never appear in a
 * title or a message here. Findings name the item or metric id and a count,
 * and team keys by their role or the page's own short form.
 */

const EVIDENCE = "/evidence";

/** The article the index renders into; nav and footer sit outside it. */
const ARTICLE = "[data-evidence-page]";

/** Where the site's own pages print their full address from (FE lib/guide/display SITE_URL). */
const SITE_URL = "https://orizons.xyz";

type PrintedLink = { href: string; printed: string; lineShown: boolean; anchorShown: boolean };

/**
 * Every link in the evidence article that leaves the spot it is on (in-page
 * "#" anchors excluded), each with the text of the `[data-print-url]` line the
 * markup puts after it, and whether each is laid out under the current media
 * (innerText cannot tell: it falls back to textContent on an unrendered node).
 */
async function printedLinks(page: Page): Promise<PrintedLink[]> {
  return page.locator(ARTICLE).evaluate((article) => {
    const anchors = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]")).filter(
      (a) => !a.getAttribute("href")!.startsWith("#"),
    );
    return anchors.map((a) => {
      let next = a.nextElementSibling;
      while (next && !next.matches("[data-print-url]") && !next.matches("a")) next = next.nextElementSibling;
      const line = next?.matches("[data-print-url]") ? (next as HTMLElement) : null;
      const laidOut = (el: Element): boolean => {
        const box = el.getBoundingClientRect();
        return getComputedStyle(el).display !== "none" && box.width > 0 && box.height > 0;
      };
      return {
        href: a.getAttribute("href")!,
        printed: line?.textContent?.trim() ?? "",
        lineShown: line ? laidOut(line) : false,
        anchorShown: laidOut(a),
      };
    });
  });
}

/** The URL a reader must see on paper for a link: its own address, made absolute for the site's pages. */
function expectedOnPaper(href: string): string {
  return href.startsWith("/") ? `${SITE_URL}${href}` : href;
}

/**
 * The links that fail a check, by position and host only: a link's path can
 * hold an outside operator's wallet or hash, which a message must not repeat.
 */
function failing(links: PrintedLink[], ok: (l: PrintedLink) => boolean): string[] {
  return links.flatMap((l, i) => (ok(l) ? [] : [`link ${i + 1} on ${new URL(l.href, SITE_URL).host}`]));
}

test.describe("RV-06 the evidence index printed to PDF", () => {
  test.beforeEach(async ({ page }) => {
    // The page is static and server-rendered: the article is complete at
    // DOMContentLoaded, so the test does not wait on fonts and script chunks.
    await page.goto(EVIDENCE, { waitUntil: "domcontentloaded" });
    await expect(page.locator(ARTICLE)).toBeVisible();
  });

  test("RV-06 every link in the index prints its full URL, and only on paper", async ({ page }) => {
    // The proof is the print stylesheet as the engine applies it: each link's
    // URL line is laid out under print media and hidden on screen. page.pdf()
    // is not used: its text is in compressed streams that cannot be asserted
    // on without a PDF library, and it exists in Chromium only, while this
    // check runs in every engine.
    const onScreen = await printedLinks(page);
    expect(onScreen.length, "the index links its proof").toBeGreaterThan(100);
    expect(failing(onScreen, (l) => !l.lineShown), "URL lines are hidden on screen").toEqual([]);

    await page.emulateMedia({ media: "print" });
    const onPaper = await printedLinks(page);
    expect(onPaper).toHaveLength(onScreen.length);
    expect(failing(onPaper, (l) => l.anchorShown), "every link in the article is on paper").toEqual([]);
    expect(failing(onPaper, (l) => l.printed === expectedOnPaper(l.href)), "each prints its own URL").toEqual([]);
    const printed = onPaper.filter((l) => l.lineShown && /^https?:\/\/\S+$/.test(l.printed));
    expect(printed.length, "printed URL lines equal the number of links").toBe(onPaper.length);
  });
});
