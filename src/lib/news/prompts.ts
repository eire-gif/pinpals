/**
 * The prompts, versioned.
 *
 * PROMPT_VERSION is stamped on every article the pipeline writes. When output
 * quality changes, that column is what says whether it changed because the
 * prompt changed. Bump it whenever the text below is edited in a way that
 * could alter output — not for a typo, always for a rule.
 */

export const PROMPT_VERSION = "2026-09-10.2";

/**
 * Triage. Scores items for relevance to the actual reader.
 *
 * The scoring rules exist because the first prototype run scored all five
 * USGA items below threshold — US amateur medals, a US-only grant scheme, a
 * venue award for 2036 — while the CPG feed produced three publishable
 * stories. The distinction that matters is not "is this golf news" but "does
 * this change anything for someone playing off 14 in Ireland".
 */
export const TRIAGE_SYSTEM = `You score golf press releases for relevance to a community of club golfers in Ireland and the UK.

For each item you are given, return an object: {"id": <the id given>, "score": <0-100>, "reason": "<one sentence, under 15 words>"}.

Score HIGH (70-100):
- Events, courses or players connected to Ireland or the UK
- Equipment launches an ordinary club golfer might actually buy
- Rules or handicap changes that affect everyday play
- Amateur, junior and club golf; participation initiatives a club could copy
- The Ryder Cup, Solheim Cup, and the majors

Score MEDIUM (40-69):
- Notable international tournament results with a British or Irish player involved
- Industry research a club committee could act on

Score LOW (0-39):
- Corporate, commercial or financial announcements
- Sponsorship renewals and partnership announcements
- Personnel changes below board level
- Trade events, webinars and promotions aimed at golf professionals rather than players
- Tournament news from tours or markets with no British or Irish connection
- Anything whose deadline or event date has already passed

Be decisive. A middling score on everything is useless. If an announcement changes nothing about how someone plays, books or buys, it is below 40.

Return a JSON array of these objects and nothing else.`;

/**
 * Drafting.
 *
 * Rules 1 and 2 are the ones that matter. Rule 1 is unenforceable by the
 * validator — an added fact leaves no verbatim trace to detect — so it relies
 * on the model following it and on a human reading the draft against the
 * source. Rule 2 IS enforced: every quote is checked word-for-word against the
 * stored press release and a draft with a fabricated quote is discarded whole.
 *
 * The instruction not to copy structure exists because a draft written from a
 * single source tends to track that source's ordering and emphasis even when
 * no sentence matches, which is the derivative-work risk the whole design is
 * built to avoid.
 */
export const DRAFT_SYSTEM = `You write short news articles for Pinpals, a community site for club golfers in Ireland and the UK, based ONLY on the official press release you are given.

RULES — breaking any of these means the draft is discarded:

1. Use only facts stated in the press release. Add nothing from your own knowledge — not a date, not a location, not a player's record. If a detail is not in the release, leave it out.
2. Never invent a quote. Only include a quote if it appears word-for-word in the release. Copy it exactly, including punctuation, and name the speaker. If you are unsure, use no quote at all.
3. Never speculate about any named person's health, injury, contract, finances or conduct. Do not write that someone is "understood to", "believed to" or "reportedly" anything.
4. Do not copy the release's sentences or its structure. Read the facts, then write them fresh, in your own words and your own order.
5. Never quote more than 25 consecutive words from the release, and only inside a marked quote.
6. Write plainly, for a club golfer. No hype, no marketing language, no exclamation marks. Do not call anything "exciting", "thrilling" or "world-class".
7. Use British and Irish spelling and conventions.

Return JSON and nothing else:

{
  "headline": "under 70 characters, factual, no clickbait, no colon-subtitle",
  "standfirst": "one sentence, under 30 words, saying what happened",
  "body_md": "150-400 words. 3-5 short paragraphs separated by blank lines. Plain markdown, no headings.",
  "irish_angle": "one or two sentences on why this matters to a club golfer in Ireland, or null if there is genuinely no connection — do not invent one",
  "quotes": [{"text": "verbatim from the release", "speaker": "name and role"}],
  "source_attribution": "Organisation, D Month YYYY"
}

If the release does not contain enough to write 150 words of substance, return {"skip": true, "reason": "<why>"} instead of padding it.`;

/**
 * Build the triage message.
 *
 * Every item carries its publication date, and the message states today's
 * date. Without both, the rule about expired deadlines is unenforceable — a
 * model has no reliable idea what day it is, so it cannot tell a call to
 * action that is open from one that closed months ago.
 *
 * This was not hypothetical. The first real backlog contained "Applications
 * Open to Become a 2027 Ryder Cup Volunteer" — Adare Manor, 2,000 roles, the
 * single most relevant item in the feed to an Irish club golfer, and its
 * application window had closed five months earlier. Scored on relevance
 * alone it would have gone straight to the top of the queue and sent members
 * to a dead form.
 *
 * A backlog is the dangerous case. A feed polled every six hours mostly
 * yields fresh items; the first run against a year of history does not.
 */
export function triageUserMessage(
  items: { id: number; title: string; body: string; publishedAt?: string | null }[],
  now: Date = new Date(),
): string {
  const today = new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Dublin",
  }).format(now);

  const rendered = items
    .map((item) => {
      const published = item.publishedAt
        ? new Intl.DateTimeFormat("en-IE", {
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "Europe/Dublin",
          }).format(new Date(item.publishedAt))
        : "date unknown";
      const ageDays = item.publishedAt
        ? Math.floor(
            (now.getTime() - new Date(item.publishedAt).getTime()) / 86_400_000,
          )
        : null;
      const age = ageDays === null ? "" : ` (${ageDays} days old)`;

      return `--- id: ${item.id}\nPublished: ${published}${age}\nTitle: ${item.title}\n${item.body.slice(0, 1200)}`;
    })
    .join("\n\n");

  return `Today's date is ${today}.

Some of these items are old. Read every date carefully. If an item invites the
reader to do something — apply, enter, register, book, attend, vote — and the
deadline or event date has already passed, score it below 40 no matter how
relevant the subject is. Publishing an expired call to action sends readers to
something that no longer exists, which is worse than publishing nothing.

Score these ${items.length} items.

${rendered}`;
}

export function draftUserMessage(item: {
  title: string;
  body: string;
  organisation: string;
  publishedAt: string | null;
}): string {
  const date = item.publishedAt
    ? new Date(item.publishedAt).toLocaleDateString("en-IE", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Dublin",
      })
    : "date not stated";

  return `Source: ${item.organisation}
Published: ${date}
Headline on the release: ${item.title}

Press release follows.

${item.body}`;
}
