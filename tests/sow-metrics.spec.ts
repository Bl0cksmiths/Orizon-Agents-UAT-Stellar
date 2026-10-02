import { test, expect, type TestInfo } from "@playwright/test";
import { liveStatuses, measuredAt, readIndex, type EvidenceIndex } from "../tools/sow-metrics-verify/claims.ts";
import {
  charges,
  countedCharges,
  disputeRefunds,
  endOfDay,
  externalAgents,
  externalOwners,
  externalWorkflows,
  SOW_ROWS,
  usdcCharges,
} from "../tools/sow-metrics-verify/metrics.ts";
import { traceOperator, type OperatorTrace } from "../tools/sow-metrics-verify/operators.ts";
import { snapshot, type Snapshot } from "../tools/sow-metrics-verify/snapshot.ts";
import { isAccountId } from "../tools/sow-metrics-verify/strkey.ts";
import { registryAdmin } from "../tools/sow-metrics-verify/team.ts";
import {
  DISPUTE_ROUTES,
  readPage,
  readParams,
  readReadiness,
  readRoutes,
  REGISTER_ROUTE,
} from "../tools/sow-metrics-verify/web.ts";

/**
 * Story 6.04, OV-02 and the inputs to OV-06: each of the eleven SOW §6.3
 * metrics counted from chain data (or, for the milestones, the live site and
 * GitHub), never from the dashboard, and recorded against its target and the
 * evidence index's claim.
 *
 * Each count is taken at the moment the index says that row was measured
 * (its snapshot method names the times), so the comparison is like for like.
 * Registrations, receipts, ratings and transfers are immutable once on-chain,
 * so a count at a past cut-off is the same on every run and an exact
 * assertion is not brittle. What has happened since is annotated, not
 * asserted, since anyone may register an agent at any time.
 *
 * A metric that is not met is asserted at its true value. A claim the chain
 * contradicts is pinned with its defect draft id (D-NEW-METRICS-n), so the
 * test fails, and must be revisited, when the index or the chain changes.
 */

test.describe.configure({ mode: "default" });

const ADMIN = "GA7AI5TAJEZA27I666DSJC4MUJYBEWUYNNZWPU7R2ONA7IZQVO6R5OQV";

let chain: Snapshot;
let index: EvidenceIndex;
let traces: OperatorTrace[];

const now = (): number => Date.now() / 1000;

/** Records metric, target, index claim, independent actual and verdict on the test, for the report. */
function record(info: TestInfo, id: string, actual: string, verdict: "met" | "not met" | "disputed"): void {
  const sow = SOW_ROWS.find((r) => r.id === id);
  if (!sow) throw new Error(`no SOW row ${id}`);
  const claim = index.claims.get(id);
  const claimed = claim ? `${claim.achieved} (${claim.status})` : index.removed.has(id) ? "removed" : "absent";
  info.annotations.push({
    type: id,
    description: `${sow.metric} | target ${sow.target} | index ${claimed} | actual ${actual} | ${verdict}`,
  });
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  chain = await snapshot();
  index = await readIndex();
  const owners = externalOwners(chain, measuredAt(index, "15:48"));
  const claimed = new Set(owners);
  traces = [];
  for (const owner of owners) traces.push(await traceOperator(owner, chain.agents, chain.team, claimed));
});

test("OV-02 the claims under test are the ones the live /evidence page shows", async () => {
  expect(index.asOf).toBe("2026-09-30");
  expect(chain.team.network.network).toBe("testnet");
  const statuses = await liveStatuses();
  const claimed = SOW_ROWS.filter((r) => index.claims.has(r.id)).map((r) => index.claims.get(r.id)!.status);
  expect(claimed).toHaveLength(10);
  expect(statuses).toEqual(claimed);
});

test("OV-02 the verifier refuses a corrupted address and a measurement time the index does not name", () => {
  const admin = chain.team.network.admin;
  expect(isAccountId(admin)).toBe(true);
  const corrupted = admin.slice(0, -1) + (admin.endsWith("A") ? "B" : "A");
  expect(isAccountId(corrupted)).toBe(false);
  expect(isAccountId("calculatorai")).toBe(false);
  expect(() => measuredAt(index, "00:01")).toThrow(/names no measurement/);
});

