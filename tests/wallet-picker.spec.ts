import { test, expect } from "@playwright/test";

/**
 * WM-01 — every wallet the build allowlists is offered when the connect
 * picker opens on /app/register.
 *
 * lib/wallet.tsx lazy-loads @creit.tech/stellar-wallets-kit (a dynamic
 * import) on the first `connect()` call, then calls `StellarWalletsKit.init()`
 * with an explicit `filterBy` allowlist over the kit's nine bundled wallet
 * modules. `authModal()` renders the picker as a plain Preact tree appended
 * straight to `document.body` (confirmed by reading the installed
 * @creit.tech/stellar-wallets-kit source — no shadow DOM, no custom element,
 * so ordinary Playwright locators reach it) and populates the wallet list
 * from `refreshSupportedWallets()`, which races each module's own
 * `isAvailable()` probe against a 1s timeout. No wallet extension exists in
 * CI, so every wallet renders in its "not detected" state — the picker still
 * lists all six by name, which is exactly what WM-01 requires.
 *
 * SAFETY — this file never clicks a wallet entry. Reading the kit's
 * `onWalletSelected` source (auth-options.page.js): a detected ("available")
 * wallet is asked for its address immediately on click, with no separate
 * confirmation step, and an undetected one opens the wallet's install page
 * in a new tab. Neither is safe here — the target reports mainnet while this
 * programme is testnet-only (defect D-001), and even the "not detected"
 * branch would spawn an uncontrolled new page. Every test below only opens
 * the picker and dismisses it.
 */

const REGISTER_URL = "/app/register";

/**
 * The kit's dynamic import + StellarWalletsKit.init() + the module registry
 * scan (`refreshSupportedWallets()`, each entry racing its own extension
 * probe against a 1s timeout) all happen after the first "Connect Wallet"
 * click, not on page load — generous on purpose so a cold chunk fetch on a
 * slow CI runner doesn't flake this test.
 */
const PICKER_OPEN_TIMEOUT = 30_000;

/**
 * Mirrors `SUPPORTED_WALLET_IDS` in lib/wallet.tsx (freighter, xbull, albedo,
 * lobstr, hana, rabet — six ids, including Rabet even though SOW §3.3 names
 * only five; that gap is defect D-016 and is not this test's to resolve)
 * together with the exact display name each wallet module reports as
 * `productName` in the installed @creit.tech/stellar-wallets-kit — the
 * picker renders `wallet.name = mod.productName` directly, not
 * lib/wallet.tsx's own `prettyName()` fallback (which only ever labels an
 * already-connected session, never the picker itself). One name genuinely
 * differs from that fallback map: the kit's Hana module reports "Hana
 * Wallet", not "Hana" — asserted here as the kit actually renders it.
 *
 * Kept as a literal list rather than imported from lib/wallet.tsx: this
 * suite runs against the deployed site, not the source tree (see
 * fixtures.ts's WALLET_STORAGE_KEY comment for the same reasoning). If the
 * allowlist ever changes without this list being updated too, a wallet
 * added, removed or renamed on the build side fails this test loudly rather
 * than silently passing on a stale subset.
 */
const EXPECTED_WALLETS = [
  "Freighter",
  "xBull",
  "Albedo",
  "LOBSTR",
  "Hana Wallet",
  "Rabet",
] as const;

test.describe("WM-01: connect picker offers every allowlisted wallet", () => {
  test("WM-01 opening the picker on /app/register lists every wallet lib/wallet.tsx allowlists", async ({
    page,
  }) => {
    await page.goto(REGISTER_URL);

    // Two "Connect Wallet" buttons render disconnected on this route (the
    // topbar's and the register card's own) — same pattern wallet.spec.ts
    // documents for /app/send. Either opens the same picker; take the first.
    await page.getByRole("button", { name: "Connect Wallet" }).first().click();

    // The picker's own title, set by the kit's AuthOptionsPage — role-based,
    // unlike the wallet items' unnamed icon buttons a later test deals with.
    await expect(
      page.getByRole("heading", { name: "Connect Wallet" }),
    ).toBeVisible({ timeout: PICKER_OPEN_TIMEOUT });

    for (const walletName of EXPECTED_WALLETS) {
      await expect(page.getByText(walletName, { exact: true })).toBeVisible();
    }
  });

  test("WM-01 the picker is dismissible via its own close control without connecting, and the page stays usable and disconnected", async ({
    page,
  }) => {
    await page.goto(REGISTER_URL);

    const connectButton = page
      .getByRole("button", { name: "Connect Wallet" })
      .first();
    await connectButton.click();

    const heading = page.getByRole("heading", { name: "Connect Wallet" });
    await expect(heading).toBeVisible({ timeout: PICKER_OPEN_TIMEOUT });

    // The kit's close (X) button (components/shared/header.js in the kit
    // source) is a real <button> but carries no accessible name at all — no
    // aria-label, no text, just an SVG glyph — so role-with-name and text
    // locators can't reach it. Escape does not close this modal either: the
    // installed kit has no keydown/Escape handling anywhere in its bundle
    // (verified by grepping the extracted package — reported as a finding,
    // not fixed here). This SVG path is the close icon's own glyph, unique
    // within the picker and more specific than a positional CSS path would
    // be; it's used only because no accessible-name or text locator exists
    // for this control.
    await page
      .locator('.stellar-wallets-kit button:has(svg path[d^="M11.9997 10.5865"])')
      .click();

    // The kit's authModal() close() unmounts the Preact tree and removes its
    // wrapper node entirely (not just hides it), so the heading must be gone
    // from the DOM, not merely invisible.
    await expect(heading).toHaveCount(0);

    // Nothing was auto-selected or auto-connected merely by opening and
    // closing the picker: the page must still offer to connect, never show a
    // connected address/badge.
    await expect(connectButton).toBeVisible();
    await expect(connectButton).toBeEnabled();

    // The page underneath stays interactive — a picker that traps focus or
    // input would leave this unusable even after the modal itself is gone.
    const idField = page.locator("#reg-agent-id");
    await idField.fill("wm01_picker_dismiss_probe");
    await expect(idField).toHaveValue("wm01_picker_dismiss_probe");
  });
});
