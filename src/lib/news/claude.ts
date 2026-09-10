import "server-only";

/**
 * A small Claude client, built on `fetch`.
 *
 * No SDK, for the same reason src/lib/email.ts talks to Resend over plain
 * HTTP: this repo adds a dependency only when one earns its place, and two
 * JSON POSTs do not.
 *
 * Every call returns its token usage so the caller can log spend. The
 * pipeline halts on a monthly budget, and it cannot halt on a number nobody
 * recorded.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export const TRIAGE_MODEL = process.env.NEWS_TRIAGE_MODEL ?? "claude-haiku-4-5";
export const DRAFT_MODEL = process.env.NEWS_DRAFT_MODEL ?? "claude-sonnet-5";

/**
 * Published prices per million tokens, in micro-dollars, so spend sums as
 * integers rather than accumulating float error across thousands of small
 * calls.
 *
 * These are a local copy of a published price list and will drift. They are
 * used only to decide when to stop spending, so drifting slightly high is the
 * safe direction — an overestimate halts early, an underestimate overspends.
 * Unknown models fall back to the most expensive entry for the same reason.
 */
const PRICES_MICRODOLLARS_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1_000_000, output: 5_000_000 },
  "claude-sonnet-5": { input: 2_000_000, output: 10_000_000 },
  "claude-opus-5": { input: 5_000_000, output: 25_000_000 },
};

const FALLBACK_PRICE = { input: 5_000_000, output: 25_000_000 };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costMicrodollars: number;
}

export interface ClaudeResult<T> {
  data: T;
  usage: Usage;
  model: string;
}

export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_MICRODOLLARS_PER_MTOK[model] ?? FALLBACK_PRICE;
  return Math.ceil(
    (inputTokens * price.input) / 1_000_000 + (outputTokens * price.output) / 1_000_000,
  );
}

/**
 * Pull the first JSON value out of a model response.
 *
 * Asking for "JSON only" gets JSON only nearly always, and occasionally gets
 * JSON wrapped in a code fence or preceded by a sentence. Both are recoverable
 * and neither is worth failing a run over; anything else is a genuine failure
 * and throws.
 */
export function extractJson<T>(text: string): T {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back to the outermost {...} or [...] in the response.
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    throw new Error(
      `Model response was not JSON: ${candidate.slice(0, 200)}${candidate.length > 200 ? "…" : ""}`,
    );
  }
}

export interface CallOptions {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Zero by default: this is extraction and summarisation, not invention. */
  temperature?: number;
}

/**
 * One Messages API call, returning parsed JSON plus usage.
 *
 * Retries twice on 429 and 5xx with a short backoff. Does not retry a 4xx —
 * a malformed request will be malformed again, and a run that hammers the API
 * with the same bad payload is worse than a run that fails.
 */
export async function callClaude<T>(options: CallOptions): Promise<ClaudeResult<T>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set; the news pipeline cannot run.");
  }

  const body = JSON.stringify({
    model: options.model,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0,
    system: options.system,
    messages: [{ role: "user", content: options.user }],
  });

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt));
    }

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        body,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "network error";
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = `HTTP ${response.status}`;
      continue;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Claude API ${response.status}: ${detail.slice(0, 300)}`);
    }

    const payload = (await response.json()) as {
      model?: string;
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;
    const model = payload.model ?? options.model;

    return {
      data: extractJson<T>(text),
      model,
      usage: {
        inputTokens,
        outputTokens,
        costMicrodollars: costOf(model, inputTokens, outputTokens),
      },
    };
  }

  throw new Error(`Claude API unavailable after 3 attempts: ${lastError}`);
}
