import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkRobots,
  fetchRobotsRules,
  isPathAllowed,
  robotsPath,
  USER_AGENT,
} from "./robots";
import { parseFeed, type FeedItem } from "./feed";
import {
  parseSitemap,
  isWithinSection,
  MAX_CHILDREN_FOLLOWED,
  type SitemapEntry,
} from "./sitemap";
import { extractArticle, extractTitle } from "./extract";
import { sourceIsDraftable } from "./validate";

/**
 * The feed collector.
 *
 * Runs on a schedule, reads the enabled sources that are due, and writes new
 * items into content_items. It makes no model calls and costs nothing but
 * bandwidth — triage and drafting are phase 2.
 *
 * Three rules it will not break:
 *
 *   1. robots.txt is checked before every source and the result is obeyed.
 *      There is no override parameter.
 *   2. The response body is stored exactly as received. Parsing happens
 *      after the write, never before it.
 *   3. It identifies itself honestly and rate-limits between hosts.
 */

/** Between requests to the same host. */
const REQUEST_SPACING_MS = 10_000;
/** How many consecutive failures before a source is marked degraded. */
const FAILURE_THRESHOLD = 3;
/** Ceiling on items taken from one feed in one run. */
const MAX_ITEMS_PER_SOURCE = 50;
/** Refresh a source's cached robots.txt result after this long. */
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How old an article in a sitemap can be and still be collected.
 *
 * A feed hands us the last thirty items. A sitemap hands us the archive —
 * the DP World Tour's runs to a file per month going back years. Without a
 * window, the first run against a new sitemap source would fetch several
 * thousand pages and fill the triage queue with 2023.
 */
const MAX_ARTICLE_AGE_DAYS = 21;

/** Article pages fetched from one sitemap source in one run, unless the row says otherwise. */
const DEFAULT_MAX_ARTICLES_PER_RUN = 8;

/**
 * Below this, the extractor thinks most of the page's prose sat outside the
 * run it chose — so what it returned is probably not the article.
 */
const MIN_EXTRACTION_CONFIDENCE = 0.5;

export interface SourceRow {
  id: number;
  name: string;
  organisation: string;
  fetch_kind: "rss" | "atom" | "sitemap" | "html" | "pdf_index";
  feed_url: string;
  enabled: boolean;
  robots_checked_at: string | null;
  robots_allows: boolean | null;
  poll_interval_minutes: number;
  last_fetched_at: string | null;
  consecutive_failures: number;
  status: string;
  /** Sitemap sources only: article URLs must start with this. */
  section_prefix: string | null;
  /** Sitemap sources only: cap on article pages fetched per run. */
  max_articles_per_run: number | null;
}

const SOURCE_COLUMNS =
  "id, name, organisation, fetch_kind, feed_url, enabled, robots_checked_at, robots_allows, poll_interval_minutes, last_fetched_at, consecutive_failures, status, section_prefix, max_articles_per_run";

export interface SourceResult {
  source: string;
  fetched: boolean;
  inserted: number;
  skipped: number;
  reason: string;
}

