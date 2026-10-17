/**
 * Import a society's members from a spreadsheet (0170). Pure, so the
 * browser can preview exactly what the server will send, and both run the
 * same rules.
 *
 * Accepts whatever a secretary is likely to have: a CSV saved from Excel,
 * Google Sheets or Numbers (comma, semicolon or tab separated, with or
 * without a header row, with Excel's BOM), or addresses pasted one per line.
 * Columns are recognised by name ("Email", "E-mail address", "First name",
 * "Surname", "Name"…); without a header, the column full of @s is the email.
 */

export const MAX_IMPORT_ROWS = 500;

export type ImportRow = { email: string; firstName: string | null; lastName: string | null };

export type ImportProblem = { line: number; value: string; reason: "invalid" | "duplicate" };

export type ImportPreview = {
  rows: ImportRow[];
  problems: ImportProblem[];
  /** True when there were more rows than one import takes. */
  truncated: boolean;
  /** How the columns were read, for the preview's caption. */
  columns: { email: number; first: number | null; last: number | null; full: number | null; header: boolean };
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normaliseEmail(raw: string): string | null {
  let v = raw.trim().replace(/^mailto:/i, "");
  // "Jane Byrne <jane@x.ie>"
  const angle = v.match(/<([^<>]+)>/);
  if (angle) v = angle[1];
  v = v.trim().toLowerCase();
  return v.length <= 254 && EMAIL.test(v) ? v : null;
}

const cleanName = (v: string | undefined): string | null => {
  const s = (v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return s ? s : null;
};

function pickDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const d = pickDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field.trim() === "") {
      field = "";
      quoted = true;
    } else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ""));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");
const EMAIL_HEADS = ["email", "emailaddress", "mail", "emailaddr", "memberemail", "contactemail"];
const FIRST_HEADS = ["firstname", "first", "forename", "forenames", "givenname", "christianname"];
const LAST_HEADS = ["lastname", "last", "surname", "familyname", "secondname"];
const FULL_HEADS = ["name", "fullname", "membername", "member", "player", "playername", "golfer"];

const findCol = (head: string[], names: string[]) => {
  const i = head.findIndex((h) => names.includes(norm(h)));
  return i >= 0 ? i : null;
};

function splitFull(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  // "Byrne, Jane"
  if (full.includes(",")) {
    const [last, first] = full.split(",", 2).map((s) => cleanName(s));
    return { first, last };
  }
  const parts = full.split(" ");
  if (parts.length === 1) return { first: cleanName(parts[0]), last: null };
  return { first: cleanName(parts.slice(0, -1).join(" ")), last: cleanName(parts[parts.length - 1]) };
}

/** The whole preview: parse, find the columns, check every address. */
export function readMemberList(text: string): ImportPreview {
  const table = parseCsv(text);
  const empty: ImportPreview = { rows: [], problems: [], truncated: false, columns: { email: 0, first: null, last: null, full: null, header: false } };
  if (table.length === 0) return empty;

  const head = table[0];
  let emailCol = findCol(head, EMAIL_HEADS);
  const header = emailCol !== null || head.some((h) => [...FIRST_HEADS, ...LAST_HEADS, ...FULL_HEADS].includes(norm(h)));
  let first: number | null = null;
  let last: number | null = null;
  let full: number | null = null;
  if (header) {
    first = findCol(head, FIRST_HEADS);
    last = findCol(head, LAST_HEADS);
    full = first === null && last === null ? findCol(head, FULL_HEADS) : null;
  }
  const body = header ? table.slice(1) : table;
  if (emailCol === null) {
    // The column with the most addresses in it.
    const width = Math.max(...body.map((r) => r.length));
    let best = -1;
    for (let c = 0; c < width; c++) {
      const n = body.filter((r) => r[c] && normaliseEmail(r[c])).length;
      if (n > best) {
        best = n;
        emailCol = c;
      }
    }
    // No header and two text columns before it: assume first, last.
    if (!header && emailCol !== null && emailCol >= 2) {
      first = 0;
      last = 1;
    } else if (!header && emailCol === 1) full = 0;
  }
  const col = emailCol ?? 0;

  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  const seen = new Set<string>();
  let truncated = false;
  body.forEach((r, i) => {
    const line = i + (header ? 2 : 1);
    const raw = r[col] ?? "";
    const email = normaliseEmail(raw);
    if (!email) {
      problems.push({ line, value: raw || r.join(", ").slice(0, 80), reason: "invalid" });
      return;
    }
    if (seen.has(email)) {
      problems.push({ line, value: email, reason: "duplicate" });
      return;
    }
    if (rows.length >= MAX_IMPORT_ROWS) {
      truncated = true;
      return;
    }
    seen.add(email);
    const names = full !== null ? splitFull(cleanName(r[full])) : { first: first !== null ? cleanName(r[first]) : null, last: last !== null ? cleanName(r[last]) : null };
    rows.push({ email, firstName: names.first, lastName: names.last });
  });

  return { rows, problems, truncated, columns: { email: col, first, last, full, header } };
}

