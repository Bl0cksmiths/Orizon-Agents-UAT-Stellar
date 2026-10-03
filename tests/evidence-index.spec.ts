import { test, expect, type APIRequestContext } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";
import { ACCOUNT_FACTS, ADMIN, ATTESTATION, CONTRACT_FACTS, ESCROW_V1, LEDGER, PLATFORM, REGISTRY, SNAPSHOT, TEAM_OWNERS, TX_FACTS } from "../tools/onchain-verify/facts.ts";
import { show, txDifferences } from "../tools/onchain-verify/compare.ts";
import { contractCallsBy, observeAccount, observeTx, type GetJson } from "../tools/onchain-verify/horizon.ts";
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

/** The live evidence page's HTML. */
async function evidenceHtml(request: APIRequestContext): Promise<string> {
  const res = await request.get("/evidence", { timeout: COLD_START_TIMEOUT });
  expect(res.status(), "the evidence page answers").toBe(200);
  return res.text();
}

/** The distinct stellar.expert links the live evidence page renders. */
async function liveLinks(request: APIRequestContext): Promise<ExplorerLink[]> {
  const html = await evidenceHtml(request);
  const explorerUrls = html.match(/stellar\.expert\/explorer\//g) ?? [];
  expect([...html.matchAll(EXPLORER_LINK)].length, "every explorer link is a tx, contract or account link")
    .toBe(explorerUrls.length);
  const seen = new Map<string, ExplorerLink>();
  for (const [url, network = "", kind = "", id = ""] of html.matchAll(EXPLORER_LINK)) {
    seen.set(url, { network, kind, id });
  }
  return [...seen.values()];
}

type LabelledLink = ExplorerLink & {
  /** 1-based place among the page's explorer links, the way findings cite a link. */
  position: number;
  /** The visible link text, entities decoded, screen-reader suffix dropped. */
  label: string;
};

const ENTITIES: Record<string, string> = { "&#x27;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">" };

/** Every stellar.expert anchor the page renders, in page order, with its label. */
function labelledLinks(html: string): LabelledLink[] {
  const anchors = html.matchAll(/<a\b[^>]*\bhref="https:\/\/stellar\.expert\/explorer\/([a-z]+)\/(tx|contract|account)\/([A-Za-z0-9]+)"[^>]*>([\s\S]*?)<\/a>/g);
  return [...anchors].map(([, network = "", kind = "", id = "", inner = ""], i) => ({
    network,
    kind,
    id,
    position: i + 1,
    label: inner
      .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")
      .replace(/<[^>]+>|↗/g, "")
      .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, (e) => ENTITIES[e] ?? e)
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

/** "Registration of <agent> [signed] by an outside operator's wallet <G…X> … — <date>". */
const OUTSIDE_REGISTRATION = /^Registration of (\S+) (?:signed )?by an outside operator's wallet (G[A-Z2-7]+)…([A-Z2-7]+)\b.*? — (\d{4}-\d{2}-\d{2})\b/;

/** "An outside operator's wallet <G…X> — owns <agents> …". */
const OUTSIDE_WALLET = /^An outside operator's wallet (G[A-Z2-7]+)…([A-Z2-7]+) — owns (.+?)(?: \(|$)/;

/** What "owns …" in a label claims: a count ("5 agents") or the agents by name ("a, b and c"). */
function ownsClaim(owns: string): { count: number } | { names: string[] } {
  const count = /^(\d+) agents?$/.exec(owns)?.[1];
  return count ? { count: Number(count) } : { names: sorted(owns.split(/, | and /)) };
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

/** The team's public register of its own wallets, kept by the backend repo. */
const TEAM_REGISTER = "https://raw.githubusercontent.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/main/app/data/team_wallets.json";

type TeamWallet = { address: string; role: string };

async function teamRegister(request: APIRequestContext): Promise<TeamWallet[]> {
  const res = await request.get(TEAM_REGISTER, { timeout: 30_000 });
  expect(res.status(), "the team wallet register answers").toBe(200);
  const { wallets } = (await res.json()) as { wallets: TeamWallet[] };
  expect(wallets.length, "the team wallet register lists wallets").toBeGreaterThan(0);
  return wallets;
}

/** Every key the team owns: its register plus the platform role keys pinned in facts.ts. */
async function teamKeys(request: APIRequestContext): Promise<Set<string>> {
  return new Set([...(await teamRegister(request)).map((w) => w.address), ADMIN, PLATFORM]);
}

/** Whether `html` shows `wallet` in full or abbreviated as prefix…suffix. */
function showsWallet(html: string, wallet: string): boolean {
  if (html.includes(wallet)) return true;
  return [...html.matchAll(/\b(G[A-Z2-7]{3,})…([A-Z2-7]{3,})\b/g)]
    .some(([, prefix = "", suffix = ""]) => wallet.startsWith(prefix) && wallet.endsWith(suffix));
}

/** Whether `html` shows `agentId` as a whole word. */
function showsAgent(html: string, agentId: string): boolean {
  for (let at = html.indexOf(agentId); at >= 0; at = html.indexOf(agentId, at + 1)) {
    const before = html[at - 1] ?? "";
    const after = html[at + agentId.length] ?? "";
    if (!/\w/.test(before) && !/\w/.test(after)) return true;
  }
  return false;
}

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

  test("the ReputationLedger link's rating counts hold at the snapshot", async ({ request }) => {
    test.slow();
    const { at, total, disputes, writers } = SNAPSHOT.ratings;
    const ratings = [];
    for (const writer of writers) {
      const calls = await contractCallsBy(horizon(request), writer);
      ratings.push(...calls.filter((c) => c.contract === LEDGER && c.fn === "submit" && c.createdAt <= at));
    }
    expect({
      total: ratings.length,
      disputes: ratings.filter((c) => c.args[6] === "dispute").length,
    }, `ReputationLedger submits by ${writers.join(", ")} as of ${at}`).toEqual({ total, disputes });
  });

  test("the AttestationRegistry link's seal counts hold at the snapshot", async ({ request }) => {
    test.slow();
    const { at, sprintStart, preSprint, runDay, runs, sealers } = SNAPSHOT.seals;
    const seals = [];
    for (const sealer of sealers) {
      const calls = await contractCallsBy(horizon(request), sealer);
      seals.push(...calls.filter((c) => c.contract === ATTESTATION && c.fn === "seal" && c.createdAt <= at));
    }
    expect({
      preSprint: seals.filter((c) => c.createdAt < sprintStart).length,
      sinceSprint: seals.filter((c) => c.createdAt >= sprintStart).map((c) => c.createdAt.slice(0, 10)),
    }, `AttestationRegistry seals by ${sealers.join(", ")} as of ${at}`).toEqual({
      preSprint,
      sinceSprint: Array.from({ length: runs }, () => runDay),
    });
  });

  test("the v1 escrow link's charges are all pre-sprint, none since", async ({ request }) => {
    test.slow();
    const { sprintStart, total } = SNAPSHOT.v1Charges;
    const charges = (await contractCallsBy(horizon(request), ADMIN))
      .filter((c) => c.contract === ESCROW_V1 && c.fn === "charge");
    expect({
      total: charges.length,
      sinceSprint: charges.filter((c) => c.createdAt >= sprintStart).length,
    }, "charges the v1 settler (the admin wallet) has made, to date").toEqual({ total, sinceSprint: 0 });
  });
});

test.describe("RV — the evidence index re-verified after escrow v2 (story 6.10)", () => {
  test("RV-01 every link labelled as an outside registration is a successful register call on the AgentRegistry, signed by a wallet outside the team register, on the date its label gives, naming the agent its label names", async ({ request }) => {
    test.slow();
    const html = await evidenceHtml(request);
    const team = await teamKeys(request);
    const outside = labelledLinks(html).filter((l) => l.kind === "tx" && /outside operator/.test(l.label));
    const unparsed = outside.filter((l) => !OUTSIDE_REGISTRATION.test(l.label)).map((l) => l.position);
    expect(unparsed, "outside-operator transaction links whose label is not a dated registration").toEqual([]);
    const seen = new Map<string, Awaited<ReturnType<typeof observeTx>>>();
    for (const link of outside) {
      const [, agent, prefix = "", suffix = "", date] = OUTSIDE_REGISTRATION.exec(link.label) ?? [];
      const tx = seen.get(link.id) ?? (await observeTx(horizon(request), link.id));
      seen.set(link.id, tx);
      const call = tx?.ops.length === 1 ? tx.ops[0]?.call : undefined;
      const signer = tx?.source ?? "";
      expect({
        resolves: tx !== null,
        successful: tx?.successful,
        registerOnRegistry: call?.contract === REGISTRY && call.fn === "register",
        signerOutsideTeam: !team.has(signer),
        ownerIsSigner: call?.args[0] === signer,
        agentAsLabelled: call?.args[1] === agent,
        walletAsLabelled: signer.startsWith(prefix) && signer.endsWith(suffix),
        dateAsLabelled: tx?.createdAt.slice(0, 10) === date,
      }, `outside registration link #${link.position} against Horizon testnet`).toEqual({
        resolves: true,
        successful: true,
        registerOnRegistry: true,
        signerOutsideTeam: true,
        ownerIsSigner: true,
        agentAsLabelled: true,
        walletAsLabelled: true,
        dateAsLabelled: true,
      });
    }
  });

  test("RV-01 every link labelled as an outside operator's wallet is an account outside the team register that owned the agents its label names at the snapshot", async ({ request }) => {
    const html = await evidenceHtml(request);
    const team = await teamKeys(request);
    const wallets = labelledLinks(html).filter((l) => l.kind === "account" && /outside operator/.test(l.label));
    const unparsed = wallets.filter((l) => !OUTSIDE_WALLET.test(l.label)).map((l) => l.position);
    expect(unparsed, "outside-operator account links whose label does not say what the wallet owns").toEqual([]);
    const asOf = new Date(SNAPSHOT.registrations.at);
    const agents = (await readAgents(rpc(request), REGISTRY)).filter((agent) => agent.registeredAt <= asOf);
    for (const link of wallets) {
      const [, prefix = "", suffix = "", owns = ""] = OUTSIDE_WALLET.exec(link.label) ?? [];
      const owned = sorted(agents.filter((agent) => agent.owner === link.id).map((agent) => agent.id));
      const claim = ownsClaim(owns);
      expect({
        outsideTeam: !team.has(link.id),
        walletAsLabelled: link.id.startsWith(prefix) && link.id.endsWith(suffix),
        ownsAsLabelled: "count" in claim ? owned.length === claim.count : show(owned) === show(claim.names),
      }, `outside wallet link #${link.position} against the AgentRegistry on testnet`).toEqual({
        outsideTeam: true,
        walletAsLabelled: true,
        ownsAsLabelled: true,
      });
    }
  });

  test("RV-04 no outside operator's agent id, wallet or hash appears on the page", async ({ request }) => {
    // D-092 (Critical): the index links outside operators' registrations and
    // wallets. Expected to fail until the page drops them; it then passes
    // unexpectedly and this marker must go.
    test.fail();
    test.slow();
    const html = await evidenceHtml(request);
    const team = await teamKeys(request);
    const links = await liveLinks(request);
    const wallets = new Set(links.filter((l) => l.kind === "account").map((l) => l.id));
    const outsideHashes = new Set<string>();
    const outsideAgents = new Set<string>();
    const txLinks = links.filter((l) => l.kind === "tx");
    for (const [i, link] of txLinks.entries()) {
      const tx = await observeTx(horizon(request), link.id);
      expect(tx, `linked transaction ${i + 1} of ${txLinks.length} is on Horizon testnet`).not.toBeNull();
      if (!tx) continue;
      wallets.add(tx.source);
      if (!team.has(tx.source)) outsideHashes.add(tx.hash);
      for (const { call } of tx.ops) {
        const [owner, agentId] = call?.contract === REGISTRY && call.fn === "register" ? call.args : [];
        if (typeof owner === "string" && typeof agentId === "string" && !team.has(owner)) outsideAgents.add(agentId);
      }
    }
    expect({
      wallets: [...wallets].filter((w) => !team.has(w) && showsWallet(html, w)).length,
      agentIds: [...outsideAgents].filter((id) => showsAgent(html, id)).length,
      hashes: outsideHashes.size,
    }, "outside operators' identifiers on the evidence page (counts only, by consent)").toEqual({ wallets: 0, agentIds: 0, hashes: 0 });
  });
});
