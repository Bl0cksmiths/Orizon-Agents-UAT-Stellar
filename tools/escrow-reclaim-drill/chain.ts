/**
 * What the EP-04 reclaim drill reads from testnet itself, never from the app:
 * the ledger clock, the escrow's authorization record, its events, and the
 * buyer's balance. Built on the dependency-free readers in tools/onchain-verify.
 */

import { ESCROW_V2 } from "../onchain-verify/facts.ts";
import { HORIZON_TESTNET } from "../onchain-verify/horizon.ts";
import { field, readContractData, RPC_TESTNET, type PostJson } from "../onchain-verify/rpc.ts";
import { decodeScVal, type ScValue } from "../onchain-verify/scval.ts";

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

/** One escrow event: its decoded topics and value, and the ledger it closed in. */
export type EscrowEvent = { topic: ScValue[]; value: ScValue; ledger: number; closedAt: string };

/**
 * Every event escrow v2 emitted in transaction `hash`, from Stellar RPC
 * `getEvents` over the transaction's own ledger.
 */
export async function escrowEventsOf(hash: string): Promise<EscrowEvent[]> {
  const tx = (await getJson(`${HORIZON_TESTNET}/transactions/${hash}`)) as { ledger: number };
  const res = await postJson(RPC_TESTNET, {
    jsonrpc: "2.0",
    id: 1,
    method: "getEvents",
    params: {
      startLedger: tx.ledger,
      endLedger: tx.ledger + 1,
      filters: [{ type: "contract", contractIds: [ESCROW_V2] }],
      pagination: { limit: 200 },
    },
  });
  const body = res.body as {
    result?: { events: { txHash: string; ledger: number; ledgerClosedAt: string; topic: string[]; value: string }[] };
    error?: unknown;
  };
  if (res.status !== 200 || !body.result) throw new Error(`getEvents answered ${res.status}: ${JSON.stringify(body.error)}`);
  return body.result.events
    .filter((e) => e.txHash === hash)
    .map((e) => ({ topic: e.topic.map(decodeScVal), value: decodeScVal(e.value), ledger: e.ledger, closedAt: e.ledgerClosedAt }));
}

/** "12.3456789" → 123456789n: Horizon's seven-place XLM amount in stroops. */
function toStroops(amount: string): bigint {
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, "0").slice(0, 7));
}

/** The account's native XLM balance on Horizon testnet, in stroops. */
export async function nativeBalance(account: string): Promise<bigint> {
  const body = (await getJson(`${HORIZON_TESTNET}/accounts/${account}`)) as {
    balances: { asset_type: string; balance: string }[];
  };
  const native = body.balances.find((b) => b.asset_type === "native");
  if (!native) throw new Error(`account ${account} lists no native balance`);
  return toStroops(native.balance);
}
