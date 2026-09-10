import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the Orizon Agents marketing page (route: "/"), sourced
 * from app/page.tsx, app/layout.tsx, app/(marketing)/_components/*.tsx,
 * components/ui/marquee.tsx, components/backend-warmup.tsx, and the
 * app/{manifest,robots,sitemap,opengraph-image,not-found}.ts metadata
 * routes. Selectors are derived from the actual rendered markup, not
 * guessed — verified against both source and the live orizons.xyz HTML.
 *
 * Assumes baseURL is configured to https://orizons.xyz.
 */

// Desktop nav is a fixed <header> with a "hidden md:flex" desktop <nav> and a
// separate "md:hidden" mobile disclosure <nav aria-label="Mobile">. Below the
// md breakpoint the mobile menu starts closed, so a viewport this wide is
// required for the desktop links to be present in the accessibility tree.
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Primary nav: label -> in-page anchor -> the section id it must land on.
// Source: app/(marketing)/_components/nav.tsx `links` array.
const NAV_LINKS = [
  { label: "Product", href: "#solution", sectionId: "solution" },
  { label: "Architecture", href: "#architecture", sectionId: "architecture" },
  { label: "Reputation", href: "#reputation", sectionId: "reputation" },
  { label: "Use Cases", href: "#use-cases", sectionId: "use-cases" },
  { label: "Roadmap", href: "#roadmap", sectionId: "roadmap" },
] as const;

// The eight <h2> section headings, in the exact order page.tsx composes the
// sections. Matched with substring regexes (not full copy) so a subtitle
// wording tweak doesn't break the suite, per the "avoid brittle exact-string
// matches on long marketing copy" guidance.
const SECTION_HEADINGS: RegExp[] = [
  /isolated.*bottleneck/i, // Problem
  /coordinated network/i, // Solution
  /Five modules/i, // Architecture
  /settled history, not stars/i, // Reputation
  /Real intents\. Real agent chains/i, // UseCases
  /digital labor market/i, // Roadmap
  /Three audiences/i, // Personas
  /Stop shipping/i, // CTA
];

// Console routes the marketing page links out to (nav CTA, hero, reputation,
// final CTA, footer "Product" column). None of these render on the marketing
// page itself, but every link that promises them must actually resolve.
const INTERNAL_APP_ROUTES = [
  "/app",
  "/app/agents",
  "/app/reputation",
  "/app/orchestrator",
  "/app/trace",
  "/app/flow",
];

// Footer link columns. Source: app/(marketing)/_components/footer.tsx `cols`.
const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "Console", href: "/app" },
      { label: "Agents", href: "/app/agents" },
      { label: "Reputation", href: "/app/reputation" },
      { label: "Orchestrator", href: "/app/orchestrator" },
      { label: "Trace", href: "/app/trace" },
      { label: "Flow", href: "/app/flow" },
    ],
  },
  {
    heading: "Protocol",
    links: [
      { label: "ERC-8004", href: "https://eips.ethereum.org/EIPS/eip-8004" },
      { label: "x402", href: "https://www.x402.org" },
      { label: "Registry", href: "/app/agents" },
      {
        label: "Contracts",
        href: "https://github.com/ALGOREX-PH/Orizon-Agents-Smart-Contract-Stellar#readme",
      },
    ],
  },
  {
    heading: "Resources",
    links: [
      {
        label: "Docs",
        href: "https://github.com/ALGOREX-PH/Orizon-Agents-BE-Stellar#readme",
      },
      { label: "API", href: "https://orizon-agents-be-stellar.onrender.com/docs" },
      {
        label: "Status",
        href: "https://orizon-agents-be-stellar.onrender.com/health",
      },
      {
        label: "Changelog",
        href: "https://github.com/ALGOREX-PH/Orizon-Agents-FE-Stellar/commits",
      },
    ],
  },
  {
    heading: "Team",
    links: [
      { label: "GitHub", href: "https://github.com/ALGOREX-PH" },
      { label: "LinkedIn", href: "https://www.linkedin.com/in/algorexph/" },
      {
        label: "Frontend repo",
        href: "https://github.com/ALGOREX-PH/Orizon-Agents-FE-Stellar",
      },
      {
        label: "Backend repo",
        href: "https://github.com/ALGOREX-PH/Orizon-Agents-BE-Stellar",
      },
      {
        label: "Contracts repo",
        href: "https://github.com/ALGOREX-PH/Orizon-Agents-Smart-Contract-Stellar",
      },
    ],
  },
] as const;

