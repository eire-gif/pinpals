/**
 * Draft validation.
 *
 * Every check here is a hard reject. A draft that fails goes to status
 * 'error' with its reasons recorded, and never becomes a publishable article.
 *
 * The important one is quote verification. A fabricated quote attributed to a
 * named person is not a copyright problem, it is a defamation problem, and
 * Irish defamation law is claimant-friendly. So a quote that cannot be matched
 * word-for-word against the stored press release discards the WHOLE draft
 * rather than being quietly stripped — a model that invented one quote may
 * have invented the surrounding facts too, and stripping the visible symptom
 * would leave those in place.
 *
 * What this cannot catch: a fact the model added from its own knowledge.
 * There is no verbatim trace to test for. That is rule 1 of the drafting
 * prompt and it is why the human review gate exists. During the prototype the
 * first draft written described Ballyneety as "five miles south of Limerick"
 * — true, not in the release, and invisible to every check below.
 */

/** Longest verbatim run allowed from the source outside a marked quote. */
export const MAX_EXTRACT_WORDS = 25;
export const MIN_BODY_WORDS = 150;
export const MAX_BODY_WORDS = 400;
export const MAX_HEADLINE_CHARS = 70;
export const MAX_STANDFIRST_WORDS = 30;

export interface DraftQuote {
  text: string;
  speaker: string;
}

export interface DraftShape {
  headline: string;
  standfirst: string;
  body_md: string;
  irish_angle: string | null;
  quotes: DraftQuote[];
  source_attribution: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  verifiedQuotes: number;
  longestExtractWords: number;
}

/**
 * Rule 3 of the drafting prompt, enforced. Deliberately blunt: a false
 * positive costs a human thirty seconds, a false negative costs a claim.
 */
const BANNED_PATTERNS: [RegExp, string][] = [
  [
    /\b(is|are|was|were)\s+(believed|understood|rumou?red|thought|expected)\s+to\b/,
    "speculative attribution about a person",
  ],
  [/\bsources?\s+(say|said|close to|suggest)\b/, "unsourced hearsay"],
  [
    /\b(injur\w+|surgery|illness|fitness concerns?|struggling with)\b/,
    "health or injury claim",
  ],
  [
    /\b(contract|salary|fee|earnings|net worth|payout)\s+(talks?|dispute|negotiat\w+|row)\b/,
    "financial or contractual claim",
  ],
  [/\b(allegedly|reportedly|is said to)\b/, "unverified allegation"],
  [/\b(denied|accused|investigat\w+|misconduct|banned for)\b/, "conduct allegation"],
];

/** Fold the differences that do not change meaning. */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Drop leading and trailing punctuation before comparing.
 *
 * House style turns a quote's full stop into a comma when an attribution
 * follows it — "...support to me," he said — so a strict comparison against
 * the source's "...support to me." reports a fabrication that is not one.
 * The prototype's first validation run threw this false positive on two of
 * three genuine drafts, which is worth remembering: a validator tuned only on
 * synthetic examples would reject most real output and look broken.
 */
export function trimPunctuation(text: string): string {
  return text
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, "")
    .trim();
}

