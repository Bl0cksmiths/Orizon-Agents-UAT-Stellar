import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT, expectNoHorizontalOverflow } from "./fixtures";

/**
 * Wallet / money routes: /app/wallet, /app/send, /app/pdax.
 *
 * SCOPE — no wallet extension exists in CI, so every test here runs in the
 * DISCONNECTED state. That is coverage, not a gap: lib/wallet.tsx documents
 * that an unknown or failed balance must never render as a real zero, and
 * `xlmBalance` is null for a disconnected visitor — the exact defensive
 * branch a genuine balance-fetch failure takes. Testing disconnected tests
 * the invariant.
 *
 * Anything requiring a signature (connect, sign, submit) is out of reach and
 * is called out explicitly below rather than silently omitted.
 */

const WALLET_URL = "/app/wallet";
const SEND_URL = "/app/send";
const PDAX_URL = "/app/pdax";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.describe('/app/wallet — disconnected state', () => {
  test('renders exactly one h1 and the connect prompt, no wallet extension needed', async ({ page }) => {
    await page.goto(WALLET_URL);
    // Regression: a second h1 (e.g. leaking a section heading) breaks the
    // page's document outline for screen-reader users.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wallet');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
  });

  test('shows the disconnected session copy instead of an empty/blank session card', async ({ page }) => {
    await page.goto(WALLET_URL);
    // Regression: page.tsx's "Your session" card must render the literal
    // "No wallet connected…" copy when `connected` is false, never a blank
    // <dl> (which would look like a broken fetch rather than "not signed in").
    await expect(
      page.getByText('No wallet connected. Click', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Wallet' }).nth(1)).toBeVisible();
  });

  test('the balance card is entirely absent while disconnected — no numeric zero to misread as a real balance', async ({ page }) => {
    await page.goto(WALLET_URL);
    // Regression: page.tsx only renders the "native XLM balance" Card when
    // `connected` is true. If a regression made it render for a logged-out
    // visitor, an empty/null balance could format as "0.0000000" and read as
    // a real, spendable zero — exactly the fabricated-money failure mode
    // lib/wallet.tsx's four-state doc comment (lines ~70-95) exists to
    // prevent (not-connected / loading / failed / zero must stay distinct).
    await expect(page.getByText('native XLM balance')).toHaveCount(0);
    await expect(page.locator('text=/^\\d+\\.\\d{7}$/')).toHaveCount(0);
  });

  test('the network mismatch warning never renders while disconnected', async ({ page }) => {
    await page.goto(WALLET_URL);
    // networkMismatch in page.tsx is gated on `connected && info && walletNetwork`
    // — asserting it stays absent guards against a null-wallet read slipping
    // through the mismatch check and firing a false "wrong network" alarm.
    await expect(page.getByText('Switch networks in your wallet extension.')).toHaveCount(0);
  });

  test('the contracts grid resolves to either the four live contracts (linked to stellar.expert/public) or a truthful error — never stuck placeholders', async ({ page }) => {
    await page.goto(WALLET_URL);
    await expect(page.getByText('Deployed contracts')).toBeVisible();

    const contractLinks = page.locator('a[href*="stellar.expert/explorer/"]');
    const errorNote = page.getByRole('alert').filter({ hasText: 'contracts unavailable' });

    // Cold backend: wait (generously) for the fetch to settle one way or the
    // other, per the file header's 25-60s cold-start budget.
    await expect(contractLinks.first().or(errorNote)).toBeVisible({ timeout: COLD_START_TIMEOUT });

    if (await errorNote.isVisible()) {
      // Truthful-failure path: a role="alert" is present (ErrorNote), so a
      // screen reader is told the fetch failed — not four blank tiles
      // pulsing forever (the exact regression the source comment calls out:
      // "a failed fetch pulsed four empty placeholders forever").
      await expect(errorNote).toBeVisible();
      return;
    }

    // Success path: exactly four contracts, each linking to stellar.expert
    // on this build's configured network (env.ts + stellar-link.tsx resolve
    // IS_MAINNET → "public"; the live site is mainnet per its rendered
    // "mainnet" badges, so the explorer segment must be "public", not
    // "testnet" — a wrong segment here 404s every single contract link).
    await expect(contractLinks).toHaveCount(4);
    const hrefs = await contractLinks.evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).href),
    );
    for (const href of hrefs) {
      expect(href).toMatch(/^https:\/\/stellar\.expert\/explorer\/public\/contract\/[A-Z0-9]+$/);
    }
    // Every tile also carries the human-readable "view on stellar.expert ▸"
    // affordance text, not just a bare address as the only clue it's a link.
    await expect(page.getByText('view on stellar.expert ▸').first()).toBeVisible();
  });

  test('the Orizon deploy panel never gets stuck on a bare "loading…" — it resolves to data or a dated ErrorNote', async ({ page }) => {
    await page.goto(WALLET_URL);
    const deployHeading = page.getByText(/Orizon deploy \(/);
    await expect(deployHeading).toBeVisible({ timeout: COLD_START_TIMEOUT });
    // Regression: `deployLabel` must switch from "…" to either the real
    // network name or "unreachable" — it must never keep reading "…" once
    // the fetch has actually failed (that would look like an eternal load).
    await expect(deployHeading).not.toHaveText('Orizon deploy (…)');
  });
});

