import { test, expect, type TestInfo } from "@playwright/test";
import { liveStatuses, measuredAt, readIndex, type EvidenceIndex } from "../tools/sow-metrics-verify/claims.ts";
import { endOfDay, externalAgents, externalOwners, SOW_ROWS } from "../tools/sow-metrics-verify/metrics.ts";
import { traceOperator, type OperatorTrace } from "../tools/sow-metrics-verify/operators.ts";
import { snapshot, type Snapshot } from "../tools/sow-metrics-verify/snapshot.ts";
import { isAccountId } from "../tools/sow-metrics-verify/strkey.ts";

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