function words(text: string): string[] {
  return normalise(text).match(/[a-z0-9']+/g) ?? [];
}

/** Marked quotes are exempt from the extract-length rule: they passed above. */
function stripMarkedQuotes(body: string): string {
  return body.replace(/"[^"]*"/g, " ");
}

function longestCommonRun(bodyWords: string[], sourceWords: string[], cap: number): number {
  const shingles = new Set<string>();
  for (let n = 2; n <= cap + 1; n++) {
    for (let i = 0; i + n <= sourceWords.length; i++) {
      shingles.add(sourceWords.slice(i, i + n).join(" "));
    }
  }
  let best = 0;
  for (let n = 2; n <= cap + 1; n++) {
    for (let i = 0; i + n <= bodyWords.length; i++) {
      if (shingles.has(bodyWords.slice(i, i + n).join(" "))) best = Math.max(best, n);
    }
  }
  return best;
}

/**
 * Validate a draft against the press release it was written from.
 *
 * `rawBody` must be the stored source text, exactly as collected. Validating
 * against anything processed — a summary, a re-fetch, a cleaned copy — turns
 * quote verification into a comparison with a paraphrase and starts passing
 * fabrications.
 */
export function validateDraft(draft: DraftShape, rawBody: string): ValidationResult {
  const errors: string[] = [];
  const haystack = normalise(rawBody);

  // --- required fields and shape ---
  for (const field of [
    "headline",
    "standfirst",
    "body_md",
    "source_attribution",
  ] as const) {
    if (!draft[field] || String(draft[field]).trim() === "") {
      errors.push(`missing required field: ${field}`);
    }
  }

  if ((draft.headline ?? "").length > MAX_HEADLINE_CHARS) {
    errors.push(
      `headline too long: ${draft.headline.length} chars (max ${MAX_HEADLINE_CHARS})`,
    );
  }
  if ((draft.standfirst ?? "").split(/\s+/).filter(Boolean).length > MAX_STANDFIRST_WORDS) {
    errors.push(`standfirst too long (max ${MAX_STANDFIRST_WORDS} words)`);
  }

  const bodyWordCount = (draft.body_md ?? "").split(/\s+/).filter(Boolean).length;
  if (bodyWordCount < MIN_BODY_WORDS) {
    errors.push(`body too short: ${bodyWordCount} words (min ${MIN_BODY_WORDS})`);
  } else if (bodyWordCount > MAX_BODY_WORDS) {
    errors.push(`body too long: ${bodyWordCount} words (max ${MAX_BODY_WORDS})`);
  }

  // --- quote verification ---
  let verifiedQuotes = 0;
  const declared: string[] = [];

  for (const quote of draft.quotes ?? []) {
    const needle = trimPunctuation(normalise(quote.text ?? ""));
    declared.push(needle);

    if (!needle) {
      errors.push("a quote has empty text");
      continue;
    }
    if (!quote.speaker || quote.speaker.trim() === "") {
      errors.push(`quote has no speaker: "${quote.text.slice(0, 60)}…"`);
    }
    if (haystack.includes(needle)) {
      verifiedQuotes++;
    } else {
      errors.push(
        `FABRICATED QUOTE — not found in the source release: "${quote.text.slice(0, 90)}…"`,
      );
    }
  }

  // A quoted passage in the body that was never declared has bypassed the
  // check above, so verify it too.
  for (const match of (draft.body_md ?? "").matchAll(/"([^"]{25,})"/g)) {
    const found = trimPunctuation(normalise(match[1]));
    const isDeclared = declared.some((d) => d.includes(found) || found.includes(d));
    if (!isDeclared && !haystack.includes(found)) {
      errors.push(
        `UNDECLARED QUOTE in body, not found in the source: "${match[1].slice(0, 90)}…"`,
      );
    }
  }

  // --- extract length ---
  const bodyOutsideQuotes = words(stripMarkedQuotes(draft.body_md ?? ""));
  const sourceWords = words(rawBody);
  const longestExtractWords = longestCommonRun(
    bodyOutsideQuotes,
    sourceWords,
    MAX_EXTRACT_WORDS,
  );
  if (longestExtractWords > MAX_EXTRACT_WORDS) {
    errors.push(
      `extract too long: ${longestExtractWords} consecutive words copied from the source outside a quote (max ${MAX_EXTRACT_WORDS})`,
    );
  }

  // --- banned content ---
  const prose = normalise(`${draft.body_md ?? ""} ${draft.standfirst ?? ""}`);
  for (const [pattern, label] of BANNED_PATTERNS) {
    const match = prose.match(pattern);
    if (match) {
      errors.push(`banned content (${label}): "…${match[0]}…"`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    verifiedQuotes,
    longestExtractWords,
  };
}

/**
 * Letters NFKD does not decompose, because they are distinct letters rather
 * than a letter plus an accent. Without these, Højgaard slugs as "h-jgaard"
 * — and Scandinavian names are not exactly rare in professional golf.
 */
const LETTER_SUBSTITUTIONS: [RegExp, string][] = [
  [/ø/g, "o"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ð/g, "d"],
  [/þ/g, "th"],
  [/ł/g, "l"],
  [/ß/g, "ss"],
  [/đ/g, "d"],
  [/ı/g, "i"],
  [/&/g, " and "],
];

/** URL-safe slug from a headline, with an optional suffix for uniqueness. */
export function slugify(headline: string, suffix?: string): string {
  let text = (headline ?? "").toLowerCase();
  for (const [pattern, replacement] of LETTER_SUBSTITUTIONS) {
    text = text.replace(pattern, replacement);
  }

  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining marks: é -> e, å -> a
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");

  // Join only when there is something to join to, or an empty base leaves a
  // leading hyphen and the slug fails the database's format constraint.
  if (base && suffix) return `${base}-${suffix}`;
  if (base) return base;
  return suffix || `article-${Date.now()}`;
}
