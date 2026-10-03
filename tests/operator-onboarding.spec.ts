import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { COLD_START_TIMEOUT, expectNoHorizontalOverflow, stubWalletSession } from "./fixtures";

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

// The checklist's words for those steps, in the same order.
const STEP_LABELS = ["Registered on-chain", "Active", "Endpoint bound", "Endpoint reachable", "Routable", "First workflow run", "First settlement"];

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

// The team's QA throwaway operator key: owns uat605_ext_op and uat624_ext_op.
const QA_OPERATOR_KEY = "GBWMD26IB6CMG3JO3HU7SD7ZJSTF4BIJ5JS77ANMLJ52M6FV6K3J7BQJ";

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

// The adoption report is read from the backend host directly: through
// orizons.xyz the rewrite gives up long before the report is computed (D-091).
const BACKEND = "https://orizon-agents-be-stellar.onrender.com";
// Cold computations measured 4, 12 and over 15 minutes on 2026-10-03.
const ADOPTION_TIMEOUT = 1_500_000;

type Counts = { external_agents: number; unique_operator_wallets: number; settled_external_workflows: number };
type Adoption = {
  window_days: number;
  targets: Counts;
  totals: Counts;
  operators: { owner: string; agents: { agent_id: string; settled_workflows: { job_id_hex: string }[] }[] }[];
  excluded: { owner: string; reason: string; role: string | null; agent_ids: string[] }[];
};

/** The live report. The type names only what is checked; every other field
 * the backend sent is kept as it came. */
async function adoptionReport(request: APIRequestContext): Promise<Adoption> {
  const response = await request.get(`${BACKEND}/api/ecosystem/adoption`, { timeout: ADOPTION_TIMEOUT });
  expect(response.status()).toBe(200);
  return (await response.json()) as Adoption;
}

// The Ecosystem page's heading for each target (lib/ecosystem.ts TARGET_COPY).
const TARGET_LABELS: Record<keyof Counts, string> = {
  external_agents: "Externally operated agents",
  unique_operator_wallets: "Unique operator wallets",
  settled_external_workflows: "Workflows routed to external agents and settled",
};

/** The page's own wording of the settled window (settledWindowSentence in
 * lib/ecosystem.ts): rounded down to one decimal, never up to a whole week. */
function windowSentence(days: number): string {
  const tenths = Math.floor(days * 10 + 1e-9) / 10;
  const n = tenths.toLocaleString("en-US", { maximumFractionDigits: 1 });
  const span = tenths === 0 ? "the last 0.1 days or less" : `the last ${n} ${n === "1" ? "day" : "days"}`;
  return `Settled workflows counted over ${span} of ledger history — older settlements are not shown here; each transaction stays verifiable on Stellar Expert.`;
}

/** Opens the Ecosystem page with the live report as its answer. The transport
 * is D-091; this checks that the page renders the real figures, and nothing
 * in the report is changed or invented. */
