import { request } from "./http.ts";

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
