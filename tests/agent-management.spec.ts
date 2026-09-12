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

  test("AM-02 a wallet that owns nothing sees no management action on the on-chain agent's row", async ({ page }) => {
    await stubWalletSession(page, { address: NON_OWNER_ADDRESS });
    await page.goto(AGENTS_URL);

    const row = agentRow(page, ONCHAIN_AGENT_ID);
    await expect(row).toBeVisible({ timeout: COLD_START_TIMEOUT });

    // page.tsx's ownership check requires an exact address match, so a
    // connected-but-unrelated wallet must fall into the disabled affordance,
    // never the enabled "⚙ manage" one.
    await expect(row.getByRole("button", { name: "▸ view" })).toBeVisible();
    await expect(row.getByRole("button", { name: "▸ view" })).toBeDisabled();
    await expect(row.getByRole("button", { name: "⚙ manage" })).toHaveCount(0);

    // No management action anywhere on the page for this wallet at all —
    // not just absent on this one row.
    await expect(page.getByRole("button", { name: "⚙ manage" })).toHaveCount(0);
  });

  test("AM-02 seeded agents (owner: null) never show a management action, even for the wallet that owns the on-chain agent", async ({ page }) => {
    await stubWalletSession(page, { address: ONCHAIN_AGENT_OWNER });
    await page.goto(AGENTS_URL);

    const onchainRow = agentRow(page, ONCHAIN_AGENT_ID);
    await expect(onchainRow).toBeVisible({ timeout: COLD_START_TIMEOUT });
    // Sanity: the wallet does own the one on-chain agent, so this run is
    // actually exercising "owned wallet, unowned other rows" and not an
    // accidentally-disconnected session.
    await expect(onchainRow.getByRole("button", { name: "⚙ manage" })).toBeVisible();

    // Every other row belongs to a seeded agent with `owner: null`, which
    // can never satisfy `a.owner === wallet.address` — assert the disabled
    // affordance on each of them explicitly rather than trusting a page-wide
    // count, so a future extra on-chain agent doesn't silently blind this
    // assertion.
    const otherRows = page
      .locator("tbody tr")
      .filter({ hasNot: page.getByRole("rowheader", { name: ONCHAIN_AGENT_ID, exact: true }) });
    const otherRowCount = await otherRows.count();
    expect(otherRowCount).toBeGreaterThan(0);
    for (let i = 0; i < otherRowCount; i++) {
      const r = otherRows.nth(i);
      await expect(r.getByRole("button", { name: "▸ view" })).toBeVisible();
      await expect(r.getByRole("button", { name: "▸ view" })).toBeDisabled();
      await expect(r.getByRole("button", { name: "⚙ manage" })).toHaveCount(0);
    }

    // Exactly one management action exists on the whole page.
    await expect(page.getByRole("button", { name: "⚙ manage" })).toHaveCount(1);
  });
});

test.describe("AM-03 — price control confirmation copy", () => {
  test("AM-03 the price note states future-plans-only and that an already-authorized buyer is charged the signed price", async ({ page }) => {
    await stubWalletSession(page, { address: ONCHAIN_AGENT_OWNER });
    await page.goto(AGENTS_URL);

    const row = agentRow(page, ONCHAIN_AGENT_ID);
    await expect(row).toBeVisible({ timeout: COLD_START_TIMEOUT });

    // Opening the manage panel only expands local UI state — it builds,
    // signs and submits nothing.
    await row.getByRole("button", { name: "⚙ manage" }).click();

    // Verbatim string from manage-panel.tsx's price section — never
    // paraphrased, so a copy edit there fails this test rather than sliding
    // past it.
    await expect(
      page.getByText(
        "A price change applies to future plans only. A buyer who already authorized a workflow is charged the price they signed against.",
      ),
    ).toBeVisible();

    // This note is unconditional on the price field's validity/edited state
    // — it must not depend on the "Update price" button having been clicked
    // (which this suite never does, since that signs and submits).
    await expect(page.getByRole("button", { name: "Update price" })).toBeVisible();
  });
});

test.describe("AM-04 — delist control confirmation copy", () => {
  test("AM-04 the delist confirmation states in-flight work is unaffected, history/reputation are retained, and never calls it a delete", async ({ page }) => {
    await stubWalletSession(page, { address: ONCHAIN_AGENT_OWNER });
    await page.goto(AGENTS_URL);

    const row = agentRow(page, ONCHAIN_AGENT_ID);
    await expect(row).toBeVisible({ timeout: COLD_START_TIMEOUT });
    await row.getByRole("button", { name: "⚙ manage" }).click();

    // Before confirming: the standing note next to the (unclicked) Delist
    // button, verbatim from manage-panel.tsx.
    const delistBtn = page.getByRole("button", { name: "Delist", exact: true });
    await expect(delistBtn).toBeVisible();
    await expect(
      page.getByText(
        "Delisting is reversible and never a delete — history and reputation survive.",
      ),
    ).toBeVisible();

    // "Delist" only flips local state (setConfirmingDelist(true)) — it
    // builds/signs/submits nothing. Safe to click. "Confirm delist" (which
    // signs and submits) is asserted visible below but is NEVER clicked.
    await delistBtn.click();

    await expect(
      page.getByText(
        "Delisting stops new work being routed to this agent. In-flight authorized work is unaffected, and your reputation and history are retained. You can relist any time.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm delist" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();

    // The action is never presented as a delete anywhere in the panel.
    await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);
    await expect(page.getByText(/\bdelete\b/i)).toHaveCount(0);
  });
});
