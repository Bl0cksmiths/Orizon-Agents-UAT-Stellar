import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { verifyDispatch } from "../tools/operator-endpoint/verify-dispatch.ts";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * EX — story 6.05, the external agent execution path on the deployed service.
 *
 * The dispatch below is not a fixture anyone wrote: it is the request the
 * deployed backend actually sent to the UAT operator endpoint on 2026-09-17,
 * recorded byte-for-byte before parsing (docs/uat/evidence/6.05-external-dispatch.md).
 * What these tests re-check live is the half an operator relies on — that the
 * signer published at GET /api/stellar/network still verifies it.
 */

interface CapturedDispatch {
  bound_endpoint_url: string;
  headers: Record<string, string>;
  raw_body_base64: string;
}

const captured = JSON.parse(
  readFileSync(join(__dirname, "..", "docs", "uat", "evidence", "6.05", "dispatch-ok.json"), "utf8"),
) as CapturedDispatch;
const rawBody = Buffer.from(captured.raw_body_base64, "base64");
const signature = captured.headers["x-orizon-signature"] ?? "";

async function publishedSigner(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const response = await request.get("/api/stellar/network", { timeout: COLD_START_TIMEOUT });
  expect(response.status()).toBe(200);
  const signer = (await response.json()).dispatch_signer as string | null;
  expect(signer, "a deployment with no dispatch key signs nothing").toMatch(/^G[A-Z2-7]{55}$/);
  return signer as string;
}

test.describe("EX — external agent dispatch (story 6.05)", () => {
  test("EX-03 the captured dispatch verifies against the published signer and the bound URL", async ({ request }) => {
    const pinnedSigner = await publishedSigner(request);
    expect(
      verifyDispatch({ rawBody, signatureBase64: signature, pinnedSigner, boundEndpointUrl: captured.bound_endpoint_url }),
    ).toBe(true);
  });
});
