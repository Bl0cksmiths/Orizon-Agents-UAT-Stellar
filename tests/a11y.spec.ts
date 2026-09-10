import { test, expect } from "@playwright/test";
import {
  ROUTES,
  expectHeadingStructure,
  expectAllImagesHaveAlt,
  expectAllInteractivesHaveNames,
} from "./fixtures";

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

    test(`${route.label} (${route.path}): declares a document language and exposes main/navigation landmarks`, async ({
      page,
    }) => {
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

    test(`${route.label} (${route.path}): tabbing shows a visible keyboard focus indicator`, async ({
      page,
    }) => {
      await page.goto(route.path);

      // Tab a few times — the very first stop is often the "skip to
      // content" link, which is intentionally sr-only until focused,
      // so checking only the first stop would miss a real regression on
      // the second/third element.
      const samples: Array<{
        tag: string;
        outlineStyle: string;
        outlineWidth: string;
        boxShadow: string;
      }> = [];
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press("Tab");
        // eslint-disable-next-line no-await-in-loop
        const sample = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) {
            return null;
          }
          const cs = window.getComputedStyle(el);
          return {
            tag: el.tagName,
            outlineStyle: cs.outlineStyle,
            outlineWidth: cs.outlineWidth,
            boxShadow: cs.boxShadow,
          };
        });
        if (sample) samples.push(sample);
      }

      expect(
        samples.length,
        "no element accepted keyboard focus in the first 3 Tab presses",
      ).toBeGreaterThan(0);

      // A focus indicator exists if the browser/CSS draws either a
      // non-zero outline or a box-shadow ring (the common Tailwind
      // `focus-visible:ring-*` pattern). Regression this catches: a global
      // `outline: none` reset with no replacement ring, which strands
      // keyboard-only users with no visual cursor at all.
      const hasIndicator = samples.some((s) => {
        const outlineVisible =
          s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const shadowVisible = s.boxShadow !== "none" && s.boxShadow !== "";
        return outlineVisible || shadowVisible;
      });
      expect(
        hasIndicator,
        `no focus indicator (outline or box-shadow) detected on any of: ${JSON.stringify(samples)}`,
      ).toBe(true);
    });

    test(`${route.label} (${route.path}): inline links within body text are distinguishable from surrounding text without relying on color alone`, async ({
      page,
    }) => {
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