export interface CollectResult {
  ranAt: string;
  sources: SourceResult[];
  totalInserted: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * A stable id for a feed item.
 *
 * Prefers the feed's own guid. Where a feed has none, the canonical URL
 * hashed gives a value that is stable across polls and bounded in length,
 * which a raw URL is not.
 */
export function externalIdFor(item: FeedItem): string {
  const raw = item.externalId || item.link;
  return raw.length <= 200 ? raw : sha256(raw);
}

/** Whether a source is due, given its poll interval. */
export function isDue(source: Pick<SourceRow, "last_fetched_at" | "poll_interval_minutes">, now = new Date()): boolean {
  if (!source.last_fetched_at) return true;
  const due = new Date(source.last_fetched_at).getTime() + source.poll_interval_minutes * 60_000;
  return now.getTime() >= due;
}

/**
 * Run one collection pass.
 *
 * Never throws for a single bad source: one unreachable press office must
 * not stop the others being read. Failures are recorded on the row and
 * surfaced in /admin/news/sources.
 */
export async function collectAll(): Promise<CollectResult> {
  const supabase = createAdminClient();
  const ranAt = new Date().toISOString();
  const results: SourceResult[] = [];

  const { data: sources, error } = await supabase
    .from("content_sources")
    .select(SOURCE_COLUMNS)
    .eq("enabled", true)
    .in("status", ["healthy", "degraded"])
    .returns<SourceRow[]>();

  if (error) throw new Error(`Could not load content sources: ${error.message}`);

  for (const source of sources ?? []) {
    if (!isDue(source)) {
      results.push({
        source: source.name,
        fetched: false,
        inserted: 0,
        skipped: 0,
        reason: "not due yet",
      });
      continue;
    }

    // HTML index and PDF newsrooms are real sources but need their own
    // extractors, so they are skipped explicitly rather than being fetched
    // and mis-parsed as XML.
    if (
      source.fetch_kind !== "rss" &&
      source.fetch_kind !== "atom" &&
      source.fetch_kind !== "sitemap"
    ) {
      results.push({
        source: source.name,
        fetched: false,
        inserted: 0,
        skipped: 0,
        reason: `fetch_kind '${source.fetch_kind}' not implemented yet`,
      });
      continue;
    }

    results.push(
      source.fetch_kind === "sitemap"
        ? await collectSitemapSource(supabase, source)
        : await collectSource(supabase, source),
    );
    await sleep(REQUEST_SPACING_MS);
  }

  return {
    ranAt,
    sources: results,
    totalInserted: results.reduce((sum, r) => sum + r.inserted, 0),
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function recordFailure(
  supabase: AdminClient,
  source: SourceRow,
  reason: string,
): Promise<SourceResult> {
  const failures = source.consecutive_failures + 1;
  await supabase
    .from("content_sources")
    .update({
      last_fetched_at: new Date().toISOString(),
      last_error: reason,
      consecutive_failures: failures,
      status: failures >= FAILURE_THRESHOLD ? "degraded" : source.status,
    })
    .eq("id", source.id);
  return { source: source.name, fetched: false, inserted: 0, skipped: 0, reason };
}

async function recordSuccess(supabase: AdminClient, source: SourceRow): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("content_sources")
    .update({
      last_fetched_at: now,
      last_success_at: now,
      consecutive_failures: 0,
      last_error: null,
      status: "healthy",
    })
    .eq("id", source.id);
}

async function collectSource(
  supabase: AdminClient,
  source: SourceRow,
): Promise<SourceResult> {
  const fail = (reason: string) => recordFailure(supabase, source, reason);

  // --- robots.txt, cached per source ---
  const robotsStale =
    !source.robots_checked_at ||
    Date.now() - new Date(source.robots_checked_at).getTime() > ROBOTS_TTL_MS;

  let robotsAllows = source.robots_allows;
  if (robotsStale) {
    const verdict = await checkRobots(source.feed_url);
    robotsAllows = verdict.allowed;
    await supabase
      .from("content_sources")
      .update({
        robots_checked_at: new Date().toISOString(),
        robots_allows: verdict.allowed,
        // A robots disallow is sticky. Clearing it needs a human, because
        // the right response is to ask the source for access, not to retry.
        ...(verdict.allowed ? {} : { status: "blocked", last_error: verdict.reason }),
      })
      .eq("id", source.id);
  }

  if (robotsAllows !== true) {
    return {
      source: source.name,
      fetched: false,
      inserted: 0,
      skipped: 0,
      reason: "refused: robots.txt disallows this URL",
    };
  }

  // --- fetch ---
  let response: Response;
  try {
    response = await fetch(source.feed_url, {
      headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "fetch failed");
  }

  if (response.status === 304) {
    await supabase
      .from("content_sources")
      .update({
        last_fetched_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        consecutive_failures: 0,
        last_error: null,
      })
      .eq("id", source.id);
    return { source: source.name, fetched: true, inserted: 0, skipped: 0, reason: "not modified" };
  }

  if (!response.ok) return fail(`HTTP ${response.status}`);

  // The untouched body. Everything below parses a copy of this string; this
  // is what gets stored.
  const rawBody = await response.text();
  if (rawBody.trim().length === 0) return fail("empty response body");

  let items: FeedItem[];
  try {
    items = parseFeed(rawBody, source.fetch_kind === "atom" ? "atom" : "rss");
  } catch (error) {
    return fail(`parse failed: ${error instanceof Error ? error.message : "unknown"}`);
  }

  if (items.length === 0) return fail("feed parsed but contained no items");

  // --- dedupe against what we already hold ---
  const candidates = items.slice(0, MAX_ITEMS_PER_SOURCE);
  const ids = candidates.map(externalIdFor);

  const { data: existing } = await supabase
    .from("content_items")
    .select("external_id, content_hash")
    .eq("source_id", source.id)
    .in("external_id", ids)
    .returns<{ external_id: string; content_hash: string }[]>();

  const seen = new Map((existing ?? []).map((r) => [r.external_id, r.content_hash]));

  const rows = candidates.flatMap((item) => {
    const externalId = externalIdFor(item);
    // The per-item body, not the whole feed: an article is drafted from its
    // own release, and quote verification runs against this text.
    const itemRaw = [item.title, item.body].filter(Boolean).join("\n\n");
    const hash = sha256(itemRaw);

    // Unchanged since last time. A changed hash means the source edited the
    // release; that is left alone here rather than overwritten, so the
    // original text we may already have drafted from survives.
    if (seen.get(externalId) === hash) return [];
    if (seen.has(externalId)) return [];

    return [
      {
        source_id: source.id,
        external_id: externalId,
        canonical_url: item.link,
        title: item.title,
        published_at: item.publishedAt?.toISOString() ?? null,
        raw_body: itemRaw,
        content_hash: hash,
        status: "new" as const,
      },
    ];
  });

  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from("content_items")
      .upsert(rows, { onConflict: "source_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) return fail(`insert failed: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  await recordSuccess(supabase, source);

  return {
    source: source.name,
    fetched: true,
    inserted,
    skipped: candidates.length - rows.length,
    reason: `${candidates.length} items in feed`,
  };
}

// ============ sitemap sources ============

/**
 * Collect from a newsroom that publishes a sitemap rather than a feed.
 *
 * Ryder Cup Europe and the DP World Tour both do, and between them they are
 * the two most Ireland-relevant press offices there are. Neither offers RSS.
 *
 * The difference from the feed path is that a sitemap carries URLs, not text,
 * so this fetches every article page it decides to collect. That makes it the
 * only part of the system that issues a burst of requests to someone else's
 * server, and the constraints below all exist because of that:
 *
 *   - robots.txt is read once and applied to EVERY article URL, not just the
 *     sitemap. The DP World Tour's own robots.txt disallows /european-tour/
 *     and /legends-tour/ while allowing /dpworld-tour/, and its sitemap lists
 *     all three.
 *   - Deduplication happens BEFORE fetching. An article we already hold is
 *     never re-requested, so steady-state cost is a handful of pages a day.
 *   - Articles older than MAX_ARTICLE_AGE_DAYS are skipped, so pointing this
 *     at an archive does not walk the archive.
 *   - Ten seconds between requests, as everywhere else in this file.
 */
async function collectSitemapSource(
  supabase: AdminClient,
  source: SourceRow,
  now: Date = new Date(),
): Promise<SourceResult> {
  const fail = (reason: string) => recordFailure(supabase, source, reason);

  // --- robots.txt, read fresh each run ---
  // Not cached like the feed path: a sitemap run tests many paths against
  // this file, so it has to be in hand rather than reduced to the single
  // boolean the source row stores.
  const { rules, reason: robotsReason } = await fetchRobotsRules(source.feed_url);
  if (!rules) return fail(`refused: ${robotsReason}`);

  const sitemapAllowed = isPathAllowed(rules, robotsPath(source.feed_url));
  await supabase
    .from("content_sources")
    .update({
      robots_checked_at: new Date().toISOString(),
      robots_allows: sitemapAllowed,
      ...(sitemapAllowed ? {} : { status: "blocked", last_error: robotsReason }),
    })
    .eq("id", source.id);

  if (!sitemapAllowed) {
    return {
      source: source.name,
      fetched: false,
      inserted: 0,
      skipped: 0,
      reason: "refused: robots.txt disallows the sitemap",
    };
  }

  // --- read the sitemap, following an index one level down ---
  let entries: SitemapEntry[];
  try {
    entries = await readSitemapEntries(source.feed_url);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "sitemap fetch failed");
  }
  if (entries.length === 0) return fail("sitemap parsed but listed no articles");

  const cutoff = now.getTime() - MAX_ARTICLE_AGE_DAYS * 86_400_000;

  const eligible = entries.filter((entry) => {
    if (!entry.loc.startsWith("https://")) return false;
    if (!isWithinSection(entry.loc, source.section_prefix)) return false;
    if (!isPathAllowed(rules, robotsPath(entry.loc))) return false;
    // An undated entry is kept — parseSitemap sorts it last, so it only gets
    // fetched once everything dated has been.
    if (entry.publishedAt && entry.publishedAt.getTime() < cutoff) return false;
    return true;
  });

  if (eligible.length === 0) {
    await recordSuccess(supabase, source);
    return {
      source: source.name,
      fetched: true,
      inserted: 0,
      skipped: entries.length,
      reason: `${entries.length} URLs in sitemap, none recent and in section`,
    };
  }

  // --- dedupe before fetching anything ---
  const ids = eligible.map((entry) => externalIdForUrl(entry.loc));
  const { data: existing } = await supabase
    .from("content_items")
    .select("external_id")
    .eq("source_id", source.id)
    .in("external_id", ids)
    .returns<{ external_id: string }[]>();

  const held = new Set((existing ?? []).map((r) => r.external_id));
  const limit = source.max_articles_per_run ?? DEFAULT_MAX_ARTICLES_PER_RUN;
  const toFetch = eligible
    .filter((entry) => !held.has(externalIdForUrl(entry.loc)))
    .slice(0, limit);

  if (toFetch.length === 0) {
    await recordSuccess(supabase, source);
    return {
      source: source.name,
      fetched: true,
      inserted: 0,
      skipped: eligible.length,
      reason: `${eligible.length} eligible URLs, all already held`,
    };
  }

  // --- fetch and extract, politely ---
  const rows: ItemRow[] = [];
  let unreadable = 0;

  for (const entry of toFetch) {
    await sleep(REQUEST_SPACING_MS);
    const row = await readArticle(source, entry);
    if (!row) {
      unreadable++;
      continue;
    }
    rows.push(row);
  }

  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from("content_items")
      .upsert(rows, { onConflict: "source_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) return fail(`insert failed: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  await recordSuccess(supabase, source);

  return {
    source: source.name,
    fetched: true,
    inserted,
    skipped: eligible.length - toFetch.length,
    reason: `${entries.length} URLs in sitemap, ${eligible.length} eligible, ${toFetch.length} fetched${
      unreadable > 0 ? `, ${unreadable} unreadable` : ""
    }`,
  };
}

interface ItemRow {
  source_id: number;
  external_id: string;
  canonical_url: string;
  title: string;
  published_at: string | null;
  raw_body: string;
  content_hash: string;
  status: "new" | "error";
  error_detail: string | null;
  extraction_method: string | null;
}

/** A URL is the stable id for a sitemap entry; long ones are hashed. */
export function externalIdForUrl(url: string): string {
  return url.length <= 200 ? url : sha256(url);
}

/**
 * Read a sitemap, following an index to its newest children.
 *
 * One level of nesting only, and only MAX_CHILDREN_FOLLOWED of them. An index
 * pointing at an index is either a mistake or a loop, and a collector that
 * walks it at ten seconds a request would still be walking it next week.
 */
async function readSitemapEntries(url: string): Promise<SitemapEntry[]> {
  const root = parseSitemap(await fetchText(url));
  if (root.kind === "urlset") return root.entries;

  const entries: SitemapEntry[] = [];
  for (const child of root.children.slice(0, MAX_CHILDREN_FOLLOWED)) {
    await sleep(REQUEST_SPACING_MS);
    const parsed = parseSitemap(await fetchText(child));
    // Deliberately not recursing. See the note above.
    if (parsed.kind === "urlset") entries.push(...parsed.entries);
  }

  return entries.sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const body = await response.text();
  if (body.trim().length === 0) throw new Error(`empty body for ${url}`);
  return body;
}

/**
 * Fetch one article page and turn it into a row.
 *
 * Returns null only when the page could not be read at all. A page that WAS
 * read but yielded text we should not draft from is still stored — with
 * status 'error' and the reason — because that is a fact worth keeping: it
 * stops the URL being re-fetched every six hours forever, and it shows up in
 * admin as a source that needs looking at rather than as silence.
 *
 * The consequence to know about: fixing the extractor later does not
 * retrospectively rescue those items. Resetting them is a deliberate SQL
 * update, not something the collector does on its own, because re-drafting
 * old items automatically is how a queue fills with last month's news.
 */
async function readArticle(
  source: SourceRow,
  entry: SitemapEntry,
): Promise<ItemRow | null> {
  let html: string;
  try {
    html = await fetchText(entry.loc);
  } catch {
    return null;
  }

  const title = (entry.title ?? extractTitle(html) ?? "").trim();
  // content_items.title is NOT NULL and non-empty by constraint. An article
  // whose headline we cannot determine is not one we can store.
  if (title === "") return null;

  const extraction = extractArticle(html);
  const text = extraction?.text ?? "";
  const raw = [title, text].filter(Boolean).join("\n\n");

  let error: string | null = null;
  if (!extraction) {
    error = "no article text could be extracted from the page";
  } else if (extraction.confidence < MIN_EXTRACTION_CONFIDENCE) {
    error = `extraction confidence ${extraction.confidence.toFixed(2)} (via ${extraction.method}); the page may be a listing rather than an article`;
  } else {
    const draftable = sourceIsDraftable(text, title);
    if (!draftable.ok) error = draftable.reason ?? "source not draftable";
  }

  return {
    source_id: source.id,
    external_id: externalIdForUrl(entry.loc),
    canonical_url: entry.loc,
    title,
    published_at: entry.publishedAt?.toISOString() ?? null,
    raw_body: raw,
    content_hash: sha256(raw),
    status: error ? "error" : "new",
    error_detail: error,
    extraction_method: extraction?.method ?? null,
  };
}
