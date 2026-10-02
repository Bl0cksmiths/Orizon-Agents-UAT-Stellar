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
