import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRobots, USER_AGENT } from "./robots";
import { parseFeed, type FeedItem } from "./feed";

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

export interface SourceRow {
  id: number;
  name: string;
  organisation: string;
  fetch_kind: "rss" | "atom" | "html" | "pdf_index";
  feed_url: string;
  enabled: boolean;
  robots_checked_at: string | null;
  robots_allows: boolean | null;
  poll_interval_minutes: number;
  last_fetched_at: string | null;
  consecutive_failures: number;
  status: string;
}

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
    .select(
      "id, name, organisation, fetch_kind, feed_url, enabled, robots_checked_at, robots_allows, poll_interval_minutes, last_fetched_at, consecutive_failures, status",
    )
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

    // Only feed kinds are implemented. HTML and PDF newsrooms are real
    // sources but need their own extractors, so they are skipped explicitly
    // rather than being fetched and mis-parsed as XML.
    if (source.fetch_kind !== "rss" && source.fetch_kind !== "atom") {
      results.push({
        source: source.name,
        fetched: false,
        inserted: 0,
        skipped: 0,
        reason: `fetch_kind '${source.fetch_kind}' not implemented yet`,
      });
      continue;
    }

    results.push(await collectSource(supabase, source));
    await sleep(REQUEST_SPACING_MS);
  }

  return {
    ranAt,
    sources: results,
    totalInserted: results.reduce((sum, r) => sum + r.inserted, 0),
  };
}

type AdminClient = ReturnType<typeof createAdminClient>;

async function collectSource(
  supabase: AdminClient,
  source: SourceRow,
): Promise<SourceResult> {
  const fail = async (reason: string): Promise<SourceResult> => {
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
  };

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

  await supabase
    .from("content_sources")
    .update({
      last_fetched_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      consecutive_failures: 0,
      last_error: null,
      status: "healthy",
    })
    .eq("id", source.id);

  return {
    source: source.name,
    fetched: true,
    inserted,
    skipped: candidates.length - rows.length,
    reason: `${candidates.length} items in feed`,
  };
}
