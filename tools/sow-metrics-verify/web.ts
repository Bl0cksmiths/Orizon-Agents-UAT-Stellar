import { getJson, request } from "./http.ts";
import { API, BACKEND } from "./team.ts";

/**
 * The milestone metrics (m06–m11) are facts about the live deployment and
 * the repositories, not the chain. Every read is made with no session and no
 * token, and redirects are not followed: a page that only answers by
 * redirecting to a login is not published.
 */
export const FRONTEND = "https://orizons.xyz";
export const GITHUB_API = "https://api.github.com";

/** SOW §6.1's repositories, plus the copyable example agent the guide points operators to. */
export const REPOSITORIES = [
  "Bl0cksmiths/Orizon-Agents-FE-Stellar",
  "Bl0cksmiths/Orizon-Agents-BE-Stellar",
  "Bl0cksmiths/Orizon-Agents-Smart-Contract-Stellar",
  "Bl0cksmiths/Orizon-Agents-Example-Agent-Stellar",
] as const;

export const REGISTER_ROUTE = "POST /api/stellar/build/register-agent";
export const DISPUTE_ROUTES = [
  "POST /api/disputes",
  "GET /api/disputes/{dispute_id}",
  "POST /api/disputes/{dispute_id}/uphold",
  "POST /api/disputes/{dispute_id}/reject",
] as const;

export interface Page {
  path: string;
  status: number;
  html: string;
}

export async function readPage(path: string): Promise<Page> {
  const fetched = await request(`${FRONTEND}${path}`, { headers: { accept: "text/html" } });
  return { path, status: fetched.status, html: fetched.text };
}

/** Every "METHOD /path" the live backend publishes in its OpenAPI document. */
export async function readRoutes(): Promise<Set<string>> {
  const doc = (await getJson(`${BACKEND}/openapi.json`)) as { paths?: Record<string, Record<string, unknown>> };
  const routes = new Set<string>();
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(methods)) routes.add(`${method.toUpperCase()} ${path}`);
  }
  return routes;
}

export interface ReputationParams {
  enabled: boolean;
  floor_bps: number;
  network: string;
  /** The ReputationLedger the router reads. */
  contract_id: string;
}

export async function readParams(): Promise<ReputationParams> {
  return (await getJson(`${API}/stellar/reputation/params`)) as ReputationParams;
}

export interface Readiness {
  disputes?: { reconcile?: { enabled?: boolean } };
  escrow?: { contract?: string; version?: number };
}

export async function readReadiness(): Promise<Readiness> {
  return (await getJson(`${BACKEND}/readiness`)) as Readiness;
}

/** The SPDX id GitHub detects on a repository, or null when it detects none. */
export async function detectedLicense(repo: string): Promise<string | null> {
  const body = (await getJson(`${GITHUB_API}/repos/${repo}`)) as { license?: { spdx_id?: string } | null };
  return body.license?.spdx_id ?? null;
}

export interface DemoState {
  published: boolean;
  marker: string | null;
  /** The video's running time in seconds, from `<time dateTime="PT…">`, or null when none is shown. */
  seconds: number | null;
}

function isoDurationSeconds(text: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(text);
  if (!m || text === "PT") return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** What the /demo page says about its video: the published marker and the running time. */
export function demoState(html: string): DemoState {
  const marker = /data-demo="([a-z_]+)"/.exec(html)?.[1] ?? null;
  const duration = /<time[^>]*dateTime="(PT[0-9HMS]+)"/i.exec(html)?.[1];
  return {
    published: marker === "published",
    marker,
    seconds: duration ? isoDurationSeconds(duration) : null,
  };
}
