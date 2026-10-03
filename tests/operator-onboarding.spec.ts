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

const TEAM_REGISTER =
  "https://raw.githubusercontent.com/Bl0cksmiths/Orizon-Agents-BE-Stellar/main/app/data/team_wallets.json";

type Agent = { id: string; owner: string | null; bound: boolean | null };

/** The team register as committed today: address to role. */
async function teamWallets(request: APIRequestContext): Promise<Map<string, string>> {
  const response = await request.get(TEAM_REGISTER, { timeout: COLD_START_TIMEOUT });
  expect(response.status()).toBe(200);
  const { wallets } = (await response.json()) as { wallets: { address: string; role: string }[] };
  return new Map(wallets.map((wallet) => [wallet.address, wallet.role]));
}

async function listAgents(request: APIRequestContext): Promise<Agent[]> {
  const response = await request.get("/api/agents", { timeout: COLD_START_TIMEOUT });
  expect(response.status()).toBe(200);
  return (await response.json()) as Agent[];
}

/** What answers at an agent's bound host: the anonymous binding read gives
 * the host only, so that is what is fetched. */
async function probeBoundHost(request: APIRequestContext, id: string): Promise<{ html: boolean; health: boolean }> {
  const binding = await request.get(`/api/agents/${id}/binding`, { timeout: COLD_START_TIMEOUT });
  expect(binding.status()).toBe(200);
  const { endpoint_url } = (await binding.json()) as { endpoint_url: string };
  const answer = await request.get(endpoint_url, { timeout: 30_000, failOnStatusCode: false });
  return {
    html: (answer.headers()["content-type"] ?? "").includes("text/html"),
    health: isHealthJson(await answer.text()),
  };
}

/** The reference agent's health answer: JSON with `ok: true`. */
function isHealthJson(body: string): boolean {
  try {
    return (JSON.parse(body) as { ok?: unknown }).ok === true;
  } catch {
    return false;
  }
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

  test("OB-03 F-033 holds: exactly one outside bound agent reads ready, and its host serves a web page", async ({ request }) => {
    test.setTimeout(COLD_START_TIMEOUT * 3);
    const team = await teamWallets(request);
    const outside = (await listAgents(request)).filter((agent) => agent.bound === true && agent.owner && !team.has(agent.owner));
    expect(outside.length, "outside agents with an endpoint bound").toBeGreaterThan(0);
    const reports = await Promise.all(outside.map((agent) => readiness(request, agent.id)));
    const ready = reports.filter((report) => report.ready);
    expect(ready, "outside bound agents reading ready").toHaveLength(1);
    const reachable = step(ready[0]!, "reachable");
    expect(reachable.status).toBe("done");
    expect(reachable.detail).toBe("Your endpoint answered 200.");
    const host = await probeBoundHost(request, ready[0]!.agent_id);
    expect(host.html, "the ready outside agent's host serves HTML").toBe(true);
    expect(host.health, "the ready outside agent's host does not answer the reference agent's health JSON").toBe(false);
  });

  test("OB-03 every other agent that reads ready answers the reference agent's health JSON", async ({ request }) => {
    test.setTimeout(COLD_START_TIMEOUT * 3);
    // Team and outside alike. Only bound agents can read ready, and there are
    // a handful, so this is one readiness read and at most one host GET each.
    const bound = (await listAgents(request)).filter((agent) => agent.bound === true);
    expect(bound.length, "agents with an endpoint bound").toBeGreaterThan(0);
    const reports = await Promise.all(bound.map((agent) => readiness(request, agent.id)));
    const ready = reports.filter((report) => report.ready);
    const hosts = await Promise.all(ready.map((report) => probeBoundHost(request, report.agent_id)));
    // The F-033 parked page is the one ready agent allowed not to be an agent.
    expect(hosts.filter((host) => !host.health), "ready agents whose host is not an agent").toHaveLength(1);
  });
});
