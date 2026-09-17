import { createHash, createPublicKey, verify } from "node:crypto";
import { decodeAccountId } from "./stellar-key.ts";

/**
 * Orizon dispatch-signature verification, exactly as an operator is told to do
 * it in the backend's docs/operators/verifying-a-dispatch.md:
 *
 *   message = "orizon-dispatch:v1:" + <YOUR bound endpoint URL> + ":" + sha256hex(raw body)
 *   signed  = SEP-53: ed25519 over sha256("Stellar Signed Message:\n" + message)
 *
 * The signer and the endpoint URL are both the verifier's own configuration.
 * Neither is ever read from the request: the X-Orizon-Signer header is
 * attacker-settable, and taking the URL from the request would make a
 * signature replayable against any other operator.
 */

export const SIGNATURE_VERSION = "orizon-dispatch:v1";
const SEP53_PREFIX = "Stellar Signed Message:\n";

export interface DispatchToVerify {
  rawBody: Uint8Array;
  signatureBase64: string;
  pinnedSigner: string;
  boundEndpointUrl: string;
}

export function dispatchMessage(boundEndpointUrl: string, rawBody: Uint8Array): string {
  const digest = createHash("sha256").update(rawBody).digest("hex");
  return `${SIGNATURE_VERSION}:${boundEndpointUrl}:${digest}`;
}

export function verifyDispatch(input: DispatchToVerify): boolean {
  const signature = Buffer.from(input.signatureBase64, "base64");
  if (signature.length !== 64) return false;
  const publicKey = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(decodeAccountId(input.pinnedSigner)).toString("base64url") },
    format: "jwk",
  });
  const message = dispatchMessage(input.boundEndpointUrl, input.rawBody);
  const preimage = createHash("sha256").update(SEP53_PREFIX + message).digest();
  return verify(null, preimage, publicKey, signature);
}
