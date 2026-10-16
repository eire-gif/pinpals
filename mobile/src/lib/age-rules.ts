/**
 * Junior members (claude/junior-members.md, needs 0159): the pure half.
 *
 * PinPals takes golfers from 13. What a member can do is decided by the
 * database from their date of birth every time it's asked — my_age_access()
 * returns the answer and the age_guard() triggers enforce it, however a row
 * is written. This file only READS that answer: it turns the RPC's JSON into
 * a typed value, says which screens to show, and holds the small sums the
 * sign-up form and the store age signal need.
 *
 * DELIBERATELY A PURE MODULE — no React, no expo-router, no supabase — so it
 * runs in the root vitest project (age-rules.test.ts). lib/age.ts is the
 * cached, hooked half.
 *
 * Nothing here is a security boundary. Hiding a button for a 14 year old is
 * courtesy; the database says no regardless.
 */

/** The bands in the database (age_band_of). */
export type AgeBand = "junior_pending" | "junior" | "youth" | "adult" | "unknown";

const BANDS: readonly AgeBand[] = ["junior_pending", "junior", "youth", "adult", "unknown"];

export type ParentStatus = "pending" | "approved" | "declined" | "revoked";

export type ParentLink = {
  status: ParentStatus;
  /** The address the link was sent to. Shown masked (maskEmail). */
  email: string;
  invitedAt: string | null;
  approvedAt: string | null;
};

