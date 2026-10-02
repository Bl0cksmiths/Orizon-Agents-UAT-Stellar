/**
 * What the EP-04 reclaim drill reads from testnet itself, never from the app:
 * the ledger clock, the escrow's authorization record, its events, and the
 * buyer's balance. Built on the dependency-free readers in tools/onchain-verify.
 */

import { ESCROW_V2 } from "../onchain-verify/facts.ts";
import { HORIZON_TESTNET } from "../onchain-verify/horizon.ts";
import { field, readContractData, type PostJson } from "../onchain-verify/rpc.ts";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`GET ${url} answered ${res.status}`);
  return res.json();
}

/** The latest closed ledger on Horizon testnet: its sequence and close time in Unix seconds. */
export async function latestLedger(): Promise<{ sequence: number; closedAt: number }> {
  const body = (await getJson(`${HORIZON_TESTNET}/ledgers?order=desc&limit=1`)) as {
    _embedded: { records: { sequence: number; closed_at: string }[] };
  };
  const [ledger] = body._embedded.records;
  if (!ledger) throw new Error("Horizon listed no ledger");
  return { sequence: ledger.sequence, closedAt: Date.parse(ledger.closed_at) / 1000 };
}

const postJson: PostJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

/** The escrow's `Authorization` record, as `authorization(auth_id)` would return it. */
export type Authorization = {
  payer: string;
  agentId: string;
  maxAmount: bigint;
  spent: bigint;
  expiresAt: number;
  revoked: boolean;
  settled: boolean;
};

/**
 * The escrow v2 record stored under `DataKey::Auth(auth_id)`, read from ledger
 * state on Stellar RPC; null when the escrow holds no such authorization.
 */
export async function readAuthorization(authIdHex: string): Promise<Authorization | null> {
  const [record] = await readContractData(postJson, ESCROW_V2, [[{ sym: "Auth" }, { bytes: authIdHex }]]);
  if (record === undefined) return null;
  const at = (name: string) => field(record, name);
  const [payer, agentId, maxAmount, spent, expiresAt, revoked, settled] = [
    at("payer"), at("agent_id"), at("max_amount"), at("spent"), at("expires_at"), at("revoked"), at("settled"),
  ];
  if (
    typeof payer !== "string" || typeof agentId !== "string" || typeof maxAmount !== "bigint" ||
    typeof spent !== "bigint" || typeof expiresAt !== "bigint" || typeof revoked !== "boolean" ||
    typeof settled !== "boolean"
  ) {
    throw new Error(`authorization ${authIdHex} is not the escrow v2 shape`);
  }
  return { payer, agentId, maxAmount, spent, expiresAt: Number(expiresAt), revoked, settled };
}
