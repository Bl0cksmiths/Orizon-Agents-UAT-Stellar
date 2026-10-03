import { test, expect, type APIRequestContext } from "@playwright/test";
import { REGISTRY } from "../tools/onchain-verify/facts.ts";
import { observeTx, type GetJson } from "../tools/onchain-verify/horizon.ts";

/**
 * Story 6.04, OV-07: the SOW §6.2 checklist, reviewed row by row. The rows are
 * the SOW's own (the frontend's `lib/evidence/sow.mjs`, SOW_6_1), and the items
 * are those the evidence index lists under each row. Every link the index gives
 * outside Stellar Expert is fetched with no session; the explorer links are
 * OV-01's (`tests/evidence-index.spec.ts`).
 *
 * An item the chain or the API contradicts is pinned with its defect id, so
 * the test fails, and must be revisited, when the index or the deploy changes.
 *
 * Story 6.10 re-runs it on the index after escrow v2: RV-01 (each link
 * resolves, the adoption counter on its own because of D-091) and RV-02 (an
 * item's status judged from the API, the chain or the page, not its label).
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

/** The API's adoption counter, which D4-c links: it takes minutes to answer, or never does (D-091). */
const ADOPTION_URL = "https://orizon-agents-be-stellar.onrender.com/api/ecosystem/adoption";

test("OV-07 every link outside Stellar Expert, but the adoption counter, answers with no session", async ({
  request,
}) => {
  test.setTimeout(600_000);
  const rows = await readRows(request);
  const urls = new Set(
    rows.flatMap((r) => r.items.flatMap((i) => (i.links ?? []).map((l) => l.url))).filter((u) => !isExplorer(u)),
  );
  expect(urls.has(ADOPTION_URL), "the adoption counter is linked, and is checked on its own below").toBe(true);
  urls.delete(ADOPTION_URL);
  expect(urls.size, "the index links pages, files, PRs and the API").toBeGreaterThan(0);
  for (const url of urls) {
    expect.soft(await fetchStatus(request, url), url).toBe(200);
  }
});