test("OV-02 m01 externally-operated agents: 11 outside the register at 15:48, 10 with no on-chain team link", async ({}, info) => {
  const agents = externalAgents(chain, measuredAt(index, "15:48"));
  const linked = new Set(traces.filter((t) => t.verdict !== "no on-chain team link").map((t) => t.address));
  const evidenced = agents.filter((a) => !linked.has(a.owner));
  const today = externalAgents(chain, now());
  info.annotations.push({ type: "m01 today", description: `${today.length} agents outside the register` });
  record(info, "m01", `${agents.length} outside the register; ${evidenced.length} with no on-chain team link`, "met");
  expect(index.claims.get("m01")?.achieved).toBe("11");
  expect(agents).toHaveLength(11);
  expect(externalAgents(chain, endOfDay(index.asOf))).toHaveLength(11);
  // D-NEW-METRICS-5: Powerbot's owner is one hop from the team admin, so it is not demonstrably external.
  expect(evidenced, "D-NEW-METRICS-5").toHaveLength(10);
  expect(evidenced.length).toBeGreaterThanOrEqual(2);
  expect(today.length).toBeGreaterThanOrEqual(agents.length);
});

test("OV-02 m02 unique external operator wallets: 7 outside the register at 15:48, 6 with no on-chain team link", async ({}, info) => {
  const owners = externalOwners(chain, measuredAt(index, "15:48"));
  const evidenced = traces.filter((t) => t.verdict === "no on-chain team link");
  const today = externalOwners(chain, now());
  info.annotations.push({ type: "m02 today", description: `${today.length} wallets outside the register` });
  record(info, "m02", `${owners.length} outside the register; ${evidenced.length} with no on-chain team link`, "met");
  expect(index.claims.get("m02")?.achieved).toBe("7");
  expect(owners).toHaveLength(7);
  expect(new Set(owners).size).toBe(owners.length);
  expect(evidenced, "D-NEW-METRICS-5").toHaveLength(6);
  expect(evidenced.length).toBeGreaterThanOrEqual(2);
});

test("OV-02 m03 workflows routed to external agents and settled: 0 of 3, and the index drops the row", async ({}, info) => {
  const workflows = externalWorkflows(chain, endOfDay(index.asOf));
  info.annotations.push({ type: "m03 today", description: `${externalWorkflows(chain, now()).length} workflows` });
  record(info, "m03", `${workflows.length} settled workflows to an outside operator's agent`, "not met");
  expect(workflows).toHaveLength(0);
  // D-NEW-METRICS-1: the SOW has eleven metrics; the index shows ten and lists this unmet one as removed.
  expect(index.claims.has("m03"), "D-NEW-METRICS-1").toBe(false);
  expect(index.removed.get("m03")?.note, "D-NEW-METRICS-1").toMatch(/team lead/);
});

test("OV-02 m04 USDC settlements: none in USDC; the 3 counted at 10:42 are XLM, team buyer to team agent", async ({}, info) => {
  const cutoff = measuredAt(index, "10:42");
  const counted = countedCharges(chain, cutoff);
  const usdc = usdcCharges(chain, cutoff);
  const later = countedCharges(chain, endOfDay(index.asOf));
  const usdcToday = usdcCharges(chain, now());
  info.annotations.push({ type: "m04 later", description: `${later.length} XLM charges by end of day; ${usdcToday.length} in USDC today` });
  record(info, "m04", `${usdc.length} in USDC; ${counted.length} XLM charges, all team buyer to team-owned agent`, "disputed");
  expect(chain.team.network.asset, "the escrow settles native XLM, not USDC").toBe("native");
  expect(usdc).toHaveLength(0);
  expect(charges(chain, cutoff)).toHaveLength(3);
  expect(counted).toHaveLength(3);
  expect(counted.every((c) => c.payerIsTeam && c.ownerIsTeam && c.owner === ADMIN && c.version === 2)).toBe(true);
  expect(later).toHaveLength(5);
  // The receipt walk and the escrow's own `charged` events are two independent reads: every charge the
  // RPC's event window still covers must have its event.
  const inWindow = later.filter((c) => c.settledAt >= chain.window.oldestCloseTime);
  expect(inWindow.every((c) => c.txHash !== null)).toBe(true);
  // D-NEW-METRICS-2: the index marks the USDC settlement target met on XLM charges between team wallets.
  expect(index.claims.get("m04")?.achieved).toBe(String(counted.length));
  expect(index.claims.get("m04")?.status, "D-NEW-METRICS-2").toBe("met");
});

