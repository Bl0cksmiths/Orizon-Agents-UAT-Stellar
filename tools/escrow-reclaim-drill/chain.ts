/**
 * What the EP-04 reclaim drill reads from testnet itself, never from the app:
 * the ledger clock, the escrow's authorization record, its events, and the
 * buyer's balance. Built on the dependency-free readers in tools/onchain-verify.
 */

import { HORIZON_TESTNET } from "../onchain-verify/horizon.ts";

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
