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

export type ShimOptions = {
  /** The buyer's public key: what the wallet reports as connected. */
  address: string;
  /** Path to the buyer.json that holds the secret; handed to signer.py by env var. */
  keyFile: string;
  /** The interpreter with stellar_sdk (the backend's venv). */
  python: string;
};

/** One SUBMIT_TRANSACTION the page made, and what the wallet did with it. */
export type SignRequest = { xdr: string; outcome: "signed" | "declined" | "refused"; detail?: string };

export type FreighterShim = {
  readonly requests: SignRequest[];
};

export async function installFreighterShim(page: Page, opts: ShimOptions): Promise<FreighterShim> {
  const shim: FreighterShim = { requests: [] };

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
          default:
            return reply({ apiError: { code: -1, message: `the drill wallet does not answer ${String(request.type)}` } });
        }
      });
    },
    { address: opts.address, passphrase: TESTNET_PASSPHRASE },
  );

  return shim;
}
