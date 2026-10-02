import { spawn } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";

/**
 * Freighter, as the dApp's wallet kit reaches it: `window.postMessage` requests
 * (`FREIGHTER_EXTERNAL_MSG_REQUEST`) answered with a matching response, whose
 * id field is spelled `messagedId` in the real protocol. Shapes follow the
 * frontend's own e2e mock (FE e2e/mocks.ts mockWallet) and freighter-api 6.
 *
 * Horizon, RPC and /api are never intercepted, so every balance the page
 * shows and every transaction it sends is the live testnet's.
 */

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

// Playwright loads specs and their imports as CommonJS, so __dirname, not import.meta.
const SIGNER = path.join(__dirname, "signer.py");

export type ShimOptions = {
  /** The buyer's public key: what the wallet reports as connected. */
  address: string;
  /**
   * Path to the buyer.json that holds `address`'s secret, handed to signer.py
   * by env var. Leave it out for a connect-only wallet: it reports `address`
   * as connected and refuses every signature.
   */
  keyFile?: string;
  /** The interpreter with stellar_sdk (the backend's venv); "python" when unset. */
  python?: string;
  /** Answer signature requests as a user who pressed Reject (flip it later on the returned shim). */
  decline?: boolean;
};

/** One SUBMIT_TRANSACTION the page made, and what the wallet did with it. */
export type SignRequest = { xdr: string; outcome: "signed" | "declined" | "refused"; detail?: string };

export type FreighterShim = {
  /** While true, every signature request is declined, as Freighter's Reject button answers it. */
  decline: boolean;
  readonly requests: SignRequest[];
};

/** signer.py's answer: the signed envelope, or why it refused. */
function runSigner(opts: ShimOptions, xdr: string, passphrase: string): Promise<{ signed?: string; refused?: string }> {
  const keyFile = opts.keyFile;
  if (!keyFile) return Promise.resolve({ refused: "this wallet is connect-only and holds no key" });
  return new Promise((resolve) => {
    const child = spawn(opts.python ?? "python", [SIGNER, "sign", passphrase], {
      env: { ...process.env, ESCROW_DRILL_KEY: keyFile },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) => resolve(code === 0 ? { signed: out.trim() } : { refused: err.trim() || `signer exited ${code}` }));
    child.stdin.end(xdr);
  });
}

export async function installFreighterShim(page: Page, opts: ShimOptions): Promise<FreighterShim> {
  const shim: FreighterShim = { decline: opts.decline ?? false, requests: [] };

  // SUBMIT_TRANSACTION is signed with the buyer's real key by signer.py, which
  // refuses anything but an escrow `authorize` or `reclaim` paid by the buyer.
  await page.exposeFunction("escrowDrillSign", async (xdr: string, passphrase: string) => {
    if (shim.decline) {
      shim.requests.push({ xdr, outcome: "declined" });
      // Freighter's own words when the user presses Reject in its popup.
      return { apiError: { code: -4, message: "The user rejected this request." } };
    }
    const answer = await runSigner(opts, xdr, passphrase);
    if (answer.signed) {
      shim.requests.push({ xdr, outcome: "signed" });
      return { signedTransaction: answer.signed, signerAddress: opts.address };
    }
    shim.requests.push({ xdr, outcome: "refused", detail: answer.refused });
    return { apiError: { code: -1, message: `drill signer refused: ${answer.refused}` } };
  });

  await page.addInitScript(
    ({ address, passphrase }: { address: string; passphrase: string }) => {
      window.localStorage.setItem("orizon.wallet.v2", JSON.stringify({ walletId: "freighter", address }));
      (window as unknown as { freighter?: boolean }).freighter = true;
      window.addEventListener("message", async (event: MessageEvent) => {
        const request = event.data as {
          source?: string;
          messageId?: unknown;
          type?: string;
          transactionXdr?: string;
          networkPassphrase?: string;
        } | null;
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
              networkDetails: {
                network: "TESTNET",
                networkName: "Test Net",
                networkUrl: "https://horizon-testnet.stellar.org",
                networkPassphrase: passphrase,
              },
            });
          case "SUBMIT_TRANSACTION": {
            // Looked up per request: the exposed binding may land after this script runs.
            const drill = window as unknown as { escrowDrillSign: (x: string, p: string) => Promise<Record<string, unknown>> };
            return reply(await drill.escrowDrillSign(request.transactionXdr ?? "", request.networkPassphrase || passphrase));
          }
          default:
            return reply({ apiError: { code: -1, message: `the drill wallet does not answer ${String(request.type)}` } });
        }
      });
    },
    { address: opts.address, passphrase: TESTNET_PASSPHRASE },
  );

  return shim;
}
