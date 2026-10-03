import { test, expect, type Page } from "@playwright/test";
import { ADMIN, CONTRACT_FACTS, ESCROW_V2, PLATFORM } from "../tools/onchain-verify/facts.ts";

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

/** A key as the page shortens it in prose: its first five and last four characters. */
function short(account: string): string {
  return `${account.slice(0, 5)}…${account.slice(-4)}`;
}

/** The page's own words for one disclosure, title, text and what changed since the SOW, in one string. */
async function disclosure(page: Page, id: string): Promise<string> {
  const item = page.locator(`section[aria-labelledby="disclosures"] [data-disclosure="${id}"]`);
  await expect(item, `disclosure ${id} is in the Disclosures section`).toHaveCount(1);
  return (await item.innerText()).replace(/\s+/g, " ");
}

test.describe("RV-03 the Disclosures section states each limit in plain words", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(EVIDENCE, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: "Disclosures" })).toBeVisible();
  });

  test("RV-03 testnet-only scope: built and validated on testnet, no mainnet funds at risk", async ({ page }) => {
    const text = await disclosure(page, "testnet");
    expect(text).toMatch(/^Testnet only\b/);
    expect(text).toMatch(/built and validated on Stellar testnet/);
    expect(text).toMatch(/no mainnet funds are at risk/);
    expect(text).toMatch(/Every Stellar Expert link in this index points at the testnet explorer/);
    // The claim holds on the page itself: no explorer link leaves testnet.
    const explorer = await page
      .locator(`${ARTICLE} a[href*="stellar.expert/explorer/"]`)
      .evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
    expect(explorer.length).toBeGreaterThan(0);
    expect(explorer.filter((href) => !href.includes("/explorer/testnet/")).length, "explorer links off testnet").toBe(0);
  });

  test("RV-03 refunds are credits paid from the platform's own funds, not the operator's or the escrow's", async ({ page }) => {
    const text = await disclosure(page, "platform_credits");
    expect(text).toMatch(/^Refunds are credits paid from the platform's own funds/);
    expect(text).toMatch(/the platform sends the buyer a credit from its own balance/);
    expect(text).toMatch(/not taken back from the agent's owner/);
    expect(text).toMatch(/not drawn from the buyer's authorization/);
    // It names the key that pays, as the page shortens it.
    expect(text).toContain(`${short(PLATFORM)}) pays dispute credits`);
  });

  test("RV-03 the binding of an agent to its server address is off-chain, in Orizon's database", async ({ page }) => {
    const text = await disclosure(page, "offchain_binding");
    expect(text).toMatch(/^An agent's server address is stored off-chain/);
    expect(text).toMatch(/It has no field for the address of the operator's server/);
    expect(text).toMatch(/links that address to their agent in Orizon's database/);
    expect(text).toMatch(/decided by Orizon's database, not by the chain/);
    expect(text).toMatch(/Changed since the SOW: Not in the SOW/);
  });

  test("RV-03 the signing key's roles: each role the platform key holds on-chain is named", async ({ page }) => {
    // The roles the contracts give the platform key (OV-01 reads them from
    // instance storage), each with the words the page must use for it.
    const words: Record<string, RegExp> = {
      Scorer: /writes ratings/,
      Sealer: /seals attestations/,
      Settler: /signs the settlements on escrow v2/,
    };
    const held = [...CONTRACT_FACTS].flatMap(([contract, roles]) =>
      Object.entries(roles).flatMap(([role, holder]) => (holder === PLATFORM ? [{ contract, role }] : [])),
    );
    expect(held.map((h) => h.role).sort()).toEqual(Object.keys(words).sort());
    expect(held.find((h) => h.role === "Settler")?.contract).toBe(ESCROW_V2);
    const credits = await disclosure(page, "platform_credits");
    for (const { role } of held) expect(credits, `the ${role} role`).toMatch(words[role]!);
    expect(credits).toContain(`The v1 escrow's settler was the admin key (${short(ADMIN)})`);
    const settler = await disclosure(page, "single_settler_key");
    expect(settler).toMatch(/one team-held key releases payments, with no multi-signature or threshold control/);
    expect(settler).toContain(`the rating (scorer) and sealing (sealer) roles moved from the admin wallet ${short(ADMIN)} to a separate production key, ${short(PLATFORM)}`);
    expect(settler).toContain(`the production key ${short(PLATFORM)} signs the settlements`);
    expect(settler).toMatch(/Both keys are held by the team/);
  });

  test("RV-03 the m03 removal is a line of its own in the Disclosures, and m03 has no metrics row", async ({ page }) => {
    const line = page.locator('section[aria-labelledby="disclosures"] [data-removed-metric="m03"]');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(
      "SOW §6.3 metric m03 (Workflows routed to external agents & settled on Testnet, target ≥ 3) was removed from the sprint’s requirements on September 30, 2026.",
    );
    await expect(line.locator("time")).toHaveAttribute("datetime", "2026-09-30");
    const metrics = page.locator('section[aria-labelledby="success-metrics"]');
    await expect(metrics.locator("[data-metric-status]")).toHaveCount(10);
    await expect(metrics).not.toContainText("Workflows routed to external agents");
  });
});
