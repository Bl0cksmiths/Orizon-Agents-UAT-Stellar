/**
 * Compares what testnet shows with what the index claims and lists every
 * difference in words, so a failing test names exactly what drifted.
 */

import type { TxFacts } from "./facts.ts";
import type { ObservedTx } from "./horizon.ts";

/** Stable text for a decoded value; bigints keep an `n` so 1 and 1n differ. */
export const show = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? `${v}n` : v));

/**
 * Every way `observed` differs from `claim`; empty when the transaction is
 * successful and is exactly the one contract call, signer, day and native
 * balance changes the index claims. A missing transaction is a dead link.
 */
export function txDifferences(observed: ObservedTx | null, claim: TxFacts): string[] {
  if (!observed) return [`dead link: Horizon has no transaction ${claim.hash}`];
  const out: string[] = [];
  const check = (what: string, seen: unknown, want: unknown) => {
    if (show(seen) !== show(want)) out.push(`${what}: shows ${show(seen)}, index claims ${show(want)}`);
  };
  check("successful", observed.successful, true);
  check("ledger day (UTC)", observed.createdAt.slice(0, 10), claim.date);
  check("signer", observed.source, claim.source);
  check("operation count", observed.ops.length, 1);
  const call = observed.ops[0]?.call;
  check("contract", call?.contract, claim.contract);
  check("function", call?.fn, claim.fn);
  check("arguments", call?.args, claim.args);
  const moved = observed.ops.flatMap((op) => op.transfers);
  check("non-native assets moved", moved.filter((t) => t.asset !== "native").map((t) => t.asset), []);
  const transfers = moved.filter((t) => t.asset === "native");
  check("native transfers", transfers.map((t) => [t.from, t.to, t.amount]), claim.transfers);
  return out;
}
