import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { installFreighterShim } from "../escrow-path-drill/freighter-shim.ts";
import { encodeStrkey, STRKEY_VERSION } from "../onchain-verify/strkey.ts";
import { buildReclaim } from "./api.ts";
import { escrowEventsOf, feeCharged, readAuthorization } from "./chain.ts";
import { acquireLock, progress, recordFact, releaseLock } from "./state.ts";

/**
 * EP-04 — an authorization that was never executed, reclaimed from the console
 * after it expired. Serial, one worker: later tests read what earlier ones did.
 * See README.md beside this file.
 */

test.describe.configure({ mode: "serial" });

// A settled escrow v2 authorization from the developer's disclosed 5.01 run
// (settle tx 0ada0708…556b), paid by GB4K6. The test re-reads it on chain, so
// it proves its own premise rather than trusting this comment.
const SETTLED = { authIdHex: "00000000000000000000000000000009", payer: "GB4K6YRHDHB2HHNM3E7UUZJU5JP3MSQE3GXKMEA5IT4AM45D23YKAYKK" };

test("a settled authorization is refused a reclaim before anything is signed", async () => {
  const onChain = await readAuthorization(SETTLED.authIdHex);
  expect(onChain).toMatchObject({ payer: SETTLED.payer, settled: true, revoked: false });

  const answer = await buildReclaim(SETTLED.payer, SETTLED.authIdHex);
  expect(answer.status).toBe(409);
  expect(answer.code).toBe("authorization_spent");
  expect(answer.message).toMatch(/already settled/);
  expect(answer.body).not.toHaveProperty("xdr");
});

// D-NEW-RECLAIM-1: the route's own docstring and the console's reclaim
// (FE lib/reclaim.ts ROUTE_REFUSALS) both expect `authorization_settled`, which
// the console says as "Nothing to reclaim: a settlement already took this
// authorization over". The route answers `authorization_spent`, so the console
// reports a failed reclaim instead and keeps offering the button.
test("a settled authorization is refused with the code the console reads", async () => {
  test.fail(true, "D-NEW-RECLAIM-1: the route answers authorization_spent");
  const answer = await buildReclaim(SETTLED.payer, SETTLED.authIdHex);
  expect(answer.status).toBe(409);
  expect(answer.code).toBe("authorization_settled");
});

// The QA buyer: its key file stays outside the repository and only its public
// key is read here. The signer reads the secret itself (escrow-path-drill/signer.py).
const KEY_FILE = process.env.ESCROW_DRILL_KEY ?? "";
const BUYER = KEY_FILE ? (JSON.parse(readFileSync(KEY_FILE, "utf8")) as { public_key: string }).public_key : "";
const EVIDENCE = path.resolve(__dirname, "..", "..", "docs", "uat", "evidence", "6.07");

/** What the run learned, in the order it learned it; later tests read it. */
const run = { authorizeHash: "", authIdHex: "", planId: "", maxAmount: 0n, expiresAt: 0 };

