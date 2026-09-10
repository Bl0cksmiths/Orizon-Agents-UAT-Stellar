import { test, expect, type Page } from "@playwright/test";
import {
  ROUTES,
  expectHeadingStructure,
  expectAllImagesHaveAlt,
  expectAllInteractivesHaveNames,
  hangApi,
} from "./fixtures";

/**
 * Presses Tab repeatedly (never a click/pointer action) until the focused
 * element satisfies `isMatch`, or `maxPresses` is exhausted. Returns whether
 * a match was reached — the caller asserts on that, so a broken tab order
 * (an unreachable CTA, a focus trap that swallows Tab) fails loudly instead
 * of the loop just running out silently.
 *
 * Reads `document.activeElement` fresh on every press rather than walking a
 * precomputed list of focusable elements — that's what makes this a real
 * keyboard-navigation check rather than a DOM query with a keyboard-shaped
 * label: it only "sees" what the browser's own tab order actually reaches.
 */
async function tabToMatch(
  page: Page,
  isMatch: (el: {
    tag: string;
    text: string;
    ariaLabel: string | null;
  }) => boolean,
  maxPresses = 25,
): Promise<boolean> {
  for (let i = 0; i < maxPresses; i++) {
    await page.keyboard.press("Tab");
    // eslint-disable-next-line no-await-in-loop
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return {
        tag: el.tagName,
        text: (el.textContent ?? "").trim(),
        ariaLabel: el.getAttribute("aria-label"),
      };
    });
    if (info && isMatch(info)) return true;
  }
  return false;
}

/**
 * Accessibility sweep, parameterized across all 12 live routes, covering
 * AX-01 through AX-07 from docs/uat/test-plan.md. Every test is tagged with
 * the criterion id(s) it verifies (`{ tag: ["@AX-0N", ...] }` plus `@a11y`)
 * so `--grep @AX-0N` or `--grep @a11y` isolates exactly what a reviewer
 * needs.
 *
 * AX-01..AX-06 are static/structural checks against every route. AX-07 (a
 * core journey is completable by keyboard alone) is the one criterion static
 * sweeps cannot cover — it needs real keyboard-driven journeys, added below
 * the per-route loop: marketing home -> console, sidebar navigation, the
 * mobile drawer's focus trap, the orchestrator intent form, and the trace
 * tablist.
 *
 * Deliberately hand-rolled with `page.evaluate` rather than @axe-core/playwright
 * so the suite carries no extra dependency — see the task brief. This trades
 * axe's exhaustive rule set for a small, explicit set of checks whose failure
 * messages are easy to act on; it is a floor, not a replacement for a full
 * axe/manual audit.
 */

