import { test, expect, type Page } from "@playwright/test";
import { ONCHAIN_AGENT_ID, COLD_START_TIMEOUT } from "./fixtures";

/**
 * On-chain provenance and listing state on /app/agents (PR-01..PR-03).
 *
 * `source` is contracted as "provable from the API" (app/schemas.py:10-12,
 * SOW §6.3) — it is never rendered as a UI element (verified by reading
 * app/app/agents/page.tsx: the table's columns are id, agent, skills,
 * price / call, reputation, runs, status, and an unlabelled manage cell).
 * Nothing here asserts a provenance badge that does not exist. What IS
 * visible, and is what these tests hold onto instead:
 *   - the `id` column: seeded rows are `agt_`-prefixed, the on-chain row is
 *     not (ONCHAIN_AGENT_ID, "orizon_batch");
 *   - the `status` column, which mirrors the on-chain `active` flag
 *     (registry_sync.py: status = "online" if raw["active"] else "offline");
 *   - cross-view consistency between the row and `GET /api/agents`.
 *
 * SIGNING SAFETY: no test in this file opens the manage panel or clicks
 * anything that builds/signs/submits a transaction — owner-gating and the
 * manage panel itself are agent-management.spec.ts's job and are not
 * duplicated here. PR-02/PR-03's write halves (a real delist/relist) are
 * blocked by D-001 (target reports mainnet while this programme is
 * testnet-only); the coverage here instead pins the render path those
 * writes depend on, by stubbing GET /api/agents at the network layer with
 * the same shape a real sync would produce.
 */

const AGENTS_URL = "/app/agents";

/** The <tr> for a given agent id, found via its row-header cell (`<th
 * scope="row">{a.id}</th>`) rather than a CSS selector. */
function agentRow(page: Page, id: string) {
  return page
    .getByRole("rowheader", { name: id, exact: true })
    .locator("xpath=ancestor::tr[1]");
}

test.describe("PR-01 — on-chain agent distinguishable from the seeded catalog", () => {
  test("the on-chain agent's id is not agt_-prefixed, alongside twelve agt_-prefixed seeded rows", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(AGENTS_URL);

    const rowheaders = page.getByRole("table").locator("tbody tr").getByRole("rowheader");
    // Cold backend: rows only exist once the real agents fetch lands.
    await expect(rowheaders.first()).toBeVisible({ timeout: COLD_START_TIMEOUT });

    const ids = (await rowheaders.allTextContents()).map((id) => id.trim());
    const seededIds = ids.filter((id) => id.startsWith("agt_"));
    const onchainIds = ids.filter((id) => id.length > 0 && !id.startsWith("agt_"));

    // Asserted explicitly so a reseed that drops or shrinks the catalog
    // fails loudly rather than this test passing vacuously against a
    // near-empty table.
    expect(seededIds.length).toBe(12);
    expect(onchainIds).toContain(ONCHAIN_AGENT_ID);
  });

  test("the on-chain row's price and status match what GET /api/agents reports", async ({ page, request }) => {
    test.setTimeout(120_000);
    // Cross-view consistency: this is the assertion that catches the UI
    // drifting from the mirror it is supposed to render.
    const apiResponse = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
    expect(apiResponse.ok()).toBe(true);
    const apiAgents: Array<{ id: string; price: number; status: string }> =
      await apiResponse.json();
    const apiAgent = apiAgents.find((a) => a.id === ONCHAIN_AGENT_ID);
    if (!apiAgent) {
      throw new Error(`onchain agent ${ONCHAIN_AGENT_ID} missing from GET /api/agents`);
    }

    await page.goto(AGENTS_URL);
    const row = agentRow(page, ONCHAIN_AGENT_ID);
    await expect(row).toBeVisible({ timeout: COLD_START_TIMEOUT });

    // <td> order after the id <th>: agent(0), skills(1), price(2),
    // reputation(3), runs(4), status(5), actions(6).
    const cells = row.locator("td");
    await expect(cells.nth(2)).toHaveText(apiAgent.price.toFixed(3));
    await expect(cells.nth(5)).toHaveText(apiAgent.status);
  });
});
