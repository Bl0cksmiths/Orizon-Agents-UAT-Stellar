import { test, expect, type Page } from "@playwright/test";

/**
 * E2E coverage for the Orizon Agents core workflow: /app/orchestrator →
 * /app/trace. Selectors are derived from the live source:
 *   - app/app/orchestrator/page.tsx
 *   - app/app/orchestrator/_components/execution-plan.tsx
 *   - app/app/orchestrator/_components/fiat-fund.tsx
 *   - app/app/trace/page.tsx
 *   - components/ui/{artifact-viewer,code-viewer,tx-status,stellar-link,
 *     reputation-badge,error-note,skeleton}.tsx
 *   - lib/api.ts, lib/use-async-action.ts, lib/types.ts
 *
 * Environment realities baked into this file (see inline comments at each
 * use site for why):
 *   - No wallet is available in CI. Freighter never injects into the
 *     browser, so `wallet.connected` is always false and the on-chain
 *     "Authorize & Execute" path (execution-plan.tsx `authorize` action,
 *     which calls buildAuthorize → wallet.signXdr → submitSigned) cannot be
 *     exercised at all — there is no signer. We only assert that path is
 *     correctly *gated* behind a connect prompt.
 *   - The simulated execute path (`execute(plan.plan_id)` with no
 *     `auth_id_hex`/`payer`) requires no wallet — confirmed by reading
 *     `simulate` in execution-plan.tsx, which calls `execute()` with only
 *     the plan id. That path is covered end-to-end.
 *   - Only the four curated "demo kit" intents (tetris / calculator /
 *     snake / pomodoro — the exact PRESETS array in page.tsx) are
 *     deterministic and LLM-free. Every test that submits an intent uses
 *     one of these preset buttons; no test types a free-form intent.
 *   - The backend (Render free tier) cold-starts in 25-60s on the first
 *     request in a run. Any test that triggers the first network call of a
 *     suite run needs a correspondingly long timeout — see COLD_START_MS.
 */

const BASE_URL = "https://orizons.xyz";

// Render free-tier cold start is documented as 25-60s; padded for jitter.
const COLD_START_MS = 65_000;
// Cold start + the demo kit's own ~1.4-2.4s simulated decompose delay,
// rounded up generously so a slow first-call-of-the-run never flakes.
const DECOMPOSE_TIMEOUT_MS = COLD_START_MS + 15_000;
// A full run (decompose → execute → agents actually generate the artifact)
// is not bounded by the demo kit's fixed decompose delay — real step work
// happens after execute. Generous ceiling for the one full e2e test.
const FULL_RUN_TIMEOUT_MS = 240_000;

const PRESET_INTENTS = [
  "tetris game in html",
  "calculator web app",
  "snake game in html",
  "pomodoro timer with sound",
] as const;

async function gotoOrchestrator(page: Page) {
  await page.goto(`${BASE_URL}/app/orchestrator`);
}

/**
 * Clicks the "calculator web app" preset (a demo-kit intent — deterministic,
 * no LLM call) and submits via the Decompose button. Resolves once the
 * Execution plan card has rendered.
 *
 * Callers query the plan via `page.getByRole(...)` rather than a scoped
 * container locator: the plan card is the only place on either page that
 * renders an <ol>/<li> list or the "total est." / "wallet required" copy
 * (confirmed against app/app/_components/{sidebar,topbar}.tsx, which render
 * no lists of their own), so an unscoped query is unambiguous and avoids a
 * brittle DOM-parent traversal.
 */
async function decomposeCalculatorPlan(page: Page) {
  await gotoOrchestrator(page);
  await page
    .getByRole("button", { name: "calculator web app" })
    .click();
  await page.getByRole("button", { name: /Decompose/ }).click();
  const heading = page.getByRole("heading", {
    name: "Execution plan",
    level: 2,
  });
  // First network call of a cold-started backend can take up to ~60s; the
  // demo kit's own simulated delay adds a little more on top.
  await expect(heading).toBeVisible({ timeout: DECOMPOSE_TIMEOUT_MS });
}

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — intent form
// ─────────────────────────────────────────────────────────────────────────

