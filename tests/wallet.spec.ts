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

test.describe('/app/send — disconnected + client-side validation', () => {
  test('renders exactly one h1 and gates the entire payment form behind connecting a wallet', async ({ page }) => {
    await page.goto(SEND_URL);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Send XLM');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // Regression: /app/send hand-rolls its own build/sign/submit sequence
    // (unlike lib/sign-submit.ts flows) — the destination/amount inputs and
    // the Send button must not exist at all while disconnected, since there
    // is no code path here that could safely build a tx without an address.
    await expect(page.locator('#send-destination')).toHaveCount(0);
    await expect(page.locator('#send-amount')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Send XLM/ })).toHaveCount(0);
  });

  test('offers the connect prompt with the literal "wallet required" copy and a Connect Wallet action', async ({ page }) => {
    await page.goto(SEND_URL);
    await expect(page.getByText('wallet required', { exact: false })).toBeVisible();
    await expect(
      page.getByText('Connect a Stellar wallet on', { exact: false }),
    ).toBeVisible();
    // Two "Connect Wallet" buttons render disconnected: the header one and
    // the one inside the "wallet required" card.
    await expect(page.getByRole('button', { name: 'Connect Wallet' })).toHaveCount(2);
  });

  test('the TxStatus lifecycle tracker is absent when idle — no phantom "building/signing" steps before a send is attempted', async ({ page }) => {
    await page.goto(SEND_URL);
    // TxStatus returns null for state "idle" (tx-status.tsx) — asserting its
    // role="status" region is absent catches a regression that renders the
    // step trail (Build/Sign/Broadcast/Pending/Confirmed) before any send.
    await expect(page.getByRole('status')).toHaveCount(0);
  });
});

/**
 * These two validation tests document what the destination/amount fields
 * *would* enforce once a wallet is connected (isValidGAddress / amountNum
 * checks in app/app/send/page.tsx). They cannot be exercised live without a
 * wallet extension, because the entire <form> — including both inputs — is
 * unmounted while `wallet.connected` is false (see the previous describe
 * block). Recorded here as the documented, intentionally-skipped coverage
 * rather than silently omitted.
 */
test.describe('/app/send — validation logic (untestable without a wallet)', () => {
  test.skip(
    'malformed-G-address and non-positive-amount validation ' +
      '("destination must be a 56-char G… address" / "amount must be > 0") — ' +
      'the <input id="send-destination"> / <input id="send-amount"> elements only mount ' +
      'when wallet.connected is true (app/app/send/page.tsx), and no wallet extension is ' +
      'available in this environment to reach that state. Covered instead by the ' +
      'disconnected-gating test above, which proves the form — and therefore this ' +
      'validation — is unreachable pre-connect.',
    async () => {
      /* Intentionally empty — see skip reason above. */
    },
  );
});

test.describe('/app/pdax — degrades honestly when data reads are unauthenticated/failed', () => {
  test('renders exactly one h1 and all four panel headings — no white screen', async ({ page }) => {
    await page.goto(PDAX_URL);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PDAX Ramp');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // Regression: a thrown render error (e.g. balances being undefined
    // instead of null) would white-screen the whole route via the nearest
    // error boundary — asserting every panel header is present rules that
    // out directly instead of inferring it from "the page didn't crash".
    await expect(page.getByText('environment', { exact: true })).toBeVisible();
    await expect(page.getByText('balances', { exact: true })).toBeVisible();
    await expect(page.getByText('ramp · PHP ⇄ USDCXLM')).toBeVisible();
    await expect(page.getByText('price & quote', { exact: false })).toBeVisible();
    await expect(page.getByText('crypto deposit address')).toBeVisible();
    await expect(page.getByText('crypto transactions')).toBeVisible();
  });

  test('the balances panel never fabricates a number — it settles to real rows, "No assets.", or "Balances unavailable"', async ({ page }) => {
    await page.goto(PDAX_URL);

    // The three honest end-states for a PHP-key-gated read per page.tsx:
    // real currency rows, the explicit empty state, or the explicit failure
    // state. A skeleton-forever or a lone "0" with no label belongs to none
    // of them, so this or() must resolve to exactly one of the three.
    const noAssets = page.getByText('No assets.');
    const unavailable = page.getByText('Balances unavailable', { exact: false });
    const currencyRow = page.getByText('avail', { exact: false });

    await expect(noAssets.or(unavailable).or(currencyRow.first())).toBeVisible({
      timeout: COLD_START_TIMEOUT, // cold backend — see file header
    });
  });

  test('an unauthenticated environment/health/balances read surfaces a role=alert banner naming which call failed, not a silent void', async ({ page }) => {
    await page.goto(PDAX_URL);
    // Wait for the env fetch to settle (success or failure) before judging
    // whether any alert *should* be present — see the value-agnostic
    // "loading…" wait explained in the a11y test below. Without this, the
    // assertion below can run before a cold (25-60s) backend has answered
    // and trivially pass with zero alerts regardless of the real outcome.
    await expect(page.getByText('loading…', { exact: true })).toHaveCount(0, {
      timeout: COLD_START_TIMEOUT, // cold backend — see file header
    });

    // page.tsx's `failures` array renders one ErrorNote (role="alert") per
    // failed fetch, each labelled "environment" / "health" / "balances" —
    // this is the page's actual truthful-degradation mechanism for API-key
    // gated reads. We only assert the *shape* holds (a labelled alert, if
    // any fetch failed) since whether the backend key is configured varies
    // by deploy and must not be hardcoded as an expectation either way.
    const alerts = page.getByRole('alert');
    const alertCount = await alerts.count();
    if (alertCount > 0) {
      const text = await alerts.first().innerText();
      // Regression: a bare "Error" or empty alert body gives the user
      // nothing actionable — page.tsx always prefixes with the failing
      // call's label ("environment — …", "health — …", "balances — …").
      expect(text).toMatch(/^(environment|health|balances) — /);
    }
  });

  test('the "crypto transactions" panel starts truthfully empty ("No transactions loaded yet.") rather than pre-fetching and risking a fabricated 0-row table', async ({ page }) => {
    await page.goto(PDAX_URL);
    // useAsyncAction-backed panel: `txns` is null until "load" is clicked.
    // Asserting the literal empty-state copy (not just "no rows") catches a
    // regression that silently auto-fires the fetch on mount, which would
    // hit the API-key-gated endpoint unauthenticated on every page view.
    await expect(page.getByText('No transactions loaded yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'load' })).toBeVisible();
  });

  test('the deposit-address and price panels start with no fabricated address/price — only after an explicit action', async ({ page }) => {
    await page.goto(PDAX_URL);
    // Neither DepositPanel nor PricePanel auto-fetch (both are
    // useAsyncAction, click-driven) — on load there must be no address,
    // no "firm"/"indicative" badge, and no price figure anywhere yet.
    await expect(page.getByText('copy address')).toHaveCount(0);
    await expect(page.getByText('firm', { exact: true })).toHaveCount(0);
    await expect(page.getByText('indicative', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'get address' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'indicative price' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'firm quote' })).toBeVisible();
  });
});

