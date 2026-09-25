import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * RC — story 6.03e in the browser: after `drill.py run` has upheld disputes against the drill's
 * own ledger, the marketplace badge and the plan card must show the dispute rate the reputation
 * route reads. The badge's accessible name carries every number it shows, e.g.
 * "on-chain reputation 3.44 from 8 rated jobs · 50.0% disputed".
 */

const API = "http://127.0.0.1:8766";
const AGENT = "agt_09l5";
const AGENT_NAME = "research.pro";

type Rep = { count: number; dispute_rate_bps: number; source: string; degraded: boolean };

async function routeRep(request: APIRequestContext): Promise<Rep> {
  const response = await request.get(`${API}/api/stellar/reputation/${AGENT}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as Rep;
}

/** The parts of the badge's label that carry the count and the dispute rate. */
function expectedLabel(rep: Rep): RegExp {
  const pct = (rep.dispute_rate_bps / 100).toFixed(1);
  return new RegExp(`on-chain reputation [\\d.]+ from ${rep.count} rated jobs? · ${pct.replace(".", "\\.")}% disputed`);
}

/** What a badge says when its ledger read was replaced by the prior. */
const DEGRADED = "the on-chain read did not come back";

/**
 * Open a surface until its reputation reads came back from the ledger. A batch read that runs
 * past its budget (2.5 s for twelve agents) serves the prior, and says so; on a laptop behind
 * an intercepting proxy that happens on a cold cache. The reads it started still fill the
 * cache, so the surface is opened again — up to six times — rather than judged on the prior.
 */
async function openSettled(page: Page, open: () => Promise<void>, scope: Locator): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await open();
    await expect(scope).toBeVisible();
    if (!((await scope.textContent()) ?? "").includes(DEGRADED)) return;
    await page.waitForTimeout(3_000);
  }
}

test.describe.configure({ mode: "serial" });

test("RC display: the marketplace badge shows the dispute rate the route reads", async ({ page, request }, info) => {
  const rep = await routeRep(request);
  expect(rep.source, "run drill.py run first: the agent needs on-chain ratings").toBe("onchain");
  expect(rep.dispute_rate_bps).toBeGreaterThan(0);
  const row = page.getByRole("row").filter({ hasText: AGENT_NAME });
  await openSettled(page, async () => { await page.goto("/app/agents"); }, row);
  await expect(row.getByLabel(expectedLabel(rep))).toBeVisible();
  await expect(row).toContainText(`⚑ ${(rep.dispute_rate_bps / 100).toFixed(1)}%`);
  await page.screenshot({ path: info.outputPath("marketplace.png"), fullPage: true });
});

