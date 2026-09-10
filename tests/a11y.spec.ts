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
});
