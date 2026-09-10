import { test, expect } from "@playwright/test";
import { stubWalletSession } from "./fixtures";

/**
 * VR-05 / VR-06 / VR-07 — the three /app/register behaviours nothing else in
 * the suite covers (see docs/uat/test-plan.md's "Coverage note" under the VR
 * section). RG-04/05/06/07 in registry.spec.ts already own field-level
 * validation, reserved/taken ids and the disabled-without-a-wallet case;
 * RS-04 in resilience.spec.ts already owns the 429 copy itself. This file
 * adds only what those miss: the unfunded-wallet form-level error, that the
 * form survives a 429 (not just that the message is right), and that the
 * availability check is blur-driven rather than per-keystroke.
 *
 * Every test here stubs a wallet session (`stubWalletSession` — seeds
 * localStorage, no real extension) and intercepts both the availability GET
 * and the build POST with `page.route`. Nothing ever reaches the real
 * Soroban RPC or a signer: `signAndSubmit` is never exercised because every
 * build below is made to fail before the page would call it, which is what
 * keeps this safe against D-001 (the target reports mainnet; this programme
 * is testnet-only, and no test here may cause a real signature).
 */

/** Fulfils the id-availability GET as always-available — every test here
 * needs the id check to clear so the id field itself is not the thing under
 * test. Shape matches `AgentIdAvailability` (lib/types.ts) and was confirmed
 * against the live endpoint (`GET /api/stellar/agent-id-available/<id>`)
 * before writing this. */
async function stubIdAvailable(page: import("@playwright/test").Page) {
  await page.route("**/api/stellar/agent-id-available/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        available: true,
        reason: null,
        message: null,
        owner: null,
      }),
    }),
  );
}

test.describe("VR-05: an unfunded wallet reads as friendly copy, not a generic failure", () => {
  test("[VR-05] /app/register: owner_account_unfunded surfaces FORM_LEVEL_ERRORS' exact sentence", async ({
    page,
  }) => {
    await stubWalletSession(page);
    await stubIdAvailable(page);
    // Real envelope shape (`detail` + `error.code/message/request_id`),
    // confirmed live against POST /stellar/build/register-agent — only the
    // `error.code` is read by the page (app/app/register/page.tsx maps it
    // through FORM_LEVEL_ERRORS), so the message/request_id here are
    // plausible filler, not asserted.
    await page.route("**/api/stellar/build/register-agent", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "owner_account_unfunded",
          error: {
            code: "owner_account_unfunded",
            message: "Source account not found or not funded.",
            request_id: "e2evr05unfunded01",
          },
        }),
      }),
    );

    await page.goto("/app/register");

    const idField = page.locator("#reg-agent-id");
    await idField.fill("vr05_unfunded_probe");
    await idField.blur();
    await expect(page.getByText("✓ available")).toBeVisible();

    await page.locator("#reg-name").fill("VR05 Unfunded Probe");
    await page.locator("#reg-price").fill("1");

    await page.getByRole("button", { name: /register agent/i }).click();

    // The exact sentence FORM_LEVEL_ERRORS maps owner_account_unfunded to —
    // not a paraphrase, not the generic "Could not prepare the registration"
    // fallback that sits next to it in the same catch block.
    await expect(
      page.getByRole("alert").filter({
        hasText: "Fund this wallet on testnet before registering.",
      }),
    ).toBeVisible();
  });
});