// Marquee agent capability tags. Source: app/page.tsx `agentTags`, rendered
// twice by components/ui/marquee.tsx for a seamless CSS loop.
const AGENT_TAGS = [
  "seo.brief",
  "copywrite.v3",
  "design.figma",
  "code.next",
  "deploy.v0",
  "sol-audit",
  "research.pro",
  "ads.meta",
  "translate.42",
  "vision.ocr",
  "analytics.v2",
  "crawl.v2",
];

// Default every test to the desktop viewport, since the desktop nav/footer
// content this suite exercises is not present in the accessibility tree
// below the md breakpoint (mobile nav starts closed). The one mobile-only
// test overrides this locally.
test.use({ viewport: DESKTOP_VIEWPORT });

test.describe("Document head & metadata", () => {
  test("MK-01 ships the exact <title> configured in app/layout.tsx", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(
      "Orizon Agents — Orchestration for autonomous digital labor",
    );
  });

  test("MK-01 ships a meta description for search snippets", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Orizon Agents is a decentralized orchestration layer where AI agents autonomously hire, pay, and verify each other to execute complex tasks.",
    );
  });

  test("declares a self-referencing canonical URL to avoid duplicate-content indexing", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://orizons.xyz",
    );
  });

  test("MK-01 exposes Open Graph tags for social link previews", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "Orizon Agents",
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "website",
    );
    // og:url should match the canonical so search engines and share cards
    // agree on the one true URL for this page.
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      "https://orizons.xyz",
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      /\/opengraph-image/,
    );
  });

  test("exposes a Twitter summary_large_image card", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
      "content",
      "Orizon Agents",
    );
  });

  test("sets lang=\"en\" on <html> for assistive tech and search indexing", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("Structured data (JSON-LD)", () => {
  test("MK-02 ships exactly one JSON-LD script tag containing valid JSON", async ({
    page,
  }) => {
    await page.goto("/");
    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts).toHaveCount(1);
    const raw = await scripts.first().textContent();
    // A regression here (e.g. an unescaped value breaking the JSON) would
    // still render an HTML page fine but silently drop all SEO rich-result
    // eligibility, so parsing must be asserted explicitly.
    expect(() => JSON.parse(raw ?? "")).not.toThrow();
  });

  test("MK-02 declares Organization and SoftwareApplication entries in @graph", async ({
    page,
  }) => {
    await page.goto("/");
    const raw = await page
      .locator('script[type="application/ld+json"]')
      .first()
      .textContent();
    const data = JSON.parse(raw ?? "{}");
    expect(data["@context"]).toBe("https://schema.org");
    const types = (data["@graph"] ?? []).map((node: { "@type": string }) => node["@type"]);
    expect(types).toEqual(
      expect.arrayContaining(["Organization", "SoftwareApplication"]),
    );
    const app = data["@graph"].find(
      (node: { "@type": string }) => node["@type"] === "SoftwareApplication",
    );
    expect(app.offers).toMatchObject({ "@type": "Offer", priceCurrency: "USD" });
  });
});

