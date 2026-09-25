import { spawn, type ChildProcess } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { openSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * DU — story 6.03d in the browser: the trace page reloaded across a real
 * backend restart. Reads what `drill.py browser-seed` wrote; see README.md.
 */

const LOGS = process.env.DRILL_LOGS ?? "logs";
const seed = JSON.parse(readFileSync(path.join(LOGS, "browser-seed.json"), "utf8")) as {
  payer: string;
  payerSeedHex: string;
  tasks: Record<"open" | "settled" | "crediting" | "reconciled", string>;
  disputes: Record<"open" | "crediting" | "reconciled", string>;
  refundTx: Record<"crediting" | "reconciled", string>;
};

// The payer's own words: the receipt shows them to the payer alone, so seeing
// them means the wallet has reconnected as the payer.
const REASON = /signup form on the landing page never submits/;

// PKCS#8 around the raw ed25519 seed, so node:crypto can sign with the payer's key.
const payerKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed.payerSeedHex, "hex")]),
  format: "der",
  type: "pkcs8",
});

/** SEP-53, as Freighter signs a message: ed25519 over sha256(prefix + message). */
function sep53(message: string): string {
  const prefixed = Buffer.concat([Buffer.from("Stellar Signed Message:\n"), Buffer.from(message)]);
  return sign(null, createHash("sha256").update(prefixed).digest(), payerKey).toString("base64");
}

let backend: ChildProcess | null = null;
let boots = 0;

async function startBackend(taskAuth = false): Promise<void> {
  boots += 1;
  const log = openSync(path.join(LOGS, `browser-backend-${boots}.log`), "w");
  backend = spawn(process.env.DRILL_PYTHON ?? "python", ["-m", "uvicorn", "app.main:app", "--port", "8765", "--workers", "1"], {
    cwd: process.env.DRILL_BACKEND,
    env: {
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      PATH: process.env.PATH ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
      HOME: process.env.HOME ?? "",
      DATABASE_URL: process.env.DRILL_DSN ?? "",
      TASK_AUTH_REQUIRED: taskAuth ? "true" : "false",
      STELLAR_AGENT_REGISTRY: "",
      REPUTATION_ENABLED: "false",
      PYTHONIOENCODING: "utf-8",
    },
    stdio: ["ignore", log, log],
  });
  // Matches drill.py: a loaded laptop has taken close to a minute just to import the backend.
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    const up = await fetch("http://127.0.0.1:8765/health").then((r) => r.ok, () => false);
    if (up) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("the drill backend did not come up");
}

/** A hard kill, as a spun-down instance gets. */
async function killBackend(): Promise<void> {
  const proc = backend;
  backend = null;
  if (!proc) return;
  const exited = new Promise((r) => proc.once("exit", r));
  proc.kill("SIGKILL");
  await exited;
}

/** Freighter, connected as the payer and signing with the payer's real key. */
async function connectPayer(page: Page): Promise<void> {
  await page.exposeFunction("drillSign", (message: string) => sep53(message));
  await page.route("**/horizon-testnet.stellar.org/**", (route) =>
    route.fulfill({ json: { balances: [{ asset_type: "native", balance: "100.0000000" }] } }),
  );
  await page.addInitScript((address: string) => {
    window.localStorage.setItem("orizon.wallet.v2", JSON.stringify({ walletId: "freighter", address }));
    (window as unknown as { freighter?: boolean }).freighter = true;
    const passphrase = "Test SDF Network ; September 2015";
    window.addEventListener("message", async (event: MessageEvent) => {
      const request = event.data as { source?: string; messageId?: unknown; type?: string; blob?: string } | null;
      if (!request || request.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;
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
        case "SUBMIT_BLOB": {
          const signer = window as unknown as { drillSign: (m: string) => Promise<string> };
          return reply({ signedBlob: await signer.drillSign(request.blob ?? ""), signerAddress: address });
        }
        default:
          return reply({ apiError: { code: -1, message: `unmocked freighter request: ${String(request.type)}` } });
      }
    });
  }, seed.payer);
}

async function openAsPayer(page: Page, task: string): Promise<void> {
  await page.goto(`/app/trace?task=${encodeURIComponent(task)}`);
  await expect(page.getByText("Loading the receipt…")).toHaveCount(0);
  await expect(page.getByText(REASON)).toBeVisible();
}

/** The receipt as text from its heading on, with the ticking relative times blanked out. */
async function receiptText(page: Page): Promise<string> {
  const text = await page.locator("main").innerText();
  return text.slice(text.indexOf("Receipt")).replace(/\d+\s*[hms]\b(\s*\d+\s*[ms]\b)*( left)?|\d+ (seconds?|minutes?|hours?) ago|just now/g, "…");
}

