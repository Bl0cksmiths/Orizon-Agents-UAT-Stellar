import { getJsonOrNull } from "./http.ts";
import { decodeScVal, type ScValue } from "./scval.ts";

export const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";

/** The public testnet faucet. Every friendbot-funded account names it as its funder. */
export const FRIENDBOT = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";

const PAGE = 200;
const MAX_PAGES = 50;

export interface BalanceChange {
  type: string;
  from: string | null;
  to: string | null;
  /** In stroops (7 decimal places), exact. */
  amount: bigint;
}

export interface Operation {
  id: string;
  txHash: string;
  createdAt: string;
  type: string;
  source: string;
  /** create_account only. */
  funder: string | null;
  account: string | null;
  /** payment only. */
  from: string | null;
  to: string | null;
  amount: bigint | null;
  assetType: string | null;
  /** invoke_host_function only: the contract, the function and its decoded arguments. */
  contract: string | null;
  fn: string | null;
  args: ScValue[];
  balanceChanges: BalanceChange[];
}

/** A Horizon amount ("12.3456789") in stroops, exactly. */
export function stroops(amount: string): bigint {
  const negative = amount.startsWith("-");
  const [whole = "0", frac = ""] = amount.replace(/^-/, "").split(".");
  const value = BigInt(whole) * 10_000_000n + BigInt((frac + "0000000").slice(0, 7));
  return negative ? -value : value;
}

type Raw = Record<string, unknown>;

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toOperation(raw: Raw): Operation {
  const params = Array.isArray(raw.parameters) ? (raw.parameters as Raw[]) : [];
  const decoded = params.map((p) => decodeScVal(String(p.value)));
  const invoke = raw.type === "invoke_host_function" && decoded.length >= 2;
  const changes = Array.isArray(raw.asset_balance_changes) ? (raw.asset_balance_changes as Raw[]) : [];
  return {
    id: String(raw.id),
    txHash: String(raw.transaction_hash),
    createdAt: String(raw.created_at),
    type: String(raw.type),
    source: String(raw.source_account),
    funder: text(raw.funder),
    account: text(raw.account),
    from: text(raw.from),
    to: text(raw.to),
    amount: typeof raw.amount === "string" ? stroops(raw.amount) : null,
    assetType: text(raw.asset_type),
    contract: invoke ? text(decoded[0]) : null,
    fn: invoke ? text(decoded[1]) : null,
    args: invoke ? decoded.slice(2) : [],
    balanceChanges: changes.map((c) => ({
      type: String(c.type),
      from: text(c.from),
      to: text(c.to),
      amount: stroops(String(c.amount)),
    })),
  };
}

/**
 * Every successful operation `account` is party to, oldest first; [] for an
 * account that does not exist. With `since` (ISO 8601), only operations at or
 * after it, read newest first and stopped there. Throws rather than truncate a
 * history longer than the page cap.
 */
export async function operations(account: string, since?: string): Promise<Operation[]> {
  const out: Operation[] = [];
  const order = since ? "desc" : "asc";
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${TESTNET_HORIZON}/accounts/${account}/operations?order=${order}&limit=${PAGE}${cursor ? `&cursor=${cursor}` : ""}`;
    const body = (await getJsonOrNull(url)) as { _embedded?: { records?: Raw[] } } | null;
    if (body === null) return out;
    const records = body._embedded?.records ?? [];
    for (const record of records) {
      const op = toOperation(record);
      if (since && op.createdAt < since) return out.reverse();
      out.push(op);
    }
    if (records.length < PAGE) return since ? out.reverse() : out;
    cursor = String(records[records.length - 1]!.paging_token);
  }
  throw new Error(`${account} has more than ${PAGE * MAX_PAGES} operations in range`);
}

export interface AccountSigners {
  signers: { key: string; weight: number }[];
}

/** The account's signers, or null when it does not exist. */
export async function accountSigners(account: string): Promise<AccountSigners | null> {
  const body = (await getJsonOrNull(`${TESTNET_HORIZON}/accounts/${account}`)) as Raw | null;
  if (body === null) return null;
  const signers = Array.isArray(body.signers) ? (body.signers as Raw[]) : [];
  return { signers: signers.map((s) => ({ key: String(s.key), weight: Number(s.weight) })) };
}
