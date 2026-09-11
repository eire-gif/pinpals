/**
 * Staff editing of a member's own profile — the validation and the diff.
 *
 * Pure and framework-free: no Supabase, no Next.js, no `server-only`, so both
 * halves can be unit-tested directly, the same shape as
 * src/lib/admin/moderation.ts and src/lib/community.ts. The Server Action
 * (src/app/admin/users/[id]/actions.ts) is still the enforcement point — it
 * owns the role check, the club lookup and the write. This file only decides
 * whether a submitted set of values is coherent, and what changed.
 *
 * ============ Why super_admin alone ============
 *
 * Every other admin mutation in this app changes a *status* — suspended,
 * hidden, removed, resolved — and each one is reversible by flipping that
 * status back. This one rewrites facts a member entered about themselves, and
 * the previous values live nowhere except the audit row this action writes.
 * That puts it in the same tier as listing force-removal
 * (LISTING_REMOVAL_ROLES) and report redaction: super_admin, not
 * MODERATION_ROLES.
 */

import { isCountryCode, isRegionInCountry, countryName } from "@/lib/regions";

export const MEMBER_EDIT_ROLES = ["super_admin"] as const;

/** Raw strings straight off the form, before any coercion. Kept as a plain
 * object rather than FormData so the parser is testable without a DOM. */
export type MemberProfileInput = {
  firstName: string;
  lastName: string;
  /** The club's id as the combobox submits it — "" means "no home club". */
  clubId: string;
  country: string;
  county: string;
  handicap: string;
  handicapVisible: boolean;
  bio: string;
  guiNumber: string;
};

/** The columns this action may write, named exactly as they are in `profiles`
 * so the update is a straight spread and the audit metadata names real
 * columns rather than form-field aliases. */
export type MemberProfileValues = {
  first_name: string;
  last_name: string;
  home_club_id: number | null;
  country: string;
  county: string | null;
  handicap: number | null;
  handicap_visible: boolean;
  bio: string | null;
  gui_membership_number: string | null;
};

export type MemberProfileParse =
  | { ok: true; values: MemberProfileValues }
  | { ok: false; error: string };

const NAME_MAX_LENGTH = 80;
const BIO_MAX_LENGTH = 2000;
const GUI_MAX_LENGTH = 40;

/** profiles.handicap is numeric(4,1) (0001_init) — anything outside this is
 * refused rather than silently clamped, and anything finer than 0.1 is
 * rounded here rather than in Postgres, so the value the audit log records is
 * the value the row actually ends up holding. */
const HANDICAP_MIN = -10;
const HANDICAP_MAX = 54;

/**
 * Validate a staff edit of a member's profile.
 *
 * Mirrors updateProfile() in src/app/profile/edit/actions.ts deliberately: a
 * super admin fixing a member's details by hand must not be able to save a
 * combination the member themselves would have been refused — a county in the
 * wrong country, a handicap of 300 — because the directory, the club pages and
 * the tee-time filters all read these columns assuming that validation held.
 *
 * The one asymmetry is `home_club_id`. The member's own form re-reads the club
 * row to fill in the denormalised `home_club` name; that needs a database, so
 * the action does it and this function only checks the id is a number.
 */