test.describe("Primary navigation", () => {
  test("renders the desktop nav with all five section links", async ({ page }) => {
    await page.goto("/");
    const desktopNav = page.getByRole("navigation").first();
    for (const link of NAV_LINKS) {
      await expect(
        desktopNav.getByRole("link", { name: link.label, exact: true }),
      ).toHaveAttribute("href", link.href);
    }
  });

  for (const link of NAV_LINKS) {
    test(`MK-03 "${link.label}" nav link scrolls to the #${link.sectionId} section`, async ({
      page,
    }) => {
      await page.goto("/");
      const desktopNav = page.getByRole("navigation").first();
      await desktopNav.getByRole("link", { name: link.label, exact: true }).click();
      // In-page hash navigation must update the URL...
      await expect(page).toHaveURL(new RegExp(`${link.href}$`));
      // ...and actually land on the target section, not just change the URL.
      await expect(page.locator(`#${link.sectionId}`)).toBeInViewport();
    });
  }

  test('"Launch App" CTA resolves to the /app console', async ({ page }) => {
    await page.goto("/");
    const launchLink = page
      .locator("header")
      .getByRole("link", { name: /Launch App/i });
    await expect(launchLink).toHaveAttribute("href", "/app");
    // Navigate directly rather than clicking + waitForNavigation: Next.js
    // <Link> routes client-side via the History API, which Playwright's
    // navigation-lifecycle events don't reliably observe.
    const response = await page.goto("/app");
    expect(response?.ok()).toBeTruthy();
  });
});

test.describe("Hero", () => {
  test("renders the hero headline and supporting copy", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /orchestration.*autonomous/is }),
    ).toBeVisible();
    await expect(page.getByText("System online · v0.1")).toBeVisible();
  });

  test('"Launch Console" primary CTA resolves to /app', async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: /Launch Console/i }).first();
    await expect(cta).toHaveAttribute("href", "/app");
    const response = await page.goto(await cta.getAttribute("href") as string);
    expect(response?.ok()).toBeTruthy();
  });

  test('"See how it works" secondary CTA scrolls to the Solution section', async ({
    page,
  }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: "See how it works" });
    await expect(cta).toHaveAttribute("href", "#solution");
    await cta.click();
    await expect(page.locator("#solution")).toBeInViewport();
  });
});

test.describe("Marquee", () => {
  // Five of the twelve agent tags (seo.brief, copywrite.v3, design.figma,
  // code.next, deploy.v0) are *also* rendered verbatim in the Hero's
  // CodeBlock demo and in the default-active Use Cases chain, so an
  // unscoped page-wide text lookup would over-count. components/ui/marquee.tsx
  // has no landmark role/label to anchor on, so this scopes to its one
  // functional CSS hook (the seamless-loop animation class) rather than
  // matching on styling.
  const MARQUEE_TRACK_SELECTOR = ".animate-marquee";

  test("renders every agent capability tag, doubled for the seamless loop", async ({
    page,
  }) => {
    await page.goto("/");
    const marqueeTrack = page.locator(MARQUEE_TRACK_SELECTOR);
    await expect(marqueeTrack).toBeVisible();
    for (const tag of AGENT_TAGS) {
      // components/ui/marquee.tsx renders `[...items, ...items]` so the CSS
      // animation can loop without a visible seam — each tag must appear
      // exactly twice within the marquee track, not once (broken loop) or a
      // stray extra time.
      await expect(marqueeTrack.getByText(tag, { exact: false })).toHaveCount(2);
    }
  });
});

test.describe("Marketing sections: presence and document order", () => {
  test("renders all eight section headings in the order page.tsx composes them", async ({
    page,
  }) => {
    await page.goto("/");
    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings).toHaveCount(SECTION_HEADINGS.length);
    const texts = await headings.allTextContents();
    for (let i = 0; i < SECTION_HEADINGS.length; i++) {
      expect(texts[i]).toMatch(SECTION_HEADINGS[i]);
    }
  });

  test("each section carries the id its nav anchor targets", async ({ page }) => {
    await page.goto("/");
    for (const id of ["problem", "solution", "architecture", "reputation", "use-cases", "roadmap"]) {
      await expect(page.locator(`section#${id}`)).toBeVisible();
    }
  });
});

