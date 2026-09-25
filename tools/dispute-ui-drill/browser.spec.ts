import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * FS — story 6.03f: every state of the dispute receipt, read on the real trace page as a buyer
 * reads it. The states are real records with real testnet transactions, written by seed.py;
 * see README.md. The payer is recognised as the frontend recognises one — the connected
 * wallet's address — and, as in the tab that ran the task, holds the task's read token.
 */

type State = "open" | "crediting" | "credited" | "rating_pending" | "rejected" | "live" | "gap";
const seed = JSON.parse(readFileSync(path.join(process.env.DRILL_STATE ?? ".", "ui-seed.json"), "utf8")) as {
  payer: string;
  apiKey: string;
  tasks: Record<State, string>;
  disputes: Record<State, string>;
  tokens: Record<State, string>;
  tx: Partial<Record<State, { refund: string; rating?: string; credited_usdc?: number }>>;
};

// seed.py's words: the payer's reason.
const REASON = "Research step 6.03f returned nothing usable — naïve sources, none cited 😀";

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
