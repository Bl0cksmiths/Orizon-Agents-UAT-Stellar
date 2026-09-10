import { test, expect, type Page } from "@playwright/test";
import {
  ONCHAIN_AGENT_ID,
  ONCHAIN_AGENT_OWNER,
  NON_OWNER_ADDRESS,
  COLD_START_TIMEOUT,
  stubWalletSession,
} from "./fixtures";

/**
 * Operator agent management on /app/agents — owner-gating and confirmation
 * copy (AM-01..AM-04).
 *
 * SIGNING SAFETY: the target reports mainnet while this programme is
 * testnet-only (defect D-001), so no test in this file may click a control
 * that builds and submits a transaction. Per manage-panel.tsx, "Update
 * price" and "Confirm delist" both flow through `run()`, which signs and
 * submits — neither is ever clicked here. "Delist" only flips local
 * component state (`setConfirmingDelist(true)`) to reveal the confirmation
 * copy; it is the only manage-panel button this file interacts with.
 *
 * There is exactly one on-chain agent on the target (`ONCHAIN_AGENT_ID`,
 * "orizon_batch"); every other (seeded) agent carries `owner: null` and can
 * never pass the ownership check in page.tsx (`wallet.connected && !!a.owner
 * && a.owner === wallet.address`). Assertions below are written to fail
 * loudly if a reseed removes or renames that on-chain agent, rather than
 * silently passing on an empty result set.
 */

const AGENTS_URL = "/app/agents";

/** The <tr> for a given agent id, found via its row-header cell (`<th
 * scope="row">{a.id}</th>`) rather than a CSS selector. */
function agentRow(page: Page, id: string) {
  return page
    .getByRole("rowheader", { name: id, exact: true })
    .locator("xpath=ancestor::tr[1]");
}

test.describe("AM-01/AM-02 — owner gating on /app/agents", () => {
  test("AM-01 a wallet whose address equals the on-chain agent's owner sees a manage action on that row", async ({ page }) => {
    await stubWalletSession(page, { address: ONCHAIN_AGENT_OWNER });
    await page.goto(AGENTS_URL);

    const row = agentRow(page, ONCHAIN_AGENT_ID);
    // Cold backend: the row only exists once the real agents fetch lands.
    await expect(row).toBeVisible({ timeout: COLD_START_TIMEOUT });

    const manageBtn = row.getByRole("button", { name: "⚙ manage", exact: true });
    await expect(manageBtn).toBeVisible();
    await expect(manageBtn).toBeEnabled();
    // The disabled, non-owner affordance must not also be present on an
    // owned row.
    await expect(row.getByRole("button", { name: "▸ view" })).toHaveCount(0);
  });
});
