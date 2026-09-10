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

test.describe("VR-06: a 429 while registering is recoverable, not dead", () => {
  test("[VR-06] /app/register: the wait is communicated in plain language AND every typed field survives", async ({
    page,
  }) => {
    await stubWalletSession(page);
    await stubIdAvailable(page);
    const retryAfterSeconds = 22;
    // RS-04 (resilience.spec.ts) already proves this exact copy renders on a
    // 429 — what it never checks is what's left in the form afterwards. That
    // survival is the whole point of this test, asserted below alongside the
    // message so a regression that clears the form on error still fails a
    // VR-06-labelled test even if RS-04 stays green.
    await page.route("**/api/stellar/build/register-agent", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": String(retryAfterSeconds) },
        body: JSON.stringify({
          error: { code: "rate_limited", message: "Too Many Requests" },
        }),
      }),
    );

    await page.goto("/app/register");

    const idField = page.locator("#reg-agent-id");
    const nameField = page.locator("#reg-name");
    const priceField = page.locator("#reg-price");

    const typedId = "vr06_retry_probe";
    const typedName = "VR06 Retry Probe";
    const typedPrice = "2.5";

    await idField.fill(typedId);
    await idField.blur();
    await expect(page.getByText("✓ available")).toBeVisible();

    await nameField.fill(typedName);
    await priceField.fill(typedPrice);

    await page.getByRole("button", { name: /register agent/i }).click();

    // The wait, in plain language — lib/rate-limit-message.ts's exact copy.
    await expect(
      page.getByRole("alert").filter({
        hasText: `Too many requests — wait ${retryAfterSeconds}s and try again. Nothing was lost.`,
      }),
    ).toBeVisible();

    // Recoverable, not dead: every value already typed is still there — the
    // page never clears the form on this error path (register/page.tsx's
    // catch only sets formError/txState, none of the field setters).
    await expect(idField).toHaveValue(typedId);
    await expect(nameField).toHaveValue(typedName);
    await expect(priceField).toHaveValue(typedPrice);
  });
});

test.describe("VR-07: the availability check fires on blur, not per keystroke", () => {
  test("[VR-07] /app/register: continuous typing in the id field makes zero availability requests; blur makes exactly one", async ({
    page,
  }) => {
    let requestCount = 0;
    // No stubWalletSession/build stub needed — this test never submits, it
    // only exercises the id field's onChange/onBlur wiring
    // (app/app/register/page.tsx: onChange resets idCheck locally with no
    // network call; onBlur calls runIdCheck(), the only path that invokes
    // idCheck.run() -> agentIdAvailable() -> this GET).
    await page.route("**/api/stellar/agent-id-available/**", (route) => {
      requestCount += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          available: true,
          reason: null,
          message: null,
          owner: null,
        }),
      });
    });

    await page.goto("/app/register");

    const idField = page.locator("#reg-agent-id");
    // pressSequentially sends a real keydown/input/keyup per character —
    // fill() sets the value in one shot and would never exercise a
    // per-keystroke regression.
    await idField.pressSequentially("vr07_no_per_keystroke", { delay: 20 });

    expect(
      requestCount,
      "typing must not fire the availability check per keystroke",
    ).toBe(0);

    await idField.blur();

    // Auto-retrying: the GET is async, so give it a window to land rather
    // than asserting the instant after blur().
    await expect
      .poll(() => requestCount, {
        timeout: 10_000,
        message: "blur must fire exactly one availability check",
      })
      .toBe(1);

    // And it stays at exactly one — no follow-up request sneaks in behind it.
    await expect(page.getByText("✓ available")).toBeVisible();
    expect(requestCount).toBe(1);
  });
});

test.describe("RE-01: register stays open without a wallet; send hard-gates", () => {
  test("[RE-01] /app/register: all three fields render editable with a connect prompt; /app/send: the payment form is not mounted", async ({
    page,
  }) => {
    // No stubWalletSession anywhere in this test — RE-01 is specifically
    // about the disconnected state, and stubbing a session here would defeat
    // the point. Neither page load below ever connects or signs.
    await page.goto("/app/register");

    const idField = page.locator("#reg-agent-id");
    const nameField = page.locator("#reg-name");
    const priceField = page.locator("#reg-price");

    // Visible AND actually editable — a visible-but-disabled input would
    // still pass a bare toBeVisible() but defeats RE-01's "fillable" clause.
    // (register/page.tsx only disables these on `submitting`, never on
    // `!wallet.connected`.)
    await expect(idField).toBeVisible();
    await expect(idField).toBeEditable();
    await expect(nameField).toBeVisible();
    await expect(nameField).toBeEditable();
    await expect(priceField).toBeVisible();
    await expect(priceField).toBeEditable();

    await idField.fill("re01_no_wallet_probe");
    await nameField.fill("RE01 No Wallet Probe");
    await priceField.fill("3.5");

    // The values actually stick — proves editable, not merely enabled-looking.
    await expect(idField).toHaveValue("re01_no_wallet_probe");
    await expect(nameField).toHaveValue("RE01 No Wallet Probe");
    await expect(priceField).toHaveValue("3.5");

    // The connect prompt sits beside submit, not instead of the form.
    await expect(page.getByText("connect a wallet to register")).toBeVisible();

    // Contrast case, same test: /app/send hard-gates the identical
    // disconnected state by never mounting the form at all
    // (send/page.tsx wraps it in `{wallet.connected && (...)}`). Asserting
    // both sides here is the point of RE-01 — a test that only checked
    // register would still pass if send were later loosened to match it.
    await page.goto("/app/send");

    await expect(page.locator("#send-destination")).toHaveCount(0);
    await expect(page.locator("#send-amount")).toHaveCount(0);
    await expect(page.locator("#send-memo")).toHaveCount(0);
  });
});

test.describe("RE-02: a free id confirms availability on blur", () => {
  test("[RE-02] /app/register: blurring a valid, unregistered id shows the affirmative available state and no error", async ({
    page,
  }) => {
    // No stubWalletSession — the id-availability check is wired to onBlur
    // regardless of wallet.connected (register/page.tsx), so RE-02 needs no
    // wallet either, and this test never connects or signs.
    await stubIdAvailable(page);

    await page.goto("/app/register");

    const idField = page.locator("#reg-agent-id");
    await idField.fill("re02_available_probe");
    await idField.blur();

    // The affirmative confirmation itself — the exact "✓ available" copy
    // register/page.tsx renders once idCheck.data.available is true. This is
    // what VR-07 never asserts: it counts requests, not the resulting state.
    await expect(page.getByText("✓ available")).toBeVisible();

    // And no error note takes its place.
    await expect(page.locator("#reg-agent-id-err")).toHaveCount(0);
    await expect(idField).toHaveAttribute("aria-invalid", "false");
  });
});