test.describe("accessibility", () => {
  for (const route of ROUTES) {
    test(
      `AX-01/AX-02/AX-03 — ${route.label} (${route.path}): document has one h1, no skipped heading levels, alt text on every image, and a name on every interactive control`,
      { tag: ["@AX-01", "@AX-02", "@AX-03", "@a11y"] },
      async ({ page }) => {
      await page.goto(route.path);
      // Let client-rendered content (metrics, tables) settle before auditing —
      // an h1 rendered by a client component after mount must still count.
      await page.waitForLoadState("networkidle").catch(() => {
        // Some routes poll continuously (live metrics) and never go idle;
        // fall back to DOM readiness, which is enough for a static audit.
      });

      await expectHeadingStructure(page);
      await expectAllImagesHaveAlt(page);
      await expectAllInteractivesHaveNames(page);
    });

    test(
      `AX-05 — ${route.label} (${route.path}): declares a document language and exposes main/navigation landmarks`,
      { tag: ["@AX-05", "@a11y"] },
      async ({ page }) => {
      await page.goto(route.path);

      // A missing/empty `lang` makes every screen reader guess the
      // pronunciation and hyphenation rules for the whole document.
      const lang = await page.evaluate(
        () => document.documentElement.lang,
      );
      expect(lang, "<html lang> must be a non-empty language tag").toBeTruthy();
      expect(lang.toLowerCase().startsWith("en")).toBe(true);

      // A `main` landmark lets assistive-tech users skip straight to page
      // content; `nav` lets them jump to wayfinding without reading it
      // linearly. Both shells (marketing and console) render one of each.
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("navigation").first()).toBeVisible();
    });

    test(
      `AX-04 — ${route.label} (${route.path}): tabbing shows a visible keyboard focus indicator`,
      { tag: ["@AX-04", "@a11y"] },
      async ({ page }) => {
        await page.goto(route.path);

        // Tab a few times — the very first stop is often the "skip to
        // content" link, which is intentionally sr-only until focused,
        // so checking only the first stop would miss a real regression on
        // the second/third element.
        //
        // Each sample compares the SAME element's computed style focused vs
        // blurred — not merely whether some outline/box-shadow property is
        // non-empty, which a static `outline: 1px solid transparent` would
        // pass without ever being visible. The app draws its ring with an
        // inset Tailwind `focus-visible:ring-*` (`focusRing` in lib/ui.ts),
        // a box-shadow that exists only while `:focus-visible` matches, so a
        // real regression (a global `outline: none` reset with nothing to
        // replace it) shows up as "focused === unfocused", not as an empty
        // string.
        const samples: Array<{
          tag: string;
          focused: { outlineStyle: string; outlineWidth: string; boxShadow: string };
          unfocused: { outlineStyle: string; outlineWidth: string; boxShadow: string };
        }> = [];
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press("Tab");
          // eslint-disable-next-line no-await-in-loop
          const sample = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) {
              return null;
            }
            const focusedCs = window.getComputedStyle(el);
            const focused = {
              outlineStyle: focusedCs.outlineStyle,
              outlineWidth: focusedCs.outlineWidth,
              boxShadow: focusedCs.boxShadow,
            };
            el.blur();
            const unfocusedCs = window.getComputedStyle(el);
            const unfocused = {
              outlineStyle: unfocusedCs.outlineStyle,
              outlineWidth: unfocusedCs.outlineWidth,
              boxShadow: unfocusedCs.boxShadow,
            };
            // Restore focus so the next real Tab press continues forward
            // from here instead of restarting the sequence from the top.
            el.focus();
            return { tag: el.tagName, focused, unfocused };
          });
          if (sample) samples.push(sample);
        }

        expect(
          samples.length,
          "no element accepted keyboard focus in the first 3 Tab presses",
        ).toBeGreaterThan(0);

        // A real focus indicator is a visible outline or box-shadow that is
        // present while focused and gone (or different) once blurred.
        // Regression this catches: a global `outline: none` reset with no
        // replacement ring, which strands keyboard-only users with no
        // visual cursor at all — including one that leaves SOME non-empty
        // outline/box-shadow declared but identical whether focused or not.
        const hasRealIndicator = samples.some((s) => {
          const outlineVisible =
            s.focused.outlineStyle !== "none" &&
            parseFloat(s.focused.outlineWidth) > 0;
          const outlineChanged =
            s.focused.outlineStyle !== s.unfocused.outlineStyle ||
            s.focused.outlineWidth !== s.unfocused.outlineWidth;
          const shadowVisible =
            s.focused.boxShadow !== "none" && s.focused.boxShadow !== "";
          const shadowChanged = s.focused.boxShadow !== s.unfocused.boxShadow;
          return (outlineVisible && outlineChanged) || (shadowVisible && shadowChanged);
        });
        expect(
          hasRealIndicator,
          `no focus indicator that actually changes between focused and unfocused (outline or box-shadow) detected on any of: ${JSON.stringify(samples)}`,
        ).toBe(true);
      },
    );

    test(
      `AX-06 — ${route.label} (${route.path}): inline links within body text are distinguishable from surrounding text without relying on color alone`,
      { tag: ["@AX-06", "@a11y"] },
      async ({ page }) => {
      await page.goto(route.path);

      // WCAG 1.4.1: a link that differs from its surrounding paragraph text
      // ONLY by color is invisible to color-blind and low-vision readers.
      // This checks links nested inside prose containers (paragraphs, list
      // items) rather than nav/button chrome, where color-only styling is a
      // real risk; standalone nav/CTA links are exempted since they are
      // already set apart by position and button-like framing, not color.
      const offenders = await page.evaluate(() => {
        const proseLinks = Array.from(
          document.querySelectorAll("main p a, main li a, article a"),
        );
        return proseLinks
          .filter((a) => {
            const cs = window.getComputedStyle(a);
            const underlined =
              cs.textDecorationLine.includes("underline") ||
              cs.textDecorationLine.includes("dotted");
            const bold = parseInt(cs.fontWeight, 10) >= 600;
            const italic = cs.fontStyle === "italic";
            return !underlined && !bold && !italic;
          })
          .map((a) => a.textContent?.trim().slice(0, 60) ?? a.outerHTML.slice(0, 80));
      });

      expect(
        offenders,
        `inline links relying on color alone (no underline/bold/italic): ${JSON.stringify(offenders)}`,
      ).toEqual([]);
    });
  }
});

/**
 * AX-07: core journeys completable by keyboard alone. The per-route sweep
 * above checks static structure; these tests drive real journeys with
 * `page.keyboard` only — no `.click()`, no `.tap()` — and assert the journey
 * actually completed (a route changed, a form submitted, focus landed
 * somewhere real), not just that some element was reachable.
 */