async function showReport(page: Page, report: Adoption): Promise<void> {
  await page.route("**/api/ecosystem/adoption", (route) => route.fulfill({ json: report }));
  await page.goto("/app/ecosystem");
  await expect(page.getByRole("heading", { name: "Wallets we control (not counted)" })).toBeVisible({ timeout: 90_000 });
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

  test("OB-03 the guide warns in Step 6 and under Known issues that reachable is not proof of an agent", async ({ page }) => {
    await page.goto("/guide/list-your-agent");
    await expect(page.locator("dt", { hasText: /^Version$/ }).locator("xpath=following-sibling::dd[1]")).toHaveText("1.1.0");
    // The guide's sections are flat: a section is everything between its h2
    // and the next one, read here as text and as its tables' first column.
    const section = (from: string, to: string) =>
      page.evaluate(
        ({ start, end }) => {
          const range = document.createRange();
          range.setStartAfter(document.getElementById(start)!);
          range.setEndBefore(document.getElementById(end)!);
          const ids = [...range.cloneContents().querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent?.match(/F-\d{3}/)?.[0]);
          return { text: range.toString().replace(/\s+/g, " "), ids };
        },
        { start: from, end: to },
      );
    const step6 = await section("step-6-check-readiness", "step-7-get-routed");
    expect(step6.text).toContain("reachable: done means only that something at the bound URL answered. It does not mean your agent did.");
    expect(step6.text).toContain("(F-033)");
    const known = await section("known-issues", "friction-log-coverage");
    expect(known.ids).toEqual(expect.arrayContaining(["F-033", "F-034", "F-035"]));
  });

  test("OB-06 the console can bind but offers no unbind, as the guide says (F-031)", async ({ page }) => {
    test.setTimeout(180_000);
    // The QA operator key owns uat605_ext_op, which is bound: the one state in
    // which an unbind control would belong on the page.
    await stubWalletSession(page, { address: QA_OPERATOR_KEY });
    await page.goto("/app/bind?agent=uat605_ext_op");
    await expect(page.getByRole("button", { name: /Replace endpoint/ })).toBeVisible({ timeout: 90_000 });
    const unbind = /unbind|revoke|remove (the )?(binding|endpoint)/i;
    await expect(page.getByRole("button", { name: unbind })).toHaveCount(0);
    await expect(page.getByRole("link", { name: unbind })).toHaveCount(0);
  });

  test("OB-08 the adoption report answers through orizons.xyz within the page's 60 s budget", async ({ request }) => {
    // D-091: computed per request across every outside agent, the report takes
    // minutes; through the site's rewrite it answers 502 after about 122 s and
    // the page gives up at 60 s. Remove the marker when it answers in time.
    test.fail();
    test.setTimeout(120_000);
    const response = await request.get("/api/ecosystem/adoption", { timeout: 60_000 });
    expect(response.status()).toBe(200);
  });

  test("OB-09 at 360 px the readiness checklist shows all seven steps, fits, and names its new-tab links", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 360, height: 780 });
    await stubWalletSession(page, { address: QA_OPERATOR_KEY });
    await page.goto("/app/operator");
    for (const id of ["uat605_ext_op", "uat624_ext_op"]) {
      const steps = page.getByRole("list", { name: `Onboarding steps for ${id}` });
      await expect(steps.getByRole("listitem")).toHaveCount(7, { timeout: 90_000 });
      for (const [index, label] of STEP_LABELS.entries()) {
        await expect(steps.getByRole("listitem").nth(index)).toContainText(`${index + 1}. ${label}`);
      }
      const away = steps.locator('a[target="_blank"]');
      expect(await away.count(), `${id}'s evidence links`).toBeGreaterThan(0);
      for (const link of await away.all()) await expect(link).toHaveAccessibleName(/opens in a new tab/);
    }
    await expectNoHorizontalOverflow(page);
  });

  test("OB-09 at 360 px the live Ecosystem page says its figures did not arrive, offers a retry, and fits", async ({ page }) => {
    test.setTimeout(240_000);
    // D-091: the report does not answer within the page's 60 s budget, so this
    // is the state a visitor meets today. It must not read as a count of zero.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/app/ecosystem");
    await expect(page.getByText("Nothing below is a count of zero", { exact: false })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No external operators yet" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test.describe("against one live adoption report", () => {
    // Every check below reads the same report, fetched once per worker before
    // any page opens: a cold computation takes many minutes (D-091) and the
    // backend caches it for only about 30 seconds.
    test.describe.configure({ mode: "default" });
    let report: Adoption;

    test.beforeAll(async ({ playwright }) => {
      test.setTimeout(ADOPTION_TIMEOUT + 60_000);
      const request = await playwright.request.newContext();
      report = await adoptionReport(request);
      await request.dispose();
    });

    test("OB-07 every team wallet's agents are excluded with its role and never counted", async ({ request }) => {
      const team = await teamWallets(request);
      const agents = await listAgents(request);
      const owning = [...team.keys()].filter((wallet) => agents.some((agent) => agent.owner === wallet));
      expect(owning.length, "team wallets that own agents").toBeGreaterThan(0);
      for (const wallet of owning) {
        const excluded = report.excluded.filter((entry) => entry.owner === wallet);
        expect(excluded, `${wallet} listed once under excluded`).toHaveLength(1);
        expect(excluded[0]!.reason).toBe("team_wallet");
        expect(excluded[0]!.role).toBe(team.get(wallet));
        const owned = agents.filter((agent) => agent.owner === wallet).map((agent) => agent.id);
        expect(excluded[0]!.agent_ids).toEqual(expect.arrayContaining(owned));
      }
      const operatorWallets = report.operators.map((operator) => operator.owner);
      expect(operatorWallets.filter((wallet) => team.has(wallet)), "team wallets counted as operators").toEqual([]);
      const counted = report.operators.reduce((sum, operator) => sum + operator.agents.length, 0);
      expect(report.totals.external_agents).toBe(counted);
      expect(report.totals.unique_operator_wallets).toBe(report.operators.length);
    });

    test("OB-08 the Ecosystem page states the live report's counts, targets and window", async ({ page }) => {
      test.setTimeout(180_000);
      await showReport(page, report);
      // Scoped to the targets: the operators below render hundreds of items.
      const targets = page.locator('section[aria-labelledby="targets-heading"] > ul > li');
      const item = (label: string) => targets.filter({ has: page.getByRole("heading", { name: label, exact: true }) });
      for (const [key, label] of Object.entries(TARGET_LABELS) as [keyof Counts, string][]) {
        const current = report.totals[key];
        const target = report.targets[key];
        await expect(item(label).getByText(new RegExp(`^${current}\\s*of ${target}$`)), `${label} figure`).toBeVisible();
        await expect(item(label)).toContainText(`: ${current} of ${target}`);
      }
      expect(report.window_days, "the report states a settled window").toBeGreaterThan(0);
      await expect(item(TARGET_LABELS.settled_external_workflows)).toContainText(windowSentence(report.window_days));
    });

    test("OB-09 at 360 px the rendered report fits, names every new-tab link and reads each job id in full", async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 360, height: 780 });
      await showReport(page, report);
      await expectNoHorizontalOverflow(page);
      const away = page.locator('main a[target="_blank"]');
      const total = await away.count();
      expect(total, "new-tab links on the page").toBeGreaterThan(0);
      await expect(away.and(page.getByRole("link", { name: /opens in a new tab/ })), "new-tab links that say so").toHaveCount(total);
      // Each distinct job is one settled workflow. None has settled yet, so the
      // count pins that at zero and the job-id check reads each one once it exists.
      const jobs = report.operators.flatMap((operator) => operator.agents.flatMap((agent) => agent.settled_workflows.map((workflow) => workflow.job_id_hex)));
      expect(new Set(jobs).size, "distinct settled jobs listed").toBe(report.totals.settled_external_workflows);
      for (const id of new Set(jobs)) {
        const listed = jobs.filter((job) => job === id).length;
        await expect(page.getByRole("cell", { name: id, exact: true }), "a job cell read as its full id").toHaveCount(listed);
      }
    });
  });
});
