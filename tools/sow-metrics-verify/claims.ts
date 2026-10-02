import { getJson } from "./http.ts";

/**
 * What the evidence index claims. The /evidence page renders the frontend's
 * `content/evidence/index.json`; the claims are read from that file on the
 * frontend's main branch, and the live page is checked to render the same
 * statuses, so a claim tested here is the one a reader of orizons.xyz sees.
 */
export const INDEX_URL =
  "https://raw.githubusercontent.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/main/content/evidence/index.json";

export interface Claim {
  id: string;
  metric: string;
  target: string;
  achieved: string;
  status: "met" | "not_met";
}

export interface EvidenceIndex {
  asOf: string;
  /** The snapshot's own account of how and when each row was measured. */
  method: string;
  claims: Map<string, Claim>;
  removed: Map<string, { metric: string; note: string }>;
}

export async function readIndex(): Promise<EvidenceIndex> {
  const body = (await getJson(INDEX_URL)) as {
    snapshot: { as_of: string; method: string };
    metrics: Claim[];
    removed_metrics?: { id: string; metric: string; note: string }[];
  };
  return {
    asOf: body.snapshot.as_of,
    method: body.snapshot.method,
    claims: new Map(body.metrics.map((m) => [m.id, m])),
    removed: new Map((body.removed_metrics ?? []).map((r) => [r.id, { metric: r.metric, note: r.note }])),
  };
}

/**
 * The cut-off a row was measured at (Unix seconds): the last second of the
 * "HH:MM UTC" minute the snapshot's method names, on its as_of day. Throws
 * when the method names no such time, so a re-measured index is noticed
 * rather than compared against the wrong moment.
 */
export function measuredAt(index: EvidenceIndex, time: string): number {
  if (!index.method.includes(`at ${time} UTC`)) {
    throw new Error(`the index's method names no measurement at ${time} UTC`);
  }
  return Date.parse(`${index.asOf}T${time}:59Z`) / 1000;
}
