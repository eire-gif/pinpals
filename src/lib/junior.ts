/**
 * Junior members (0159, claude/junior-members.md) — the pure half. No
 * Supabase, no Next, so the arithmetic and the wording rules are directly
 * unit-testable, the same split as age.ts and safe-redirect.ts.
 *
 * The database is the authority on what a member may do: `my_age_access()`
 * works the band out from the date of birth on every call, and `age_guard()`
 * refuses the writes. This module only (a) checks a date of birth before it
 * is sent anywhere, so the sign-up form can say "you need a parent's email"
 * before the round trip, and (b) reads the JSON `my_age_access()` returns
 * into a typed shape the pages hide things with. If the two ever disagree,
 * the database wins: a page that shows a form the database then refuses is a
 * bug in this file, never a hole.
 */

// ---------------------------------------------------------------------------
// Dates of birth
// ---------------------------------------------------------------------------

export const MIN_JOIN_AGE = 13;
/** Under this, a parent approves the account (Ireland's digital age of consent). */
export const PARENT_LINK_AGE = 16;
export const ADULT_AGE = 18;
export const EARLIEST_BIRTH_YEAR = 1900;

export type DobCheck = { ok: true; date: string } | { ok: false; error: string };

const pad = (n: number) => String(n).padStart(2, "0");

/** Today as YYYY-MM-DD in UTC — a date of birth has no time of day. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

/**
 * Three select values (day, month, year) into YYYY-MM-DD, or "" when any is
 * missing. Validation is checkDateOfBirth()'s job, not this one's.
 */