test.describe.configure({ mode: "serial" });

test.afterAll(killBackend);

test("DU-01 an open dispute reads the same after a backend restart", async ({ page }, info) => {
  await startBackend();
  await connectPayer(page);
  await openAsPayer(page, seed.tasks.open);
  await expect(page.getByText("Under review")).toBeVisible();
  const closesBefore = await page.locator("time").first().getAttribute("datetime");
  const before = await receiptText(page);
  await page.screenshot({ path: info.outputPath("du01-before.png"), fullPage: true });

  await killBackend();
  await startBackend();
  await page.reload();
  await expect(page.getByText("Loading the receipt…")).toHaveCount(0);
  await expect(page.getByText(REASON)).toBeVisible();
  await expect(page.getByText("Under review")).toBeVisible();
  await page.screenshot({ path: info.outputPath("du01-after.png"), fullPage: true });

  expect(await page.locator("time").first().getAttribute("datetime")).toBe(closesBefore);
  expect(await receiptText(page)).toBe(before);
});

test("DU-02 a settlement recorded before a restart is disputed through the UI after it", async ({ page }, info) => {
  await killBackend();
  await startBackend();
  await connectPayer(page);
  await page.goto(`/app/trace?task=${encodeURIComponent(seed.tasks.settled)}`);
  await expect(page.getByText("Loading the receipt…")).toHaveCount(0);
  await page.getByRole("button", { name: /^Dispute step 2,/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("After the restart: the signup form still never submits.");
  await dialog.getByRole("button", { name: "Sign and submit" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Under review")).toBeVisible();
  await expect(page.getByText("After the restart: the signup form still never submits.")).toBeVisible();
  await page.screenshot({ path: info.outputPath("du02-after-restart.png"), fullPage: true });
});

test("DU-03 a submitted, unconfirmed refund reads as pending everywhere", async ({ page }, info) => {
  if (!backend) await startBackend();
  await connectPayer(page);
  await openAsPayer(page, seed.tasks.crediting);
  await expect(page.getByText("Refund in progress")).toBeVisible();
  await expect(page.getByText("Submitted, waiting for confirmation")).toBeVisible();
  await expect(page.getByText(/The refund was submitted and is waiting for confirmation on Stellar/)).toBeVisible();
  await expect(page.getByText(seed.refundTx.crediting)).toBeVisible();
  await page.screenshot({ path: info.outputPath("du03-crediting.png"), fullPage: true });
  const receipt = await receiptText(page);
  expect(receipt).not.toContain("Refunded");
  expect(receipt).not.toContain("Confirmed on Stellar");
  expect(receipt).not.toMatch(/Done:|received \d|\d USDC credited to/);
});

test("DU-04 a credit reconciled by the script's own hint ends with a complete receipt", async ({ page }, info) => {
  // D-064: the hint records hash and amount but never the dispute rating, so the
  // receipt says "the dispute rating it costs Coder is not confirmed yet" forever.
  test.fail();
  if (!backend) await startBackend();
  await connectPayer(page);
  await openAsPayer(page, seed.tasks.reconciled);
  await expect(page.getByText("Refunded")).toBeVisible();
  await page.screenshot({ path: info.outputPath("du04-reconciled.png"), fullPage: true });
  const receipt = await receiptText(page);
  expect(receipt).toMatch(/0\.25\d* USDC credited to/);
  expect(receipt).toContain("it cost Coder a dispute rating on its reputation");
});

test("DU-01 with TASK_AUTH_REQUIRED on, the payer still sees their dispute after a restart", async ({ page }, info) => {
  // D-065: the per-task read 404s once the in-memory token is gone, and the
  // console treats that 404 as "no receipt route": the panel and every dispute
  // action vanish, with nothing said, while GET /api/disputes/{id} still answers.
  test.fail();
  await killBackend();
  await startBackend(true);
  await connectPayer(page);
  const read = page.waitForResponse((r) => r.url().includes(`/tasks/${seed.tasks.open}/disputes`));
  await page.goto(`/app/trace?task=${encodeURIComponent(seed.tasks.open)}`);
  expect((await read).status()).toBe(404);
  const direct = (await (await fetch(`http://127.0.0.1:8765/api/disputes/${seed.disputes.open}`)).json()) as { status: string };
  expect(direct.status).toBe("open");
  await page.screenshot({ path: info.outputPath("token-gap.png"), fullPage: true });
  await expect(page.getByText("Under review")).toBeVisible({ timeout: 15_000 });
});
