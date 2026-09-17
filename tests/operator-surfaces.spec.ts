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

// Registered by earlier programme runs and never cleaned up: w1_audit_a7x and
// sign_probe_bb5c12, both unbound.
const SEVERAL_AGENTS_OWNER = "GBI2I3WLMP2Q6L26G7CBKRPP5WJ6G3GGYJHWALOJ7D6EBRGL5OZAADBH";

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

  test("OS-07 a wallet owning several agents sees counts that match the registry and the bindings", async ({ page, request }) => {
    test.setTimeout(240_000);
    const owner = SEVERAL_AGENTS_OWNER;
    const agents = (await (await request.get("/api/agents", { timeout: 90_000 })).json()) as { id: string; owner: string | null }[];
    const owned = agents.filter((agent) => agent.owner === owner).map((agent) => agent.id);
    expect(owned.length, "the fixture wallet must still own several agents").toBeGreaterThan(1);
    let bound = 0;
    for (const id of owned) {
      if ((await request.get(`/api/agents/${id}/binding`, { timeout: 90_000 })).status() === 200) bound += 1;
    }

    await stubWalletSession(page, { address: owner });
    await page.goto("/app/operator");
    for (const id of owned) await expect(page.getByText(id, { exact: true }).first()).toBeVisible({ timeout: 90_000 });
    const main = page.locator("main");
    await expect(main).toContainText(new RegExp(`agents owned\\s*${owned.length}`, "i"));
    await expect(main).toContainText(new RegExp(`endpoint bound\\s*${bound}\\s*of\\s*${owned.length}`, "i"));
  });

  test("OS-07 an agent with no endpoint bound is not presented as online", async ({ page }) => {
    // D-044: the card's status badge reads the catalog's `status`, which is
    // "online" for every on-chain agent, bound or not.
    test.fail();
    test.setTimeout(180_000);
    await stubWalletSession(page, { address: SEVERAL_AGENTS_OWNER });
    await page.goto("/app/operator");
    const card = page.locator("main li").filter({ has: page.getByText("w1_audit_a7x", { exact: true }) }).first();
    await expect(card.getByText("unbound", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(card.getByText("online", { exact: true })).toHaveCount(0);
  });

  test("OS-07 a card that says its agent is not eligible does not also call it routable", async ({ page }) => {
    // D-045: the never-rated note under Gate 2 always ends "an agent with no
    // history is routable from the day it is registered", whatever Gate 1 says.
    test.fail();
    test.setTimeout(180_000);
    await stubWalletSession(page, { address: SEVERAL_AGENTS_OWNER });
    await page.goto("/app/operator");
    const card = page.locator("main li").filter({ has: page.getByText("w1_audit_a7x", { exact: true }) }).first();
    await expect(card.getByText("Not eligible — no endpoint is bound.", { exact: false })).toBeVisible({ timeout: 90_000 });
    await expect(card).not.toContainText("routable from the day it is registered");
  });

  test("OS-07 a settlement lookup that failed is not shown as zero earnings", async ({ page }) => {
    test.setTimeout(180_000);
    await stubWalletSession(page, { address: SEVERAL_AGENTS_OWNER });
    const settlement = page.waitForResponse((r) => r.url().includes("/api/stellar/settlement/w1_audit_a7x"), { timeout: 120_000 });
    await page.goto("/app/operator");
    const card = page.locator("main li").filter({ has: page.getByText("w1_audit_a7x", { exact: true }) }).first();
    if ((await settlement).ok()) {
      await expect(card.getByText("settled revenue", { exact: false })).toBeVisible({ timeout: 90_000 });
    } else {
      await expect(card).toContainText("This is a failed lookup, not a zero — no figure is shown because none was read.", { timeout: 90_000 });
      await expect(card.getByText("settled revenue", { exact: false })).toHaveCount(0);
    }
  });

  test("OS-07 where the money would be, the dashboard names the escrow defect instead of a zero", async ({ page }) => {
    // D-036: the deployed backend has no settlement route, so the panel can
    // only report a failed lookup and the escrow explanation never renders.
    // Remove the marker once GET /api/stellar/settlement/{id} answers 200.
    test.fail();
    test.setTimeout(180_000);
    await stubWalletSession(page, { address: SEVERAL_AGENTS_OWNER });
    await page.goto("/app/operator");
    const card = page.locator("main li").filter({ has: page.getByText("w1_audit_a7x", { exact: true }) }).first();
    await expect(card.getByText("Settlement", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(card.getByText("Why nothing settles", { exact: false })).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("This is a defect in the escrow contract, on the platform's side of the line.");
    await expect(card).toContainText("It is not a measure of your agent, and not a signal about demand for it.");
  });

  test("OS-05 an already-bound agent shows the endpoint that reads back, and binding again replaces it", async ({ page, request }) => {
    test.setTimeout(180_000);
    // Bound in 6.05 and rebound twice there; the registry is the source of truth.
    const binding = await (await request.get("/api/agents/uat605_ext_op/binding", { timeout: 90_000 })).json();
    const host = new URL(binding.endpoint_url as string).host;

    await stubWalletSession(page, { address: binding.owner as string });
    await page.goto("/app/bind?agent=uat605_ext_op");
    await expect(page.getByText(host, { exact: false }).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByLabel("replacement endpoint url")).toBeVisible();
    await expect(page.getByText("Binding replaces the endpoint above.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Replace endpoint/ })).toBeVisible();
  });

  test.describe("OS-08 at a phone viewport (emulated — the real-phone pass is the checklist)", () => {
    test.use({ viewport: { width: 360, height: 780 }, hasTouch: true });

    for (const route of ["/app/bind?agent=uat605_ext_op", "/app/operator"]) {
      test(`OS-08 ${route} fits the screen width with nothing cut off sideways`, async ({ page }) => {
        test.setTimeout(180_000);
        await stubWalletSession(page, { address: SEVERAL_AGENTS_OWNER });
        await page.goto(route);
        await expect(page.locator("main h1")).toBeVisible({ timeout: 90_000 });
        await page.waitForLoadState("networkidle", { timeout: 90_000 }).catch(() => undefined);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, "horizontal scroll hides fields, messages or figures").toBeLessThanOrEqual(0);
      });
    }
  });
});
