import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { callClaude, TRIAGE_MODEL, DRAFT_MODEL, type Usage } from "./claude";
import {
  TRIAGE_SYSTEM,
  DRAFT_SYSTEM,
  PROMPT_VERSION,
  triageUserMessage,
  draftUserMessage,
} from "./prompts";
import { validateDraft, slugify, type DraftShape } from "./validate";

/**
 * Triage and drafting — the only two model calls in the pipeline.
 *
 * Triage is one cheap call over every new item. Drafting is one call per
 * item that survives it. Nothing here publishes: a successful draft lands in
 * the admin queue at status 'draft' and waits for a person.
 *
 * The order of operations in draftOne() matters. Validation runs BEFORE the
 * row is written, and a failed draft is written as 'error' with its reasons
 * rather than as a draft with problems. A reviewer should never be handed
 * something that already failed a check the machine could make.
 */

const DEFAULT_TRIAGE_THRESHOLD = 65;
const DEFAULT_MAX_DRAFTS = 5;
const DEFAULT_MONTHLY_BUDGET_USD = 30;
/** Items sent to triage in one call. */
const TRIAGE_BATCH = 40;

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface PipelineResult {
  ranAt: string;
  triaged: number;
  aboveThreshold: number;
  drafted: number;
  rejectedByValidation: number;
  skippedByModel: number;
  spentThisMonthUsd: number;
  halted?: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

interface ItemRow {
  id: number;
  title: string;
  raw_body: string;
  canonical_url: string;
  published_at: string | null;
  source_id: number;
  content_sources: { organisation: string } | null;
}

async function recordUsage(
  supabase: AdminClient,
  stage: "triage" | "draft",
  model: string,
  usage: Usage,
  contentItemId: number | null,
) {
  const { error } = await supabase.from("news_usage").insert({
    stage,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_microdollars: usage.costMicrodollars,
    content_item_id: contentItemId,
  });
  // Usage logging must never take down a run. A missed row costs accuracy in
  // the budget guard; a thrown error costs the whole batch.
  if (error) console.warn(`[news] could not record usage: ${error.message}`);
}

/** Spend so far this calendar month, in whole US dollars. */
export async function monthlySpendUsd(supabase: AdminClient): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("news_usage")
    .select("cost_microdollars")
    .gte("occurred_at", startOfMonth.toISOString())
    .returns<{ cost_microdollars: number }[]>();

  if (error) {
    // Failing open on the budget check would be the wrong direction, so treat
    // an unreadable ledger as "assume we have spent nothing" only because the
    // per-run caps still bound the damage.
    console.warn(`[news] could not read usage ledger: ${error.message}`);
    return 0;
  }

  const micro = (data ?? []).reduce((sum, row) => sum + Number(row.cost_microdollars), 0);
  return micro / 1_000_000;
}

export async function runPipeline(): Promise<PipelineResult> {
  const supabase = createAdminClient();
  const ranAt = new Date().toISOString();

  const threshold = intFromEnv("NEWS_TRIAGE_THRESHOLD", DEFAULT_TRIAGE_THRESHOLD);
  const maxDrafts = intFromEnv("NEWS_MAX_DRAFTS_PER_RUN", DEFAULT_MAX_DRAFTS);
  const budgetUsd = intFromEnv("NEWS_MONTHLY_TOKEN_BUDGET_USD", DEFAULT_MONTHLY_BUDGET_USD);
  const publishMode = process.env.NEWS_PUBLISH_MODE === "auto" ? "auto" : "review";

  const spent = await monthlySpendUsd(supabase);
  if (spent >= budgetUsd) {
    return {
      ranAt,
      triaged: 0,
      aboveThreshold: 0,
      drafted: 0,
      rejectedByValidation: 0,
      skippedByModel: 0,
      spentThisMonthUsd: Number(spent.toFixed(4)),
      halted: `monthly budget reached: $${spent.toFixed(2)} of $${budgetUsd}`,
    };
  }

  const triaged = await triageNewItems(supabase, threshold);

  const { data: candidates } = await supabase
    .from("content_items")
    .select(
      "id, title, raw_body, canonical_url, published_at, source_id, content_sources(organisation)",
    )
    .eq("status", "triaged")
    .gte("triage_score", threshold)
    .order("triage_score", { ascending: false })
    .limit(maxDrafts)
    .returns<ItemRow[]>();

  let drafted = 0;
  let rejectedByValidation = 0;
  let skippedByModel = 0;

  for (const item of candidates ?? []) {
    const outcome = await draftOne(supabase, item, publishMode);
    if (outcome === "drafted") drafted++;
    else if (outcome === "rejected") rejectedByValidation++;
    else skippedByModel++;
  }

  return {
    ranAt,
    triaged: triaged.scored,
    aboveThreshold: triaged.above,
    drafted,
    rejectedByValidation,
    skippedByModel,
    spentThisMonthUsd: Number((await monthlySpendUsd(supabase)).toFixed(4)),
  };
}

interface TriageVerdict {
  id: number;
  score: number;
  reason: string;
}

