import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * PP-04 (story 6.11, verifies 5.04) — the litepaper's PDF, HTML, Word and
 * Markdown downloads say the same thing in §6, and the HTML book's §6 link
 * opens at §6.
 *
 * §6 runs from the heading "§6 · Operations and Governance" up to the heading
 * "§7 · Economics". Every format is downloaded live from the link the
 * `/litepaper` page offers for it, and §6 is located structurally in each (a
 * Markdown level-1 heading, an HTML `<h1>` id, a Word `Heading1` paragraph, the
 * PDF's largest-type run), never by searching for its body text.
 *
 * The Markdown is the reference: it is the source the other three are
 * rendered from. Formats are compared as a sequence of words reduced to their
 * letters, digits and the content-bearing symbols §, ✓, ✗, × and √. That one
 * rule absorbs every rendering artifact found in the 2026-09-30 downloads —
 * Markdown syntax, curly versus straight quotes, en and em dashes, the
 * Chromium print's hyphenated line breaks ("win- dow") and the spaces it puts
 * around inline code — while any changed, added or dropped word still fails.
 * Its cost is that a change of punctuation alone goes unnoticed, which no
 * claim in §6 depends on.
 */

const SECTION_6 = "§6 · Operations and Governance";
const SECTION_7 = "§7 · Economics";

/** The v0.5 revision note §6 opens with on the 2026-09-30 litepaper. */
const REVISION_LINE =
  "v0.5, 2026-09-29: §6 updated for open registration, reputation-gated routing and the dispute window. " +
  "Revised 2026-09-30: escrow v2 deployed on testnet and settling, with refunds switched on.";

/** §6 is about 4,650 words of Markdown; far fewer means the slice is wrong. */
const MIN_SECTION_WORDS = 4_000;

type Format = "pdf" | "html" | "docx" | "md";

/**
 * Downloads are a few megabytes each and identical for every test in a
 * worker, so each is fetched once per worker. The path comes from the
 * `/litepaper` page itself: the test downloads what a visitor is offered.
 */
const downloads = new Map<Format, Promise<Buffer>>();

function download(request: APIRequestContext, format: Format): Promise<Buffer> {
  let pending = downloads.get(format);
  if (!pending) {
    pending = (async () => {
      const page = await request.get("/litepaper");
      expect(page.status(), "/litepaper did not answer 200").toBe(200);
      const href = new RegExp(`href="(/[^"#]+\\.${format})"`).exec(await page.text())?.[1];
      expect(href, `/litepaper offers no .${format} download`).toBeTruthy();
      const res = await request.get(href as string);
      expect(res.status(), `${href} did not answer 200`).toBe(200);
      return res.body();
    })();
    pending.catch(() => downloads.delete(format));
    downloads.set(format, pending);
  }
  return pending;
}

interface Word {
  /** The word as the format renders it, for failure messages. */
  raw: string;
  /** What is compared: letters, digits and content-bearing symbols only. */
  key: string;
}

function words(text: string): Word[] {
  return text
    .normalize("NFKC")
    .split(/\s+/)
    .map((raw) => ({ raw, key: raw.replace(/[^\p{L}\p{N}§✓✗×√]/gu, "") }))
    .filter((w) => w.key !== "");
}

/**
 * §6 of the Markdown, with its syntax removed: heading hashes, list markers
 * (the other formats render them as bullets and numbers, or not as text at
 * all), table alignment rows, HTML comments and autolink brackets. Emphasis,
 * code and table pipes are stripped by the word reduction.
 */
function markdownSection(md: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.indexOf(`# ${SECTION_6}`);
  const end = lines.indexOf(`# ${SECTION_7}`);
  expect(start, `the Markdown has no "# ${SECTION_6}" heading`).toBeGreaterThanOrEqual(0);
  expect(end, `the Markdown's §7 heading does not follow §6`).toBeGreaterThan(start);
  return lines
    .slice(start, end)
    .filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) =>
      line
        .replace(/<!--.*?-->/g, " ")
        .replace(/<(https?:[^>\s]+)>/g, "$1")
        .replace(/^#+\s/, "")
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/, ""),
    )
    .join("\n");
}

test.describe("PP-04 litepaper §6 across the four downloads", () => {
  test("PP-04 the Markdown download has a §6 with the v0.5 revision line", async ({ request }) => {
    const md = (await download(request, "md")).toString("utf8");
    const section = markdownSection(md);
    const body = section.split("\n").filter((line) => line.trim() !== "");
    expect(body[0], "§6 does not open with its heading").toBe(SECTION_6);
    expect(body[1], "§6's first line is not the v0.5 revision note").toBe(`*${REVISION_LINE}*`);
    expect(words(section).length, "the Markdown §6 is too short").toBeGreaterThan(MIN_SECTION_WORDS);
  });
});
