import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ESCROW_V1, ESCROW_V2, QA_BUYER } from "../onchain-verify/facts.ts";
import { STRKEY_VERSION, encodeStrkey } from "../onchain-verify/strkey.ts";

/**
 * EP-05 — story 6.07: what the plan card says a signature does, for the escrow the
 * backend settles through. Nothing is signed here: the Freighter shim answers the
 * connection probes as UAT's QA buyer and refuses any signing request, which it counts.
 */

const PROD = "https://orizons.xyz";
const API = "https://orizon-agents-be-stellar.onrender.com";
const LOCAL = "http://127.0.0.1:3100";
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

test("EP-05 precondition @prod: the live backend settles through the escrow the frontend's main pins", async ({ request }) => {
  const frontend = process.env.DRILL_FRONTEND;
  expect(frontend, "DRILL_FRONTEND names a frontend checkout whose origin/main pin is read").toBeTruthy();
  const pins = JSON.parse(execFileSync("git", ["-C", frontend ?? "", "show", "origin/main:lib/escrow-address.json"], { encoding: "utf8" })) as {
    testnet: string | null;
  };
  const main = execFileSync("git", ["-C", frontend ?? "", "rev-parse", "--short=8", "origin/main"], { encoding: "utf8" }).trim();
  test.info().annotations.push({ type: "pin", description: `${pins.testnet} at FE origin/main ${main}` });
  const network = await request.get(`${API}/api/stellar/network`, { timeout: 120_000 });
  expect(network.ok()).toBe(true);
  const live = ((await network.json()) as { contracts: { payment_escrow?: string } }).contracts.payment_escrow;
  expect(pins.testnet).toBe(ESCROW_V2);
  expect(live).toBe(pins.testnet);
});

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

/** The v1 consequence, in the frontend's own words (lib/escrow-generation.ts V1_CANNOT_SETTLE). */
const V1_CANNOT_SETTLE =
  "On this deployment the escrow cannot yet complete a payment (a known defect; the fix is deployed separately), so a paid run reports its settlement as failed and nothing is charged.";

/**
 * Makes GET /api/stellar/network report `escrow` as the live payment escrow. The live
 * answer is fetched and only `contracts.payment_escrow` is replaced; every other request
 * (decompose included) goes to the live API untouched.
 */
async function reportEscrow(page: Page, escrow: string): Promise<void> {
  await page.route("**/api/stellar/network", async (route) => {
    const live = await route.fetch();
    const body = (await live.json()) as { contracts: Record<string, string> };
    await route.fulfill({ response: live, json: { ...body, contracts: { ...body.contracts, payment_escrow: escrow } } });
  });
}

const paused = (page: Page) => page.getByText(/^On-chain payment is paused/);

test("EP-05 v1 @local: the v1 escrow is told as an allowance that moves nothing", async ({ page }) => {
  const asked = await freighterShim(page);
  await reportEscrow(page, ESCROW_V1);
  await page.goto(`${LOCAL}/app/orchestrator`);
  await decompose(page);
  await expect(connectSentence(page)).toHaveText(
    `Connect Freighter (testnet) to pay on-chain: authorizing records a spending allowance on the escrow contract, and no funds move when you sign. ${V1_CANNOT_SETTLE} Or run a simulated pass, which moves no funds.`,
  );

  await connectOnReload(page);
  const total = await decompose(page);
  await expect(signSentence(page)).toHaveText(
    `Freighter will prompt for one signature authorizing up to ${capText(total)}. It records a spending allowance on the escrow contract; no funds move when you sign. ${V1_CANNOT_SETTLE}`,
  );
  await expect(signSentence(page)).not.toContainText("into escrow now");
  // This build pins v2, so v1 is also a mismatch: the card pauses Authorize and names both.
  await expect(paused(page)).toContainText(ESCROW_V1);
  await expect(paused(page)).toContainText(ESCROW_V2);
  await expect(authorize(page)).toBeDisabled();
  await signSentence(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence("v1") });
  expect(asked).not.toContain("SUBMIT_TRANSACTION");
});

/** A well-formed contract id that is neither escrow: 32 bytes of 0x07, with a real checksum. */
const FOREIGN = encodeStrkey(STRKEY_VERSION.contract, new Uint8Array(32).fill(7));

test("EP-05 mismatch @local: a foreign escrow pauses Authorize, names both ids and asks nothing of the wallet", async ({ page }) => {
  const asked = await freighterShim(page);
  const builds: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/stellar/build/authorize")) builds.push(r.url());
  });
  await reportEscrow(page, FOREIGN);
  await page.goto(`${LOCAL}/app/orchestrator`);
  await decompose(page);
  await expect(connectSentence(page)).toHaveText("Connect Freighter (testnet) to pay on-chain. Or run a simulated pass, which moves no funds.");

  await connectOnReload(page);
  const total = await decompose(page);
  await expect(paused(page)).toHaveText(
    `On-chain payment is paused: the platform is settling through escrow ${FOREIGN}, but this console is written for escrow ${ESCROW_V2}. Nothing is asked of your wallet until they agree. A simulated pass is unaffected.`,
  );
  // The escrow is neither v1 nor the pinned v2, so the sentence claims neither story.
  await expect(signSentence(page)).toHaveText(`Freighter will prompt for one signature authorizing up to ${capText(total)}.`);
  await expect(authorize(page)).toBeDisabled();
  await expect(authorize(page)).toHaveAttribute("aria-describedby", /escrow-mismatch-notice/);
  await expect(page.getByRole("button", { name: /^simulate/ })).toBeEnabled();
  await paused(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence("mismatch") });

  await authorize(page).click({ force: true });
  await expect(authorize(page)).toHaveText("Authorize & Execute ▸");
  expect(asked.filter((t) => t === "SUBMIT_TRANSACTION")).toHaveLength(0);
  expect(builds).toHaveLength(0);
});

test("EP-05 neutral @local: with no network read the card claims neither custody story", async ({ page }) => {
  const asked = await freighterShim(page);
  await page.route("**/api/stellar/network", (route) => route.fulfill({ status: 503, json: { detail: "drill: network read refused" } }));
  await page.goto(`${LOCAL}/app/orchestrator`);
  await decompose(page);
  await expect(connectSentence(page)).toHaveText("Connect Freighter (testnet) to pay on-chain. Or run a simulated pass, which moves no funds.");

  await connectOnReload(page);
  const total = await decompose(page);
  // No asset is known either, so the cap prints bare rather than as a guessed currency.
  await expect(signSentence(page)).toHaveText(`Freighter will prompt for one signature authorizing up to ${capText(total).replace(" XLM", "")}.`);
  await expect(paused(page)).toHaveCount(0);
  await signSentence(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: evidence("neutral") });
  expect(asked).not.toContain("SUBMIT_TRANSACTION");
});
