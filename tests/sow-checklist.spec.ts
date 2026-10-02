import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Story 6.04, OV-07: the SOW §6.2 checklist, reviewed row by row. The rows are
 * the SOW's own (the frontend's `lib/evidence/sow.mjs`, SOW_6_1), and the items
 * are those the evidence index lists under each row. Every link the index gives
 * outside Stellar Expert is fetched with no session; the explorer links are
 * OV-01's (`tests/evidence-index.spec.ts`).
 *
 * An item the chain or the API contradicts is pinned with its defect id, so
 * the test fails, and must be revisited, when the index or the deploy changes.
 */

const INDEX_URL =
  "https://raw.githubusercontent.com/Bl0cksmiths/Orizon-Agents-FE-Stellar/main/content/evidence/index.json";

type Link = { label: string; url: string; kind: string };
type Item = { id: string; status: string; links?: Link[] };
type Row = { id: string; items: Item[] };

async function readRows(request: APIRequestContext): Promise<Row[]> {
  const res = await request.get(INDEX_URL);
  expect(res.status(), "the evidence index answers").toBe(200);
  const body = (await res.json()) as { deliverables: Row[] };
  return body.deliverables;
}

const ROWS = ["D1", "D2", "D3", "D4", "RD"];
const ITEMS = 20;

test("OV-07 the index lists the SOW's five §6.2 rows and twenty items", async ({ request }) => {
  const rows = await readRows(request);
  expect(rows.map((r) => r.id)).toEqual(ROWS);
  const items = rows.flatMap((r) => r.items);
  expect(items).toHaveLength(ITEMS);
  for (const row of rows) {
    for (const item of row.items) expect(item.id.startsWith(`6.1-${row.id}-`), item.id).toBe(true);
  }
});

const isExplorer = (url: string): boolean => url.startsWith("https://stellar.expert/");

/** A GitHub file page is checked through its raw file, which GitHub does not rate-limit like its HTML. */
function fetchable(url: string): string {
  const blob = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([^#]+)/.exec(url);
  return blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}` : url;
}

/** GET with no session; a 429 is waited out (Retry-After, else 20 s) up to three times. */
async function fetchPage(
  request: APIRequestContext,
  url: string,
  method: "GET" | "HEAD" = "GET",
): Promise<{ status: number; body: string }> {
  for (let attempt = 0; ; attempt++) {
    const res = await request.fetch(url, { method, timeout: 90_000 });
    if (res.status() !== 429 || attempt === 3) return { status: res.status(), body: method === "GET" ? await res.text() : "" };
    const wait = Number(res.headers()["retry-after"] ?? "20");
    await new Promise((r) => setTimeout(r, Math.min(wait, 60) * 1000));
  }
}

/** Raw files (screenshots, the recording, the PDF) are checked by HEAD, so a slow download cannot time out. */
async function fetchStatus(request: APIRequestContext, url: string): Promise<number> {
  const target = fetchable(url);
  const method = target.startsWith("https://raw.githubusercontent.com/") ? "HEAD" : "GET";
  return (await fetchPage(request, target, method)).status;
}

test("OV-07 every link outside Stellar Expert answers with no session", async ({ request }) => {
  test.setTimeout(600_000);
  const rows = await readRows(request);
  const urls = new Set(
    rows.flatMap((r) => r.items.flatMap((i) => (i.links ?? []).map((l) => l.url))).filter((u) => !isExplorer(u)),
  );
  expect(urls.size, "the index links pages, files, PRs and the API").toBeGreaterThan(0);
  for (const url of urls) {
    expect.soft(await fetchStatus(request, url), url).toBe(200);
  }
});

/**
 * Read from the PR page, not GitHub's API: the API allows 60 unauthenticated
 * calls an hour, fewer than one run of the suite needs. The page embeds the
 * PR's state as `"state":"MERGED"`; if GitHub changes that payload, this test
 * fails rather than passing.
 */
test("OV-07 every pull request the index links is merged", async ({ request }) => {
  test.setTimeout(600_000);
  const rows = await readRows(request);
  const prs = new Set(
    rows
      .flatMap((r) => r.items.flatMap((i) => (i.links ?? []).map((l) => l.url)))
      .filter((u) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(u)),
  );
  expect(prs.size, "the index links pull requests").toBeGreaterThan(0);
  for (const url of prs) {
    const page = await fetchPage(request, url);
    expect.soft(page.status, url).toBe(200);
    expect.soft(page.body.includes('"state":"MERGED"'), `${url} merged`).toBe(true);
  }
});
