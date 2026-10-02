/**
 * HTTP with a bounded retry. Public testnet RPC and Horizon rate-limit and
 * occasionally drop a connection; a verifier that read one of those as "no
 * data" would count zero where the chain holds something. So a 429, a 5xx or
 * a network error is retried, and if it persists it is thrown, never
 * swallowed. A 404 is an answer and is returned to the caller.
 */

const ATTEMPTS = 5;
const TIMEOUT_MS = 45_000;

export interface Fetched {
  status: number;
  text: string;
  location: string | null;
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function pause(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
}

/** One request, retried while the failure is transient. Redirects are not followed. */
export async function request(url: string, init: RequestInit = {}): Promise<Fetched> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await response.text();
      if (!retryable(response.status)) {
        return { status: response.status, text, location: response.headers.get("location") };
      }
      last = new Error(`${url} answered ${response.status}`);
    } catch (error) {
      last = error;
    }
    if (attempt < ATTEMPTS - 1) await pause(attempt);
  }
  throw new Error(`${url} did not answer after ${ATTEMPTS} attempts: ${String(last)}`);
}

function parse(url: string, fetched: Fetched): unknown {
  if (fetched.status !== 200) throw new Error(`${url} answered ${fetched.status}`);
  return JSON.parse(fetched.text) as unknown;
}

export async function getJson(url: string): Promise<unknown> {
  return parse(url, await request(url, { headers: { accept: "application/json" } }));
}

/** GET that treats 404 as "nothing here" (null) rather than an error. */
export async function getJsonOrNull(url: string): Promise<unknown> {
  const fetched = await request(url, { headers: { accept: "application/json" } });
  return fetched.status === 404 ? null : parse(url, fetched);
}
