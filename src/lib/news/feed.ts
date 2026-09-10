/**
 * RSS 2.0 and Atom parsing, with no dependency.
 *
 * The repo has no XML parser and deliberately calls external services with
 * plain `fetch` rather than adding packages (see src/lib/email.ts). Feed
 * parsing is a small enough job to keep that way: we read two known feeds,
 * both well-formed, and we only need five fields from each entry.
 *
 * The important property is that this NEVER rewrites the source text. It
 * extracts fields and decodes entities; it does not summarise, truncate or
 * normalise prose. The raw response body is stored separately and
 * untouched — see migration 0068's header for why that matters.
 */

export interface FeedItem {
  /** The feed's own guid where present, else the canonical URL. */
  externalId: string;
  title: string;
  link: string;
  publishedAt: Date | null;
  /** description + content:encoded, entity-decoded, tags stripped. */
  body: string;
}

/** Strip CDATA wrappers and decode the entities feeds actually use. */
export function decode(value: string): string {
  let out = value.trim();

  const cdata = out.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) out = cdata[1];

  return out
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    // Ampersand last, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, "&");
}

/** Text content of the first `<tag>` inside a chunk of XML. */
export function tagText(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"),
  );
  return match ? decode(match[1]) : null;
}

/** Value of an attribute on the first matching tag. */
function tagAttr(xml: string, tag: string, attr: string): string | null {
  const match = xml.match(new RegExp(`<${tag}\\b([^>]*)>`, "i"));
  if (!match) return null;
  const attrMatch = match[1].match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return attrMatch ? decode(attrMatch[1]) : null;
}

/** Remove markup and collapse whitespace, for the stored body text. */
export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function parseRss(xml: string): FeedItem[] {
  return blocks(xml, "item").flatMap((item) => {
    const link = tagText(item, "link");
    const guid = tagText(item, "guid");
    const title = tagText(item, "title");
    if (!title || (!link && !guid)) return [];

    const description = tagText(item, "description") ?? "";
    const encoded = tagText(item, "content:encoded") ?? "";
    // content:encoded is the fuller text where a feed provides both.
    const body = stripTags(encoded.length > description.length ? encoded : description);

    return [
      {
        externalId: guid ?? link ?? "",
        title,
        link: link ?? guid ?? "",
        publishedAt: parseDate(tagText(item, "pubDate") ?? tagText(item, "dc:date")),
        body,
      },
    ];
  });
}

function parseAtom(xml: string): FeedItem[] {
  return blocks(xml, "entry").flatMap((entry) => {
    const title = tagText(entry, "title");
    // Atom puts the URL in an attribute, not the element body.
    const link = tagAttr(entry, "link", "href") ?? tagText(entry, "link");
    const id = tagText(entry, "id");
    if (!title || (!link && !id)) return [];

    const content = tagText(entry, "content") ?? "";
    const summary = tagText(entry, "summary") ?? "";
    const body = stripTags(content.length > summary.length ? content : summary);

    return [
      {
        externalId: id ?? link ?? "",
        title,
        link: link ?? id ?? "",
        publishedAt: parseDate(tagText(entry, "published") ?? tagText(entry, "updated")),
        body,
      },
    ];
  });
}

/**
 * Parse a feed body into items.
 *
 * `kind` comes from the source row, but the document itself decides where
 * they disagree — a source configured as RSS that starts serving Atom should
 * keep working rather than silently returning nothing.
 */
export function parseFeed(xml: string, kind: "rss" | "atom" = "rss"): FeedItem[] {
  const looksAtom = /<feed[\s>]/i.test(xml);
  const looksRss = /<rss[\s>]|<channel[\s>]/i.test(xml);

  if (looksAtom && !looksRss) return parseAtom(xml);
  if (looksRss) return parseRss(xml);

  const items = kind === "atom" ? parseAtom(xml) : parseRss(xml);
  return items.length > 0 ? items : parseRss(xml).concat(parseAtom(xml));
}
