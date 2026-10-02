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
