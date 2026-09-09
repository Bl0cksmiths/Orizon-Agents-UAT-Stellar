import { test, expect } from "@playwright/test";
import {
  ROUTES,
  expectHeadingStructure,
  expectAllImagesHaveAlt,
  expectAllInteractivesHaveNames,
} from "./fixtures";

/**
 * Accessibility sweep, parameterized across all 12 live routes.
 *
 * Deliberately hand-rolled with `page.evaluate` rather than @axe-core/playwright
 * so the suite carries no extra dependency — see the task brief. This trades
 * axe's exhaustive rule set for a small, explicit set of checks whose failure
 * messages are easy to act on; it is a floor, not a replacement for a full
 * axe/manual audit.
 */

test.describe("accessibility", () => {
  for (const route of ROUTES) {
    test(`${route.label} (${route.path}): document has one h1, no skipped heading levels, alt text on every image, and a name on every interactive control`, async ({
      page,
    }) => {
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