/** What the server action accepts back from the browser — re-checked, never trusted. */
export function sanitiseRows(input: unknown): ImportRow[] {
  if (!Array.isArray(input)) return [];
  const out: ImportRow[] = [];
  const seen = new Set<string>();
  for (const item of input.slice(0, MAX_IMPORT_ROWS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const email = typeof o.email === "string" ? normaliseEmail(o.email) : null;
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      firstName: typeof o.firstName === "string" ? cleanName(o.firstName) : null,
      lastName: typeof o.lastName === "string" ? cleanName(o.lastName) : null,
    });
  }
  return out;
}

export type ImportOutcome = "invited" | "added" | "already_invited" | "already_member" | "not_added" | "invalid";

export const OUTCOME_LABELS: Record<ImportOutcome, string> = {
  invited: "Invitation emailed",
  added: "Already on PinPals — added",
  already_invited: "Already invited",
  already_member: "Already a member",
  not_added: "Couldn't add",
  invalid: "Not an email address",
};

/** "38 invitations emailed, 4 already on PinPals and added, 2 already members." */
export function importSummary(counts: Partial<Record<ImportOutcome, number>>, emailFailures = 0): string {
  const parts: string[] = [];
  const n = (k: ImportOutcome) => counts[k] ?? 0;
  const plural = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
  if (n("invited")) parts.push(plural(n("invited"), "invitation emailed", "invitations emailed"));
  if (n("added")) parts.push(`${n("added")} already on PinPals and added`);
  if (n("already_invited")) parts.push(`${n("already_invited")} already invited`);
  if (n("already_member")) parts.push(plural(n("already_member"), "already a member", "already members"));
  if (n("not_added")) parts.push(`${n("not_added")} couldn't be added`);
  if (n("invalid")) parts.push(`${n("invalid")} not valid`);
  let s = parts.length ? parts.join(", ") + "." : "Nobody new to invite.";
  if (emailFailures) s += ` ${plural(emailFailures, "email", "emails")} didn't send — use Resend below.`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The emails (0170): a join invitation, or "you've been added". */
export function societyInviteEmail(input: {
  kind: "invite" | "added";
  societyName: string;
  inviterName: string | null;
  firstName: string | null;
  email: string;
  link: string;
}): { subject: string; title: string; bodyLines: string[]; ctaLabel: string } {
  const hi = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const by = input.inviterName ? `${input.inviterName} has` : "Your society has";
  if (input.kind === "added") {
    return {
      subject: `You're now in ${input.societyName} on PinPals`,
      title: `You're in ${input.societyName}`,
      bodyLines: [
        hi,
        `${by} added you to ${input.societyName} on PinPals. Its events, results and messages are in the PinPals app under Groups & Societies.`,
        "If you'd rather not be in it, open the society in the app and tap Leave.",
      ],
      ctaLabel: "Open the society",
    };
  }
  return {
    subject: `${input.societyName} has moved to PinPals — you're invited`,
    title: `Join ${input.societyName} on PinPals`,
    bodyLines: [
      hi,
      `${by} invited you to ${input.societyName} on PinPals — where the society's events, draws, live scoring and results now live.`,
      `Sign up or log in with ${input.email} and you'll be in the society straight away. Using a different email? Tap the button and you'll still be added.`,
    ],
    ctaLabel: `Join ${input.societyName}`,
  };
}
