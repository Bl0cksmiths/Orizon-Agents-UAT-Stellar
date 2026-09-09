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
