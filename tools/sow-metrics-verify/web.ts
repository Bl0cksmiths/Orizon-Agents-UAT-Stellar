import { getJson, request } from "./http.ts";
import { BACKEND } from "./team.ts";

/**
 * The milestone metrics (m06–m11) are facts about the live deployment and
 * the repositories, not the chain. Every read is made with no session and no
 * token, and redirects are not followed: a page that only answers by
 * redirecting to a login is not published.
 */
export const FRONTEND = "https://orizons.xyz";
export const GITHUB_API = "https://api.github.com";

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
