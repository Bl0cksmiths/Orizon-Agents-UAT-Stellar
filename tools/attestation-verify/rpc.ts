/**
 * Stellar RPC reads against the deployed AttestationRegistry. Nothing here
 * signs or submits: `get` and the re-seal probes are simulateTransaction
 * calls, and entry lifetimes come from getLedgerEntries.
 */

export const RPC_URL = process.env.UAT_STELLAR_RPC ?? "https://soroban-testnet.stellar.org";

/** One JSON-RPC call; an RPC-level error is thrown with its method name. */
export async function rpc<T>(method: string, params: object): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  if (body.result === undefined) throw new Error(`${method}: no result`);
  return body.result;
}
