/**
 * Reads a transaction from Horizon testnet and turns it into plain facts: who
 * signed it, whether it succeeded, and, for each contract call, the contract,
 * the function and its decoded arguments, plus the native and asset balance
 * changes Horizon attributes to the operation. Nothing here trusts the app.
 */

import { decodeScVal, type ScValue } from "./scval.ts";

export const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";

/** One GET returning the HTTP status and the parsed JSON body. */
export type GetJson = (url: string) => Promise<{ status: number; body: unknown }>;

export type ObservedTransfer = {
  asset: string;
  from: string;
  to: string;
  /** Horizon's decimal string, seven places: "0.0100000". */
  amount: string;
};

export type ObservedCall = { contract: string; fn: string; args: ScValue[] };

export type ObservedOp = {
  type: string;
  source: string;
  call?: ObservedCall;
  transfers: ObservedTransfer[];
};

export type ObservedTx = {
  hash: string;
  successful: boolean;
  ledger: number;
  /** ISO timestamp of the ledger close. */
  createdAt: string;
  source: string;
  ops: ObservedOp[];
};

type HorizonParam = { value: string; type: string };
type HorizonChange = {
  asset_type: string;
  asset_code?: string;
  type: string;
  from: string;
  to: string;
  amount: string;
};
type HorizonOp = {
  type: string;
  source_account: string;
  function?: string;
  parameters?: HorizonParam[];
  asset_balance_changes?: HorizonChange[] | null;
};

function toCall(op: HorizonOp): ObservedCall | undefined {
  if (op.function !== "HostFunctionTypeHostFunctionTypeInvokeContract") return undefined;
  const [contract, fn, ...args] = (op.parameters ?? []).map((p) => decodeScVal(p.value));
  if (typeof contract !== "string" || typeof fn !== "string") {
    throw new Error("invoke_contract without a contract address and function symbol");
  }
  return { contract, fn, args };
}

function toOp(op: HorizonOp): ObservedOp {
  return {
    type: op.type,
    source: op.source_account,
    call: toCall(op),
    transfers: (op.asset_balance_changes ?? []).map((c) => ({
      asset: c.asset_type === "native" ? "native" : (c.asset_code ?? c.asset_type),
      from: c.from,
      to: c.to,
      amount: c.amount,
    })),
  };
}

/** The transaction as Horizon testnet has it, or null when Horizon has no such hash. */
export async function observeTx(get: GetJson, hash: string): Promise<ObservedTx | null> {
  const tx = await get(`${HORIZON_TESTNET}/transactions/${hash}`);
  if (tx.status === 404) return null;
  if (tx.status !== 200) throw new Error(`Horizon /transactions/${hash} answered ${tx.status}`);
  const ops = await get(`${HORIZON_TESTNET}/transactions/${hash}/operations?limit=200`);
  if (ops.status !== 200) throw new Error(`Horizon operations of ${hash} answered ${ops.status}`);
  const t = tx.body as {
    hash: string;
    successful: boolean;
    ledger: number;
    created_at: string;
    source_account: string;
  };
  const records = (ops.body as { _embedded: { records: HorizonOp[] } })._embedded.records;
  return {
    hash: t.hash,
    successful: t.successful,
    ledger: t.ledger,
    createdAt: t.created_at,
    source: t.source_account,
    ops: records.map(toOp),
  };
}

export type ObservedAccount = {
  id: string;
  /** ISO timestamp of the create_account that funded it, when Horizon still has it. */
  createdAt: string | null;
};

/** The account as Horizon testnet has it, or null when the account does not exist. */
export async function observeAccount(get: GetJson, account: string): Promise<ObservedAccount | null> {
  const res = await get(`${HORIZON_TESTNET}/accounts/${account}`);
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`Horizon /accounts/${account} answered ${res.status}`);
  const ops = await get(`${HORIZON_TESTNET}/accounts/${account}/operations?order=asc&limit=1`);
  if (ops.status !== 200) throw new Error(`Horizon operations of ${account} answered ${ops.status}`);
  const [first] = (ops.body as { _embedded: { records: { type: string; account?: string; created_at: string }[] } })
    ._embedded.records;
  const created = first?.type === "create_account" && first.account === account;
  return { id: (res.body as { id: string }).id, createdAt: created ? first.created_at : null };
}
