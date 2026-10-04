/**
 * @mentions in comments (0097) — finding, inserting and drawing them. No
 * React, no Supabase, so it runs in vitest (mentions.test.ts).
 *
 * A mention is stored as a member id in post_comments.mentions; the body
 * keeps the readable "@Niamh Gallagher". Drawing a comment means finding
 * each mentioned member's "@Name" in the body and making it a link. If the
 * author later edits the name out, that mention simply isn't drawn.
 */

export type MentionTarget = { id: string; name: string };

/**
 * The word being typed after an "@" at the cursor, if any — "Nia" in
 * "great shot @Nia|". The "@" must start the text or follow a space, so an
 * email address doesn't open the picker. Returns where the "@" is so the
 * pick can replace it.
 */
export function activeMention(text: string, cursor: number): { query: string; start: number } | null {
  const before = text.slice(0, cursor);
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!match) return null;
  const start = before.length - match[2].length - 1;
  return { query: match[2], start };
}

/** The text with the "@query" at `start` replaced by "@Full Name ", and
 *  where the cursor goes after it. */
export function insertMention(text: string, start: number, cursor: number, name: string): { text: string; cursor: number } {
  const inserted = `@${name} `;
  const next = text.slice(0, start) + inserted + text.slice(cursor).replace(/^\s+/, "");
  return { text: next, cursor: start + inserted.length };
}

/** Candidates whose first or last name (or full name) starts with the query. */
export function matchMentions<T extends MentionTarget>(candidates: T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    const name = c.name.toLowerCase();
    const words = name.split(/\s+/);
    if (!q || name.startsWith(q) || words.some((w) => w.startsWith(q))) {
      out.push(c);
      seen.add(c.id);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** The ids of chosen mentions whose "@Name" is still in the body — a name
 *  picked and then deleted isn't sent. */
export function mentionIdsInBody(body: string, chosen: MentionTarget[]): string[] {
  return [...new Set(chosen.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id))];
}

export type Segment = { text: string; mention?: MentionTarget };

/** The body split into plain text and mention links, longest names first
 *  so "@Niamh Gallagher" wins over a second member called "Niamh". */
export function mentionSegments(body: string, mentions: MentionTarget[]): Segment[] {
  const targets = [...mentions].filter((m) => m.name).sort((a, b) => b.name.length - a.name.length);
  if (targets.length === 0) return [{ text: body }];
  const out: Segment[] = [];
  let i = 0;
  let plain = "";
  while (i < body.length) {
    const hit = body[i] === "@" ? targets.find((m) => body.startsWith(`@${m.name}`, i)) : undefined;
    if (hit) {
      if (plain) out.push({ text: plain });
      plain = "";
      out.push({ text: `@${hit.name}`, mention: hit });
      i += hit.name.length + 1;
    } else {
      plain += body[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain });
  return out;
}