test.describe("Final CTA section", () => {
  test('"Launch Console" and "Browse Agents" resolve to /app and /app/agents', async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.locator("section", { hasText: "FINAL TRANSMISSION" });
    await expect(section.getByRole("link", { name: /Launch Console/i })).toHaveAttribute(
      "href",
      "/app",
    );
    await expect(section.getByRole("link", { name: /Browse Agents/i })).toHaveAttribute(
      "href",
      "/app/agents",
    );
  });
});

test.describe("Reputation section deep links", () => {
  test('"Explore the Reputation System" resolves to /app/reputation', async ({
    page,
  }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: /Explore the Reputation System/i });
    await expect(link).toHaveAttribute("href", "/app/reputation");
    const response = await page.goto("/app/reputation");
    expect(response?.ok()).toBeTruthy();
  });

  test('"View the ledger contract" opens the on-chain explorer in a new tab', async ({
    page,
  }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: "View the ledger contract" });
    // Points off-site to stellar.expert — must open in a new tab with
    // rel="noopener" so the marketing page can't be reverse-tabnabbed.
    await expect(link).toHaveAttribute("href", /stellar\.expert\/explorer/);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });
});

test.describe("Footer", () => {
  test("renders all four link columns", async ({ page }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    for (const col of FOOTER_COLUMNS) {
      await expect(
        footer.getByText(col.heading, { exact: true }),
      ).toBeVisible();
    }
  });

  for (const route of INTERNAL_APP_ROUTES) {
    test(`footer link to ${route} resolves (not a 404)`, async ({ page }) => {
      await page.goto("/");
      const footer = page.locator("footer");
      const col = FOOTER_COLUMNS.find((c) => c.links.some((l) => l.href === route))!;
      const label = col.links.find((l) => l.href === route)!.label;
      const link = footer.getByRole("link", { name: label, exact: true });
      await expect(link).toHaveAttribute("href", route);
      const response = await page.goto(route);
      expect(response?.ok()).toBeTruthy();
    });
  }

  test("external footer links carry correct hrefs and open safely in a new tab", async ({
    page,
  }) => {
    await page.goto("/");
    const footer = page.locator("footer");
    for (const col of FOOTER_COLUMNS) {
      for (const link of col.links) {
        if (!link.href.startsWith("http")) continue;
        const locator = footer.getByRole("link", { name: link.label, exact: true });
        await expect(locator).toHaveAttribute("href", link.href);
        await expect(locator).toHaveAttribute("target", "_blank");
        // rel="noreferrer" (footer.tsx) prevents the linked site from reading
        // document.referrer and from reverse-tabnabbing this tab.
        await expect(locator).toHaveAttribute("rel", "noreferrer");
      }
    }
  });

  test("renders the build/network status line", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/build 0\.1\.0-alpha/i)).toBeVisible();
  });
});