test("OV-02 m05 dispute to partial-refund settlements: 0 partial; the refund returned the whole workflow", async ({}, info) => {
  const refunds = disputeRefunds(chain, measuredAt(index, "15:30"));
  const today = disputeRefunds(chain, now());
  const partial = refunds.filter((r) => r.partial);
  const partialToday = today.filter((r) => r.partial);
  info.annotations.push({ type: "m05 today", description: `${today.length} refunds, ${partialToday.length} partial` });
  record(info, "m05", `${partial.length} partial; ${refunds.length} dispute refunded in full`, "not met");
  expect(refunds).toHaveLength(1);
  for (const r of today) {
    expect(r.charge, `dispute rating ${r.rating.txHash} traces to a counted charge`).not.toBeNull();
    expect(r.transfer, `dispute rating ${r.rating.txHash} has a platform refund`).not.toBeNull();
    expect(r.transfer!.amount).toBe(r.charge!.amount);
    expect(r.transfer!.amount).toBe(r.jobTotal);
  }
  expect(partial).toHaveLength(0);
  expect(partialToday).toHaveLength(0);
  // Every dispute the ledger has ever counted is one the platform keys' histories show.
  expect(chain.lifetimeDisputes).toBe(chain.ratings.filter((r) => r.kind === "dispute").length);
  // D-NEW-METRICS-3: the index marks it met on a refund of 100% of what the buyer paid.
  expect(index.claims.get("m05")?.achieved).toBe(String(refunds.length));
  expect(index.claims.get("m05")?.status, "D-NEW-METRICS-3").toBe("met");
});

test("OV-02 m06 permissionless register flow: the page opens with no session and non-admin wallets have registered", async ({}, info) => {
  const page = await readPage("/app/register");
  const routes = await readRoutes();
  const admin = await registryAdmin(chain.team.network.contracts.agent_registry);
  const byOthers = chain.agents.filter((a) => a.owner !== admin && a.registeredAt <= endOfDay(index.asOf));
  const owners = new Set(byOthers.map((a) => a.owner));
  record(info, "m06", `Yes: page ${page.status}, route published, ${owners.size} non-admin wallets registered`, "met");
  expect(page.status).toBe(200);
  expect(routes.has(REGISTER_ROUTE)).toBe(true);
  expect(owners.size).toBeGreaterThanOrEqual(2);
  expect(index.claims.get("m06")?.status).toBe("met");
});

test("OV-02 m07 reputation-gated routing: the live router reads the ledger and applies the claimed floor", async ({}, info) => {
  const params = await readParams();
  record(info, "m07", `Yes: enabled ${params.enabled}, floor ${params.floor_bps} bps`, "met");
  expect(params.network).toBe("testnet");
  expect(params.enabled).toBe(true);
  expect(params.contract_id).toBe(chain.team.network.contracts.reputation_ledger);
  // The index states the floor as "2.75 out of 5": 2.75 / 5 of 10 000 bps.
  expect(params.floor_bps).toBe(5500);
  expect(index.claims.get("m07")?.achieved).toContain("2.75 out of 5");
  expect(index.claims.get("m07")?.status).toBe("met");
});

test("OV-02 m08 dispute window and partial-credit refund: window and refund live, no partial credit on record", async ({}, info) => {
  const routes = await readRoutes();
  const readiness = await readReadiness();
  const refunds = disputeRefunds(chain, measuredAt(index, "15:30"));
  const live = chain.escrows.find((e) => e.contract === chain.team.network.contracts.payment_escrow);
  const partial = refunds.filter((r) => r.partial);
  record(info, "m08", `Partly: routes, sweep and ${refunds.length} refund live; ${partial.length} partial`, "disputed");
  for (const route of DISPUTE_ROUTES) expect(routes.has(route), route).toBe(true);
  expect(readiness.disputes?.reconcile?.enabled).toBe(true);
  expect(readiness.escrow?.contract).toBe(live?.contract);
  expect(live?.version, "a dispute window opens only on a v2 settlement").toBe(2);
  expect(refunds.filter((r) => r.transfer !== null)).toHaveLength(1);
  // D-NEW-METRICS-3: "partial-credit" is not evidenced: the only refund returned the whole workflow.
  expect(partial, "D-NEW-METRICS-3").toHaveLength(0);
  expect(index.claims.get("m08")?.status, "D-NEW-METRICS-3").toBe("met");
});