export type AgeCan = {
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

export type AgeAccess = {
  band: AgeBand;
  /** Whole years, or null with no date of birth. */
  age: number | null;
  /** YYYY-MM-DD, or null. */
  dateOfBirth: string | null;
  /** A member from before juniors: asked for a date once (set_my_date_of_birth). */
  needsDateOfBirth: boolean;
  /** "May be under 18" is open on the account (report or store signal). */
  underReview: boolean;
  /** Only for 13–15 year olds. */
  parent: ParentLink | null;
  can: AgeCan;
};

/**
 * What each band may do — the same table as the `can` object in
 * my_age_access(). Used to fill any field the server leaves out (an older
 * server, a newer field), so a missing key never reads as "allowed" for a
 * minor.
 */
export function canForBand(band: AgeBand): AgeCan {
  const minor = band === "junior" || band === "junior_pending" || band === "youth";
  return {
    liveScoring: band !== "junior_pending",
    shareLive: band !== "junior_pending",
    teeTimes: !minor,
    social: !minor,
    chat: !minor,
    marketplace: minor ? "browse" : "full",
    createGroups: !minor,
    groupOfficer: !minor,
    joinGroups: band === "junior_pending" ? "none" : band === "junior" ? "parent" : "all",
    connections: band !== "junior" && band !== "junior_pending",
    playWith: band === "junior_pending" ? "none" : band === "junior" ? "approved" : "all",
    personalisedAds: !minor,
  };
}

/**
 * What a screen assumes when it has no answer at all (no network on the first
 * launch, the RPC not there yet). Adult-like, because that is how every
 * member was treated before 0159 and the database still refuses anything a
 * minor can't do — this only decides what is DRAWN. Never used to replace an
 * answer the server has already given (see lib/age.ts).
 */
export const FALLBACK_ACCESS: AgeAccess = {
  band: "unknown",
  age: null,
  dateOfBirth: null,
  needsDateOfBirth: false,
  underReview: false,
  parent: null,
  can: canForBand("unknown"),
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** my_age_access() / set_my_date_of_birth() → AgeAccess. Null when it isn't one. */
export function parseAgeAccess(raw: unknown): AgeAccess | null {
  if (!isRecord(raw)) return null;
  const band = oneOf<AgeBand | "">(raw.band, BANDS, "");
  if (!band) return null;

  const base = canForBand(band);
  const c = isRecord(raw.can) ? raw.can : {};
  const can: AgeCan = {
    liveScoring: bool(c.liveScoring, base.liveScoring),
    shareLive: bool(c.shareLive, base.shareLive),
    teeTimes: bool(c.teeTimes, base.teeTimes),
    social: bool(c.social, base.social),
    chat: bool(c.chat, base.chat),
    marketplace: oneOf(c.marketplace, ["browse", "full"] as const, base.marketplace),
    createGroups: bool(c.createGroups, base.createGroups),
    groupOfficer: bool(c.groupOfficer, base.groupOfficer),
    joinGroups: oneOf(c.joinGroups, ["none", "parent", "all"] as const, base.joinGroups),
    connections: bool(c.connections, base.connections),
    playWith: oneOf(c.playWith, ["none", "approved", "all"] as const, base.playWith),
    personalisedAds: bool(c.personalisedAds, base.personalisedAds),
  };

  const p = isRecord(raw.parent) ? raw.parent : null;
  const parentEmail = p ? str(p.email) : null;
  const parent: ParentLink | null =
    p && parentEmail
      ? {
          status: oneOf(p.status, ["pending", "approved", "declined", "revoked"] as const, "pending"),
          email: parentEmail,
          invitedAt: str(p.invitedAt),
          approvedAt: str(p.approvedAt),
        }
      : null;

  const dob = str(raw.dateOfBirth);
  return {
    band,
    age: typeof raw.age === "number" && Number.isFinite(raw.age) ? raw.age : null,
    dateOfBirth: dob && /^\d{4}-\d{2}-\d{2}/.test(dob) ? dob.slice(0, 10) : null,
    needsDateOfBirth: bool(raw.needsDateOfBirth, dob === null),
    underReview: bool(raw.underReview, false),
    parent,
    can,
  };
}

// ---------------------------------------------------------------------------
// Questions screens ask
// ---------------------------------------------------------------------------

/** The things a screen hides or shows by age. */
export type AgeFeature =
  | "teeTimes"
  | "social"
  | "chat"
  /** PinPals (connections), the member directory and Find PinPals: not under 16. */
  | "connections"
  /** Listing, selling, payouts — and buying, which a parent does for them. */
  | "sell"
  | "buy"
  | "createGroups"
  | "groupOfficer"
  | "liveScoring"
  | "shareLive"
  /** The website's /parent page, in the menu: adults only. */
  | "parentDashboard";

export function canUse(access: AgeAccess, feature: AgeFeature): boolean {
  switch (feature) {
    case "sell":
    case "buy":
      return access.can.marketplace === "full";
    case "parentDashboard":
      return access.band === "adult" || access.band === "unknown";
    default:
      return access.can[feature];
  }
}

export const isMinor = (access: AgeAccess): boolean =>
  access.band === "junior" || access.band === "junior_pending" || access.band === "youth";

/** 13–15: a parent approves the account. */
export const isUnder16 = (access: AgeAccess): boolean => access.band === "junior" || access.band === "junior_pending";

/** The full-screen stop a member is held at, if any. */
export type AgeGate = "dateOfBirth" | "waiting";

export function gateFor(access: AgeAccess): AgeGate | null {
  if (access.needsDateOfBirth) return "dateOfBirth";
  if (access.band === "junior_pending") return "waiting";
  return null;
}

/**
 * Where a 13–15 year old still waiting for their parent may go: the waiting
 * screen itself, the Rules of Golf, the course directory and the how-to
 * guides. Keyed on the first route segment, as the auth gate is.
 */
const OPEN_WHILE_WAITING = new Set(["age", "rules", "courses", "course", "guide"]);

export const openWhileWaiting = (firstSegment: string | undefined): boolean =>
  firstSegment !== undefined && OPEN_WHILE_WAITING.has(firstSegment);

/** "jo•••••@gmail.com" — enough to recognise, not enough to copy. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••••";
  const local = email.slice(0, at);
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}${"•".repeat(Math.min(5, Math.max(3, local.length - keep)))}${email.slice(at)}`;
}

/** The parent link's state, in a line for the waiting screen and Privacy. */
export function parentStatusLine(parent: ParentLink | null): string {
  if (!parent) return "No parent or guardian added yet.";
  switch (parent.status) {
    case "approved":
      return "Approved — your parent looks after your account.";
    case "declined":
      return "Your parent said no. You can ask again, or send it to a different parent or guardian.";
    case "revoked":
      return "Your parent's approval was taken back. Send it again to switch your account back on.";
    default:
      return "Waiting for them to approve.";
  }
}

// ---------------------------------------------------------------------------
// Sign-up and date of birth
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole years between a YYYY-MM-DD birthday and `today` (a local date). Null for a bad or future date. */
export function ageOn(dob: string, today: Date): number | null {
  const m = ISO_DATE.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(y, mo - 1, d);
  if (born.getFullYear() !== y || born.getMonth() !== mo - 1 || born.getDate() !== d) return null;
  let age = today.getFullYear() - y;
  if (today.getMonth() < mo - 1 || (today.getMonth() === mo - 1 && today.getDate() < d)) age -= 1;
  return age < 0 ? null : age;
}

/** Which sign-up path a date of birth takes. */
export type SignupAge = "under13" | "under16" | "over16";

export function signupAge(dob: string, today: Date): SignupAge | null {
  const age = ageOn(dob, today);
  if (age === null) return null;
  if (age < 13) return "under13";
  if (age < 16) return "under16";
  return "over16";
}

/** Under 13 is turned away; the form stays shut on this phone for a day. */
export const SIGNUP_LOCK_MS = 24 * 60 * 60 * 1000;

/** When a stored lock (an ISO time) ends, or null when there isn't one any more. */
export function signupLockedUntil(stored: string | null, now: Date): Date | null {
  if (!stored) return null;
  const until = new Date(stored);
  if (Number.isNaN(until.getTime())) return null;
  // A lock further away than its own length is a clock change or tampering:
  // cap it rather than shut someone out for a year.
  const capped = Math.min(until.getTime(), now.getTime() + SIGNUP_LOCK_MS);
  return capped > now.getTime() ? new Date(capped) : null;
}

export const UNDER_13_MESSAGE = "Sorry, you need to be 13 or over to join PinPals.";

export const looksLikeEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

// ---------------------------------------------------------------------------
// App store age signals (lib/store-age.ts)
// ---------------------------------------------------------------------------

/** What the native module hands back. */
export type StoreSignal = { lower: number | null; upper: number | null; status: string };

const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 150 ? v : null;

/** The native result → a signal worth sending, or null (nothing known). */
export function parseStoreSignal(raw: unknown): StoreSignal | null {
  if (!isRecord(raw)) return null;
  const lower = intOrNull(raw.lowerBound);
  const upper = intOrNull(raw.upperBound);
  const status = typeof raw.status === "string" ? raw.status.slice(0, 40) : "";
  if (lower === null && upper === null && !status) return null;
  return { lower, upper, status: status || "unknown" };
}

/** Asked at most once a day; after the member says no to sharing, once a month. */
export const STORE_SIGNAL_EVERY_MS = 24 * 60 * 60 * 1000;
export const STORE_SIGNAL_DECLINED_MS = 30 * 24 * 60 * 60 * 1000;

export type StoreSignalMemo = { at: string; declined: boolean };

export function parseStoreMemo(raw: string | null): StoreSignalMemo | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return isRecord(v) && typeof v.at === "string" ? { at: v.at, declined: v.declined === true } : null;
  } catch {
    return null;
  }
}

export function storeSignalDue(memo: StoreSignalMemo | null, now: Date): boolean {
  if (!memo) return true;
  const last = new Date(memo.at).getTime();
  if (Number.isNaN(last) || last > now.getTime()) return true;
  return now.getTime() - last >= (memo.declined ? STORE_SIGNAL_DECLINED_MS : STORE_SIGNAL_EVERY_MS);
}

/**
 * Only accounts that say they're adults (or haven't said) are checked: the
 * signal exists to catch a child on an 18+ account. A member already known
 * to be under 18 is spared the system's "share your age?" sheet.
 */
export const wantsStoreSignal = (access: AgeAccess): boolean => access.band === "adult" || access.band === "unknown";

// ---------------------------------------------------------------------------
// Marketplace: Ask a parent
// ---------------------------------------------------------------------------

/**
 * Under 16s have a parent on PinPals, so the listing goes to them as an
 * alert (POST /api/app/age/ask-parent). 16–17s — or when the server couldn't
 * send it — get the share sheet with the listing's link instead.
 */
export const askParentByAlert = (access: AgeAccess): boolean => access.band === "junior";

export const askParentOutcome = (response: unknown): "sent" | "share" =>
  isRecord(response) && response.sent === true ? "sent" : "share";
