import { postJson } from "./http.ts";

export const TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** A contract call that failed in simulation: an answer ("no such receipt"), not an outage. */
export class SimulationFailed extends Error {}

let nextId = 0;

async function rpc<R>(method: string, params?: unknown): Promise<R> {
  const body = await postJson(TESTNET_RPC, { jsonrpc: "2.0", id: ++nextId, method, params });
  const reply = body as { result?: R; error?: { message?: string } };
  if (reply.error) throw new Error(`${method}: ${reply.error.message ?? JSON.stringify(reply.error)}`);
  if (reply.result === undefined) throw new Error(`${method}: no result`);
  return reply.result;
}

export async function networkPassphrase(): Promise<string> {
  return (await rpc<{ passphrase: string }>("getNetwork")).passphrase;
}