export function dateFromParts(day: unknown, month: unknown, year: unknown): string {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y) || d < 1 || m < 1 || y < 1) return "";
  return `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
}

/**
 * A real calendar date, not in the future, not before 1900. Strict about the
 * format — `new Date("2010-02-31")` quietly becomes 3 March, and a date of
 * birth that is locked once saved is the last place to let that through.
 */
export function checkDateOfBirth(raw: unknown, now: Date = new Date()): DobCheck {
  const value = typeof raw === "string" ? raw.trim() : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { ok: false, error: "Please enter your date of birth." };
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false, error: "That date of birth doesn't look right." };
  }
  if (y < EARLIEST_BIRTH_YEAR) return { ok: false, error: "Please check that date of birth." };
  if (value > todayIso(now)) return { ok: false, error: "That date of birth is in the future." };
  return { ok: true, date: value };
}

/**
 * Completed years on `now`, from a YYYY-MM-DD string, in UTC. Matches
 * Postgres's `extract(year from age(dob))`: a 29 February birthday ticks over
 * on 1 March in a non-leap year.
 */
export function ageFromIso(dob: string, now: Date = new Date()): number {
  const [y, m, d] = dob.split("-").map(Number);
  let age = now.getUTCFullYear() - y;
  const monthDelta = now.getUTCMonth() + 1 - m;
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < d)) age -= 1;
  return age;
}

/** What sign-up does with a given age. */
export type SignupAgeOutcome = "under_13" | "needs_parent" | "ok";

export function signupAgeOutcome(age: number): SignupAgeOutcome {
  if (age < MIN_JOIN_AGE) return "under_13";
  if (age < PARENT_LINK_AGE) return "needs_parent";
  return "ok";
}

export const UNDER_13_MESSAGE = "Sorry — you need to be 13 or over to join PinPals.";

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

// Deliberately loose: one @, something either side, a dot in the domain, no
// spaces. The real test is whether the parent receives the email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && EMAIL_RE.test(value.trim());
}

export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** j***@gmail.com — enough for a junior to recognise the address they gave. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Checks a parent's email as the sign-up form and the "change email" form both need. */
export function checkParentEmail(raw: unknown, ownEmail: string | null | undefined): { ok: true; email: string } | { ok: false; error: string } {
  const email = typeof raw === "string" ? raw.trim() : "";
  if (!email) return { ok: false, error: "Please add a parent or guardian's email." };
  if (!isPlausibleEmail(email)) return { ok: false, error: "That parent or guardian's email doesn't look right." };
  if (ownEmail && sameEmail(email, ownEmail)) {
    return { ok: false, error: "Your parent or guardian's email needs to be different from yours." };
  }
  return { ok: true, email: email.toLowerCase() };
}

// ---------------------------------------------------------------------------
// my_age_access()
// ---------------------------------------------------------------------------

export const AGE_BANDS = ["junior_pending", "junior", "youth", "adult", "unknown"] as const;
export type JuniorBand = (typeof AGE_BANDS)[number];

export type AgeAccess = {
  band: JuniorBand;
  age: number | null;
  dateOfBirth: string | null;
  needsDateOfBirth: boolean;
  underReview: boolean;
  parent: { status: string; email: string; invitedAt: string | null; approvedAt: string | null } | null;
  can: {
    liveScoring: boolean;
    shareLive: boolean;
    teeTimes: boolean;
    social: boolean;
    chat: boolean;
    marketplace: "browse" | "full";
    createGroups: boolean;
    groupOfficer: boolean;
    joinGroups: "none" | "parent" | "all";
    connections: boolean;
    playWith: "none" | "approved" | "all";
    personalisedAds: boolean;
  };
};

const isBand = (v: unknown): v is JuniorBand => typeof v === "string" && (AGE_BANDS as readonly string[]).includes(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * The RPC's JSON, typed. Anything missing reads as the adult default — the
 * same "unknown is treated as an adult" rule the database uses — so a page
 * never hides features because a key was renamed. The triggers still refuse
 * anything a minor shouldn't do.
 */
export function parseAgeAccess(raw: unknown): AgeAccess | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const band = isBand(r.band) ? r.band : "unknown";
  const c = (r.can && typeof r.can === "object" ? r.can : {}) as Record<string, unknown>;
  const p = r.parent && typeof r.parent === "object" ? (r.parent as Record<string, unknown>) : null;
  return {
    band,
    age: typeof r.age === "number" ? r.age : null,
    dateOfBirth: str(r.dateOfBirth),
    needsDateOfBirth: bool(r.needsDateOfBirth, false),
    underReview: bool(r.underReview, false),
    parent: p ? { status: str(p.status) ?? "pending", email: str(p.email) ?? "", invitedAt: str(p.invitedAt), approvedAt: str(p.approvedAt) } : null,
    can: {
      liveScoring: bool(c.liveScoring, true),
      shareLive: bool(c.shareLive, true),
      teeTimes: bool(c.teeTimes, true),
      social: bool(c.social, true),
      chat: bool(c.chat, true),
      marketplace: c.marketplace === "browse" ? "browse" : "full",
      createGroups: bool(c.createGroups, true),
      groupOfficer: bool(c.groupOfficer, true),
      joinGroups: c.joinGroups === "none" || c.joinGroups === "parent" ? c.joinGroups : "all",
      connections: bool(c.connections, true),
      playWith: c.playWith === "none" || c.playWith === "approved" ? c.playWith : "all",
      personalisedAds: bool(c.personalisedAds, true),
    },
  };
}

/** The website's restricted areas, each answered from `can`. */
export const AGE_FEATURES = ["teeTimes", "social", "chat", "marketplaceSell", "createGroups", "connections", "directory"] as const;
export type AgeFeature = (typeof AGE_FEATURES)[number];

/** What a member sees instead of the feature — or null when it's theirs to use. */
export type AgeBlock = "waiting_for_parent" | "under_18" | "under_16";

export function ageBlockFor(access: AgeAccess | null, feature: AgeFeature): AgeBlock | null {
  if (!access) return null;
  if (access.band === "junior_pending") return "waiting_for_parent";
  const { can } = access;
  switch (feature) {
    case "teeTimes":
      return can.teeTimes ? null : "under_18";
    case "social":
      return can.social ? null : "under_18";
    case "chat":
      return can.chat ? null : "under_18";
    case "marketplaceSell":
      return can.marketplace === "full" ? null : "under_18";
    case "createGroups":
      return can.createGroups ? null : "under_18";
    case "connections":
    case "directory":
      return can.connections ? null : "under_16";
  }
}

export const isMinorBand = (band: JuniorBand) => band === "junior" || band === "junior_pending" || band === "youth";

/** Plain-English names for a band, for the parent dashboard and admin. */
export const BAND_LABELS: Record<JuniorBand, string> = {
  junior_pending: "13–15, waiting for a parent",
  junior: "13–15, parent approved",
  youth: "16–17 (or under review)",
  adult: "18 or over",
  unknown: "No date of birth yet",
};

/**
 * The band from the facts, mirroring `age_band_of()` in 0159 — for admin,
 * which reads the facts with the service role rather than calling a
 * function revoked from members. Keep the two in step.
 */
export function bandFromFacts(input: { dateOfBirth: string | null; parentApproved: boolean; openFlag: boolean }, now: Date = new Date()): JuniorBand {
  if (!input.dateOfBirth) return input.openFlag ? "youth" : "unknown";
  const age = ageFromIso(input.dateOfBirth, now);
  if (age < PARENT_LINK_AGE) return input.parentApproved ? "junior" : "junior_pending";
  if (age < ADULT_AGE) return "youth";
  return input.openFlag ? "youth" : "adult";
}

/**
 * The short "what a 13–15 year old can and can't do" list — the parent's
 * email and the approval page both show it, so they can't drift apart.
 */
export const JUNIOR_CAN = [
  "Score their rounds live, keep scorecards and use the GPS hole maps",
  "Share a live round with family (Follow my round)",
  "Play with you, the PinPals you approve, and people in groups you add them to",
  "Browse the marketplace and send you anything they'd like",
] as const;

export const JUNIOR_CANNOT = [
  "Post on Social, comment or review courses",
  "Send or receive messages",
  "Post or join tee times with strangers",
  "Buy, sell or bid in the marketplace",
  "Add PinPals themselves — you approve who they play with",
] as const;
