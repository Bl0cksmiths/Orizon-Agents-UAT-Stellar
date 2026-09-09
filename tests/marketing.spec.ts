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
  test("ships the exact <title> configured in app/layout.tsx", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(
      "Orizon Agents — Orchestration for autonomous digital labor",
    );
  });

  test("ships a meta description for search snippets", async ({ page }) => {
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

  test("exposes Open Graph tags for social link previews", async ({ page }) => {
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
  test("ships exactly one JSON-LD script tag containing valid JSON", async ({
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

  test("declares Organization and SoftwareApplication entries in @graph", async ({
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
    test(`"${link.label}" nav link scrolls to the #${link.sectionId} section`, async ({
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

