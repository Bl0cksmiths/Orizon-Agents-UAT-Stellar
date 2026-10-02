/**
 * The deployed backend's own routes, called the way the dApp calls them. Only
 * read-only answers are asked for here: a reclaim build is refused or answered
 * with unsigned XDR, and the drill never signs what it gets back.
 */

export const API = process.env.RECLAIM_API ?? "https://orizon-agents-be-stellar.onrender.com";

/** An answer: the HTTP status, and the error envelope's code and message when there is one. */
export type Answer = { status: number; code: string | null; message: string | null; body: unknown };

async function postJson(path: string, payload: unknown): Promise<Answer> {
  // Render cold starts have taken up to 90 s.
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  const body: unknown = await res.json();
  const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
  return {
    status: res.status,
    code: typeof error?.code === "string" ? error.code : null,
    message: typeof error?.message === "string" ? error.message : null,
    body,
  };
}

/** `POST /api/stellar/build/reclaim`: a refusal, or unsigned XDR that nobody signs. */
export function buildReclaim(payer: string, authIdHex: string): Promise<Answer> {
  return postJson("/api/stellar/build/reclaim", { payer, auth_id_hex: authIdHex });
}

/** `POST /api/orchestrator/execute` for a paid run, exactly as the plan card sends it. */
export function executePaid(planId: string, authIdHex: string, payer: string): Promise<Answer> {
  return postJson("/api/orchestrator/execute", { plan_id: planId, auth_id_hex: authIdHex, payer });
}
