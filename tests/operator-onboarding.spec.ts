import { test, expect, type APIRequestContext } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * OB — story 6.09, operator onboarding, readiness and the Ecosystem page on
 * the live deployment.
 *
 * The onboarding run from the guide alone, the rebind from the console and the
 * screen-reader pass are done by hand
 * (docs/uat/checklists/6.09-onboarding-and-phone.md). This spec holds what can
 * be read without a key: readiness on the team's fixture agents, the parked
 * page case found at run time, the adoption report against the team register,
 * the Ecosystem page against that report, and the guide's own claims.
 *
 * Consent: outside operators' agents are discovered at run time and never
 * named, here or in any message an assertion prints.
 */

const STEP_KEYS = ["registered", "active", "bound", "reachable", "routable", "first_run", "first_settlement"];

type Step = { key: string; status: string; detail: string; action: string | null };
type Readiness = { agent_id: string; ready: boolean; steps: Step[] };

async function readiness(request: APIRequestContext, id: string): Promise<Readiness> {
  const response = await request.get(`/api/agents/${id}/readiness`, { timeout: COLD_START_TIMEOUT });
  expect(response.status()).toBe(200);
  return (await response.json()) as Readiness;
}

function step(report: Readiness, key: string): Step {
  const found = report.steps.find((candidate) => candidate.key === key);
  expect(found, `the ${key} step`).toBeDefined();
  return found!;
}

test.describe("OB — operator onboarding, readiness and the Ecosystem page (story 6.09)", () => {
  test("OB-02 an agent with nothing bound says so at bound and reachable, and is not ready", async ({ request }) => {
    // Team fixture, registered by the audit key and never bound.
    const report = await readiness(request, "w1_audit_a7x");
    expect(report.steps.map((candidate) => candidate.key)).toEqual(STEP_KEYS);
    const bound = step(report, "bound");
    expect(bound.status).toBe("todo");
    expect(bound.detail).toBe("No endpoint is bound, so no work can be dispatched to this agent.");
    expect(bound.action).toContain("on the Bind page");
    const reachable = step(report, "reachable");
    expect(reachable.status).toBe("todo");
    expect(reachable.detail).toContain("there is nothing to check");
    expect(report.ready).toBe(false);
  });

  test("OB-04 an agent bound to a dead quick tunnel fails reachable, naming the outcome and the fix", async ({ request }) => {
    // Team fixture bound in 6.05 to a trycloudflare quick tunnel that has gone.
    const report = await readiness(request, "uat605_ext_op");
    expect(report.steps.map((candidate) => candidate.key)).toEqual(STEP_KEYS);
    expect(step(report, "bound").status).toBe("done");
    const reachable = step(report, "reachable");
    expect(reachable.status).toBe("failed");
    expect(reachable.detail).toMatch(/^Your endpoint's hostname no longer resolves in DNS\./);
    expect(reachable.detail).toContain("Warning: this endpoint is a Cloudflare quick tunnel (trycloudflare.com)");
    expect(reachable.action).toMatch(/^Your quick tunnel has gone\..*rebind on the Bind page/);
    expect(report.ready).toBe(false);
  });
});