test.describe("Orchestrator intent form", () => {
  test("OR-01 renders the intent textarea with an associated label", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    // getByLabel resolves via the <label htmlFor="intent"> / <textarea
    // id="intent"> pairing in page.tsx. Regression this catches: the label
    // and textarea silently losing their htmlFor/id link, which would make
    // the field anonymous to screen readers even though it looks fine.
    const intent = page.getByLabel(/intent/i);
    await expect(intent).toBeVisible();
    await expect(intent).toHaveAttribute(
      "placeholder",
      'e.g. "code a calculator web app"',
    );
  });

  test("has exactly one h1 reading Orchestrator", async ({ page }) => {
    await gotoOrchestrator(page);
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText("Orchestrator");
  });

  for (const intent of PRESET_INTENTS) {
    test(`OR-01 preset button "${intent}" populates the textarea verbatim`, async ({
      page,
    }) => {
      await gotoOrchestrator(page);
      // Accessible name is "▸ {intent}" (page.tsx prefixes every preset with
      // the ▸ glyph), so match by substring rather than the exact string.
      await page.getByRole("button", { name: intent }).click();
      // Regression: a preset that populates the wrong string (or a
      // truncated one) would silently send a different — possibly
      // non-demo-kit, LLM-routed — intent to decompose.
      await expect(page.getByLabel(/intent/i)).toHaveValue(intent);
    });
  }

  test("OR-02 Enter submits the form", async ({ page }) => {
    await gotoOrchestrator(page);
    await page.getByRole("button", { name: "calculator web app" }).click();
    const textarea = page.getByLabel(/intent/i);
    await textarea.press("Enter");
    // Regression: if Enter stopped submitting, users would be forced to
    // reach for the mouse for every single decompose — the textarea's
    // whole reason for intercepting Enter (page.tsx `submitOnEnter`) would
    // be dead code.
    await expect(
      page.getByRole("button", { name: /Decomposing/ }),
    ).toBeVisible();
  });

  test("OR-02 Shift+Enter inserts a newline instead of submitting", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    const textarea = page.getByLabel(/intent/i);
    await textarea.fill("line one");
    await textarea.press("Shift+Enter");
    await textarea.type("line two");
    // Regression: this is explicit, commented behavior in page.tsx
    // (submitOnEnter checks `!e.shiftKey`) — losing it would make
    // multi-line intents impossible to compose.
    await expect(textarea).toHaveValue("line one\nline two");
    // And critically: it must not have submitted.
    await expect(
      page.getByRole("button", { name: "Decompose ▸" }),
    ).toBeEnabled();
  });

  test("OR-03 submit is disabled while the intent is empty or whitespace-only", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    const submit = page.getByRole("button", { name: /Decompose/ });
    // Regression: an enabled submit on an empty textarea lets a blank
    // intent reach POST /orchestrator/decompose, which the backend has
    // nothing meaningful to plan against.
    await expect(submit).toBeDisabled();

    const textarea = page.getByLabel(/intent/i);
    await textarea.fill("   ");
    await expect(submit).toBeDisabled();

    await textarea.fill("calculator web app");
    await expect(submit).toBeEnabled();

    await textarea.fill("");
    await expect(submit).toBeDisabled();
  });

  test("OR-03 submit is disabled and shows a pending label while decompose is in flight", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    await page.getByRole("button", { name: "calculator web app" }).click();
    await page.getByRole("button", { name: "Decompose ▸" }).click();
    // Regression: a submit left enabled mid-flight lets a second click fire
    // an overlapping decompose request (use-async-action.ts explicitly
    // guards against overlapping runs winning out of order — the button
    // should never let a user create that race in the first place).
    const pending = page.getByRole("button", { name: /Decomposing/ });
    await expect(pending).toBeVisible();
    await expect(pending).toBeDisabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — decompose result (demo-kit intent, deterministic)
// ─────────────────────────────────────────────────────────────────────────

test.describe("Orchestrator decompose result", () => {
  test("OR-04 OR-05 a demo-kit intent returns a six-step plan whose totals row equals the sum of step prices", async ({
    page,
  }) => {
    test.setTimeout(DECOMPOSE_TIMEOUT_MS + 30_000);
    await decomposeCalculatorPlan(page);

    // The demo kit is documented as returning a fixed 6-step plan.
    // Regression: a step count drifting from 6 for a curated intent means
    // the backend's demo-kit shortcut stopped matching and this intent fell
    // through to the real (slow, non-deterministic) LLM path.
    const steps = page.getByRole("listitem");
    await expect(steps).toHaveCount(6);

    let sumOfSteps = 0;
    const count = await steps.count();
    for (let i = 0; i < count; i++) {
      const text = (await steps.nth(i).innerText()).replace(/\s+/g, " ");
      // Regression: losing the "→" between the agent badge and the
      // rationale would mean the rationale is no longer distinguishable
      // from the agent name in the rendered row.
      expect(text).toContain("→");
      // Regression: price/eta format drifting (execution-plan.tsx renders
      // `${price.toFixed(3)} · ${eta.toFixed(1)}s`) breaks the totals-sum
      // assertion below and, for a real user, the estimate they're shown
      // before authorizing spend.
      const priceMatch = text.match(/(\d+\.\d{3})\s*·\s*\d+\.\d+s/);
      expect(priceMatch, `step ${i} should render a price · eta`).toBeTruthy();
      sumOfSteps += parseFloat(priceMatch![1]);

      // Rationale: whatever text sits between "→" and the trailing price
      // block must be non-empty — an empty rationale is a silently broken
      // plan step.
      const rationale = text.split("→")[1]?.replace(priceMatch![0], "").trim();
      expect(rationale?.length ?? 0).toBeGreaterThan(0);
    }

    // "total est." / "eta" only ever appear inside the plan card (confirmed
    // against sidebar.tsx / topbar.tsx, which render neither), so reading
    // the whole page's text is unambiguous and avoids a brittle DOM-parent
    // traversal to scope a container that has no test id.
    const pageText = (await page.locator("body").innerText()).replace(
      /\s+/g,
      " ",
    );
    const totalMatch = pageText.match(/total est\.\s*(\d+\.\d{3}) USDC/);
    expect(totalMatch, "totals row should render total est. in USDC").toBeTruthy();
    const displayedTotal = parseFloat(totalMatch![1]);

    // Regression: the totals row is exactly what a user reads before
    // authorizing on-chain spend. If it silently drifted from the sum of
    // the steps actually listed, users could authorize more (or be shown
    // less) than what the plan really costs. Tolerance accounts only for
    // per-step display rounding to 3 decimals.
    expect(Math.abs(displayedTotal - sumOfSteps)).toBeLessThanOrEqual(
      0.0005 * count + 0.0005,
    );

    const etaMatch = pageText.match(/eta\s*(\d+\.\d+)s/);
    expect(etaMatch, "totals row should render an eta in seconds").toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — execution plan actions (simulate vs. on-chain gating)
// ─────────────────────────────────────────────────────────────────────────

test.describe("Execution plan actions", () => {
  test("OR-06 offers a simulated execute path that requires no wallet", async ({
    page,
  }) => {
    test.setTimeout(DECOMPOSE_TIMEOUT_MS + 30_000);
    await decomposeCalculatorPlan(page);

    // No wallet extension is present in this environment, so this button
    // must be reachable and usable in the disconnected state — this is the
    // only execute path this suite can exercise end-to-end.
    const simulate = page.getByRole("button", { name: /simulate/i });
    await expect(simulate).toBeVisible();
    await expect(simulate).toBeEnabled();

    await simulate.click();
    // execution-plan.tsx `simulate` calls execute(plan.plan_id) with no
    // auth_id/payer, then router.push(`/app/trace?task=${task_id}`).
    // Regression: if the simulated path started requiring a wallet or an
    // auth id, this navigation would never happen (or would throw).
    await expect(page).toHaveURL(/\/app\/trace\?task=/, {
      timeout: FULL_RUN_TIMEOUT_MS,
    });
  });

  test("OR-06 gates the on-chain Authorize & Execute path behind a wallet connect prompt", async ({
    page,
  }) => {
    test.setTimeout(DECOMPOSE_TIMEOUT_MS + 30_000);
    await decomposeCalculatorPlan(page);

    // Regression: this is the core safety property of the on-chain path —
    // without a connected wallet there is no signer, so the UI must show a
    // connect prompt instead of a clickable Authorize button that would
    // throw on `wallet.address` being undefined mid-flow.
    await expect(page.getByText(/wallet required/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Connect Wallet" }),
    ).toBeVisible();

    // The on-chain button only renders in the connected branch of
    // execution-plan.tsx — asserting its absence (not just "disabled")
    // confirms the gate is structural, not a crash waiting to happen.
    await expect(
      page.getByRole("button", { name: /Authorize & Execute/ }),
    ).toHaveCount(0);

    // The simulated path and fiat funding remain available while
    // disconnected.
    await expect(
      page.getByRole("button", { name: /simulate/i }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /Pay with Fiat/i }),
    ).toBeEnabled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/orchestrator — error path
// ─────────────────────────────────────────────────────────────────────────

test.describe("Orchestrator error handling", () => {
  test("OR-07 a failed decompose surfaces a visible role=alert and never renders a blank plan card", async ({
    page,
  }) => {
    // Route interception forces a deterministic failure without depending
    // on real backend downtime — the only reliable way to exercise this
    // path in CI.
    await page.route("**/api/orchestrator/decompose", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "forced_failure", message: "forced test failure" },
        }),
      }),
    );

    await gotoOrchestrator(page);
    await page.getByRole("button", { name: "calculator web app" }).click();
    await page.getByRole("button", { name: "Decompose ▸" }).click();

    // Regression: page.tsx renders the error inside `role="alert"` — a
    // plain <div> here would leave screen-reader users with zero signal
    // that anything failed (ErrorNote / this inline block exist precisely
    // to fix that class of silent failure).
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/500|forced_failure|forced test failure/);

    // Regression: AnimatePresence only mounts ExecutionPlan when
    // plan.data is truthy — a failed decompose must leave plan.data null,
    // so the plan card (identified by its heading) must never appear, not
    // even as an empty/blank shell.
    await expect(
      page.getByRole("heading", { name: "Execution plan" }),
    ).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// /app/trace — no task param / invalid task id
// ─────────────────────────────────────────────────────────────────────────

test.describe("Trace page without a live task", () => {
  test("with no ?task= param, renders a truthful demo/empty state", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/app/trace`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trace");

    // trace/page.tsx: taskId is null → the subtitle explicitly says this is
    // a demo replay, not a live run. Regression: showing live-run copy
    // (or a "streaming…" state) here would misrepresent a canned replay as
    // a real workflow execution.
    await expect(
      page.getByText(
        "Demo replay — run an intent in the Orchestrator to see a live one.",
      ),
    ).toBeVisible();

    // Demo-only transport controls.
    await expect(page.getByRole("button", { name: /Pause|Play/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart/ })).toBeVisible();

    // Summary row must say "demo", not fabricate a task id or a live state.
    await expect(page.getByText("demo").first()).toBeVisible();

    // No artifact exists in demo mode, so the artifact/trace tablist must
    // not render at all (trace/page.tsx only renders it when `artifact` is
    // truthy).
    await expect(page.getByRole("tablist")).toHaveCount(0);
  });

  test("with an invalid task id, degrades to a visible error instead of a blank page", async ({
    page,
  }) => {
    // openTraceStream's own reconnect budget (3 attempts, 1s/2s/4s backoff)
    // plus its polling fallback (up to 3 failed polls at 4s apart) bound
    // how long an unrecoverable task id takes to surface as an error —
    // this ceiling is derived from those lib/api.ts constants, not guessed.
    test.setTimeout(90_000);
    await page.goto(`${BASE_URL}/app/trace?task=nonexistent-task-id-e2e`);

    // The page must never go blank/white even while the stream is still
    // trying — the header and h1 render synchronously from taskId alone.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trace");
    await expect(page.getByText("nonexistent-task-id-e2e")).toBeVisible();

    // Regression: openTraceStream must eventually give up (settle(false))
    // rather than leaving the UI claiming "streaming…" forever against a
    // task that will never produce a line — this is the exact bug class
    // the streamError / ErrorNote path in trace/page.tsx exists to fix.
    await expect(page.getByRole("alert").first()).toBeVisible({
      timeout: 80_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Full end-to-end run: decompose → simulate execute → trace → artifact.
//
// Marked slow and isolated in its own describe block deliberately. Unlike
// decompose (a fixed ~1.4-2.4s simulated delay for demo-kit intents), the
// *execute* path hands the plan to real agents that actually generate the
// calculator artifact — that work is not bounded by any documented
// constant, and its wall-clock time is not guaranteed stable run to run.
// Rather than omit tablist/sandbox coverage (both real regressions worth
// catching), this accepts the flakiness/runtime tradeoff explicitly instead
// of silently skipping it.
// ─────────────────────────────────────────────────────────────────────────

test.describe("Full run: trace tablist and sandboxed artifact preview", () => {
  test.slow();

  test("trace/artifact tablist has correct ARIA wiring and the artifact iframe is sandboxed", async ({
    page,
  }) => {
    test.setTimeout(FULL_RUN_TIMEOUT_MS);
    await decomposeCalculatorPlan(page);
    await page.getByRole("button", { name: /simulate/i }).click();
    await expect(page).toHaveURL(/\/app\/trace\?task=/, {
      timeout: FULL_RUN_TIMEOUT_MS,
    });

    const tablist = page.getByRole("tablist", { name: "Trace views" });
    // The tablist only mounts once an artifact has arrived over SSE/polling
    // — this is the slow part of this test.
    await expect(tablist).toBeVisible({ timeout: FULL_RUN_TIMEOUT_MS });

    const traceTab = page.getByRole("tab", { name: "▸ trace log" });
    const artifactTab = page.getByRole("tab", { name: "▣ artifact" });
    await expect(traceTab).toHaveAttribute("aria-controls", /.+/);
    await expect(artifactTab).toHaveAttribute("aria-controls", /.+/);

    // trace/page.tsx auto-switches to the artifact tab once the artifact
    // arrives (useEffect keyed on artifactData). Regression: aria-selected
    // must track the actual rendered tab, or assistive tech announces the
    // wrong panel as active.
    await expect(artifactTab).toHaveAttribute("aria-selected", "true");
    await expect(traceTab).toHaveAttribute("aria-selected", "false");

    const artifactTabId = await artifactTab.getAttribute("id");
    expect(artifactTabId, "artifact tab should have an id").toBeTruthy();
    const artifactPanel = page.getByRole("tabpanel");
    await expect(artifactPanel).toBeVisible();
    await expect(artifactPanel).toHaveAttribute(
      "aria-labelledby",
      artifactTabId as string,
    );

    // Arrow-key navigation, per trace/page.tsx onTabKeyDown: ArrowLeft from
    // "artifact" (index 1) wraps to "trace" (index 0) and moves focus.
    await artifactTab.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(traceTab).toHaveAttribute("aria-selected", "true");
    await expect(traceTab).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(artifactTab).toHaveAttribute("aria-selected", "true");
    await expect(artifactTab).toBeFocused();

    // Home/End jump to the first/last tab regardless of current position.
    await page.keyboard.press("Home");
    await expect(traceTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(artifactTab).toHaveAttribute("aria-selected", "true");

    // ── The security-critical assertion in this suite ──
    // artifact-viewer.tsx renders the generated HTML via
    // `sandbox="allow-scripts"` with NO `allow-same-origin`. That
    // combination is what stops the sandboxed document (arbitrary
    // agent-generated HTML/JS) from ever holding a token that is
    // simultaneously "can run script" AND "shares this page's origin" —
    // the classic sandbox-escape pattern. A regression that adds
    // allow-same-origin back (even for a legitimate-looking reason, e.g.
    // "fonts wouldn't load") would let generated code read/write this
    // page's cookies, localStorage, and DOM.
    const iframeEl = page.locator("iframe");
    await expect(iframeEl).toHaveAttribute("sandbox", "allow-scripts");
    const sandboxValue = await iframeEl.getAttribute("sandbox");
    expect(sandboxValue).not.toContain("allow-same-origin");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Responsive: no horizontal overflow
// ─────────────────────────────────────────────────────────────────────────

test.describe("No horizontal overflow", () => {
  const viewports = [
    { name: "mobile 390x844", width: 390, height: 844 },
    { name: "desktop 1440x900", width: 1440, height: 900 },
  ];
  const routes = [
    { name: "orchestrator", path: "/app/orchestrator" },
    { name: "trace (demo)", path: "/app/trace" },
  ];

  for (const vp of viewports) {
    for (const route of routes) {
      test(`${route.name} has no horizontal scroll at ${vp.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(`${BASE_URL}${route.path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        // Regression this catches: globals.css sets `overflow-x: hidden` on
        // the document, which SILENTLY CLIPS overflow instead of scrolling
        // it (see the comment on TraceRow in trace/page.tsx about exactly
        // this happening to trace timestamps on a 380px viewport). A
        // scrollWidth that exceeds clientWidth means real content is being
        // clipped off-screen right now, invisibly.
        await expect
          .poll(
            async () =>
              page.evaluate(
                () =>
                  document.documentElement.scrollWidth -
                  document.documentElement.clientWidth,
              ),
            {
              message: `${route.name} at ${vp.name} should not overflow horizontally`,
              timeout: 15_000,
            },
          )
          .toBeLessThanOrEqual(1);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Accessibility
// ─────────────────────────────────────────────────────────────────────────

test.describe("Accessibility", () => {
  test("orchestrator page has one h1 and a labelled intent control", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByLabel(/intent/i)).toBeVisible();
  });

  test("trace page has exactly one h1", async ({ page }) => {
    await page.goto(`${BASE_URL}/app/trace`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("submit button is keyboard-reachable by Tab from the intent field", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    const textarea = page.getByLabel(/intent/i);
    await textarea.focus();
    await expect(textarea).toBeFocused();

    // DOM order in page.tsx: textarea → 4 preset buttons → submit button.
    // Regression: a positive tabindex or an off-order insertion anywhere
    // in that chain would strand keyboard users before ever reaching
    // submit.
    for (let i = 0; i < PRESET_INTENTS.length + 1; i++) {
      await page.keyboard.press("Tab");
    }
    await expect(
      page.getByRole("button", { name: "Decompose ▸" }),
    ).toBeFocused();
  });

  test("the focused submit button shows a visible focus indicator", async ({
    page,
  }) => {
    await gotoOrchestrator(page);
    await page.getByRole("button", { name: "calculator web app" }).click();
    const submit = page.getByRole("button", { name: "Decompose ▸" });
    await submit.focus();
    await expect(submit).toBeFocused();

    // Regression: the shared `focusRing` class (lib/ui.ts) is this app's
    // only visible focus signal on a dark, low-chrome UI — losing it (e.g.
    // an `outline: none` override with no replacement) leaves keyboard
    // users with no way to see where focus is.
    const outlineStyle = await submit.evaluate(
      (el) => getComputedStyle(el).outlineStyle,
    );
    const boxShadow = await submit.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    );
    const hasVisibleFocus =
      outlineStyle !== "none" || Boolean(boxShadow && boxShadow !== "none");
    expect(hasVisibleFocus).toBeTruthy();
  });
});
