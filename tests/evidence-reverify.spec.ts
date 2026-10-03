import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { ADMIN, BUYER_GB4K6, BUYER_GCNQA, CONTRACT_FACTS, ESCROW_V2, PLATFORM } from "../tools/onchain-verify/facts.ts";
import { observeTx, type GetJson, type ObservedTx } from "../tools/onchain-verify/horizon.ts";

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

/**
 * Whether prose names an account, in full or shortened the page's way: its
 * first five characters, an ellipsis, and any four or more of its last ones.
 */
function names(text: string, account: string): boolean {
  if (text.includes(account)) return true;
  const shortened = new RegExp(`${account.slice(0, 5)}…([A-Z2-7]{4,})`, "g");
  return [...text.matchAll(shortened)].some((m) => account.endsWith(m[1]!));
}

/** The team wallet register, at the address the page links it. */
const REGISTER_URL = "https://github.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/blob/main/app/data/team_wallets.json";

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

  test("RV-03 the m03 removal line says who removed the metric", async ({ page }) => {
    // D-09x (pending id): the index records that m03, the one metric at 0,
    // was removed "by the team lead", but the page renders only the date, in
    // the passive voice, so a reader cannot tell the team dropped its own
    // unmet target on the snapshot day (see also D-078).
    test.fail();
    const line = page.locator('section[aria-labelledby="disclosures"] [data-removed-metric="m03"]');
    await expect(line).toContainText(/removed .* by the team/, { timeout: 5_000 });
  });

  test("RV-03 the team wallets note: the public register, the rule, and the wallets of the escrow v2 runs", async ({ page }) => {
    const note = page.locator('section[aria-labelledby="notes"] [data-note="team_wallets"]');
    await expect(note).toHaveCount(1);
    const text = (await note.innerText()).replace(/\s+/g, " ");
    expect(text).toMatch(/^How an outside operator is told apart from the team/);
    expect(text).toMatch(/public register of every wallet it controls, in the backend repository \(app\/data\/team_wallets\.json\)/);
    expect(text).toMatch(/counts as outside only when its owner is not in that register and holds no platform role/);
    expect(text).toMatch(/The escrow v2 test runs of 2026-09-30 used team wallets only/);
    for (const [role, account] of [["buyer", BUYER_GB4K6], ["buyer", BUYER_GCNQA], ["admin", ADMIN]] as const) {
      expect(names(text, account), `the note names the ${role} ${short(account)}`).toBe(true);
    }
    await expect(page.locator(`${ARTICLE} a[href="${REGISTER_URL}"]`).first(), "the page links the register").toBeVisible();
  });
});

/** Horizon reads through Playwright's request context, body parsed whatever the status. */
const horizon = (request: APIRequestContext): GetJson => async (url) => {
  const res = await request.get(url, { timeout: 30_000 });
  return { status: res.status(), body: await res.json() };
};

/** Every transaction hash the article links on the testnet explorer, once each, in page order. */
async function linkedTxHashes(scope: Locator): Promise<string[]> {
  const hrefs = await scope
    .locator('a[href*="stellar.expert/explorer/testnet/tx/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
  return [...new Set(hrefs.map((href) => /\/tx\/([0-9a-f]{64})$/.exec(href)?.[1] ?? href))];
}

/** Each hash read from Horizon, a few at a time; a hash Horizon does not know is a dead link. */
async function observeAll(get: GetJson, hashes: string[]): Promise<ObservedTx[]> {
  const out: ObservedTx[] = [];
  for (let i = 0; i < hashes.length; i += 6) {
    const batch = await Promise.all(hashes.slice(i, i + 6).map((hash) => observeTx(get, hash)));
    batch.forEach((tx, j) => {
      if (!tx) throw new Error(`linked transaction ${i + j + 1} is not on testnet`);
      out.push(tx);
    });
  }
  return out;
}

/** The register's wallets, read from the raw file behind the address the page links. */
async function teamRegister(request: APIRequestContext): Promise<Map<string, string>> {
  const raw = REGISTER_URL.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/");
  const res = await request.get(raw, { timeout: 30_000 });
  expect(res.status(), "the register the page links answers").toBe(200);
  const body = (await res.json()) as { wallets: { address: string; role: string }[] };
  return new Map(body.wallets.map((w) => [w.address, w.role]));
}

/** Accounts the contracts give a platform role, each with its roles, from the on-chain facts OV-01 checks. */
function platformRoles(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const roles of CONTRACT_FACTS.values()) {
    for (const [role, holder] of Object.entries(roles)) {
      if (typeof holder === "string" && holder.startsWith("G")) out.set(holder, [...(out.get(holder) ?? []), role]);
    }
  }
  return out;
}

const HORIZON_BUDGET = 180_000;

