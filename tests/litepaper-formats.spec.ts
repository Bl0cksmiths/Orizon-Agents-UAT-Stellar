import { inflateRawSync } from "node:zlib";
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

/** Decodes the character references an HTML or XML text node can carry. */
function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    const name = ref.toLowerCase();
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return named[name] ?? whole;
  });
}

/** §6 of the HTML book: from its `<h1>` to §7's, as text. */
function htmlSection(html: string): string {
  const start = html.indexOf('<h1 id="operations-and-governance"');
  const end = html.indexOf('<h1 id="economics"');
  expect(start, "the HTML book has no #operations-and-governance heading").toBeGreaterThanOrEqual(0);
  expect(end, "the HTML book's #economics heading does not follow §6").toBeGreaterThan(start);
  return decodeEntities(html.slice(start, end).replace(/<[^>]*>/g, " "));
}

/**
 * Reads one entry of a zip archive through its central directory. Only the
 * two methods a .docx uses are supported: 0 (stored) and 8 (deflated).
 */
function unzipEntry(zip: Buffer, name: string): Buffer {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  expect(eocd, "the .docx has no zip end-of-central-directory record").toBeGreaterThanOrEqual(0);
  let entry = zip.readUInt32LE(eocd + 16);
  for (let i = zip.readUInt16LE(eocd + 10); i > 0; i--) {
    expect(zip.readUInt32LE(entry), "corrupt zip central directory").toBe(0x02014b50);
    const method = zip.readUInt16LE(entry + 10);
    const size = zip.readUInt32LE(entry + 20);
    const nameLength = zip.readUInt16LE(entry + 28);
    const local = zip.readUInt32LE(entry + 42);
    if (zip.toString("utf8", entry + 46, entry + 46 + nameLength) === name) {
      const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(data, data + size);
      expect([0, 8], `${name} uses an unsupported zip method`).toContain(method);
      return method === 0 ? raw : inflateRawSync(raw);
    }
    entry += 46 + nameLength + zip.readUInt16LE(entry + 30) + zip.readUInt16LE(entry + 32);
  }
  throw new Error(`the .docx has no ${name}`);
}

/**
 * §6 of the Word document: the paragraphs from the `Heading1` titled §6 to
 * the one titled §7, as the text of their `<w:t>` runs. Field codes, deleted
 * text and numbering live outside `<w:t>`, so a list's numbers and bullets
 * are not text here, as in the HTML.
 */
function docxSection(docx: Buffer): string {
  const xml = unzipEntry(docx, "word/document.xml").toString("utf8");
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([p]) => ({
    heading1: /<w:pStyle w:val="Heading1"/.test(p),
    text: decodeEntities([...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")),
  }));
  const start = paragraphs.findIndex((p) => p.heading1 && p.text === SECTION_6);
  const end = paragraphs.findIndex((p) => p.heading1 && p.text === SECTION_7);
  expect(start, `the Word document has no "${SECTION_6}" Heading1`).toBeGreaterThanOrEqual(0);
  expect(end, "the Word document's §7 Heading1 does not follow §6").toBeGreaterThan(start);
  return paragraphs.slice(start, end).map((p) => p.text).join("\n");
}

/**
 * Asserts two renderings of §6 carry the same words. On a mismatch the
 * message quotes about twelve words around the first difference from each
 * side, so the defect can be logged from the report alone.
 */
function expectSameWords(format: string, reference: Word[], actual: Word[]): void {
  const want = reference.map((w) => w.key).join("");
  const got = actual.map((w) => w.key).join("");
  expect(actual.length, `the ${format} §6 is too short`).toBeGreaterThan(MIN_SECTION_WORDS);
  if (want === got) return;
  let at = 0;
  while (want[at] === got[at]) at++;
  const context = (list: Word[]): string => {
    let seen = 0;
    const index = list.findIndex((w) => (seen += w.key.length) > at);
    const k = index < 0 ? list.length : index;
    return list.slice(Math.max(0, k - 6), k + 6).map((w) => w.raw).join(" ");
  };
  expect(
    `${format}: … ${context(actual)} …`,
    `the ${format} §6 departs from the Markdown's`,
  ).toBe(`${format}: … ${context(reference)} …`);
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

  test("PP-04 the HTML download's §6 has the same words as the Markdown's", async ({ request }) => {
    const md = (await download(request, "md")).toString("utf8");
    const html = (await download(request, "html")).toString("utf8");
    expectSameWords("HTML", words(markdownSection(md)), words(htmlSection(html)));
  });

  test("PP-04 the Word download's §6 has the same words", async ({ request }) => {
    const md = (await download(request, "md")).toString("utf8");
    const docx = await download(request, "docx");
    expectSameWords("Word", words(markdownSection(md)), words(docxSection(docx)));
  });
});
