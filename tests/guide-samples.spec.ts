import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";
import { COLD_START_TIMEOUT } from "./fixtures";

/**
 * PP-03: three samples from the "List your agent" guide, copied with the
 * page's own copy buttons, run exactly as copied against testnet, and checked
 * against the response the guide documents beside each one.
 *
 * Only read-only `verify="live"` samples are used: they need no key and
 * change nothing. The documented response is read from the published page,
 * not from a copy in this repo, so the test checks what a reader sees today.
 * Agent ids are team agents only (consent rule).
 */

const GUIDE = "/guide/list-your-agent";
const execFileAsync = promisify(execFile);

test.describe.configure({ timeout: COLD_START_TIMEOUT + 120_000 });

test.beforeEach(async ({ page, context, browserName }) => {
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  /* The guide page never fires `load` reliably in Firefox; the copy buttons
     only need the document and hydration, which `toBeEnabled` waits for. */
  await page.goto(GUIDE, { waitUntil: "domcontentloaded" });
});

/** Click a block's copy button and return the text it copied. */
async function copySample(page: Page, id: string, browserName: string): Promise<string> {
  const caption = page.locator(`figure#${id} > figcaption`);
  const button = caption.getByRole("button", { name: /^Copy / });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(caption.getByRole("status")).toHaveText("Copied");
  if (browserName === "chromium") {
    return page.evaluate(() => navigator.clipboard.readText());
  }
  /* WebKit and Firefox cannot grant `clipboard-read` to a test, so the
     clipboard cannot be read back. The page's handler writes the
     textContent of the block's code element and has just announced
     "Copied", so that textContent is what it put on the clipboard. */
  return page.locator(`#${id}-code`).evaluate((el) => el.textContent ?? "");
}

/**
 * Run a copied script with bash, as a reader pastes it into a shell, with
 * `ORIZON_API` exported by the guide's own "Set the API base once" block and
 * only the reader's own values (`AGENT_ID`) added. PATH is the shell's own.
 */
async function runAsWritten(
  page: Page,
  browserName: string,
  id: string,
  readerEnv: Record<string, string> = {},
): Promise<unknown> {
  const apiBase = await copySample(page, "set-api-base", browserName);
  const sample = await copySample(page, id, browserName);
  const { stdout } = await execFileAsync("bash", ["-c", `${apiBase}\n${sample}`], {
    env: { PATH: process.env.PATH ?? "", ...readerEnv },
    timeout: COLD_START_TIMEOUT,
  });
  return JSON.parse(stdout);
}

/** The response the guide documents under a sample, as published. */
async function documentedResponse(page: Page, id: string): Promise<unknown> {
  const text = await page.locator(`#${id}-response-code`).textContent();
  return JSON.parse(text ?? "");
}

/**
 * Does `value` have the type a documented `<placeholder>` names? Every
 * placeholder the samples below use is listed; an unknown one throws, so a
 * guide edit that introduces a new kind of value fails loudly instead of
 * being matched by anything.
 */
function placeholderMatches(text: string, value: unknown): boolean {
  const isString = typeof value === "string";
  if (/G address/.test(text)) return isString && /^G[A-Z2-7]{55}$/.test(value);
  if (/^C address/.test(text)) return isString && /^C[A-Z2-7]{55}$/.test(value);
  if (/URL$/.test(text)) return isString && /^https:\/\/\S+$/.test(value);
  throw new Error(`no rule for documented placeholder <${text}>`);
}

/**
 * Every way `actual` departs from `documented`: a documented key missing, a
 * literal that differs, or a value not of its placeholder's type. Arrays must
 * match element by element and in length; extra object keys are allowed.
 */
function differences(documented: unknown, actual: unknown, path = "$"): string[] {
  if (typeof documented === "string") {
    const placeholder = /^<(.+)>$/.exec(documented)?.[1];
    if (placeholder !== undefined) {
      return placeholderMatches(placeholder, actual)
        ? []
        : [`${path}: documented <${placeholder}>, got ${JSON.stringify(actual)}`];
    }
  }
  if (Array.isArray(documented)) {
    if (!Array.isArray(actual) || actual.length !== documented.length) {
      return [`${path}: documented ${documented.length} elements, got ${JSON.stringify(actual)}`];
    }
    return documented.flatMap((d, i) => differences(d, actual[i], `${path}[${i}]`));
  }
  if (typeof documented === "object" && documented !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) {
      return [`${path}: documented an object, got ${JSON.stringify(actual)}`];
    }
    const record = actual as Record<string, unknown>;
    return Object.entries(documented).flatMap(([key, d]) =>
      key in record
        ? differences(d, record[key], `${path}.${key}`)
        : [`${path}.${key}: documented key is missing`],
    );
  }
  return documented === actual
    ? []
    : [`${path}: documented ${JSON.stringify(documented)}, got ${JSON.stringify(actual)}`];
}

test("PP-03 'Read the network the deployment runs on' (network) returns its documented response", async ({
  page,
  browserName,
}) => {
  const actual = await runAsWritten(page, browserName, "network");
  const documented = await documentedResponse(page, "network");
  expect(differences(documented, actual)).toEqual([]);
});
