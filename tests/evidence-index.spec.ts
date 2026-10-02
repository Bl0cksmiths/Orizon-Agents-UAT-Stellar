import { test, expect, type APIRequestContext } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";
import { ACCOUNT_FACTS, CONTRACT_FACTS, TX_FACTS } from "../tools/onchain-verify/facts.ts";

/**
 * OV-01 (story 6.04): every explorer link in the public evidence index
 * resolves on testnet and shows the contract, function, addresses and
 * amounts the index claims.
 *
 * The links are read from the live /evidence page, never from a copy, so a
 * link added to or dropped from the index fails here until its claim is
 * pinned in tools/onchain-verify/facts.ts. Each claim is then checked only
 * against Horizon and Stellar RPC testnet, never the app's own API: a link
 * that resolves but shows something else fails, as does a dead one.
 */

const EXPLORER_LINK = /https:\/\/stellar\.expert\/explorer\/([a-z]+)\/(tx|contract|account)\/([A-Za-z0-9]+)/g;

type ExplorerLink = { network: string; kind: string; id: string };

/** The distinct stellar.expert links the live evidence page renders. */
async function liveLinks(request: APIRequestContext): Promise<ExplorerLink[]> {
  const res = await request.get("/evidence", { timeout: COLD_START_TIMEOUT });
  expect(res.status(), "the evidence page answers").toBe(200);
  const seen = new Map<string, ExplorerLink>();
  for (const [url, network = "", kind = "", id = ""] of (await res.text()).matchAll(EXPLORER_LINK)) {
    seen.set(url, { network, kind, id });
  }
  return [...seen.values()];
}

const sorted = (ids: Iterable<string>) => [...ids].sort();

test.describe("OV-01 — the evidence index's explorer links", () => {
  test("every live link is on testnet and has a pinned claim, and every claim is linked", async ({ request }) => {
    const links = await liveLinks(request);
    expect(links.filter((l) => l.network !== "testnet"), "links off testnet").toEqual([]);
    const ids = (kind: string) => sorted(links.filter((l) => l.kind === kind).map((l) => l.id));
    expect(ids("tx")).toEqual(sorted(TX_FACTS.keys()));
    expect(ids("contract")).toEqual(sorted(CONTRACT_FACTS.keys()));
    expect(ids("account")).toEqual(sorted(ACCOUNT_FACTS.keys()));
  });
});