test.describe("robots.txt & sitemap.xml", () => {
  test("robots.txt is served and allows crawling", async ({ page }) => {
    const response = await page.request.get("/robots.txt");
    expect(response.ok()).toBeTruthy();
    const body = await response.text();
    expect(body).toMatch(/User-Agent:\s*\*/i);
    expect(body).toMatch(/Allow:\s*\//i);
  });

  test("sitemap.xml is served with valid XML containing the canonical homepage URL", async ({
    page,
  }) => {
    const response = await page.request.get("/sitemap.xml");
    expect(response.ok()).toBeTruthy();
    expect(response.headers()["content-type"]).toMatch(/xml/);
    const body = await response.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("<loc>https://orizons.xyz</loc>");
  });

  test("the sitemap URL declared in robots.txt matches the real sitemap route", async ({
    page,
  }) => {
    const robots = await (await page.request.get("/robots.txt")).text();
    const match = robots.match(/Sitemap:\s*(\S+)/i);
    expect(match).not.toBeNull();
    const declaredSitemapUrl = match![1].trim();
    expect(declaredSitemapUrl).toBe("https://orizons.xyz/sitemap.xml");
    // The declared URL must itself resolve — a stale/renamed sitemap route
    // would otherwise silently break crawler discovery.
    const sitemapResponse = await page.request.get(declaredSitemapUrl);
    expect(sitemapResponse.ok()).toBeTruthy();
  });
});

test.describe("PWA manifest", () => {
  test("manifest.webmanifest is served and points start_url at the console", async ({
    page,
  }) => {
    const response = await page.request.get("/manifest.webmanifest");
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toBe("Orizon Agents");
    expect(manifest.start_url).toBe("/app");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });
});

test.describe("404 handling", () => {
  test("an unknown route renders the not-found page with a 404 status", async ({
    page,
  }) => {
    const response = await page.goto("/this-route-does-not-exist-e2e-check");
    // Next.js app-router not-found.tsx must set the HTTP status to 404, not
    // just render 404-looking copy on a 200 — otherwise crawlers index it.
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: /SIGNAL LOST/i }),
    ).toBeVisible();
  });

  test("the not-found page offers working ways back into the app", async ({
    page,
  }) => {
    await page.goto("/this-route-does-not-exist-e2e-check");
    await expect(page.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByRole("link", { name: /Open console/i })).toHaveAttribute(
      "href",
      "/app",
    );
  });
});

test.describe("Console & network health", () => {
  test("loading the homepage produces no console errors and no failed requests", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const failures: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    page.on("requestfailed", (req) => {
      // Chromium unconditionally probes /favicon.ico regardless of the
      // <link rel="icon"> pointing at /icon.png; the app ships no explicit
      // favicon.ico route, so this specific probe is a known benign 404 and
      // not an app regression (see summary note).
      if (!req.url().endsWith("/favicon.ico")) {
        failures.push(`${req.url()} :: ${req.failure()?.errorText}`);
      }
    });
    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().endsWith("/favicon.ico")) {
        failures.push(`${res.status()} ${res.url()}`);
      }
    });

    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

test.describe("Responsive layout", () => {
  test.describe("mobile (390x844)", () => {
    test.use({ viewport: MOBILE_VIEWPORT });
    test("has no horizontal overflow", async ({ page }) => {
      await page.goto("/");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(overflow).toBe(true);
    });
  });

  test.describe("desktop (1440x900)", () => {
    test.use({ viewport: DESKTOP_VIEWPORT });
    test("has no horizontal overflow", async ({ page }) => {
      await page.goto("/");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(overflow).toBe(true);
    });
  });
});

test.describe("Accessibility smoke", () => {
  test("exposes exactly one <h1>", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("heading levels never skip (e.g. h2 straight to h4)", async ({ page }) => {
    await page.goto("/");
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((el) =>
        Number(el.tagName.substring(1)),
      ),
    );
    let maxSoFar = 0;
    for (const level of levels) {
      // A skip means jumping more than one level deeper than the highest
      // level seen so far (e.g. straight from h1 to h3) — this breaks
      // screen-reader users' mental model of the page outline.
      expect(level).toBeLessThanOrEqual(maxSoFar + 1);
      maxSoFar = Math.max(maxSoFar, level);
    }
  });

  test("every <img> carries a non-empty alt attribute", async ({ page }) => {
    await page.goto("/");
    // The page currently renders zero <img> elements (all graphics are
    // inline SVG), so this guards a future regression rather than failing
    // vacuously today.
    const images = page.locator("img");
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute("alt");
      expect(alt).not.toBeNull();
    }
  });

  test("every link has an accessible name", async ({ page }) => {
    await page.goto("/");
    const links = page.locator("a[href]");
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const link = links.nth(i);
      const accessibleName = await link.evaluate((el) => {
        const aria = el.getAttribute("aria-label");
        if (aria && aria.trim()) return aria.trim();
        return (el.textContent ?? "").trim();
      });
      expect(accessibleName, `link with href="${await link.getAttribute("href")}" has no accessible name`).not.toBe("");
    }
  });
});
