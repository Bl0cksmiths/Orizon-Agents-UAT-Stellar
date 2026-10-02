import { test, expect, type APIRequestContext } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";
import { ACCOUNT_FACTS, CONTRACT_FACTS, REGISTRY, SNAPSHOT, TEAM_OWNERS, TX_FACTS } from "../tools/onchain-verify/facts.ts";
import { txDifferences } from "../tools/onchain-verify/compare.ts";
import { observeAccount, observeTx, type GetJson } from "../tools/onchain-verify/horizon.ts";
import { readAgents, readInstance, type PostJson } from "../tools/onchain-verify/rpc.ts";

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

/** Horizon reads through Playwright's request context, body parsed whatever the status. */
const horizon = (request: APIRequestContext): GetJson => async (url) => {
  const res = await request.get(url, { timeout: 30_000 });
  return { status: res.status(), body: await res.json() };
};

/** Stellar RPC calls through the same request context. */
const rpc = (request: APIRequestContext): PostJson => async (url, data) => {
  const res = await request.post(url, { data, timeout: 30_000 });
  return { status: res.status(), body: await res.json() };
};

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

  for (const claim of TX_FACTS.values()) {
    test(`tx ${claim.hash.slice(0, 12)} is ${claim.fn} on ${claim.contract.slice(0, 6)} as the index claims`, async ({ request }) => {
      const observed = await observeTx(horizon(request), claim.hash);
      expect(txDifferences(observed, claim), `what Horizon testnet shows for ${claim.hash}`).toEqual([]);
    });
  }

  for (const [contract, roles] of CONTRACT_FACTS) {
    test(`contract ${contract.slice(0, 6)} is live and holds the roles the index gives it`, async ({ request }) => {
      const storage = await readInstance(rpc(request), contract);
      expect(storage, `contract ${contract} on the testnet ledger`).not.toBeNull();
      const held = Object.fromEntries(Object.keys(roles).map((name) => [name, storage?.get(name)]));
      expect(held, `instance storage of ${contract}`).toEqual(roles);
    });
  }

  for (const [account, facts] of ACCOUNT_FACTS) {
    test(`account ${account.slice(0, 6)} exists and owns the agents the index says`, async ({ request }) => {
      const observed = await observeAccount(horizon(request), account);
      expect(observed, `account ${account} on Horizon testnet`).not.toBeNull();
      if (facts.createdOn) {
        expect(observed?.createdAt?.slice(0, 10), `day ${account} was created`).toBe(facts.createdOn);
      }
      const asOf = new Date(SNAPSHOT.registrations.at);
      const owned = (await readAgents(rpc(request), REGISTRY))
        .filter((agent) => agent.owner === account && agent.registeredAt <= asOf)
        .map((agent) => agent.id);
      expect(sorted(owned), `agents the AgentRegistry lists for ${account}`).toEqual(sorted(facts.owns));
    });
  }

  test("the AgentRegistry link's registration counts hold at the snapshot", async ({ request }) => {
    const { at, total, team, outside, outsideOwners } = SNAPSHOT.registrations;
    const asOf = new Date(at);
    const agents = (await readAgents(rpc(request), REGISTRY)).filter((agent) => agent.registeredAt <= asOf);
    const isTeam = (owner: string) => TEAM_OWNERS.includes(owner);
    const others = agents.filter((agent) => !isTeam(agent.owner));
    expect({
      total: agents.length,
      team: agents.length - others.length,
      outside: others.length,
      outsideOwners: new Set(others.map((agent) => agent.owner)).size,
    }, `AgentRegistry registrations as of ${at}`).toEqual({ total, team, outside, outsideOwners });
  });
});
