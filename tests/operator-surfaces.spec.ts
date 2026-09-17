import { test, expect } from "@playwright/test";

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
});
