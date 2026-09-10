/**
 * Article text extraction from a served HTML page.
 *
 * The feed sources hand us the release text. The sitemap sources hand us a
 * URL, so the text has to come out of the page — and a news page is mostly
 * not article: navigation, a cookie banner, related-story teasers, a footer of
 * tour sponsors. Everything in this file exists to separate the one from the
 * other.
 *
 * Getting that wrong is not a cosmetic problem. Whatever this function returns
 * becomes `content_items.raw_body`, and raw_body is what quote verification
 * checks against. Navigation furniture in raw_body means a draft is validated
 * against navigation furniture. So the bias here is precision over recall:
 * dropping a real paragraph costs a slightly thinner article, while keeping a
 * sponsor strip costs the integrity of the check that stops fabricated quotes
 * reaching the site.
 *
 * A note on how this was built. The sandbox this was written in cannot reach
 * either publisher directly — general egress is refused by policy — so unlike
 * feed.ts, this parser was NOT tuned against captured markup from the two
 * sites it is for. That is why it keys on semantics every news CMS shares
 * (JSON-LD, <article>, paragraph density, link density) rather than on class
 * names, and why extractArticle reports a confidence its caller is expected to
 * act on. Treat the first live run against each source as the real test: read
 * the first few items in /admin/news against their source pages before
 * enabling anything for drafting.
 */

import { decode } from "./feed";

/** Shorter than this and a <p> is a caption, a byline or a button. */
export const MIN_BLOCK_CHARS = 45;

/**
 * Above this share of a block's characters sitting inside links, it is a
 * menu or a list of related stories rather than prose. Real article
 * paragraphs do link out, but rarely for half their length.
 */
export const MAX_LINK_DENSITY = 0.4;

/**
 * How many consecutive rejected blocks end a run of article text.
 *
 * Article paragraphs sit together in the source. An inline image, a pull
 * quote or an embedded tweet interrupts them by a block or two; the jump from
 * the end of the article to the related-stories rail is much larger.
 */
export const RUN_GAP_TOLERANCE = 4;

/** Phrases that identify a block as site furniture whatever its length. */
const BOILERPLATE = [
  /\ball rights reserved\b/i,
  /\bcookies?\b.*\b(accept|consent|settings|policy)\b/i,
  /\b(accept|manage)\b.*\bcookies?\b/i,
  /\bprivacy policy\b/i,
  /\bterms (of use|and conditions)\b/i,
  /\bsign up (to|for) (our|the) newsletter\b/i,
  /\bsubscribe to (our|the)\b/i,
  /\bfollow us on\b/i,
  /\bshare (this|on)\b/i,
  /\bread more\b\s*$/i,
  /\bclick here\b/i,
  /^\s*©/,
  /\bjavascript\b.*\b(enabled?|required)\b/i,
];

/** Elements whose contents are never article text. */
const DROPPED_ELEMENTS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "figcaption",
  "select",
  "button",
];

