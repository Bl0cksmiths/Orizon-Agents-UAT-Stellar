import { expect, test } from "@playwright/test";

import { buildReclaim } from "./api.ts";
import { readAuthorization } from "./chain.ts";

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