test.describe("RV-03 every team wallet used in a run is disclosed", () => {
  test("RV-03 every account in a linked transaction is in the register, holds a platform role, or is named on the page", async ({ page, request }) => {
    test.setTimeout(HORIZON_BUDGET);
    await page.goto(EVIDENCE, { waitUntil: "domcontentloaded" });
    const article = page.locator(ARTICLE);
    const prose = (await article.innerText()).replace(/\s+/g, " ");
    const hashes = await linkedTxHashes(article);
    expect(hashes.length, "the page links transactions").toBeGreaterThan(40);
    const txs = await observeAll(horizon(request), hashes);
    const register = await teamRegister(request);
    const roles = platformRoles();

    const accounts = new Set<string>();
    for (const tx of txs) {
      accounts.add(tx.source);
      for (const op of tx.ops) {
        accounts.add(op.source);
        for (const t of op.transfers) for (const a of [t.from, t.to]) if (a.startsWith("G")) accounts.add(a);
      }
    }
    const team = [...accounts].filter((a) => register.has(a) || roles.has(a));
    test.info().annotations.push({
      type: "RV-03 accounts",
      description: `${accounts.size} accounts in ${txs.length} linked transactions, ${team.length} of them team or platform keys`,
    });
    const undisclosedTeam = team.filter((a) => !register.has(a) && !names(prose, a));
    expect(undisclosedTeam.map((a) => `${roles.get(a)!.join("/")} ${short(a)}`), "team keys neither registered nor named").toEqual([]);
    // An account in neither the register nor the page cannot be told apart:
    // named by count only, since it may be an outside operator's.
    const unknown = [...accounts].filter((a) => !register.has(a) && !roles.has(a) && !names(prose, a));
    expect(unknown.length, "accounts in linked transactions that the page and the register both leave out").toBe(0);
  });

  test("RV-03 every team wallet that paid or was paid in a linked run is named in the page's own words", async ({ page, request }) => {
    test.setTimeout(HORIZON_BUDGET);
    await page.goto(EVIDENCE, { waitUntil: "domcontentloaded" });
    const article = page.locator(ARTICLE);
    const prose = (await article.innerText()).replace(/\s+/g, " ");
    const txs = await observeAll(horizon(request), await linkedTxHashes(article));
    const register = await teamRegister(request);
    const roles = platformRoles();
    const moved = new Set(
      txs.flatMap((tx) => tx.ops.flatMap((op) => op.transfers.flatMap((t) => [t.from, t.to]))).filter((a) => a.startsWith("G")),
    );
    const team = [...moved].filter((a) => register.has(a) || roles.has(a));
    expect(team.length, "team wallets moved money in the linked runs").toBeGreaterThan(0);
    // Being in the register is not enough here: a reader of the page alone
    // must see each wallet whose balance a linked run changed.
    const unnamed = team.filter((a) => !names(prose, a));
    expect(unnamed.map((a) => `${register.get(a) ?? roles.get(a)!.join("/")} ${short(a)}`)).toEqual([]);
  });
});

/** One metric's row in the Success metrics table, found by its SOW words, with its achieved value and status. */
async function metricRow(page: Page, metric: string): Promise<{ row: Locator; achieved: string; status: string | null }> {
  const row = page
    .locator('section[aria-labelledby="success-metrics"] tbody tr')
    .filter({ has: page.getByRole("rowheader").filter({ hasText: metric }) });
  await expect(row, `one row for "${metric}"`).toHaveCount(1);
  const achieved = (await row.getByRole("cell").nth(1).locator("span.font-semibold").innerText()).trim();
  const status = await row.locator("[data-metric-status]").getAttribute("data-metric-status");
  return { row, achieved, status };
}

/** The visible label of the link to a transaction, in the given scope. */
async function labelOf(scope: Locator, hash: string): Promise<string> {
  const text = await scope.locator(`a[href$="/tx/${hash}"]`).first().textContent();
  return (text ?? "").replace(/\s+/g, " ");
}

test.describe("RV-02 each metric's achieved value against its source", () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(HORIZON_BUDGET);
    await page.goto(EVIDENCE, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: "Success metrics (SOW §6.3)" })).toBeVisible();
  });

  test("RV-02 m04 achieved 3: three escrow v2 payouts on testnet, each a team run the page calls one", async ({ page, request }) => {
    const m04 = await metricRow(page, "On-chain USDC settlements (charges) recorded");
    expect(m04.achieved).toBe("3");
    const get = horizon(request);
    const register = await teamRegister(request);
    const settles = (await observeAll(get, await linkedTxHashes(m04.row))).filter(
      (tx) => tx.successful && tx.ops.some((op) => op.call?.contract === ESCROW_V2 && op.call.fn === "settle"),
    );
    const payouts = settles.flatMap((tx) =>
      tx.ops.flatMap((op) => op.transfers.filter((t) => t.from === ESCROW_V2).map((t) => ({ tx, payout: t }))),
    );
    expect(payouts.length, "payouts of the escrow v2 settlements the row links").toBe(Number(m04.achieved));
    // Each payer is the buyer the link names; its own authorization, linked
    // elsewhere on the page, is the escrow v2 deposit of the paid-out amount.
    const authorizations = (await observeAll(get, await linkedTxHashes(page.locator(ARTICLE)))).filter(
      (tx) => tx.successful && tx.ops.some((op) => op.call?.contract === ESCROW_V2 && op.call.fn === "authorize"),
    );
    for (const [i, { tx, payout }] of payouts.entries()) {
      const label = await labelOf(m04.row, tx.hash);
      expect(label, `counted charge ${i + 1} is called a team test run`).toMatch(/\(counted; a team test run:/);
      expect(label, `counted charge ${i + 1} has no outside framing`).not.toMatch(/\b(external|customer|outside)\b/i);
      expect(register.has(payout.to), `counted charge ${i + 1} pays a team wallet`).toBe(true);
      const payer = [...register.keys()].find((a) => a !== payout.to && names(label, a));
      expect(payer, `counted charge ${i + 1} names its buyer from the register`).toBeDefined();
      const deposit = authorizations.find((a) =>
        a.ops.some((op) => op.transfers.some((t) => t.from === payer && t.to === ESCROW_V2 && t.amount === payout.amount)),
      );
      expect(deposit, `counted charge ${i + 1}: ${short(payer!)} deposited ${payout.amount} XLM on escrow v2`).toBeDefined();
    }
    await expect(m04.row).toContainText("all from the team's own escrow v2 test runs of 2026-09-30");
    await expect(m04.row).toContainText("so no outside operator was paid");
  });
});