test.describe("EP-04 in the console", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    expect(BUYER, "set ESCROW_DRILL_KEY to the buyer.json written by escrow-path-drill/buyer.py").toMatch(/^G[A-Z2-7]{55}$/);
    context = await browser.newContext();
    page = await context.newPage();
    await installFreighterShim(page, { address: BUYER, keyFile: KEY_FILE, python: process.env.ESCROW_DRILL_PYTHON });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("authorize confirms and an aborted execute leaves the held-funds notice", async () => {
    test.setTimeout(600_000);
    await acquireLock();
    try {
      // The drill's one interception: the request that would start the run is
      // dropped, as a lost connection drops it. It never reaches the backend,
      // so no run starts and nothing is released; the escrow is untouched.
      let aborted = 0;
      await page.route("**/api/orchestrator/execute", async (route) => {
        aborted += 1;
        await route.abort("connectionreset");
      });
      const submitted = page.waitForResponse(
        (r) => r.url().endsWith("/api/stellar/submit") && r.request().method() === "POST",
        { timeout: 300_000 },
      );
      await page.goto("/app/orchestrator");
      await page.getByRole("textbox", { name: /intent/i }).fill("write me a haiku about an escrow");
      await page.getByRole("button", { name: /decompos/i }).click();
      const authorize = page.getByRole("button", { name: /Authorize & Execute/ });
      await expect(authorize).toBeEnabled();
      await authorize.click();

      const submit = (await (await submitted).json()) as { hash: string; status: string };
      expect(submit.status).toBe("SUCCESS");
      run.authorizeHash = submit.hash;
      recordFact("authorize_tx", submit.hash);
      progress(`authorize confirmed: ${submit.hash}`);

      await expect(page.getByText("The authorization confirmed, but the run was not started.")).toBeVisible();
      const notice = page.getByRole("region", { name: "Your funds are held in escrow" });
      await expect(notice).toBeVisible();
      expect(aborted).toBe(1);

      // Custody, read from the chain rather than the page.
      const [authd] = (await escrowEventsOf(run.authorizeHash)).filter((e) => e.topic[0] === "authd");
      expect(authd, "the authorize transaction emitted no authd event").toBeDefined();
      const [authId, payer, maxAmount] = authd!.value as [string, string, bigint];
      expect(payer).toBe(BUYER);
      run.authIdHex = authId;
      run.planId = String(authd!.topic[1]);
      run.maxAmount = maxAmount;
      const record = await readAuthorization(authId);
      expect(record).toMatchObject({ payer: BUYER, agentId: run.planId, maxAmount, spent: 0n, settled: false, revoked: false });
      run.expiresAt = record!.expiresAt;
      await expect(notice).toContainText(authId);

      // The session keeps nothing for a run that never got a task id.
      expect(await page.evaluate(() => window.sessionStorage.getItem("orizon.held-authorizations"))).toBeNull();

      const { closedAt } = await feeCharged(run.authorizeHash);
      for (const [name, value] of Object.entries({
        auth_id: authId, plan_id: run.planId, max_amount: String(maxAmount),
        expires_at: String(run.expiresAt), authorize_closed_at: closedAt,
      })) recordFact(name, value);
      await page.screenshot({ path: path.join(EVIDENCE, "ep04-held-notice.png"), fullPage: true });
    } finally {
      releaseLock();
    }
  });

  test("before expiry the console says when reclaim opens and the route refuses it", async () => {
    const notice = page.getByRole("region", { name: "Your funds are held in escrow" });
    await expect(notice).toContainText(/Reclaim opens at .+ \(in about \d+ minutes?\), when the authorization expires\./);
    await expect(notice.getByRole("button", { name: /^Reclaim / })).toHaveCount(0);

    // Read-only: the route simulates, refuses, and builds nothing to sign.
    const answer = await buildReclaim(BUYER, run.authIdHex);
    expect(answer.status).toBe(409);
    expect(answer.code).toBe("authorization_locked");
    expect(answer.message).toContain(String(run.expiresAt));
    expect(answer.body).not.toHaveProperty("xdr");
    expect(await readAuthorization(run.authIdHex)).toMatchObject({ settled: false, revoked: false });
  });

  test("another wallet is refused the reclaim and is offered none", async ({ browser }) => {
    // A throwaway key, connect-only: its shim holds no secret and signs nothing.
    const { publicKey } = generateKeyPairSync("ed25519");
    const stranger = encodeStrkey(STRKEY_VERSION.account, publicKey.export({ format: "der", type: "spki" }).subarray(-32));
    recordFact("stranger", stranger);

    const answer = await buildReclaim(stranger, run.authIdHex);
    expect(answer.status).toBe(403);
    expect(answer.code).toBe("authorization_payer_mismatch");
    expect(answer.message).toBe("only the wallet that made this authorization can reclaim it");
    expect(answer.body).not.toHaveProperty("xdr");

    const other = await browser.newContext();
    try {
      const strangerPage = await other.newPage();
      await installFreighterShim(strangerPage, { address: stranger });
      await strangerPage.goto("/app/orchestrator");
      await expect(strangerPage.getByRole("textbox", { name: /intent/i })).toBeVisible();
      await expect(strangerPage.getByRole("region", { name: "Your funds are held in escrow" })).toHaveCount(0);
      await expect(strangerPage.getByRole("button", { name: /^Reclaim / })).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});
