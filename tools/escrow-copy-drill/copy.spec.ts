import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { QA_BUYER } from "../onchain-verify/facts.ts";

/**
 * EP-05 — story 6.07: what the plan card says a signature does, for the escrow the
 * backend settles through. Nothing is signed here: the Freighter shim answers the
 * connection probes as UAT's QA buyer and refuses any signing request, which it counts.
 */

const PROD = "https://orizons.xyz";
const PASSPHRASE = "Test SDF Network ; September 2015";

/** The evidence PNG for a case, under docs/uat/evidence/6.07/. */
function evidence(name: string): string {
  return path.resolve(test.info().config.rootDir, "../../docs/uat/evidence/6.07", `ep05-${name}.png`);
}

/** The cap as the card prints it: the plan total in whole stroops of native XLM, trailing zeros cut. */
function capText(totalUsdc: number): string {
  const units = Math.round((totalUsdc > 0 ? totalUsdc : 0.001) * 10_000_000) / 10_000_000;
  return `${units.toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0")} XLM`;
}

/**
 * Freighter's message bus, answered as the QA buyer. Every request type is recorded in
 * `asked`; signing requests are refused, so nothing can be signed even if one is made.
 */
async function freighterShim(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.exposeFunction("drillWalletAsked", (type: string) => asked.push(type));
  await page.addInitScript(
    ([address, passphrase]: string[]) => {
      (window as unknown as { freighter?: boolean }).freighter = true;
      window.addEventListener("message", (event: MessageEvent) => {
        const request = event.data as { source?: string; messageId?: unknown; type?: string } | null;
        if (!request || request.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;
        (window as unknown as { drillWalletAsked: (t: string) => void }).drillWalletAsked(String(request.type));
        const reply = (payload: Record<string, unknown>) =>
          window.postMessage({ source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId: request.messageId, ...payload }, window.location.origin);
        switch (request.type) {
          case "REQUEST_CONNECTION_STATUS":
            return reply({ isConnected: true });
          case "REQUEST_ALLOWED_STATUS":
            return reply({ isAllowed: true });
          case "REQUEST_ACCESS":
          case "REQUEST_PUBLIC_KEY":
            return reply({ publicKey: address });
          case "REQUEST_NETWORK":
            return reply({ network: "TESTNET", networkPassphrase: passphrase });
          case "REQUEST_NETWORK_DETAILS":
            return reply({
              networkDetails: { network: "TESTNET", networkName: "Test Net", networkUrl: "https://horizon-testnet.stellar.org", networkPassphrase: passphrase },
            });
          default:
            return reply({ apiError: { code: -1, message: `the drill signs nothing: ${String(request.type)}` } });
        }
      });
    },
    [QA_BUYER, PASSPHRASE],
  );
  return asked;
}

/** Restores the QA buyer's Freighter session, as the app restores one on mount. */
async function connectOnReload(page: Page): Promise<void> {
  await page.evaluate((address) => {
    window.localStorage.setItem("orizon.wallet.v2", JSON.stringify({ walletId: "freighter", address }));
  }, QA_BUYER);
  await page.reload();
}

/** Decomposes the demo-kit calculator intent against the live API and returns the plan's total. */
async function decompose(page: Page): Promise<number> {
  await page.getByRole("button", { name: "calculator web app" }).click();
  const response = page.waitForResponse((r) => r.url().endsWith("/api/orchestrator/decompose") && r.request().method() === "POST");
  await page.getByRole("button", { name: /Decompose/ }).click();
  const plan = (await (await response).json()) as { total_usdc: number };
  await expect(page.getByRole("heading", { name: "Execution plan", level: 2 })).toBeVisible();
  return plan.total_usdc;
}

const connectSentence = (page: Page) => page.getByText(/^Connect Freighter \(testnet\) to pay on-chain/);
const signSentence = (page: Page) => page.getByText(/^Freighter will prompt for one signature/);
const authorize = (page: Page) => page.getByRole("button", { name: /Authorize & Execute/ });

test.describe.configure({ mode: "serial" });

test("EP-05 v2 @prod: production's matching pin tells the custody story and asks for the signature", async ({ page }) => {
  const asked = await freighterShim(page);
  await page.goto(`${PROD}/app/orchestrator`);
  await decompose(page);
  await expect(connectSentence(page)).toHaveText(
    "Connect Freighter (testnet) to pay on-chain: authorizing moves the plan's maximum into escrow, delivered steps are paid from it, and the rest comes back when the run settles. Or run a simulated pass, which moves no funds.",
  );

  await connectOnReload(page);
  const total = await decompose(page);
  await expect(signSentence(page)).toHaveText(
    `Freighter will prompt for one signature that moves up to ${capText(total)} from your wallet into escrow now. Delivered steps are paid from it, and the rest comes back to you when the run settles.`,
  );
  await expect(page.getByText(/On-chain payment is paused/)).toHaveCount(0);
  await expect(authorize(page)).toBeEnabled();
  await signSentence(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence("v2") });
  expect(asked).not.toContain("SUBMIT_TRANSACTION");
});
