import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * FS — story 6.03f: every state of the dispute receipt, read on the real trace page as a buyer
 * reads it. The states are real records with real testnet transactions, written by seed.py;
 * see README.md. The payer is recognised as the frontend recognises one — the connected
 * wallet's address — and, as in the tab that ran the task, holds the task's read token.
 */

type State = "open" | "crediting" | "credited" | "rating_pending" | "rejected" | "live" | "gap" | "upheld";
const seed = JSON.parse(readFileSync(path.join(process.env.DRILL_STATE ?? ".", "ui-seed.json"), "utf8")) as {
  payer: string;
  apiKey: string;
  tasks: Record<State, string>;
  jobs: Record<State, string>;
  disputes: Record<State, string>;
  tokens: Record<State, string>;
  tx: Partial<Record<State, { refund: string; rating?: string; credited_usdc?: number }>>;
};

// seed.py's words: the payer's reason and the adjudicator's.
const REASON = "Research step 6.03f returned nothing usable — naïve sources, none cited 😀";
const REJECTION = "Rejection 6.03f: the step delivered three cited sources, so the brief was met.";

type Viewer = { wallet: string | null; token: boolean };
const PAYER: Viewer = { wallet: seed.payer, token: true };

/** A wallet restored as the app restores one, with Freighter answering as that address. */
async function connect(page: Page, address: string): Promise<void> {
  await page.addInitScript((addr: string) => {
    window.localStorage.setItem("orizon.wallet.v2", JSON.stringify({ walletId: "freighter", address: addr }));
    (window as unknown as { freighter?: boolean }).freighter = true;
    window.addEventListener("message", (event: MessageEvent) => {
      const request = event.data as { source?: string; messageId?: unknown; type?: string } | null;
      if (!request || request.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;
      const reply = (payload: Record<string, unknown>) =>
        window.postMessage({ source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId: request.messageId, ...payload }, window.location.origin);
      if (request.type === "REQUEST_CONNECTION_STATUS") return reply({ isConnected: true });
      if (request.type === "REQUEST_ALLOWED_STATUS") return reply({ isAllowed: true });
      if (request.type === "REQUEST_ACCESS" || request.type === "REQUEST_PUBLIC_KEY") return reply({ publicKey: addr });
      if (request.type === "REQUEST_NETWORK") return reply({ network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" });
      return reply({ apiError: { code: -1, message: `unmocked freighter request: ${String(request.type)}` } });
    });
  }, address);
}

/** Open a state's trace page as `viewer` and return its dispute receipt. */
async function open(page: Page, state: State, viewer: Viewer = PAYER): Promise<Locator> {
  if (viewer.wallet) await connect(page, viewer.wallet);
  if (viewer.token) {
    await page.addInitScript(([task, token]: string[]) => {
      window.sessionStorage.setItem("orizon.task-tokens", JSON.stringify([[task, token]]));
    }, [seed.tasks[state], seed.tokens[state]]);
  }
  await page.goto(`/app/trace?task=${encodeURIComponent(seed.tasks[state])}`);
  const receipt = page.getByRole("group", { name: /^Dispute receipt/ });
  await expect(receipt).toBeVisible();
  return receipt;
}

const HORIZON = "https://horizon-testnet.stellar.org";
const expert = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

/** An SCVal from Horizon's operation parameters: a symbol's text, or a byte string's hex. */
function scval(base64: string): string {
  const raw = Buffer.from(base64, "base64");
  const kind = raw.readUInt32BE(0);
  const body = raw.subarray(8, 8 + raw.readUInt32BE(4));
  return kind === 15 ? body.toString("utf8") : body.toString("hex");
}

/** What a transaction did, read back from testnet Horizon — the record Stellar Expert shows. */
async function onChain(request: APIRequestContext, hash: string) {
  const ops = await (await request.get(`${HORIZON}/transactions/${hash}/operations`)).json();
  const effects = await (await request.get(`${HORIZON}/transactions/${hash}/effects`)).json();
  const params = (ops._embedded.records[0].parameters ?? []) as { type: string; value: string }[];
  const called = params[1];
  if (!called) throw new Error(`${hash} is not a contract call`);
  return {
    successful: ops._embedded.records[0].transaction_successful as boolean,
    fn: scval(called.value),
    symbols: params.filter((p) => p.type === "Sym").map((p) => scval(p.value)),
    bytes: params.filter((p) => p.type === "Bytes").map((p) => scval(p.value)),
    credited: (effects._embedded.records as { type: string; account: string; amount: string }[]).filter((e) => e.type === "account_credited"),
  };
}

test.describe.configure({ mode: "serial" });

test("FS-01 open: under review, when it was raised, what happens next, and no links", async ({ page }, info) => {
  const receipt = await open(page, "open");
  await expect(receipt.getByText("Dispute status:")).toBeAttached();
  await expect(receipt).toContainText("Under review");
  await expect(receipt).toContainText(/Raised \S/);
  await expect(receipt).toContainText("The platform is reviewing this dispute; if it is upheld, the step's credit is paid to your wallet");
  await expect(receipt).toContainText(REASON);
  await expect(receipt.getByRole("link")).toHaveCount(0);
  await expect(receipt).not.toContainText(/Refunded|Confirmed|Done/);
  await page.screenshot({ path: info.outputPath("fs01-open.png"), fullPage: true });
});

test("FS-02 crediting: the refund is submitted and waiting, with its hash — never refunded or confirmed", async ({ page }, info) => {
  const receipt = await open(page, "crediting");
  const refund = seed.tx.crediting?.refund ?? "";
  expect(refund, "seed.py records the submitted transfer's hash").toMatch(/^[0-9a-f]{64}$/);
  await expect(receipt).toContainText("Refund in progress");
  await expect(receipt).toContainText("Submitted, waiting for confirmation");
  await expect(receipt).toContainText(refund);
  await expect(receipt).toContainText("The refund was submitted and is waiting for confirmation on Stellar");
  await expect(receipt).not.toContainText(/Refunded|Confirmed on Stellar|Done:|what you received/);
  await expect(receipt).toContainText("Up to 0.1");
  await expect(receipt).toContainText("to be credited to your wallet");
  await page.screenshot({ path: info.outputPath("fs02-crediting.png"), fullPage: true });
});

test("FS-03 credited: the amount with its funder on one line, and both links to the right transactions", async ({ page, request }, info) => {
  const receipt = await open(page, "credited");
  const tx = seed.tx.credited;
  expect(tx?.refund).toMatch(/^[0-9a-f]{64}$/);
  expect(tx?.rating).toMatch(/^[0-9a-f]{64}$/);
  await expect(receipt).toContainText("Refunded");
  await expect(receipt).toContainText("Done: you received 0.1");
  const credit = receipt.locator("p", { hasText: "credit ·" });
  await expect(credit).toContainText(/0\.1\s*USDC credited to your wallet/);
  await expect(credit).toContainText("funded by the platform, not clawed back from the agent");
  await expect(receipt.getByRole("link", { name: /view refund on stellar\.expert/ })).toHaveAttribute("href", expert(tx?.refund ?? ""));
  await expect(receipt.getByRole("link", { name: /view rating on stellar\.expert/ })).toHaveAttribute("href", expert(tx?.rating ?? ""));

  const refund = await onChain(request, tx?.refund ?? "");
  expect(refund.successful).toBe(true);
  expect(refund.fn).toBe("transfer");
  expect(refund.credited).toEqual([expect.objectContaining({ account: seed.payer, amount: "0.1000000" })]);
  const rating = await onChain(request, tx?.rating ?? "");
  expect(rating.successful).toBe(true);
  expect(rating.fn).toBe("submit");
  expect(rating.symbols).toEqual(expect.arrayContaining(["agt_09l5", "dispute"]));
  expect(rating.bytes[0]?.slice(0, 16), "the rating is filed under this dispute's job").toBe(seed.jobs.credited.slice(0, 16));
  await page.screenshot({ path: info.outputPath("fs03-credited.png"), fullPage: true });
});

test("FS-04 credited with the rating unconfirmed: the rating reads pending, not confirmed", async ({ page }, info) => {
  const receipt = await open(page, "rating_pending");
  const rating = seed.tx.rating_pending?.rating ?? "";
  expect(rating).toMatch(/^[0-9a-f]{64}$/);
  await expect(receipt).toContainText("the dispute rating it costs Researcher is not confirmed yet");
  const row = receipt.locator("div", { has: page.getByText(/^Dispute rating against/) }).last();
  await expect(row).toContainText("what it will cost the agent");
  await expect(row).toContainText("Submitted, waiting for confirmation");
  await expect(row).not.toContainText(/Confirmed on Stellar|what it cost the agent/);
  await expect(row.getByRole("link", { name: /view rating on stellar\.expert/ })).toHaveAttribute("href", expert(rating));
  await expect(receipt).not.toContainText("and it cost Researcher a dispute rating");
  await page.screenshot({ path: info.outputPath("fs04-rating-pending.png"), fullPage: true });
});

test("FS-05 rejected: the payer reads Rejected and why", async ({ page }, info) => {
  const receipt = await open(page, "rejected");
  await expect(receipt).toContainText("Rejected");
  await expect(receipt).toContainText("The platform did not uphold this dispute: no credit was issued, Researcher's reputation is unchanged, and the reason is below.");
  await expect(receipt.getByText("Why it was rejected")).toBeVisible();
  await expect(receipt).toContainText(REJECTION);
  await expect(receipt.getByRole("link")).toHaveCount(0);
  await expect(receipt).not.toContainText(/credit ·|Refunded/);
  await page.screenshot({ path: info.outputPath("fs05-rejected.png"), fullPage: true });
});

// A valid testnet address that is not the payer's.
const STRANGER = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

for (const [who, viewer] of [["another wallet", { wallet: STRANGER, token: false }], ["no wallet", { wallet: null, token: false }]] as const) {
  test(`FS-06 privacy: with ${who}, neither reason is on screen, in the page source, or in any response`, async ({ browser, request }, info) => {
    for (const state of ["credited", "rejected"] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const bodies: string[] = [];
      page.on("response", async (response) => {
        bodies.push(await response.text().catch(() => ""));
      });
      const receipt = await open(page, state, viewer);
      await expect(receipt).toContainText(state === "credited" ? "Refunded" : "Rejected");
      if (state === "credited") await expect(receipt).toContainText("credited to the payer's wallet");
      await expect(receipt).not.toContainText(/your wallet|Your reason|Why it was rejected/);
      const source = await (await request.get(`http://127.0.0.1:3100/app/trace?task=${seed.tasks[state]}`)).text();
      for (const words of [REASON, REJECTION]) {
        expect(await page.content(), `${state}: the rendered page`).not.toContain(words);
        expect(source, `${state}: the page source`).not.toContain(words);
        expect(bodies.filter((body) => body.includes(words)), `${state}: the responses`).toEqual([]);
      }
      await page.screenshot({ path: info.outputPath(`fs06-${state}-${viewer.wallet ? "stranger" : "anonymous"}.png`), fullPage: true });
      await context.close();
    }
  });
}

test("FS-07 the payer returning without the task's tab still reads why it was rejected", async ({ page }, info) => {
  // D-067: the backend sends the reasons only to a holder of the task token, which lives in the
  // tab that ran the task. The payer's own wallet, on any other tab or device, gets neither.
  // Remove the marker once the payer's wallet is enough to read them.
  test.fail();
  const receipt = await open(page, "rejected", { wallet: seed.payer, token: false });
  await page.screenshot({ path: info.outputPath("fs07-payer-without-token.png"), fullPage: true });
  await expect(receipt).toContainText("Rejected");
  await expect(receipt).toContainText(REJECTION, { timeout: 10_000 });
});

test("FS-08 a reason the backend withheld is never drawn as an empty quote", async ({ page }) => {
  // D-068: a withheld reason arrives as "" rather than null, and the payer's receipt draws the
  // "Your reason" label over an empty quote. Remove the marker once it is left out.
  test.fail();
  const receipt = await open(page, "open", { wallet: seed.payer, token: false });
  await expect(receipt).toContainText("Under review");
  await expect(receipt.getByText("Your reason")).toHaveCount(0, { timeout: 10_000 });
});

/** Every text the receipt's live region is given, in order: what a screen reader announces. */
async function recordAnnouncements(receipt: Locator): Promise<void> {
  await receipt.locator('[role="status"]').evaluate((region) => {
    const heard: string[] = [];
    (window as unknown as { heard: string[] }).heard = heard;
    new MutationObserver(() => {
      const text = region.textContent ?? "";
      if (text) heard.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
}

const announcements = (page: Page) => page.evaluate(() => (window as unknown as { heard: string[] }).heard);

test("FS-09 upheld while the payer watches: Refunded with both links, no reload, announced once", async ({ page, request }, info) => {
  const receipt = await open(page, "live");
  await expect(receipt).toContainText("Under review");
  await page.evaluate(() => ((window as unknown as { sameDocument: boolean }).sameDocument = true));
  await recordAnnouncements(receipt);
  const upheld = await request.post(`http://127.0.0.1:8766/api/disputes/${seed.disputes.live}/uphold`, {
    headers: { "X-API-Key": seed.apiKey },
    timeout: 300_000,
  });
  expect(upheld.status()).toBe(200);
  const dispute = (await upheld.json()) as { status: string; refund_tx: string; rating_tx: string };
  expect(dispute.status).toBe("credited");

  await expect(receipt).toContainText("Refunded", { timeout: 180_000 });
  await expect(receipt.getByRole("link", { name: /view refund on stellar\.expert/ })).toHaveAttribute("href", expert(dispute.refund_tx));
  await expect(receipt.getByRole("link", { name: /view rating on stellar\.expert/ })).toHaveAttribute("href", expert(dispute.rating_tx));
  expect(await page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument), "no reload").toBe(true);
  const heard = await announcements(page);
  expect(heard.at(-1)).toBe("Your dispute against Researcher was refunded.");
  expect(new Set(heard).size, `each change announced once: ${JSON.stringify(heard)}`).toBe(heard.length);
  await page.screenshot({ path: info.outputPath("fs09-live-refunded.png"), fullPage: true });
});

test("FS-10 a rating that lands after the refund reaches the open receipt without a reload", async ({ page }, info) => {
  // D-069: once a poll sees the refund confirmed and no rating yet, nothing is left for the
  // receipt to wait on, so polling stops and the rating that lands seconds later never shows.
  // Remove the marker once the receipt keeps polling until the rating is recorded.
  test.fail();
  const receipt = await open(page, "gap");
  await expect(receipt).toContainText("Done: you received 0.1 USDC; the dispute rating it costs Researcher is not confirmed yet.");
  await expect(receipt).toContainText("not recorded on-chain yet");
  await page.screenshot({ path: info.outputPath("fs10-before-rating.png"), fullPage: true });
  execFileSync(process.env.DRILL_PYTHON ?? "python", ["seed.py", "rate-gap"], { cwd: path.dirname(info.file), stdio: "inherit", timeout: 300_000 });
  const rated = JSON.parse(readFileSync(path.join(process.env.DRILL_STATE ?? ".", "ui-seed.json"), "utf8")) as typeof seed;
  const rating = rated.tx.gap?.rating ?? "";
  expect(rating).toMatch(/^[0-9a-f]{64}$/);
  await expect(receipt.getByRole("link", { name: /view rating on stellar\.expert/ })).toHaveAttribute("href", expert(rating), { timeout: 90_000 });
  await expect(receipt).toContainText("and it cost Researcher a dispute rating");
});

test("FS-11 @phone a credited receipt at 360px: nothing past the edge, both hashes whole, both links tappable", async ({ page, context }, info) => {
  const receipt = await open(page, "credited");
  const tx = seed.tx.credited;
  await expect(receipt).toContainText("Refunded");
  const width = await page.evaluate(() => window.innerWidth);
  expect(width).toBe(360);
  // The page hides horizontal overflow, which would clip rather than scroll: so every box in the
  // receipt must end inside the viewport, and each hash must fit its own box.
  const overflow = await receipt.evaluate((root, w) =>
    [root, ...root.querySelectorAll("*")]
      // Screen-reader-only text is a clipped 1px box by design; only what is drawn can overflow.
      .filter((el) => !el.closest(".sr-only"))
      .filter((el) => el.getBoundingClientRect().right > w + 0.5 || el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.tagName}.${el.className}: ${(el.textContent ?? "").slice(0, 40)}`), width);
  expect(overflow).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for (const hash of [tx?.refund ?? "", tx?.rating ?? ""]) {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(receipt.getByText(hash)).toBeVisible();
  }
  await context.route("https://stellar.expert/**", (route) => route.fulfill({ contentType: "text/html", body: "<title>stellar.expert</title>" }));
  for (const [name, hash] of [["view refund on stellar.expert", tx?.refund], ["view rating on stellar.expert", tx?.rating]] as const) {
    const link = receipt.getByRole("link", { name: new RegExp(name.replace(".", "\.")) });
    const box = await link.boundingBox();
    info.annotations.push({ type: "tap target", description: `${name}: ${box?.width.toFixed(0)}×${box?.height.toFixed(0)}px` });
    const opened = context.waitForEvent("page");
    await link.tap();
    const tab = await opened;
    expect(tab.url()).toBe(expert(hash ?? ""));
    await tab.close();
  }
  await page.screenshot({ path: info.outputPath("fs11-phone-credited.png"), fullPage: true });
});

test("FS-12 the countdown ticks without being announced: no live region changes while nothing happens", async ({ page }) => {
  const receipt = await open(page, "open");
  await expect(receipt).toContainText("Under review");
  const live = '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="timer"]:not([aria-live="off"])';
  await page.evaluate((selector) => {
    const changes: string[] = [];
    (window as unknown as { changes: string[] }).changes = changes;
    for (const region of document.querySelectorAll(selector)) {
      new MutationObserver(() => changes.push(region.textContent ?? "")).observe(region, { childList: true, characterData: true, subtree: true });
    }
  }, live);
  const countdown = page.getByText(/\d+h \d+m left/);
  const before = await countdown.textContent();
  // Long enough for a per-second or per-minute countdown to tick at least once.
  await expect(countdown).not.toHaveText(before ?? "", { timeout: 70_000 });
  expect(await page.evaluate(() => (window as unknown as { changes: string[] }).changes)).toEqual([]);
  expect(await countdown.evaluate((el) => el.closest('[aria-live]:not([aria-live="off"]), [role="status"]'))).toBeNull();
});

test("FS-13 upheld with no transfer on record: decided, and nothing claims a transfer is on its way", async ({ page }, info) => {
  // D-070: the sentence says the transfer "is queued", but nothing queues it — the platform has
  // to uphold again. Remove the marker once the wording says what the record holds.
  test.fail();
  const receipt = await open(page, "upheld");
  await page.screenshot({ path: info.outputPath("fs13-upheld.png"), fullPage: true });
  await expect(receipt).toContainText("Upheld");
  await expect(receipt).toContainText("No transaction on record");
  await expect(receipt).not.toContainText(/Refunded|Confirmed on Stellar|Done:/);
  // Upheld outlives a transfer only when one was refused or failed; nothing retries it by itself.
  await expect(receipt).not.toContainText("queued", { timeout: 10_000 });
});
