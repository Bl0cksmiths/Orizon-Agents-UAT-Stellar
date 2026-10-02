import { test, expect } from "@playwright/test";
import { measuredAt, readIndex } from "../tools/sow-metrics-verify/claims.ts";
import { FRIENDBOT } from "../tools/sow-metrics-verify/horizon.ts";
import { externalOwners } from "../tools/sow-metrics-verify/metrics.ts";
import { traceOperator, type OperatorTrace } from "../tools/sow-metrics-verify/operators.ts";
import { snapshot, type Snapshot } from "../tools/sow-metrics-verify/snapshot.ts";
import { isTeam } from "../tools/sow-metrics-verify/team.ts";

/**
 * Story 6.04, OV-04: the outside operator wallets the evidence index counts
 * (m01, m02) are checked against the wallets the team controls.
 *
 * "Outside" in the backend means "not in the team's own register". The
 * register is written by the team, so it is the claim, not the proof. Each
 * claimed wallet is traced on Horizon instead: who created it, every account
 * it has transacted with, who may sign for it, and whether any of those
 * counterparties has itself transacted with a team wallet. The chain can show
 * a link; it cannot show the absence of an off-chain one, so the strongest
 * verdict here is "no on-chain team link".
 *
 * The set the index counted (the seven wallets outside the register when it
 * measured m02 at 15:48 UTC on its as_of day) is asserted exactly. The set as
 * it stands today is asserted only for what must hold of every claimed
 * wallet, because anyone may register at any time.
 */

test.describe.configure({ mode: "default" });

const ADMIN = "GA7AI5TAJEZA27I666DSJC4MUJYBEWUYNNZWPU7R2ONA7IZQVO6R5OQV";
const SETTLER = "GDB4N25UYM3YNTTAWX7LSGI2P7OR62QZQXRNQWAGF5TFVENDKCTTCDHP";
const DISPATCH = "GB5MKHDFLJZ6OFPAHM7R4HGBUPFV5PZYL3W27VTIUZZ25JMQSDZBKCMR";

let chain: Snapshot;
let asOf: OperatorTrace[];
let today: OperatorTrace[];

test.beforeAll(async () => {
  test.setTimeout(600_000);
  chain = await snapshot();
  const index = await readIndex();
  const claimedAsOf = externalOwners(chain, measuredAt(index, "15:48"));
  const claimedToday = externalOwners(chain, Date.now() / 1000);
  const claimed = new Set(claimedToday);
  today = [];
  for (const owner of claimedToday) today.push(await traceOperator(owner, chain.agents, chain.team, claimed));
  asOf = today.filter((t) => claimedAsOf.includes(t.address));
});

test("OV-04 the team wallets compared against are the register and every key the platform runs", async ({}, info) => {
  info.annotations.push({ type: "register", description: `${chain.team.register.size} wallets` });
  info.annotations.push({ type: "platform keys", description: [...chain.team.platform.keys()].join(", ") });
  expect(chain.team.register.size).toBeGreaterThanOrEqual(10);
  for (const key of [ADMIN, SETTLER, DISPATCH]) {
    expect(chain.team.register.has(key), key).toBe(true);
    expect(isTeam(chain.team, key), key).toBe(true);
  }
  expect(chain.team.platform.has(ADMIN)).toBe(true);
  expect(chain.team.platform.has(SETTLER)).toBe(true);
  expect(chain.team.platform.has(DISPATCH)).toBe(true);
  for (const key of chain.team.platform.keys()) expect(chain.team.register.has(key), `${key} is in the register`).toBe(true);
});

test("OV-04 every claimed outside wallet is distinct and is neither in the register nor a platform key", async ({}, info) => {
  info.annotations.push({ type: "claimed today", description: `${today.length} wallets` });
  expect(asOf).toHaveLength(7);
  expect(new Set(today.map((t) => t.address)).size).toBe(today.length);
  for (const t of today) {
    expect(isTeam(chain.team, t.address), t.address).toBe(false);
    expect(t.verdict, t.address).not.toBe("team wallet");
  }
});

test("OV-04 every claimed wallet's creation is traced, never to a team wallet; the index's seven to the public faucet", async ({}, info) => {
  for (const t of today) {
    info.annotations.push({ type: t.address, description: `created ${t.createdAt} by ${t.funder}; ${t.verdict}` });
    expect(t.createdAt, `${t.address} has a create_account on-chain`).not.toBeNull();
    expect(isTeam(chain.team, t.funder!), t.address).toBe(false);
  }
  for (const t of asOf) expect(t.funder, t.address).toBe(FRIENDBOT);
});
