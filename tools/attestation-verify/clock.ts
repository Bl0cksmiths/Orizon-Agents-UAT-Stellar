/**
 * Ledger number to approximate UTC time. Future ledgers have no close time
 * yet, so a live-until ledger is projected from the latest ledger's close
 * time at the rate measured over the last day (17,280 ledgers at 5 s).
 */
import { rpc } from "./rpc.ts";

const DAY_OF_LEDGERS = 17_280;

export type LedgerClock = { latest: number; latestClose: Date; secondsPerLedger: number; at: (ledger: number) => Date };

export async function ledgerClock(): Promise<LedgerClock> {
  const latest = await rpc<{ sequence: number; closeTime: string }>("getLatestLedger", {});
  const older = await rpc<{ ledgers: { sequence: number; ledgerCloseTime: string }[] }>("getLedgers", {
    startLedger: latest.sequence - DAY_OF_LEDGERS,
    pagination: { limit: 1 },
  });
  const reference = older.ledgers[0];
  if (!reference) throw new Error("getLedgers returned no reference ledger");
  const latestClose = Number(latest.closeTime);
  const secondsPerLedger = (latestClose - Number(reference.ledgerCloseTime)) / (latest.sequence - reference.sequence);
  return {
    latest: latest.sequence,
    latestClose: new Date(latestClose * 1000),
    secondsPerLedger,
    at: (ledger) => new Date((latestClose + (ledger - latest.sequence) * secondsPerLedger) * 1000),
  };
}