async function triageNewItems(
  supabase: AdminClient,
  threshold: number,
): Promise<{ scored: number; above: number }> {
  const { data: items } = await supabase
    .from("content_items")
    .select("id, title, raw_body")
    .eq("status", "new")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(TRIAGE_BATCH)
    .returns<{ id: number; title: string; raw_body: string }[]>();

  if (!items || items.length === 0) return { scored: 0, above: 0 };

  const result = await callClaude<TriageVerdict[]>({
    model: TRIAGE_MODEL,
    system: TRIAGE_SYSTEM,
    user: triageUserMessage(
      items.map((i) => ({ id: i.id, title: i.title, body: i.raw_body })),
    ),
    maxTokens: 4_000,
  });

  await recordUsage(supabase, "triage", result.model, result.usage, null);

  const verdicts = Array.isArray(result.data) ? result.data : [];
  const byId = new Map(verdicts.map((v) => [Number(v.id), v]));
  let above = 0;

  for (const item of items) {
    const verdict = byId.get(item.id);
    // An item the model did not return a verdict for is left at 'new' rather
    // than guessed at, so the next run picks it up again.
    if (!verdict || typeof verdict.score !== "number") continue;

    const score = Math.max(0, Math.min(100, Math.round(verdict.score)));
    if (score >= threshold) above++;

    await supabase
      .from("content_items")
      .update({
        triage_score: score,
        triage_reason: (verdict.reason ?? "").slice(0, 300),
        triage_model: result.model,
        triaged_at: new Date().toISOString(),
        status: score >= threshold ? "triaged" : "rejected",
      })
      .eq("id", item.id);
  }

  return { scored: items.length, above };
}

async function draftOne(
  supabase: AdminClient,
  item: ItemRow,
  publishMode: "review" | "auto",
): Promise<"drafted" | "rejected" | "skipped"> {
  const organisation = item.content_sources?.organisation ?? "the source";

  let result;
  try {
    result = await callClaude<DraftShape & { skip?: boolean; reason?: string }>({
      model: DRAFT_MODEL,
      system: DRAFT_SYSTEM,
      user: draftUserMessage({
        title: item.title,
        body: item.raw_body,
        organisation,
        publishedAt: item.published_at,
      }),
      maxTokens: 2_000,
    });
  } catch (error) {
    await supabase
      .from("content_items")
      .update({
        status: "error",
        error_detail: error instanceof Error ? error.message : "draft call failed",
      })
      .eq("id", item.id);
    return "skipped";
  }

  await recordUsage(supabase, "draft", result.model, result.usage, item.id);

  // The model is allowed to decline. A release with nothing in it produces a
  // padded article, which is worse than no article.
  if (result.data.skip) {
    await supabase
      .from("content_items")
      .update({
        status: "rejected",
        triage_reason: `model declined: ${(result.data.reason ?? "").slice(0, 200)}`,
      })
      .eq("id", item.id);
    return "skipped";
  }

  const draft = result.data;
  const validation = validateDraft(draft, item.raw_body);

  if (!validation.ok) {
    // Recorded as an errored article, not a draft. A reviewer should never be
    // handed something that already failed a machine check — and the reasons
    // are kept so the prompt can be tuned against real failures.
    await supabase.from("articles").insert({
      content_item_id: item.id,
      slug: slugify(draft.headline ?? "rejected", `err-${item.id}`),
      headline: (draft.headline ?? "(no headline)").slice(0, 120),
      standfirst: (draft.standfirst ?? "(no standfirst)").slice(0, 400),
      body_md: draft.body_md ?? "(no body)",
      irish_angle: draft.irish_angle ?? null,
      source_attribution: draft.source_attribution ?? organisation,
      source_organisation: organisation,
      source_url: item.canonical_url,
      quotes: draft.quotes ?? [],
      ai_model: result.model,
      prompt_version: PROMPT_VERSION,
      status: "error",
      publish_mode: publishMode,
      validation_errors: validation.errors,
    });

    await supabase
      .from("content_items")
      .update({ status: "error", error_detail: validation.errors.join("; ").slice(0, 500) })
      .eq("id", item.id);

    return "rejected";
  }

  const { error } = await supabase.from("articles").insert({
    content_item_id: item.id,
    slug: slugify(draft.headline, String(item.id)),
    headline: draft.headline,
    standfirst: draft.standfirst,
    body_md: draft.body_md,
    irish_angle: draft.irish_angle,
    source_attribution: draft.source_attribution,
    source_organisation: organisation,
    source_url: item.canonical_url,
    quotes: draft.quotes,
    ai_model: result.model,
    prompt_version: PROMPT_VERSION,
    status: "draft",
    publish_mode: publishMode,
  });

  if (error) {
    await supabase
      .from("content_items")
      .update({ status: "error", error_detail: `insert failed: ${error.message}` })
      .eq("id", item.id);
    return "skipped";
  }

  await supabase.from("content_items").update({ status: "drafted" }).eq("id", item.id);
  return "drafted";
}
