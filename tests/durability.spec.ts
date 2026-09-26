import { test, expect } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * DU — story 6.03d, durability and the unconfirmed-refund path.
 *
 * Durability is tested by restarting. On the deploy the restart is Render's own
 * — the free tier stops an idle service — so what can be asserted live is that
 * a restart is visible and that state written before it is still served after
 * it. Opening, restarting and reading back a dispute needs a settled step
 * (D-050); that half ran locally on a real Postgres and is recorded in
 * docs/uat/evidence/6.03d-durability.md with the drill in tools/restart-drill/.
 */

type Health = { status: string; version: string; uptime_seconds: number };

test.describe("DU — durability (story 6.03d)", () => {
  test("DU-05 the backend reports its uptime, so a restart can be seen from outside", async ({ request }) => {
    const response = await request.get("/api/health", { timeout: COLD_START_TIMEOUT });
    expect(response.status()).toBe(200);
    const health = (await response.json()) as Health;
    expect(health.status).toBe("ok");
    expect(typeof health.uptime_seconds).toBe("number");
    expect(health.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  test("DU-05 a binding written before this process started is still served, so DATABASE_URL is set", async ({ request }) => {
    // The startup log cannot be read from outside. The binding store and the
    // dispute store are both chosen from DATABASE_URL, and a binding outlives
    // a restart only in Postgres — so the 6.05 agent's binding, older than the
    // running process, is the deploy's own proof of the store it uses.
    const health = (await (await request.get("/api/health", { timeout: COLD_START_TIMEOUT })).json()) as Health;
    const clock = (await (await request.get("/api/tasks/uat-603d-clock/disputes")).json()) as { now: number };
    const startedAt = clock.now - health.uptime_seconds;
    const response = await request.get("/api/agents/uat624_ext_op/binding");
    expect(response.status()).toBe(200);
    const binding = (await response.json()) as { agent_id: string; bound_at: number };
    expect(binding.agent_id).toBe("uat624_ext_op");
    expect(binding.bound_at, "the binding must predate the running process").toBeLessThan(startedAt);
  });
});