test.describe("accessibility — AX-07 keyboard journeys", () => {
  test(
    "AX-07 — marketing home to the console via the Launch App CTA, using only Tab and Enter",
    { tag: ["@AX-07", "@a11y"] },
    async ({ page }) => {
      await page.goto("/");

      const reachedCta = await tabToMatch(
        page,
        (el) => el.tag === "A" && el.text.toLowerCase().includes("launch app"),
        25,
      );
      expect(
        reachedCta,
        "could not reach the Launch App CTA by tabbing alone from the marketing home page",
      ).toBe(true);

      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/\/app\/?(\?.*)?$/);
      // A real page landed, not a blank shell mid-navigation.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
  );

  // Mirrors the eleven items rendered by app/app/_components/sidebar.tsx —
  // labels and hrefs kept in lockstep with that source rather than reused
  // from fixtures.ts's route labels, which are worded for reporter output
  // ("Console overview") rather than for matching the sidebar link text
  // ("Overview") a keyboard user actually tabs onto.
  const SIDEBAR_ITEMS: Array<{ label: string; path: string }> = [
    { label: "Overview", path: "/app" },
    { label: "Agents", path: "/app/agents" },
    { label: "Register", path: "/app/register" },
    { label: "Reputation", path: "/app/reputation" },
    { label: "Orchestrator", path: "/app/orchestrator" },
    { label: "Trace", path: "/app/trace" },
    { label: "Events", path: "/app/events" },
    { label: "Send XLM", path: "/app/send" },
    { label: "PDAX Ramp", path: "/app/pdax" },
    { label: "Wallet", path: "/app/wallet" },
    { label: "Flow", path: "/app/flow" },
  ];

  for (const item of SIDEBAR_ITEMS) {
    test(
      `AX-07 — console sidebar reaches ${item.label} (${item.path}) by keyboard alone, and focus lands somewhere sensible`,
      { tag: ["@AX-07", "@a11y"] },
      async ({ page }) => {
        await page.goto("/app");

        const reached = await tabToMatch(
          page,
          (el) => el.tag === "A" && el.text === item.label,
          30,
        );
        expect(
          reached,
          `could not tab to the "${item.label}" sidebar link`,
        ).toBe(true);

        await page.keyboard.press("Enter");

        await expect(page).toHaveURL(
          new RegExp(`${item.path.replace(/\//g, "\\/")}$`),
        );

        // "Somewhere sensible" means focus did not fall back to <body> — a
        // keyboard user is never left with no visible cursor after a
        // client-side route change.
        const focusedTag = await page.evaluate(() => {
          const el = document.activeElement;
          return el && el !== document.body ? el.tagName : null;
        });
        expect(
          focusedTag,
          "focus was lost (fell back to <body>) after navigating via the sidebar",
        ).not.toBeNull();
      },
    );
  }

  test(
    "AX-07 — mobile nav drawer: opens with the keyboard, traps focus inside via inert background, Escape closes it, focus returns to the opener",
    { tag: ["@AX-07", "@a11y"] },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/app");

      const reachedHamburger = await tabToMatch(
        page,
        (el) => el.ariaLabel === "open menu",
        30,
      );
      expect(
        reachedHamburger,
        "could not tab to the hamburger button on a mobile viewport",
      ).toBe(true);

      await page.keyboard.press("Enter");

      const dialog = page.locator('aside[role="dialog"]');
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");

      // Focus moves INTO the drawer itself (app/app/_components/sidebar.tsx
      // focuses the <aside> on open), not merely "somewhere on the page".
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.tagName))
        .toBe("ASIDE");

      // Background content (the ConsoleContent wrapper around topbar + main)
      // is marked `inert` while the drawer is open — see
      // app/app/_components/console-content.tsx. That native attribute is
      // the actual trap mechanism: repeated Tabs must never land on
      // anything inside it.
      const trappedOnOpen = await page.evaluate(() => {
        const main = document.querySelector("main");
        return main ? main.closest("[inert]") !== null : false;
      });
      expect(
        trappedOnOpen,
        "background content (main) is not inert while the mobile drawer is open",
      ).toBe(true);

      // Tab through the drawer's own eleven nav links (plus a little slack)
      // — none of these presses may ever land inside the inert background.
      for (let i = 0; i < 13; i++) {
        await page.keyboard.press("Tab");
        // eslint-disable-next-line no-await-in-loop
        const escapedToBackground = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return false;
          return el.closest("[inert]") !== null;
        });
        expect(
          escapedToBackground,
          `keyboard focus escaped into inert background content on Tab press ${i + 1} while the drawer was open`,
        ).toBe(false);
      }

      await page.keyboard.press("Escape");

      // The dialog role/aria-modal are only present while open — once
      // closed, this locator matches nothing.
      await expect(page.locator('aside[role="dialog"]')).toHaveCount(0);

      // Focus returns to the hamburger button that opened the drawer.
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label")))
        .toBe("open menu");
    },
  );

  test(
    "AX-07 — orchestrator intent box inserts a newline on Shift+Enter instead of submitting, keyboard only",
    { tag: ["@AX-07", "@a11y"] },
    async ({ page }) => {
      await page.goto("/app/orchestrator");

      const reachedTextarea = await tabToMatch(
        page,
        (el) => el.tag === "TEXTAREA",
        15,
      );
      expect(reachedTextarea, "could not tab to the intent textarea").toBe(
        true,
      );

      await page.keyboard.type("line one");
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.type("line two");

      await expect(page.locator("#intent")).toHaveValue("line one\nline two");

      // Shift+Enter must not have triggered a submit — the button stays in
      // its idle label, never "Decomposing…".
      await expect(page.getByRole("button", { name: /decompose/i })).toHaveText(
        "Decompose ▸",
      );
    },
  );

  test(
    "AX-07 — orchestrator intent box submits on Enter alone, keyboard only",
    { tag: ["@AX-07", "@a11y"] },
    async ({ page }) => {
      // The API is left hanging rather than resolved/mocked with a plan:
      // the behavior under test is "did Enter trigger the form's submit
      // handler", which flips `plan.pending` synchronously before any
      // network response — hanging the request just keeps that pending
      // state observable instead of racing a real decompose call.
      await hangApi(page);
      await page.goto("/app/orchestrator");

      const reachedTextarea = await tabToMatch(
        page,
        (el) => el.tag === "TEXTAREA",
        15,
      );
      expect(reachedTextarea, "could not tab to the intent textarea").toBe(
        true,
      );

      await page.keyboard.type("tetris game in html");
      await page.keyboard.press("Enter");

      await expect(
        page.getByRole("button", { name: /decomposing/i }),
      ).toBeVisible();
    },
  );

  test(
    "AX-07 — trace page tablist: ArrowLeft/ArrowRight/Home/End move between tabs, keyboard only",
    { tag: ["@AX-07", "@a11y"] },
    async ({ page }) => {
      // The tablist (app/app/trace/page.tsx) only mounts once an artifact
      // has resolved — reaching that state depends on a completed backend
      // run. Routing just the two calls the tab-list's own visibility
      // depends on (the artifact fetch and the trace stream) isolates the
      // behavior under test — the tablist's arrow/Home/End key handling —
      // from real backend/task availability, the same way `hangApi`/
      // `blockApi` isolate other specs in this suite from live network
      // state. Nothing about the keyboard interaction itself is mocked.
      const taskId = "e2e-a11y-tablist";
      await page.route(`**/api/tasks/${taskId}/artifact`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            artifact: {
              title: "a11y fixture",
              summary: "static fixture for the keyboard tablist journey",
              files: [],
              entry: "index.html",
              preview_html: "<p>fixture</p>",
            },
            charge_tx: null,
            proof_tx: null,
          }),
        }),
      );
      await page.route(`**/api/trace/${taskId}/stream*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body:
            'event: trace\ndata: {"t":"0.10","level":"input","msg":"fixture line"}\n\n' +
            "event: done\ndata: {}\n\n",
        }),
      );

      await page.goto(`/app/trace?task=${taskId}`);

      const tablist = page.getByRole("tablist", { name: /trace views/i });
      await expect(tablist).toBeVisible();

      const traceTab = page.getByRole("tab", { name: /trace log/i });
      const artifactTab = page.getByRole("tab", { name: /artifact/i });

      // The page auto-switches to the artifact tab once one resolves, so
      // that is the tab a roving-tabindex keyboard user actually lands on
      // first — the same entry point Tab would reach.
      await expect(artifactTab).toHaveAttribute("aria-selected", "true");
      await artifactTab.focus();
      await expect(artifactTab).toBeFocused();

      await page.keyboard.press("ArrowLeft");
      await expect(traceTab).toBeFocused();
      await expect(traceTab).toHaveAttribute("aria-selected", "true");
      await expect(traceTab).toHaveAttribute("tabindex", "0");
      await expect(artifactTab).toHaveAttribute("aria-selected", "false");
      await expect(artifactTab).toHaveAttribute("tabindex", "-1");

      await page.keyboard.press("ArrowRight");
      await expect(artifactTab).toBeFocused();
      await expect(artifactTab).toHaveAttribute("aria-selected", "true");

      await page.keyboard.press("Home");
      await expect(traceTab).toBeFocused();
      await expect(traceTab).toHaveAttribute("aria-selected", "true");

      await page.keyboard.press("End");
      await expect(artifactTab).toBeFocused();
      await expect(artifactTab).toHaveAttribute("aria-selected", "true");
    },
  );
});