test("RV-01 the live adoption counter link answers", async ({ request }) => {
  test.fail(true, "D-091: the adoption report takes 6 to 15 minutes, or never answers");
  test.setTimeout(180_000);
  const res = await request.get(ADOPTION_URL, { timeout: 120_000 });
  expect(res.status(), ADOPTION_URL).toBe(200);
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

const TEAM_REGISTER =
  "https://raw.githubusercontent.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/main/app/data/team_wallets.json";
const TX_LINK = /^https:\/\/stellar\.expert\/explorer\/testnet\/tx\/([0-9a-f]{64})$/;

/** Horizon reads through Playwright's request context, body parsed whatever the status. */
const horizon = (request: APIRequestContext): GetJson => async (url) => {
  const res = await request.get(url, { timeout: 30_000 });
  return { status: res.status(), body: await res.json() };
};

/**
 * The SOW asks D1 for "an externally owned agent's registration tx hash" and
 * D4 for "≥ 2 external registration tx hashes" (D-089). Each transaction is
 * judged on Horizon, never by its label: it must have succeeded, call
 * `register` on the AgentRegistry, and be signed by the owner it registers,
 * a wallet outside the team register. Linking outside operators' hashes on the
 * page breaks the consent rule; that is D-092, asserted by RV-04 in
 * `tests/evidence-index.spec.ts`, and no identifier is repeated here.
 */
test("OV-07 D1-c and D4-c are marked present and link registrations by wallets outside the team register", async ({
  request,
}) => {
  test.setTimeout(300_000);
  const rows = await readRows(request);
  const register = await request.get(TEAM_REGISTER);
  expect(register.status(), "the team register answers").toBe(200);
  const get = horizon(request);
  const team = new Set(((await register.json()) as { wallets: { address: string }[] }).wallets.map((w) => w.address));
  for (const [id, least] of [["6.1-D1-c", 1], ["6.1-D4-c", 2]] as const) {
    const item = itemById(rows, id);
    expect(item.status, id).toBe("present");
    const hashes = (item.links ?? []).flatMap((l) => TX_LINK.exec(l.url)?.[1] ?? []);
    let outside = 0;
    for (const [n, hash] of hashes.entries()) {
      const tx = await observeTx(get, hash);
      const call = tx?.ops.find((op) => op.call?.contract === REGISTRY && op.call.fn === "register")?.call;
      const owner = call?.args[0];
      const ok = !!tx?.successful && owner === tx.source && typeof owner === "string" && !team.has(owner);
      expect.soft(ok, `${id} transaction link ${n + 1}: a successful outside registration signed by its owner`).toBe(true);
      if (ok) outside++;
    }
    expect(outside, `${id}: outside registration transactions linked`).toBeGreaterThanOrEqual(least);
  }
});

/** A running time as the index writes it ("3 min 9 s"), in seconds. */
function seconds(label: string): number {
  const m = /(\d+) min (\d+) s/.exec(label);
  if (!m) throw new Error(`no running time in "${label}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A YouTube video's running time from its public watch page, which needs no API key (oEmbed carries none). */
async function youtubeSeconds(request: APIRequestContext, url: string): Promise<number> {
  const page = await fetchPage(request, url);
  expect(page.status, url).toBe(200);
  const m = /"lengthSeconds":"(\d+)"/.exec(page.body);
  if (!m) throw new Error(`${url} states no running time`);
  return Number(m[1]);
}

/**
 * D4-a and m10 (updated 2026-10-03): the demo is published on /demo in two
 * parts. Each part must play on /demo with no session, run as long on YouTube
 * as the index says, and the parts together must meet m10's "3–5 min".
 */
test("OV-07 D4-a: the demo is marked present, /demo plays each part the index links, and they run 3 to 5 minutes", async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const rows = await readRows(request);
  const item = itemById(rows, "6.1-D4-a");
  expect(item.status).toBe("present");
  const demoLink = (item.links ?? []).find((l) => l.kind === "page");
  expect(demoLink && new URL(demoLink.url).pathname, "D4-a links the /demo page").toBe("/demo");
  const parts = (item.links ?? []).filter((l) => l.kind === "video");
  expect(parts.length, "D4-a links the demo's parts").toBeGreaterThan(0);

  const demo = await page.goto("/demo");
  expect(demo?.status(), "/demo with no session").toBe(200);
  await expect(page.locator('[data-demo="published"]')).toHaveCount(1);
  let total = 0;
  for (const part of parts) {
    const id = new URL(part.url).searchParams.get("v");
    expect(id, part.url).toBeTruthy();
    const stated = seconds(part.label);
    const oembed = await request.get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(part.url)}`);
    expect(oembed.status(), `${part.label}: public on YouTube`).toBe(200);
    const { title } = (await oembed.json()) as { title: string };
    const running = `${Math.floor(stated / 60)} min ${stated % 60} s`;
    await page.locator("[data-demo-player]").getByRole("button", { name: `Play video: ${title} (${running})` }).click();
    await expect(page.locator(`iframe[src*="${id}"]`), `${part.label}: the player loads`).toHaveCount(1);
    expect(await youtubeSeconds(request, part.url), `${part.label}: running time on YouTube`).toBe(stated);
    total += stated;
  }
  expect(seconds(demoLink!.label), "the parts' stated total").toBe(total);
  expect(total, "m10: 3–5 min").toBeGreaterThanOrEqual(180);
  expect(total, "m10: 3–5 min").toBeLessThanOrEqual(300);
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

/** The index's live API link, and what it answers, parsed whatever the status. */
async function readLive<T>(request: APIRequestContext, item: Item, path: string): Promise<T> {
  const link = (item.links ?? []).find((l) => l.url === `${BACKEND}${path}`);
  expect(link, `${item.id} links ${path}`).toBeDefined();
  const res = await request.get(link!.url, { timeout: 120_000 });
  expect(res.status(), link!.url).toBe(200);
  return (await res.json()) as T;
}

test("RV-02 D2-c: the floor the index quotes is the floor the live API applies", async ({ request }) => {
  test.setTimeout(180_000);
  const item = itemById(await readRows(request), "6.1-D2-c");
  expect(item.status).toBe("present");
  const label = (item.links ?? []).find((l) => l.url.endsWith("/api/stellar/reputation/params"))?.label ?? "";
  const quoted = /floor is (\d+) of 10000, which is ([\d.]+) out of 5/.exec(label);
  expect(quoted, "the params link quotes the floor in basis points and out of 5").not.toBeNull();
  const params = await readLive<{ enabled: boolean; floor_bps: number }>(request, item, "/api/stellar/reputation/params");
  expect(params.enabled, "routing by reputation is on").toBe(true);
  expect(params.floor_bps).toBe(Number(quoted![1]));
  expect((params.floor_bps / 10_000) * 5).toBe(Number(quoted![2]));
});

type Network = { network: string; contracts: Record<string, string> };

/** The contract and account ids RD-f links on Stellar Expert. */
function explorerIds(item: Item, kind: "contract" | "account"): Set<string> {
  const pattern = new RegExp(`^https://stellar\\.expert/explorer/testnet/${kind}/([A-Z0-9]{56})$`);
  return new Set((item.links ?? []).flatMap((l) => pattern.exec(l.url)?.[1] ?? []));
}

test("RV-02 RD-e: the live API reports testnet, the contracts RD-f links, and escrow v2 with refunds on", async ({
  request,
}) => {
  test.setTimeout(240_000);
  const rows = await readRows(request);
  const item = itemById(rows, "6.1-RD-e");
  expect(item.status).toBe("present");
  const linked = itemById(rows, "6.1-RD-f");
  const network = await readLive<Network>(request, item, "/api/stellar/network");
  expect(network.network).toBe("testnet");
  expect(Object.keys(network.contracts), "four contracts").toHaveLength(4);
  for (const [role, id] of Object.entries(network.contracts)) {
    expect(explorerIds(linked, "contract").has(id), `RD-f links the live ${role}`).toBe(true);
  }
  const readiness = await readLive<{
    status: string;
    escrow: { contract: string; version: number };
    disputes: { reconcile: { enabled: boolean } };
    ratings: { signer: string };
  }>(request, item, "/readiness");
  expect(readiness.status).toBe("ready");
  expect(readiness.escrow).toEqual({ contract: network.contracts.payment_escrow, version: 2 });
  expect(readiness.disputes.reconcile.enabled, "refund reconciliation on").toBe(true);
  expect(explorerIds(linked, "account").has(readiness.ratings.signer), "RD-f links the scoring key").toBe(true);
  const routes = Object.keys((await readLive<{ paths: object }>(request, item, "/openapi.json")).paths);
  expect(routes.filter((r) => r.startsWith("/api/disputes")).length, "the dispute routes").toBeGreaterThan(0);
});

test("RV-02 RD-d: the dApp reports testnet, on the contracts the live API reports", async ({ request }) => {
  test.setTimeout(240_000);
  const rows = await readRows(request);
  expect(itemById(rows, "6.1-RD-d").status).toBe("present");
  const res = await request.get("/api/stellar/network", { timeout: 120_000 });
  expect(res.status(), "the dApp's own network route").toBe(200);
  const dapp = (await res.json()) as Network;
  expect(dapp.network).toBe("testnet");
  const api = await readLive<Network>(request, itemById(rows, "6.1-RD-e"), "/api/stellar/network");
  expect(dapp.contracts, "the dApp and the API use the same contracts").toEqual(api.contracts);
});
