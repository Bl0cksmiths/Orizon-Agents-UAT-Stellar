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
});
