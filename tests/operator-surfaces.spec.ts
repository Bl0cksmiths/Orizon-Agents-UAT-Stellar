import { test, expect } from "@playwright/test";
import { stubWalletSession } from "./fixtures";

/**
 * OS — story 6.06, the operator's surfaces as an outsider meets them on the
 * deployed dApp: the registration page's disclosure of the second signature,
 * the bind page's endpoint policy, and the My Agents dashboard in each wallet
 * state. What needs a real wallet prompt or a real phone is covered by
 * docs/uat/checklists/6.06-wallet-and-phone.md instead.
 */

const TWO_SIGNATURES =
  "Listing an agent takes two signatures. This one is the on-chain registration transaction. Binding an endpoint afterwards takes a second, separate signature — a signed message that proves you own the agent. It moves no funds and costs no fee.";

test.describe("OS — operator surfaces (story 6.06)", () => {
  test("OS-03 the registration page explains both signatures before anything is clicked", async ({ page }) => {
    await page.goto("/app/register");
    const disclosure = page.getByText(TWO_SIGNATURES);
    await expect(disclosure).toBeVisible();
    // Before the first prompt means above the only control that opens one.
    const submit = page.getByRole("button", { name: /Register agent/ });
    await expect(submit).toBeVisible();
    const disclosureBox = await disclosure.boundingBox();
    const submitBox = await submit.boundingBox();
    expect(disclosureBox!.y).toBeLessThan(submitBox!.y);
  });

  for (const refused of [
    { kind: "plaintext", url: "http://example.com/dispatch", rule: "scheme_not_https" },
    { kind: "private", url: "https://10.0.0.5/dispatch", rule: "non_public_address" },
    { kind: "loopback", url: "https://localhost/dispatch", rule: "loopback_host" },
  ]) {
    test(`OS-06 a ${refused.kind} endpoint is refused before signing, naming its rule`, async ({ page }) => {
      await page.goto("/app/bind");
      await page.getByLabel("endpoint url").fill(refused.url);
      const refusal = page.locator("#bind-endpoint-err");
      await expect(refusal).toContainText(`rule: ${refused.rule}`, { timeout: 90_000 });
      await expect(refusal).toHaveAttribute("role", "alert");
      await expect(page.getByRole("button", { name: /Bind endpoint/ })).toBeDisabled();
    });
  }

  test("OS-06 an unresolvable endpoint is refused before signing, naming its rule", async ({ page }) => {
    // D-043: the preflight never resolves DNS, so an unresolvable host is
    // allowed here and refused only by the bind itself, after the wallet has
    // signed. Remove the marker when the refusal happens before the prompt.
    test.fail();
    await page.goto("/app/bind");
    await page.getByLabel("endpoint url").fill("https://orizon-uat-no-such-host-606.invalid/dispatch");
    await expect(page.locator("#bind-endpoint-err")).toContainText("rule: unresolvable_host", { timeout: 30_000 });
  });

  test("OS-07 with no wallet the dashboard claims nothing about ownership", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/app/operator");
    await expect(page.getByText("Connect a wallet", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(
      page.getByText(
        "Agent ownership is recorded on-chain against an account, so there is nothing to show until a wallet is connected.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(page.getByText("agents owned", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Settlement", { exact: true })).toHaveCount(0);
  });

  test("OS-07 a wallet that owns nothing is told so, and why another wallet's agents are absent", async ({ page }) => {
    test.setTimeout(180_000);
    // The 6.05 payer: a real testnet account that has never registered an agent.
    await stubWalletSession(page, { address: "GDJHP2I6NRCWYZTB3ZOXRE74V4M4EGXRYORGNPTGQ6BVNJNSSJO4PKXJ" });
    await page.goto("/app/operator");
    await expect(page.getByText("This wallet owns no agents", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("Ownership is read from the chain, not from this browser.", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Register an agent" }).or(page.getByRole("button", { name: "Register an agent" }))).toBeVisible();
    await expect(page.getByText("agents owned", { exact: false })).toHaveCount(0);
  });
});