function stripElements(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROPPED_ELEMENTS) {
    out = out.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"),
      " ",
    );
    // Self-closing or unclosed variants, so a stray <br>-style <svg /> does
    // not swallow the rest of the document in the regex above.
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/>`, "gi"), " ");
  }
  return out;
}

/** Tags to text, entities decoded, whitespace collapsed. */
function textOf(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

interface Block {
  text: string;
  linkDensity: number;
  kept: boolean;
}

function linkDensityOf(html: string): number {
  const total = textOf(html).length;
  if (total === 0) return 1;
  let linked = 0;
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    linked += textOf(m[1]).length;
  }
  return linked / total;
}

/**
 * Read the page's paragraph-level blocks in document order.
 *
 * `<p>` and `<blockquote>` only. Headings are deliberately excluded: a news
 * page's h2s are as often "More from the DP World Tour" as they are article
 * subheads, and the drafting prompt asks for no headings in the output
 * anyway. List items are excluded for the same reason at greater strength —
 * most `<li>` on a news page is a menu.
 */
function readBlocks(html: string): Block[] {
  const out: Block[] = [];
  const re = /<(p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const inner = m[2];
    const text = textOf(inner);
    const density = linkDensityOf(inner);

    const kept =
      text.length >= MIN_BLOCK_CHARS &&
      density <= MAX_LINK_DENSITY &&
      !BOILERPLATE.some((pattern) => pattern.test(text));

    out.push({ text, linkDensity: density, kept });
  }

  return out;
}

/**
 * The longest contiguous stretch of kept blocks, measured in characters.
 *
 * Taking every kept block anywhere on the page would sweep in the standfirst
 * of each related story, which passes the length and link-density tests
 * comfortably. The article itself is the one dense run.
 */
function bestRun(blocks: Block[]): Block[] {
  let best: Block[] = [];
  let current: Block[] = [];
  let gap = 0;

  const close = () => {
    const weight = (bs: Block[]) => bs.reduce((n, b) => n + b.text.length, 0);
    if (weight(current) > weight(best)) best = current;
    current = [];
  };

  for (const block of blocks) {
    if (block.kept) {
      current.push(block);
      gap = 0;
    } else if (current.length > 0) {
      gap++;
      if (gap > RUN_GAP_TOLERANCE) close();
    }
  }
  close();

  return best;
}

/**
 * JSON-LD `articleBody`, where the publisher provides it.
 *
 * This is the publisher's own machine-readable statement of what the article
 * says, which beats any heuristic. Parsed without a JSON schema walk: the
 * blocks are read one at a time and anything that is not valid JSON is
 * skipped, because a malformed analytics blob must not stop extraction.
 */
export function articleBodyFromJsonLd(html: string): string | null {
  const found: string[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;
    const body = record.articleBody;
    if (typeof body === "string" && body.trim().length > 0) found.push(body.trim());

    for (const value of Object.values(record)) walk(value);
  };

  for (const m of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // Not valid JSON. Publishers ship broken JSON-LD more often than you
      // would hope; it is not a reason to fail the page.
    }
  }

  if (found.length === 0) return null;

  // Longest wins: a page carrying several schema objects usually has the
  // article in the fullest one.
  const body = found.sort((a, b) => b.length - a.length)[0];
  return textOf(body).replace(/\s{2,}/g, " ").trim() || null;
}

/**
 * The article's own headline, for sitemaps that do not carry one.
 *
 * Order matters: `<h1>` is the headline as displayed, og:title is what the
 * publisher hands to Facebook, and `<title>` is last because it usually
 * carries a site-name suffix — "… | Ryder Cup Europe" — which would end up in
 * our own headline field.
 */
export function extractTitle(html: string): string | null {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const text = textOf(h1[1]);
    if (text.length > 0) return text;
  }

  const og = html.match(
    /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i,
  );
  if (og) {
    const text = decode(og[1]).trim();
    if (text.length > 0) return text;
  }

  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    const text = textOf(title[1]);
    if (text.length > 0) return text;
  }

  return null;
}

export interface Extraction {
  /** Paragraphs joined by blank lines, ready to store as raw_body. */
  text: string;
  /** Where the text came from, for the audit trail and for debugging. */
  method: "json-ld" | "article-element" | "main-element" | "density";
  /** Paragraph count of the extracted run. */
  paragraphs: number;
  /**
   * How much of the page's kept prose the chosen run accounts for. Low
   * confidence means the page had a lot of article-shaped text outside the
   * run — a listing page rather than an article, most likely.
   */
  confidence: number;
}

/**
 * Pull the article text out of a page.
 *
 * Returns null when the page yields nothing that looks like an article, which
 * the caller must treat as a failed item rather than as an empty one.
 */
export function extractArticle(html: string): Extraction | null {
  if (!html || html.trim().length === 0) return null;

  const jsonLd = articleBodyFromJsonLd(html);
  if (jsonLd && jsonLd.length >= MIN_BLOCK_CHARS * 4) {
    return {
      text: jsonLd,
      method: "json-ld",
      paragraphs: jsonLd.split(/\n{2,}/).length,
      confidence: 1,
    };
  }

  const cleaned = stripElements(html);

  // Prefer the semantic container where the page offers one. The largest
  // <article> rather than the first: a page listing related stories often
  // wraps each teaser in its own <article>.
  const articles = [...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .map((m) => m[1])
    .sort((a, b) => b.length - a.length);
  const main = cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? null;

  const scoped = articles[0] ?? main;
  const method: Extraction["method"] = articles[0]
    ? "article-element"
    : main
      ? "main-element"
      : "density";

  const blocks = readBlocks(scoped ?? cleaned);
  const run = bestRun(blocks);
  if (run.length === 0) return null;

  // Duplicate blocks are common — a pull quote repeats a sentence from the
  // body, and some templates render the standfirst twice.
  const seen = new Set<string>();
  const paragraphs = run
    .map((b) => b.text)
    .filter((text) => {
      const key = text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const keptChars = blocks
    .filter((b) => b.kept)
    .reduce((n, b) => n + b.text.length, 0);
  const runChars = run.reduce((n, b) => n + b.text.length, 0);

  return {
    text: paragraphs.join("\n\n"),
    method,
    paragraphs: paragraphs.length,
    confidence: keptChars === 0 ? 0 : runChars / keptChars,
  };
}