export function parseMemberProfileEdit(input: MemberProfileInput): MemberProfileParse {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();

  if (!firstName || !lastName) {
    return { ok: false, error: "First and last name can't be empty." };
  }
  if (firstName.length > NAME_MAX_LENGTH || lastName.length > NAME_MAX_LENGTH) {
    return { ok: false, error: `Names are limited to ${NAME_MAX_LENGTH} characters.` };
  }

  const country = input.country.trim();
  if (!isCountryCode(country)) {
    return { ok: false, error: "Please choose the country this member plays in." };
  }

  const county = input.county.trim();
  if (county && !isRegionInCountry(country, county)) {
    return { ok: false, error: `That county isn't in ${countryName(country)}.` };
  }

  let homeClubId: number | null = null;
  const clubIdRaw = input.clubId.trim();
  if (clubIdRaw) {
    // Matched against digits rather than handed straight to parseInt, which
    // truncates instead of refusing: parseInt("12abc") is 12 and
    // parseInt("4.5") is 4, so a mangled field would quietly become a
    // foreign key to whichever club happened to hold that id. The picker
    // only ever submits a bare id or nothing, so anything else is a bug or a
    // hand-edited request, and both should be refused.
    if (!/^[0-9]+$/.test(clubIdRaw)) {
      return { ok: false, error: "Pick the home club from the suggestions." };
    }

    const parsed = Number.parseInt(clubIdRaw, 10);
    if (parsed <= 0 || !Number.isSafeInteger(parsed)) {
      return { ok: false, error: "Pick the home club from the suggestions." };
    }
    homeClubId = parsed;
  }

  let handicap: number | null = null;
  const handicapRaw = input.handicap.trim();
  if (handicapRaw) {
    const parsed = Number(handicapRaw);
    if (Number.isNaN(parsed) || parsed < HANDICAP_MIN || parsed > HANDICAP_MAX) {
      return { ok: false, error: "That handicap index doesn't look right." };
    }
    handicap = Math.round(parsed * 10) / 10;
  }

  const bio = input.bio.trim();
  if (bio.length > BIO_MAX_LENGTH) {
    return { ok: false, error: `The bio is limited to ${BIO_MAX_LENGTH} characters.` };
  }

  const guiNumber = input.guiNumber.trim();
  if (guiNumber.length > GUI_MAX_LENGTH) {
    return { ok: false, error: `That membership number is too long.` };
  }

  return {
    ok: true,
    values: {
      first_name: firstName,
      last_name: lastName,
      home_club_id: homeClubId,
      country,
      county: county || null,
      handicap,
      handicap_visible: input.handicapVisible,
      bio: bio || null,
      gui_membership_number: guiNumber || null,
    },
  };
}

export type MemberProfileChange = { from: unknown; to: unknown };

/**
 * The row as it stands before the edit. Every field is optional AND nullable,
 * which `Partial<MemberProfileValues>` alone isn't: `country` is non-null once
 * this action has validated it, but an existing row can perfectly well have a
 * null one — a member who joined before 0061 added the column. Both read as
 * "not set" in the diff below.
 */
export type MemberProfileBefore = {
  [K in keyof MemberProfileValues]?: MemberProfileValues[K] | null;
};

/**
 * What this edit actually changed, for the audit log.
 *
 * Before/after values are kept for every field except `bio`, which records
 * only that it changed and by how much. The rest are short facts a staff
 * member can already see on the page they are editing, so logging them adds
 * no exposure and makes "who set this member's handicap to 2" answerable.
 * A bio is free text the member wrote — sometimes several paragraphs — and
 * copying it into an append-only table that super admins read forever is a
 * different thing entirely. If the old text matters, it is still in the row
 * until the moment it is overwritten; the audit row's job here is to say
 * that someone overwrote it.
 *
 * Returns an empty object when nothing changed, which the caller uses to
 * refuse a no-op edit rather than writing an audit row that says nothing.
 */
export function summariseProfileChanges(
  before: MemberProfileBefore,
  after: MemberProfileValues
): Record<string, MemberProfileChange> {
  const changes: Record<string, MemberProfileChange> = {};

  for (const key of Object.keys(after) as (keyof MemberProfileValues)[]) {
    const previous = before[key] ?? null;
    const next = after[key] ?? null;
    if (previous === next) continue;

    changes[key] =
      key === "bio"
        ? {
            from: previous == null ? "empty" : `${String(previous).length} characters`,
            to: next == null ? "empty" : `${String(next).length} characters`,
          }
        : { from: previous, to: next };
  }

  return changes;
}
