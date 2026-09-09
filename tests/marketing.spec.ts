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

