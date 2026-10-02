import { test, expect } from "@playwright/test";
import { liveStatuses, measuredAt, readIndex, type EvidenceIndex } from "../tools/sow-metrics-verify/claims.ts";
import { SOW_ROWS } from "../tools/sow-metrics-verify/metrics.ts";
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

test.beforeAll(async () => {
  test.setTimeout(600_000);
  chain = await snapshot();
  index = await readIndex();
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
