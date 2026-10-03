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

test("OV-07 RD: the SOW's ALGOREX-PH repository addresses redirect to the public Bl0cksmiths repositories", async ({
  request,
}) => {
  for (const repo of ["Orizon-Agents-FE-Stellar", "Orizon-Agents-BE-Stellar", "Orizon-Agents-Smart-Contract-Stellar"]) {
    const res = await request.get(`https://github.com/ALGOREX-PH/${repo}`, { maxRedirects: 0 });
    expect(res.status(), repo).toBe(301);
    expect(res.headers()["location"], repo).toBe(`https://github.com/Bl0cksmiths/${repo}`);
  }
});

const itemById = (rows: Row[], id: string): Item => {
  const item = rows.flatMap((r) => r.items).find((i) => i.id === id);
  if (!item) throw new Error(`the index has no item ${id}`);
  return item;
};

test("OV-07 D1-c and D4-c are marked present but link no registration transaction (D-089)", async ({ request }) => {
  const rows = await readRows(request);
  for (const id of ["6.1-D1-c", "6.1-D4-c"]) {
    const item = itemById(rows, id);
    expect(item.status, `${id} D-089`).toBe("present");
    const txLinks = (item.links ?? []).filter((l) => l.url.startsWith("https://stellar.expert/explorer/testnet/tx/"));
    expect(txLinks, `${id} D-089: the SOW asks for outside registration tx hashes`).toHaveLength(0);
  }
});

test("OV-07 D4-a: the demo video is marked missing, and /demo has no player", async ({ request }) => {
  const rows = await readRows(request);
  expect(itemById(rows, "6.1-D4-a").status, "D-082").toBe("missing");
  const demo = await request.get("/demo");
  expect(demo.status()).toBe(200);
  const html = await demo.text();
  expect(html, "D-082").toContain('data-demo="unpublished"');
  expect(html, "D-082").not.toMatch(/<video|<iframe/);
});

const BACKEND = "https://orizon-agents-be-stellar.onrender.com";
const DISPUTE = "dsp_15acee279ac02852a5877ac1696ec4b5";

test("OV-07 D3-a/D3-b: the dispute is credited with a confirmed rating, and its refund is the whole charge (D-080)", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const res = await request.get(`${BACKEND}/api/disputes/${DISPUTE}`, { timeout: 120_000 });
  expect(res.status()).toBe(200);
  const d = (await res.json()) as {
    status: string;
    rating_confirmed: boolean;
    refund_tx: string;
    rating_tx: string;
    charged_usdc: number;
    credited_usdc: number;
  };
  expect(d.status).toBe("credited");
  expect(d.rating_confirmed).toBe(true);
  expect(d.rating_tx).toBe("b512135ffade2d6518fd8cf1628f20787846ed0e311750043b87723dee453a49");
  expect(d.refund_tx).toBe("cb2c57929006470f9f554989dd8071e8539d245df529df956693944a78e1e25f");
  expect(d.credited_usdc, "D-080: the 'partial' refund returns the whole charge").toBe(d.charged_usdc);
});

test("OV-07 D3-c: the live receipt's task is unknown to the API; only its settlement survives (D-090)", async ({
  request,
}) => {
  test.setTimeout(180_000);
  const task = "tsk_7e1c369cebaf41b3";
  for (const path of [`/api/tasks/${task}`, `/api/trace/${task}`, `/api/tasks/${task}/artifact`]) {
    const res = await request.get(`${BACKEND}${path}`, { timeout: 120_000 });
    expect(res.status(), `${path} D-090`).toBe(404);
    expect(((await res.json()) as { detail: string }).detail, `${path} D-090`).toBe("unknown_task");
  }
  const disputes = await request.get(`${BACKEND}/api/tasks/${task}/disputes`, { timeout: 120_000 });
  expect(disputes.status()).toBe(200);
  const body = (await disputes.json()) as { settlement: { charge_tx: string; proof_tx: string } | null };
  expect(body.settlement?.charge_tx).toBe("785428bf6552208750b375703556c534da557dccd64df8d1db7f954a04ca554b");
  expect(body.settlement?.proof_tx).toBe("efca274fb83b50865cfc20dc40b6949e5abd1ae23ed3e7a7622e6c9eda37c0a8");
});
