import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Dispute,
  Listing,
  Offer,
  Order,
  Payout,
  Profile,
  Refund,
  StripeConnectedAccount,
  TeeTimeInterest,
  TeeTimeInvite,
  WebhookEvent,
} from "@/lib/types";
import type { StaffRole, StaffStatus } from "./roles";
import type { ReportCategory, ReportPriority, ReportStatus, ReportTargetType } from "./reports";
import type {
  SupportCaseCategory,
  SupportCaseLinkedTargetType,
  SupportCasePriority,
  SupportCaseStatus,
} from "./support-cases";
import { AUDIT_TARGET_TYPES } from "./audit";
import { buildMessagesCursorFilter, nextMessagesCursor, type MessagesCursor } from "@/lib/messaging";

// Every read in this file goes through the service-role client, deliberately
// bypassing RLS: the admin console needs to see every user's data (not just
// what a given staff member's own row would let them see under the app's
// normal owner-scoped policies), and every caller of these functions sits
// behind requireStaff() already — see src/lib/admin/authorization.ts. Every
// function above the "Audit log" section only ever reads. The moment a
// Phase 3 mutation needs this client to write, it must also record a row via
// src/lib/admin/audit.ts's recordAdminAction() — see
// admin-architecture-review.md §6 — nothing here does that yet because no
// mutation exists yet.
//
// The whole member base is a handful of rows today (see the row counts in
// admin-architecture-review.md). For listTeeTimeInvites(), fetching the
// table in full and filtering in memory is simpler and plenty fast at this
// scale. listUsers() and listListings() *used* to work the same way, but
// Phase 5 (user detail + real pagination) and Phase 6 (listing moderation)
// replaced them with genuine server-side `.range()` pagination and indexed
// `ilike` search (see supabase/migrations/0012_profiles_search_indexes.sql
// and 0014_listings_search_indexes.sql) — see the "Users" and "Listings"
// sections below for why, and why email/seller-name search still work
// without a SQL column to search email on directly.
//
// Every function in this file needs each user's email attached to their
// profile — Supabase Auth emails live in auth.users, which PostgREST
// doesn't expose, so the only way to read them is the Auth admin API
// (`auth.admin.listUsers`), not a DB join. That call is bounded to 1000
// users (one Admin API page) regardless of how many profile rows are
// actually being displayed, which is the same bounded-cost pattern
// getOverviewMetrics() relies on below for suspendedMembers. Once the
// member base grows past 1000 auth users, this needs real cursor-paged
// Admin API reads instead of one bounded page.

type AuthUserInfo = { email: string | null; bannedUntil: string | null };

// Everything about a member that lives in Supabase Auth rather than
// `profiles` — today just email and ban status. `banned_until` only comes
// back from the Auth admin API (auth.admin.listUsers/getUserById), never
// from a DB join, so this is still the one place that reads it. Named
// generically (not "emailMap") now that suspend/reinstate (see
// src/app/admin/users/[id]/actions.ts) needs the ban status too.
async function authUserMap(): Promise<Map<string, AuthUserInfo>> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Failed to list auth users: ${error.message}`);
  return new Map(
    data.users.map((u) => [u.id, { email: u.email ?? null, bannedUntil: u.banned_until ?? null }])
  );
}

function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

function countBy<T, K extends keyof T>(rows: T[], key: K): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const id = String(row[key]);
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

export type AdminProfile = Profile & { email: string | null; banned_until: string | null };

function withEmail(profile: Profile, authUsers: Map<string, AuthUserInfo>): AdminProfile {
  const info = authUsers.get(profile.id);
  return { ...profile, email: info?.email ?? null, banned_until: info?.bannedUntil ?? null };
}

/** Whether a suspension is currently in effect — a past `banned_until` means
 * the ban has already lapsed (Supabase doesn't clear the field on its own). */
export function isUserSuspended(profile: Pick<AdminProfile, "banned_until">): boolean {
  return profile.banned_until != null && new Date(profile.banned_until).getTime() > Date.now();
}

// ---------- Users ----------

export type AdminUserListItem = AdminProfile & {
  listing_count: number;
  invite_count: number;
};

export type AdminUserPage = {
  rows: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const USERS_PAGE_SIZE = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reduces a raw search-box query down to characters that are inert in both
 * Postgres's ILIKE pattern language (where `\` `%` `_` are wildcards/escapes)
 * and PostgREST's filter mini-language (where `,` `.` `:` `(` `)` are
 * reserved separators). Rather than correctly *escaping* for both layers at
 * once — fragile to get right, and only verifiable by testing against a live
 * query — this sidesteps the problem: nothing that survives can ever act as
 * a wildcard or break filter syntax. Letters (Unicode-aware, so fada-accented
 * Irish spellings like "Dún Laoghaire" or "Ó Súilleabháin" still match),
 * digits, spaces, hyphens and apostrophes cover every real first name,
 * surname, club, and county this app has. Exported for unit testing.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .trim()
    .slice(0, 100);
}

/**
 * Builds the `.or()` filter string for listUsers()'s indexed search: ILIKE
 * across the four indexed profile columns the search box matches against
 * (see 0012_profiles_search_indexes.sql), plus an `id.in.(...)` clause for
 * any profile ids that matched by email (email itself isn't a SQL column —
 * see the file-header comment). Returns null when there's nothing to filter
 * on, so the caller can skip `.or()` entirely rather than pass an empty
 * clause. Pure and DB-free by design so it's testable without mocking
 * Supabase — same reasoning as audit.ts's sanitizeMetadata(). Exported for
 * unit testing.
 */
export function buildUserSearchOrFilter(query: string, emailMatchedIds: string[]): string | null {
  const term = sanitizeSearchTerm(query);
  const clauses: string[] = [];

  if (term) {
    const pattern = `%${term}%`;
    clauses.push(
      `first_name.ilike.${pattern}`,
      `last_name.ilike.${pattern}`,
      `home_club.ilike.${pattern}`,
      `county.ilike.${pattern}`
    );
  }

  // Defense in depth: these ids come from our own authUserMap() lookup
  // (Supabase Auth's own user ids), never straight from the request, but
  // validate the shape before it ever reaches a filter string anyway.
  const validIds = emailMatchedIds.filter((id) => UUID_RE.test(id));
  if (validIds.length) clauses.push(`id.in.(${validIds.join(",")})`);

  return clauses.length ? clauses.join(",") : null;
}

/**
 * Paginated, server-side-filtered member list for /admin/users. Unlike
 * listListings()/listTeeTimeInvites(), this never reads more `profiles` rows
 * than one page's worth: search runs as an indexed `ilike`/`id.in` filter in
 * the query itself (see buildUserSearchOrFilter()), and the per-user
 * listing/invite counts are looked up scoped to just this page's ids, not
 * every listing/invite in the system.
 */
export async function listUsers(
  query = "",
  suspendedOnly = false,
  page = 1
): Promise<AdminUserPage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * USERS_PAGE_SIZE;
  const rangeTo = rangeFrom + USERS_PAGE_SIZE - 1;

  // Needed up front (not just for attaching email/ban status to the result
  // page) because search-by-email and the suspended-only filter both have to
  // be resolved against the Auth roster *before* the profiles query runs —
  // there's no SQL column for either. Bounded to ≤1000 rows regardless of
  // how many profiles exist or which page is being viewed — see the
  // file-header comment.
  const authUsers = await authUserMap();

  const trimmedQuery = query.trim();
  const emailMatchedIds = trimmedQuery
    ? [...authUsers.entries()]
        .filter(([, info]) => info.email?.toLowerCase().includes(trimmedQuery.toLowerCase()))
        .map(([id]) => id)
    : [];

  let profilesQuery = admin
    .from("profiles")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (suspendedOnly) {
    const suspendedIds = [...authUsers.entries()]
      .filter(([, info]) => isUserSuspended({ banned_until: info.bannedUntil }))
      .map(([id]) => id);
    // No suspended members at all — short-circuit rather than send a query
    // that can only ever come back empty (an empty `.in()` list is also
    // invalid PostgREST syntax, so this guard is required, not just an
    // optimization).
    if (suspendedIds.length === 0) {
      return { rows: [], total: 0, page: safePage, pageSize: USERS_PAGE_SIZE };
    }
    profilesQuery = profilesQuery.in("id", suspendedIds);
  }

  if (trimmedQuery) {
    // A search term that sanitizes to nothing (e.g. punctuation-only) and
    // matched no emails means "no additional constraint" — .or() is only
    // applied when there's an actual filter to apply.
    const filter = buildUserSearchOrFilter(trimmedQuery, emailMatchedIds);
    if (filter) profilesQuery = profilesQuery.or(filter);
  }

  const { data, error, count } = await profilesQuery.returns<Profile[]>();
  if (error) throw new Error(`Failed to list profiles: ${error.message}`);
  return await attachCountsAndReturn(admin, data ?? [], count ?? 0, safePage, authUsers);
}

/** Shared tail of listUsers()'s two query paths: attach email/ban status and
 * per-user listing/invite counts, scoped to just this page's ids. */
async function attachCountsAndReturn(
  admin: ReturnType<typeof createAdminClient>,
  profiles: Profile[],
  total: number,
  page: number,
  authUsers: Map<string, AuthUserInfo>
): Promise<AdminUserPage> {
  const pageIds = profiles.map((p) => p.id);

  const [{ data: listingRows }, { data: inviteRows }] = pageIds.length
    ? await Promise.all([
        admin
          .from("listings")
          .select("seller_id")
          .in("seller_id", pageIds)
          .returns<Pick<Listing, "seller_id">[]>(),
        admin
          .from("tee_time_invites")
          .select("member_id")
          .in("member_id", pageIds)
          .returns<Pick<TeeTimeInvite, "member_id">[]>(),
      ])
    : [{ data: [] as Pick<Listing, "seller_id">[] }, { data: [] as Pick<TeeTimeInvite, "member_id">[] }];

  const listingCountBySeller = countBy(listingRows ?? [], "seller_id");
  const inviteCountByMember = countBy(inviteRows ?? [], "member_id");

  const rows = profiles.map((profile) => ({
    ...withEmail(profile, authUsers),
    listing_count: listingCountBySeller.get(profile.id) ?? 0,
    invite_count: inviteCountByMember.get(profile.id) ?? 0,
  }));

  return { rows, total, page, pageSize: USERS_PAGE_SIZE };
}

export type AdminUserDetail = {
  profile: AdminProfile;
  listings: Listing[];
  invites: TeeTimeInvite[];
  offersMade: (Offer & { listing: Pick<Listing, "id" | "title"> | null })[];
  notes: AdminUserNoteListItem[];
};

export async function getUserDetail(id: string): Promise<AdminUserDetail | null> {
  const admin = createAdminClient();
  const [{ data: profile }, authUsers, { data: listings }, { data: invites }, { data: offersMade }, notes] =
    await Promise.all([
      admin.from("profiles").select("*").eq("id", id).maybeSingle<Profile>(),
      authUserMap(),
      admin
        .from("listings")
        .select("*")
        .eq("seller_id", id)
        .order("created_at", { ascending: false })
        .returns<Listing[]>(),
      admin
        .from("tee_time_invites")
        .select("*")
        .eq("member_id", id)
        .order("play_date", { ascending: false })
        .returns<TeeTimeInvite[]>(),
      admin
        .from("offers")
        .select("*, listing:listings(id, title)")
        .eq("buyer_id", id)
        .order("created_at", { ascending: false })
        .returns<(Offer & { listing: Pick<Listing, "id" | "title"> | null })[]>(),
      listUserNotes(id),
    ]);

  if (!profile) return null;

  return {
    profile: withEmail(profile, authUsers),
    listings: listings ?? [],
    invites: invites ?? [],
    offersMade: offersMade ?? [],
    notes,
  };
}

// ---------- Admin notes ----------
//
// Read side of admin_user_notes (see supabase/migrations/0013_admin_user_notes.sql).
// The write side (addUserNote()) lives in
// src/app/admin/users/[id]/actions.ts, next to suspendUser()/reinstateUser()
// — it's a Server Action tied to that one route, not a general-purpose query.

export type AdminUserNote = {
  id: number;
  target_user_id: string;
  author_id: string;
  author_role: StaffRole;
  body: string;
  created_at: string;
};

export type AdminUserNoteListItem = AdminUserNote & { author: AdminProfile | null };

/** Every note on one member, newest first — scoped by the indexed
 * (target_user_id, created_at) composite index, never a full-table read. */
export async function listUserNotes(targetUserId: string): Promise<AdminUserNoteListItem[]> {
  const admin = createAdminClient();
  const [{ data, error }, authUsers] = await Promise.all([
    admin
      .from("admin_user_notes")
      .select("*")
      .eq("target_user_id", targetUserId)
      .order("created_at", { ascending: false })
      .returns<AdminUserNote[]>(),
    authUserMap(),
  ]);
  if (error) throw new Error(`Failed to list admin notes: ${error.message}`);

  const authorIds = [...new Set((data ?? []).map((n) => n.author_id))];
  const { data: authorProfiles } = authorIds.length
    ? await admin.from("profiles").select("*").in("id", authorIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const authorById = new Map((authorProfiles ?? []).map((p) => [p.id, p]));

  return (data ?? []).map((note) => {
    const authorProfile = authorById.get(note.author_id) ?? null;
    return { ...note, author: authorProfile ? withEmail(authorProfile, authUsers) : null };
  });
}

// ---------- Listings ----------

export type AdminListingListItem = Listing & { seller: AdminProfile | null };

export type AdminListingPage = {
  rows: AdminListingListItem[];
  total: number;
  page: number;
  pageSize: number;
};

/** Everything /admin/listings can filter on beyond the free-text search box.
 * `category` and `county` are exact-match (they're closed-ish vocabularies —
 * see CATEGORIES in src/lib/marketplace.ts — so a dropdown, not free text, is
 * the right UI and a plain equality filter is all the existing
 * listings_category_idx/listings_county_idx indexes need). `from`/`to` are
 * ISO timestamps, inclusive bounds on created_at — see the "whole day"
 * comment on the audit-log page for why `to` needs a time component added by
 * the caller, not just a bare date. */
export type AdminListingFilters = {
  status?: string;
  sellerId?: string;
  category?: string;
  county?: string;
  from?: string;
  to?: string;
};

const LISTINGS_PAGE_SIZE = 20;

/**
 * Builds the `.or()` filter string for listListings()'s indexed search:
 * ILIKE across title/description (see 0014_listings_search_indexes.sql) plus
 * an `seller_id.in.(...)` clause for any seller whose name matched (title
 * text has no column for a seller's name — same shape of problem
 * buildUserSearchOrFilter() solves for email). Pure and DB-free — same
 * reasoning as that function, and exported for the same reason: unit
 * testing without mocking Supabase.
 */
export function buildListingSearchOrFilter(query: string, sellerMatchedIds: string[]): string | null {
  const term = sanitizeSearchTerm(query);
  const clauses: string[] = [];

  if (term) {
    const pattern = `%${term}%`;
    clauses.push(`title.ilike.${pattern}`, `description.ilike.${pattern}`);
  }

  const validIds = sellerMatchedIds.filter((id) => UUID_RE.test(id));
  if (validIds.length) clauses.push(`seller_id.in.(${validIds.join(",")})`);

  return clauses.length ? clauses.join(",") : null;
}

/**
 * Paginated, server-side-filtered listing list for /admin/listings. Like
 * listUsers(), this never reads more `listings` rows than one page's worth —
 * search runs as an indexed `ilike`/`seller_id.in` filter in the query
 * itself, not a full-table fetch followed by in-memory filtering.
 */
export async function listListings(
  query = "",
  filters: AdminListingFilters = {},
  page = 1
): Promise<AdminListingPage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * LISTINGS_PAGE_SIZE;
  const rangeTo = rangeFrom + LISTINGS_PAGE_SIZE - 1;

  const trimmedQuery = query.trim();
  const term = trimmedQuery ? sanitizeSearchTerm(trimmedQuery) : "";

  // Resolve seller-name matches against `profiles` (indexed — see
  // 0012_profiles_search_indexes.sql) *before* the listings query runs,
  // same two-step shape listUsers() uses for email search: there's no
  // seller-name column on `listings` itself to search directly.
  let sellerMatchedIds: string[] = [];
  if (term) {
    const pattern = `%${term}%`;
    const { data: matchedProfiles } = await admin
      .from("profiles")
      .select("id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
      .returns<Pick<Profile, "id">[]>();
    sellerMatchedIds = (matchedProfiles ?? []).map((p) => p.id);
  }

  let listingsQuery = admin
    .from("listings")
    .select("*", { count: "exact" })
    // Stable sort — see the identical comment on listAuditLog() below.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (filters.status) listingsQuery = listingsQuery.eq("status", filters.status);
  if (filters.sellerId) listingsQuery = listingsQuery.eq("seller_id", filters.sellerId);
  if (filters.category) listingsQuery = listingsQuery.eq("category", filters.category);
  if (filters.county) listingsQuery = listingsQuery.eq("county", filters.county);
  if (filters.from) listingsQuery = listingsQuery.gte("created_at", filters.from);
  if (filters.to) listingsQuery = listingsQuery.lte("created_at", filters.to);

  if (trimmedQuery) {
    const filter = buildListingSearchOrFilter(trimmedQuery, sellerMatchedIds);
    if (filter) listingsQuery = listingsQuery.or(filter);
  }

  const { data: listings, error, count } = await listingsQuery.returns<Listing[]>();
  if (error) throw new Error(`Failed to list listings: ${error.message}`);

  const authUsers = await authUserMap();
  const sellerIds = [...new Set((listings ?? []).map((l) => l.seller_id))];
  const { data: profiles } = sellerIds.length
    ? await admin.from("profiles").select("*").in("id", sellerIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const rows = (listings ?? []).map((listing) => {
    const sellerProfile = profileById.get(listing.seller_id) ?? null;
    return { ...listing, seller: sellerProfile ? withEmail(sellerProfile, authUsers) : null };
  });

  return { rows, total: count ?? 0, page: safePage, pageSize: LISTINGS_PAGE_SIZE };
}

export type AdminListingDetail = {
  listing: Listing;
  seller: AdminProfile | null;
  offers: (Offer & { buyer: AdminProfile | null })[];
  /** Every admin_audit_log entry for this listing (hide/restore), newest
   * first — see the "Audit log" section below. Bounded by
   * AUDIT_LOG_PAGE_SIZE (50): plenty for one listing's history, since a
   * single listing is moderated at most a handful of times in practice. */
  moderationHistory: AdminAuditLogListItem[];
};

export async function getListingDetail(id: number): Promise<AdminListingDetail | null> {
  const admin = createAdminClient();
  const [{ data: listing }, authUsers, { data: offers }] = await Promise.all([
    admin.from("listings").select("*").eq("id", id).maybeSingle<Listing>(),
    authUserMap(),
    admin
      .from("offers")
      .select("*")
      .eq("listing_id", id)
      .order("created_at", { ascending: false })
      .returns<Offer[]>(),
  ]);
  if (!listing) return null;

  const [{ data: sellerProfile }, { rows: moderationHistory }] = await Promise.all([
    admin.from("profiles").select("*").eq("id", listing.seller_id).maybeSingle<Profile>(),
    listAuditLog({ targetType: "listing", targetId: String(id) }),
  ]);

  const buyerIds = [...new Set((offers ?? []).map((o) => o.buyer_id))];
  const { data: buyerProfiles } = buyerIds.length
    ? await admin.from("profiles").select("*").in("id", buyerIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const buyerById = new Map((buyerProfiles ?? []).map((p) => [p.id, p]));

  return {
    listing,
    seller: sellerProfile ? withEmail(sellerProfile, authUsers) : null,
    offers: (offers ?? []).map((offer) => {
      const buyerProfile = buyerById.get(offer.buyer_id) ?? null;
      return { ...offer, buyer: buyerProfile ? withEmail(buyerProfile, authUsers) : null };
    }),
    moderationHistory,
  };
}

// ---------- Tee-time invites ----------

export type AdminInviteListItem = TeeTimeInvite & {
  host: AdminProfile | null;
  interest_count: number;
};

export async function listTeeTimeInvites(
  query = "",
  status = ""
): Promise<AdminInviteListItem[]> {
  const admin = createAdminClient();
  const [{ data: invites, error }, { data: profiles }, authUsers, { data: interestRows }] =
    await Promise.all([
      admin
        .from("tee_time_invites")
        .select("*")
        .order("play_date", { ascending: false })
        .returns<TeeTimeInvite[]>(),
      admin.from("profiles").select("*").returns<Profile[]>(),
      authUserMap(),
      admin
        .from("tee_time_interests")
        .select("invite_id")
        .returns<Pick<TeeTimeInterest, "invite_id">[]>(),
    ]);
  if (error) throw new Error(`Failed to list tee-time invites: ${error.message}`);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const interestCountByInvite = countBy(interestRows ?? [], "invite_id");

  return (invites ?? [])
    .map((invite) => {
      const hostProfile = profileById.get(invite.member_id) ?? null;
      return {
        ...invite,
        host: hostProfile ? withEmail(hostProfile, authUsers) : null,
        interest_count: interestCountByInvite.get(String(invite.id)) ?? 0,
      };
    })
    .filter((i) => !status || i.status === status)
    .filter((i) =>
      matches(
        query,
        i.club_name,
        i.county,
        i.notes,
        i.host ? `${i.host.first_name} ${i.host.last_name}` : null
      )
    );
}

export type AdminInviteDetail = {
  invite: TeeTimeInvite;
  host: AdminProfile | null;
  interests: (TeeTimeInterest & { member: AdminProfile | null })[];
};

export async function getTeeTimeInviteDetail(id: number): Promise<AdminInviteDetail | null> {
  const admin = createAdminClient();
  const [{ data: invite }, authUsers, { data: interests }] = await Promise.all([
    admin.from("tee_time_invites").select("*").eq("id", id).maybeSingle<TeeTimeInvite>(),
    authUserMap(),
    admin
      .from("tee_time_interests")
      .select("*")
      .eq("invite_id", id)
      .order("created_at", { ascending: false })
      .returns<TeeTimeInterest[]>(),
  ]);
  if (!invite) return null;

  const { data: hostProfile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", invite.member_id)
    .maybeSingle<Profile>();

  const memberIds = [...new Set((interests ?? []).map((i) => i.member_id))];
  const { data: memberProfiles } = memberIds.length
    ? await admin.from("profiles").select("*").in("id", memberIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const memberById = new Map((memberProfiles ?? []).map((p) => [p.id, p]));

  return {
    invite,
    host: hostProfile ? withEmail(hostProfile, authUsers) : null,
    interests: (interests ?? []).map((interest) => {
      const memberProfile = memberById.get(interest.member_id) ?? null;
      return { ...interest, member: memberProfile ? withEmail(memberProfile, authUsers) : null };
    }),
  };
}

// ---------- Audit log ----------
//
// Unlike everything above, this does NOT fetch-full-table-and-filter-in-memory
// — the audit log is expected to grow unbounded (every future admin mutation
// writes a row, forever), so it's the first admin query to earn real
// server-side filtering and range()-based pagination rather than borrowing
// the small-scale approach the rest of this file uses today.

export type AdminAuditLogEntry = {
  id: number;
  actor_id: string;
  actor_role: StaffRole;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  correlation_id: string | null;
  outcome: "success" | "failure";
  created_at: string;
};

export type AdminAuditLogListItem = AdminAuditLogEntry & { actor: AdminProfile | null };

export type AuditLogFilters = {
  actorId?: string;
  action?: string;
  targetType?: string;
  /** A single target row's id (e.g. one listing) — used by
   * getListingDetail()'s "moderation history" section, which the
   * super_admin-only /admin/audit-log page doesn't need since it browses
   * every target at once. */
  targetId?: string;
  /** ISO date/timestamp — inclusive lower bound on created_at. */
  from?: string;
  /** ISO date/timestamp — inclusive upper bound on created_at. */
  to?: string;
};

export type AuditLogPage = {
  rows: AdminAuditLogListItem[];
  /** Approximate row count for this filter set — from `count: "estimated"`
   * (planner statistics, PostgREST's EXPLAIN-based estimate), not a real
   * `count(*)`. admin_audit_log is append-only and grows forever, so an
   * exact count re-scans a steadily larger table on every single page load
   * for a number that's only ever shown as a rough "how much history is
   * there" indicator — not worth the cost. Never exact; the UI must label
   * it as approximate. */
  approxTotal: number;
  nextCursor: MessagesCursor | null;
  pageSize: number;
};

const AUDIT_LOG_PAGE_SIZE = 50;

/**
 * Keyset/cursor-paginated (never OFFSET) — admin_audit_log is append-only
 * and unbounded by design (every future admin mutation adds a row,
 * forever), so paging deep into it with `.range()` would mean Postgres
 * walking and discarding everything before the offset on every request.
 * Ordered newest-first on (created_at, id) — see
 * admin_audit_log_created_at_idx (0009) and the composite
 * admin_audit_log_created_at_id_idx this pairs with (0029) — and paginated
 * with the same buildMessagesCursorFilter()/nextMessagesCursor() helpers
 * src/lib/messaging.ts already uses for message history, since the shape of
 * the problem ("stable newest-first pagination over an ever-growing table")
 * is identical.
 *
 * Omit `cursor` for the first page — this is what getListingDetail() /
 * getReportDetail() / getPayoutDetail() / getUserDetail() do for a single
 * target's (bounded, small) moderation history, and what /admin/audit-log
 * does for its own first page.
 */
export async function listAuditLog(
  filters: AuditLogFilters = {},
  cursor?: MessagesCursor
): Promise<AuditLogPage> {
  const admin = createAdminClient();
  const pageSize = AUDIT_LOG_PAGE_SIZE;

  let query = admin
    .from("admin_audit_log")
    .select("*", { count: "estimated" })
    // Stable sort: created_at alone can tie (two actions in the same
    // millisecond), so id breaks the tie deterministically rather than
    // leaving page boundaries to whatever order Postgres happens to return
    // equal-timestamp rows in.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize);

  if (cursor) query = query.or(buildMessagesCursorFilter(cursor));
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.targetType) query = query.eq("target_type", filters.targetType);
  if (filters.targetId) query = query.eq("target_id", filters.targetId);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const { data, error, count } = await query.returns<AdminAuditLogEntry[]>();
  if (error) throw new Error(`Failed to list audit log: ${error.message}`);

  const authUsers = await authUserMap();
  const actorIds = [...new Set((data ?? []).map((row) => row.actor_id))];
  const { data: actorProfiles } = actorIds.length
    ? await admin.from("profiles").select("*").in("id", actorIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const actorById = new Map((actorProfiles ?? []).map((p) => [p.id, p]));

  const rows = (data ?? []).map((entry) => {
    const actorProfile = actorById.get(entry.actor_id) ?? null;
    return { ...entry, actor: actorProfile ? withEmail(actorProfile, authUsers) : null };
  });

  return { rows, approxTotal: count ?? 0, nextCursor: nextMessagesCursor(data ?? [], pageSize), pageSize };
}

export type AuditLogActor = { id: string; name: string; email: string | null };

/**
 * The staff roster, for the audit page's actor filter dropdown. Deliberately
 * separate from listAuditLog(): the filter options only need the (tiny)
 * staff_roles table, not a scan of the (potentially large, and growing)
 * audit log itself.
 */
export async function listAuditLogActors(): Promise<AuditLogActor[]> {
  const admin = createAdminClient();
  const [{ data: staffRows }, authUsers] = await Promise.all([
    admin.from("staff_roles").select("user_id").returns<{ user_id: string }[]>(),
    authUserMap(),
  ]);
  const staffIds = [...new Set((staffRows ?? []).map((row) => row.user_id))];
  if (!staffIds.length) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("*")
    .in("id", staffIds)
    .returns<Profile[]>();

  return (profiles ?? [])
    .map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), email: authUsers.get(p.id)?.email ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Overview ----------
//
// Unlike listUsers()/listListings()/listTeeTimeInvites() above (which fetch
// each table in full — fine at today's row counts, per the file-level
// comment at the top of this file), every number here is a `head: true`
// count query: PostgREST returns just the row count, never the rows
// themselves. The two *unfiltered* whole-table counts (totalMembers,
// totalListings) use `count: "estimated"` (planner statistics) rather than
// `"exact"`, since at hundreds of thousands of rows an exact count is a real
// index-wide scan for a dashboard number nobody needs to the exact digit;
// every filtered count (active/removed listings, invites, support cases)
// stays "exact", since a filter already bounds the scan and a moderation
// queue's numbers should be trustworthy. The one exception to all of this is
// suspendedMembers, which reuses authUserMap() — that's the same bounded
// (page size 1000) Auth Admin API call every other function in this file
// already relies on for email/ban data, not a new full-table scan.

export type OverviewMetrics = {
  /** Approximate — see the "estimated" note below. */
  totalMembers: number;
  suspendedMembers: number;
  /** Approximate — see the "estimated" note below. */
  totalListings: number;
  activeListings: number;
  removedListings: number;
  totalInvites: number;
  openInvites: number;
  /** open + claimed + waiting_on_member — mirrors isSupportCaseOpen() in
   * support-cases.ts, but re-expressed as a count-query `.in()` filter here
   * rather than fetched-and-filtered, same as every other number in this
   * function. */
  unresolvedSupportCases: number;
};

export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const admin = createAdminClient();

  const [
    { count: totalMembers, error: membersError },
    authUsers,
    { count: totalListings, error: totalListingsError },
    { count: activeListings, error: activeListingsError },
    { count: removedListings, error: removedListingsError },
    { count: totalInvites, error: totalInvitesError },
    { count: openInvites, error: openInvitesError },
    { count: unresolvedSupportCases, error: unresolvedSupportCasesError },
  ] = await Promise.all([
    // "estimated" (planner statistics, not a real COUNT(*)) for the two
    // unfiltered whole-table counts on this dashboard — at hundreds of
    // thousands of members/listings, an exact head-count still means
    // Postgres walking a full index just to return a number nobody needs to
    // the last digit on a page that loads on every staff sign-in. Every
    // *filtered* count below (active/removed listings, invites,
    // support cases) stays "exact": those results are cheap regardless of
    // table size (the filter itself bounds the scan via its own index), and
    // their exactness actually matters for a moderation queue.
    admin.from("profiles").select("*", { count: "estimated", head: true }),
    authUserMap(),
    admin.from("listings").select("*", { count: "estimated", head: true }),
    admin.from("listings").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("listings").select("*", { count: "exact", head: true }).eq("status", "removed"),
    admin.from("tee_time_invites").select("*", { count: "exact", head: true }),
    admin.from("tee_time_invites").select("*", { count: "exact", head: true }).eq("status", "open"),
    admin
      .from("support_cases")
      .select("*", { count: "exact", head: true })
      .in("status", ["open", "claimed", "waiting_on_member"]),
  ]);

  const error =
    membersError ??
    totalListingsError ??
    activeListingsError ??
    removedListingsError ??
    totalInvitesError ??
    openInvitesError ??
    unresolvedSupportCasesError;
  if (error) throw new Error(`Failed to load overview metrics: ${error.message}`);

  let suspendedMembers = 0;
  for (const info of authUsers.values()) {
    if (isUserSuspended({ banned_until: info.bannedUntil })) suspendedMembers += 1;
  }

  return {
    totalMembers: totalMembers ?? 0,
    suspendedMembers,
    totalListings: totalListings ?? 0,
    activeListings: activeListings ?? 0,
    removedListings: removedListings ?? 0,
    totalInvites: totalInvites ?? 0,
    openInvites: openInvites ?? 0,
    unresolvedSupportCases: unresolvedSupportCases ?? 0,
  };
}

// ---------- Reports ----------
//
// /admin/reports unified moderation queue — see
// supabase/migrations/0016_admin_reports.sql and 0017_reports_search_indexes.sql.
// Like listAuditLog()/listListings(), this is real server-side `.range()`
// pagination with a stable sort (created_at desc, id desc), not
// fetch-all-and-filter-in-memory: the queue is expected to grow without
// bound the same way the audit log does.

export type AdminReport = {
  id: number;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  category: ReportCategory;
  description: string | null;
  priority: ReportPriority;
  status: ReportStatus;
  assigned_admin: string | null;
  claimed_at: string | null;
  evidence_refs: unknown[];
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  linked_action_id: number | null;
  created_at: string;
  updated_at: string;
};

/** A short, target-type-appropriate summary for a report row — resolved in
 * a single batched lookup per page (see resolveTargetSummaries()), not a
 * per-row query. `href` is null when there's nowhere to link yet: a
 * message/conversation target (no messaging system exists — see
 * src/lib/admin/reports.ts) or a target row that no longer exists. */
export type AdminReportTargetSummary = {
  type: ReportTargetType;
  label: string;
  href: string | null;
};

export type AdminReportListItem = AdminReport & {
  reporter: AdminProfile | null;
  assignedStaff: AdminProfile | null;
  target: AdminReportTargetSummary;
};

export type AdminReportPage = {
  rows: AdminReportListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminReportFilters = {
  status?: ReportStatus;
  priority?: ReportPriority;
  category?: ReportCategory;
  targetType?: ReportTargetType;
  /** A single target's reports — used by the listing/user detail pages'
   * "Reports" section. Paired with targetType there (target_id alone isn't
   * unique across target types). */
  targetId?: string;
  /** A specific staff user id, or the literal "unassigned" for
   * assigned_admin IS NULL (the queue's default "needs a claim" view). */
  assignedAdmin?: string;
};

const REPORTS_PAGE_SIZE = 20;

/**
 * Builds the `.or()` filter string for listReports()'s free-text search:
 * ILIKE on `description` (see 0017_reports_search_indexes.sql) plus a
 * `reporter_id.in.(...)` clause for any reporter whose name matched — same
 * two-step shape buildListingSearchOrFilter() uses for seller name. Pure and
 * DB-free, exported for unit testing.
 */
export function buildReportSearchOrFilter(query: string, reporterMatchedIds: string[]): string | null {
  const term = sanitizeSearchTerm(query);
  const clauses: string[] = [];

  if (term) {
    clauses.push(`description.ilike.%${term}%`);
  }

  const validIds = reporterMatchedIds.filter((id) => UUID_RE.test(id));
  if (validIds.length) clauses.push(`reporter_id.in.(${validIds.join(",")})`);

  return clauses.length ? clauses.join(",") : null;
}

/**
 * Batch-resolves a page of reports' targets into display summaries without a
 * per-row query: groups ids by target_type, fetches each table once, and
 * falls back to a "no longer exists" label when a target row is gone.
 * message/conversation targets deliberately never resolve to an `href` here
 * — there is no general conversation-browsing admin page to link to (see
 * src/lib/admin/reports.ts and supabase/migrations/0025_messaging.sql); the
 * only way to see a conversation's content is the reason-gated, audited
 * panel on that report's own detail page
 * (conversation-access-panel.tsx), not a link from the queue.
 */
async function resolveTargetSummaries(
  admin: ReturnType<typeof createAdminClient>,
  rows: { target_type: ReportTargetType; target_id: string }[]
): Promise<Map<string, AdminReportTargetSummary>> {
  const key = (type: string, id: string) => `${type}:${id}`;
  const summaries = new Map<string, AdminReportTargetSummary>();

  const userIds = [...new Set(rows.filter((r) => r.target_type === "user").map((r) => r.target_id))];
  const listingIds = [...new Set(rows.filter((r) => r.target_type === "listing").map((r) => r.target_id))]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  const inviteIds = [...new Set(rows.filter((r) => r.target_type === "tee_time_invite").map((r) => r.target_id))]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  const [{ data: users }, { data: listings }, { data: invites }] = await Promise.all([
    userIds.length
      ? admin
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", userIds)
          .returns<Pick<Profile, "id" | "first_name" | "last_name">[]>()
      : Promise.resolve({ data: [] as Pick<Profile, "id" | "first_name" | "last_name">[] }),
    listingIds.length
      ? admin.from("listings").select("id, title").in("id", listingIds).returns<Pick<Listing, "id" | "title">[]>()
      : Promise.resolve({ data: [] as Pick<Listing, "id" | "title">[] }),
    inviteIds.length
      ? admin
          .from("tee_time_invites")
          .select("id, club_name")
          .in("id", inviteIds)
          .returns<Pick<TeeTimeInvite, "id" | "club_name">[]>()
      : Promise.resolve({ data: [] as Pick<TeeTimeInvite, "id" | "club_name">[] }),
  ]);

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const listingById = new Map((listings ?? []).map((l) => [String(l.id), l]));
  const inviteById = new Map((invites ?? []).map((i) => [String(i.id), i]));

  for (const row of rows) {
    const k = key(row.target_type, row.target_id);
    if (summaries.has(k)) continue;

    if (row.target_type === "user") {
      const u = userById.get(row.target_id);
      summaries.set(
        k,
        u
          ? { type: "user", label: `${u.first_name} ${u.last_name}`.trim(), href: `/admin/users/${row.target_id}` }
          : { type: "user", label: "Member no longer exists", href: null }
      );
    } else if (row.target_type === "listing") {
      const l = listingById.get(row.target_id);
      summaries.set(
        k,
        l
          ? { type: "listing", label: l.title, href: `/admin/listings/${row.target_id}` }
          : { type: "listing", label: `Listing #${row.target_id} no longer exists`, href: null }
      );
    } else if (row.target_type === "tee_time_invite") {
      const i = inviteById.get(row.target_id);
      summaries.set(
        k,
        i
          ? { type: "tee_time_invite", label: i.club_name, href: `/admin/tee-times/${row.target_id}` }
          : { type: "tee_time_invite", label: `Invite #${row.target_id} no longer exists`, href: null }
      );
    } else {
      // message / conversation — deliberately not resolved to a real row or
      // an href here, even though the tables now exist (0025_messaging.sql).
      // See the comment above resolveTargetSummaries() and
      // conversation-access-panel.tsx: content only ever surfaces through
      // that reason-gated, audited panel, never a link from this queue.
      summaries.set(k, {
        type: row.target_type,
        label: `${row.target_type === "message" ? "Message" : "Conversation"} #${row.target_id}`,
        href: null,
      });
    }
  }

  return summaries;
}

/**
 * Paginated, server-side-filtered report list for /admin/reports. Same
 * indexed-search shape as listListings()/listUsers() — see
 * buildReportSearchOrFilter() — rather than a full-table fetch.
 */
export async function listReports(
  query = "",
  filters: AdminReportFilters = {},
  page = 1
): Promise<AdminReportPage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * REPORTS_PAGE_SIZE;
  const rangeTo = rangeFrom + REPORTS_PAGE_SIZE - 1;

  const trimmedQuery = query.trim();
  const term = trimmedQuery ? sanitizeSearchTerm(trimmedQuery) : "";

  // Resolve reporter-name matches against `profiles` before the reports
  // query runs — same two-step shape listListings() uses for seller name;
  // reports has no reporter-name column to search directly.
  let reporterMatchedIds: string[] = [];
  if (term) {
    const pattern = `%${term}%`;
    const { data: matchedProfiles } = await admin
      .from("profiles")
      .select("id")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
      .returns<Pick<Profile, "id">[]>();
    reporterMatchedIds = (matchedProfiles ?? []).map((p) => p.id);
  }

  let reportsQuery = admin
    .from("reports")
    .select("*", { count: "exact" })
    // Stable sort — same reasoning as listAuditLog()/listListings().
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (filters.status) reportsQuery = reportsQuery.eq("status", filters.status);
  if (filters.priority) reportsQuery = reportsQuery.eq("priority", filters.priority);
  if (filters.category) reportsQuery = reportsQuery.eq("category", filters.category);
  if (filters.targetType) reportsQuery = reportsQuery.eq("target_type", filters.targetType);
  if (filters.targetId) reportsQuery = reportsQuery.eq("target_id", filters.targetId);
  if (filters.assignedAdmin === "unassigned") {
    reportsQuery = reportsQuery.is("assigned_admin", null);
  } else if (filters.assignedAdmin) {
    reportsQuery = reportsQuery.eq("assigned_admin", filters.assignedAdmin);
  }

  if (trimmedQuery) {
    const filter = buildReportSearchOrFilter(trimmedQuery, reporterMatchedIds);
    if (filter) reportsQuery = reportsQuery.or(filter);
  }

  const { data, error, count } = await reportsQuery.returns<AdminReport[]>();
  if (error) throw new Error(`Failed to list reports: ${error.message}`);
  const rows = data ?? [];

  const [authUsers, targetSummaries] = await Promise.all([authUserMap(), resolveTargetSummaries(admin, rows)]);

  const peopleIds = [
    ...new Set(rows.flatMap((r) => [r.reporter_id, r.assigned_admin].filter((id): id is string => !!id))),
  ];
  const { data: peopleProfiles } = peopleIds.length
    ? await admin.from("profiles").select("*").in("id", peopleIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((peopleProfiles ?? []).map((p) => [p.id, p]));

  const resultRows: AdminReportListItem[] = rows.map((r) => {
    const reporterProfile = profileById.get(r.reporter_id) ?? null;
    const assignedProfile = r.assigned_admin ? profileById.get(r.assigned_admin) ?? null : null;
    return {
      ...r,
      reporter: reporterProfile ? withEmail(reporterProfile, authUsers) : null,
      assignedStaff: assignedProfile ? withEmail(assignedProfile, authUsers) : null,
      target: targetSummaries.get(`${r.target_type}:${r.target_id}`) ?? {
        type: r.target_type,
        label: `${r.target_type} #${r.target_id}`,
        href: null,
      },
    };
  });

  return { rows: resultRows, total: count ?? 0, page: safePage, pageSize: REPORTS_PAGE_SIZE };
}

// ---------- Report notes ----------
//
// Read side of report_notes (see supabase/migrations/0016_admin_reports.sql).
// The write side (addReportNote()) lives in
// src/app/admin/reports/[id]/actions.ts, same split as
// listUserNotes()/addUserNote().

export type AdminReportNote = {
  id: number;
  report_id: number;
  author_id: string;
  author_role: StaffRole;
  body: string;
  created_at: string;
};

export type AdminReportNoteListItem = AdminReportNote & { author: AdminProfile | null };

/** Every internal note on one report, newest first — scoped by the indexed
 * (report_id, created_at) composite index, never a full-table read. Same
 * shape as listUserNotes(). */
export async function listReportNotes(reportId: number): Promise<AdminReportNoteListItem[]> {
  const admin = createAdminClient();
  const [{ data, error }, authUsers] = await Promise.all([
    admin
      .from("report_notes")
      .select("*")
      .eq("report_id", reportId)
      .order("created_at", { ascending: false })
      .returns<AdminReportNote[]>(),
    authUserMap(),
  ]);
  if (error) throw new Error(`Failed to list report notes: ${error.message}`);

  const authorIds = [...new Set((data ?? []).map((n) => n.author_id))];
  const { data: authorProfiles } = authorIds.length
    ? await admin.from("profiles").select("*").in("id", authorIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const authorById = new Map((authorProfiles ?? []).map((p) => [p.id, p]));

  return (data ?? []).map((note) => {
    const authorProfile = authorById.get(note.author_id) ?? null;
    return { ...note, author: authorProfile ? withEmail(authorProfile, authUsers) : null };
  });
}

export type AdminReportDetail = {
  report: AdminReport;
  reporter: AdminProfile | null;
  assignedStaff: AdminProfile | null;
  resolvedByStaff: AdminProfile | null;
  target: AdminReportTargetSummary;
  notes: AdminReportNoteListItem[];
  /** This target's own recent moderation history (e.g. a listing's
   * hide/restore entries) — powers the resolution form's optional "link to
   * a moderation action" picker, and lets staff see what's already been done
   * to this target without leaving the report. For a message/conversation
   * report this is looked up by target_type/target_id exactly like every
   * other target (both are real AUDIT_TARGET_TYPES entries — see audit.ts),
   * so it shows past conversation.access_viewed/message.hidden/
   * message.restored entries WITHOUT itself revealing any message content —
   * only the audit metadata (actor, reason, timestamp). Empty for targets
   * with no moderation history yet. */
  targetModerationHistory: AdminAuditLogListItem[];
  linkedAction: AdminAuditLogListItem | null;
};

export async function getReportDetail(id: number): Promise<AdminReportDetail | null> {
  const admin = createAdminClient();
  const { data: report, error } = await admin.from("reports").select("*").eq("id", id).maybeSingle<AdminReport>();
  if (error) throw new Error(`Failed to load report: ${error.message}`);
  if (!report) return null;

  const isAuditableTarget = (AUDIT_TARGET_TYPES as readonly string[]).includes(report.target_type);

  const [authUsers, targetSummaries, notes, moderationHistoryResult, linkedActionRowResult] = await Promise.all([
    authUserMap(),
    resolveTargetSummaries(admin, [report]),
    listReportNotes(report.id),
    isAuditableTarget
      ? listAuditLog({ targetType: report.target_type, targetId: report.target_id })
      : Promise.resolve({ rows: [], approxTotal: 0, nextCursor: null, pageSize: AUDIT_LOG_PAGE_SIZE } as AuditLogPage),
    report.linked_action_id
      ? admin
          .from("admin_audit_log")
          .select("*")
          .eq("id", report.linked_action_id)
          .maybeSingle<AdminAuditLogEntry>()
      : Promise.resolve({ data: null as AdminAuditLogEntry | null }),
  ]);

  const peopleIds = [
    ...new Set(
      [report.reporter_id, report.assigned_admin, report.resolved_by, linkedActionRowResult.data?.actor_id].filter(
        (id): id is string => !!id
      )
    ),
  ];
  const { data: peopleProfiles } = peopleIds.length
    ? await admin.from("profiles").select("*").in("id", peopleIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((peopleProfiles ?? []).map((p) => [p.id, p]));

  let linkedAction: AdminAuditLogListItem | null = null;
  if (linkedActionRowResult.data) {
    const actorProfile = profileById.get(linkedActionRowResult.data.actor_id) ?? null;
    linkedAction = { ...linkedActionRowResult.data, actor: actorProfile ? withEmail(actorProfile, authUsers) : null };
  }

  const reporterProfile = profileById.get(report.reporter_id) ?? null;
  const assignedProfile = report.assigned_admin ? profileById.get(report.assigned_admin) ?? null : null;
  const resolvedByProfile = report.resolved_by ? profileById.get(report.resolved_by) ?? null : null;

  return {
    report,
    reporter: reporterProfile ? withEmail(reporterProfile, authUsers) : null,
    assignedStaff: assignedProfile ? withEmail(assignedProfile, authUsers) : null,
    resolvedByStaff: resolvedByProfile ? withEmail(resolvedByProfile, authUsers) : null,
    target: targetSummaries.get(`${report.target_type}:${report.target_id}`) ?? {
      type: report.target_type,
      label: `${report.target_type} #${report.target_id}`,
      href: null,
    },
    notes,
    targetModerationHistory: moderationHistoryResult.rows,
    linkedAction,
  };
}

// ---------- Support cases ----------
//
// /admin/support — see supabase/migrations/0026_support_cases.sql. Same
// real server-side `.range()` pagination + stable sort as listReports()
// above, for the same reason: the queue is expected to grow without bound.
// Unlike reports, EVERY active staff role may work a case (see
// support-cases.ts's file-header comment) — nothing here restricts by role,
// that gate lives entirely in each Server Action's requireStaff() call.

export type AdminSupportCase = {
  id: number;
  requester_id: string;
  subject: string;
  description: string | null;
  category: SupportCaseCategory;
  priority: SupportCasePriority;
  status: SupportCaseStatus;
  assigned_admin: string | null;
  claimed_at: string | null;
  linked_target_type: SupportCaseLinkedTargetType | null;
  linked_target_id: string | null;
  resolution: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
};

/** A short, target-type-appropriate summary for a case's optional linked
 * record — resolved in a single batched lookup per page (see
 * resolveLinkedTargetSummaries()), not a per-row query. `href` is null when
 * there's nowhere to link yet: a conversation target (no messaging system
 * exists — see support-cases.ts) or a target row that no longer exists. */
export type AdminSupportCaseLinkedTargetSummary = {
  type: SupportCaseLinkedTargetType;
  label: string;
  href: string | null;
};

export type AdminSupportCaseListItem = AdminSupportCase & {
  requester: AdminProfile | null;
  assignedStaff: AdminProfile | null;
  linkedTarget: AdminSupportCaseLinkedTargetSummary | null;
};

export type AdminSupportCasePage = {
  rows: AdminSupportCaseListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminSupportCaseFilters = {
  status?: SupportCaseStatus;
  priority?: SupportCasePriority;
  category?: SupportCaseCategory;
  linkedTargetType?: SupportCaseLinkedTargetType;
  /** A single linked record's cases — paired with linkedTargetType (an id
   * alone isn't unique across target types), mirrors reports' targetId. */
  linkedTargetId?: string;
  /** A specific staff user id, or the literal "unassigned" for
   * assigned_admin IS NULL (the queue's default "needs a claim" view). */
  assignedAdmin?: string;
  /** A single member's own cases — for a future "past cases" section on the
   * user detail page; not wired to any page yet in this phase. */
  requesterId?: string;
};

const SUPPORT_CASES_PAGE_SIZE = 20;

/**
 * Builds the `.or()` filter string for listSupportCases()'s free-text
 * search: ILIKE on `subject`/`description` plus a `requester_id.in.(...)`
 * clause for any requester whose name or email matched — same two-step
 * shape buildReportSearchOrFilter() uses for reporter name, extended to
 * email too (see listSupportCases() below) since staff are just as likely
 * to look a case up by the member's email as by their name. Pure and
 * DB-free, exported for unit testing.
 */
export function buildSupportCaseSearchOrFilter(query: string, requesterMatchedIds: string[]): string | null {
  const term = sanitizeSearchTerm(query);
  const clauses: string[] = [];

  if (term) {
    const pattern = `%${term}%`;
    clauses.push(`subject.ilike.${pattern}`, `description.ilike.${pattern}`);
  }

  const validIds = requesterMatchedIds.filter((id) => UUID_RE.test(id));
  if (validIds.length) clauses.push(`requester_id.in.(${validIds.join(",")})`);

  return clauses.length ? clauses.join(",") : null;
}

/**
 * Batch-resolves a page of cases' optional linked target into display
 * summaries without a per-row query — same shape as reports'
 * resolveTargetSummaries(), keyed on (linked_target_type, linked_target_id)
 * instead of (target_type, target_id), and skipping rows with no linked
 * target at all (most cases won't have one). `conversation` deliberately
 * never hits a table, even though one exists (see support-cases.ts) — a
 * support case shouldn't open a second, ungated path into private message
 * content — so it always resolves to a plain, unlinked label built from the
 * case's own fields.
 */
async function resolveLinkedTargetSummaries(
  admin: ReturnType<typeof createAdminClient>,
  rows: { linked_target_type: SupportCaseLinkedTargetType | null; linked_target_id: string | null }[]
): Promise<Map<string, AdminSupportCaseLinkedTargetSummary>> {
  const key = (type: string, id: string) => `${type}:${id}`;
  const summaries = new Map<string, AdminSupportCaseLinkedTargetSummary>();

  const linkedRows = rows.filter(
    (r): r is { linked_target_type: SupportCaseLinkedTargetType; linked_target_id: string } =>
      r.linked_target_type != null && r.linked_target_id != null
  );

  const orderIds = [...new Set(linkedRows.filter((r) => r.linked_target_type === "order").map((r) => r.linked_target_id))]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  const listingIds = [
    ...new Set(linkedRows.filter((r) => r.linked_target_type === "listing").map((r) => r.linked_target_id)),
  ]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  const inviteIds = [
    ...new Set(linkedRows.filter((r) => r.linked_target_type === "tee_time_invite").map((r) => r.linked_target_id)),
  ]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));
  const reportIds = [
    ...new Set(linkedRows.filter((r) => r.linked_target_type === "report").map((r) => r.linked_target_id)),
  ]
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  const [{ data: orders }, { data: listings }, { data: invites }, { data: reports }] = await Promise.all([
    orderIds.length
      ? admin
          .from("orders")
          .select("id, listing_title")
          .in("id", orderIds)
          .returns<Pick<Order, "id" | "listing_title">[]>()
      : Promise.resolve({ data: [] as Pick<Order, "id" | "listing_title">[] }),
    listingIds.length
      ? admin.from("listings").select("id, title").in("id", listingIds).returns<Pick<Listing, "id" | "title">[]>()
      : Promise.resolve({ data: [] as Pick<Listing, "id" | "title">[] }),
    inviteIds.length
      ? admin
          .from("tee_time_invites")
          .select("id, club_name")
          .in("id", inviteIds)
          .returns<Pick<TeeTimeInvite, "id" | "club_name">[]>()
      : Promise.resolve({ data: [] as Pick<TeeTimeInvite, "id" | "club_name">[] }),
    reportIds.length
      ? admin.from("reports").select("id, category").in("id", reportIds).returns<Pick<AdminReport, "id" | "category">[]>()
      : Promise.resolve({ data: [] as Pick<AdminReport, "id" | "category">[] }),
  ]);

  const orderById = new Map((orders ?? []).map((o) => [String(o.id), o]));
  const listingById = new Map((listings ?? []).map((l) => [String(l.id), l]));
  const inviteById = new Map((invites ?? []).map((i) => [String(i.id), i]));
  const reportById = new Map((reports ?? []).map((r) => [String(r.id), r]));

  for (const row of linkedRows) {
    const k = key(row.linked_target_type, row.linked_target_id);
    if (summaries.has(k)) continue;

    if (row.linked_target_type === "order") {
      const o = orderById.get(row.linked_target_id);
      summaries.set(
        k,
        o
          ? { type: "order", label: `Order #${o.id} — ${o.listing_title}`, href: `/admin/orders/${row.linked_target_id}` }
          : { type: "order", label: `Order #${row.linked_target_id} no longer exists`, href: null }
      );
    } else if (row.linked_target_type === "listing") {
      const l = listingById.get(row.linked_target_id);
      summaries.set(
        k,
        l
          ? { type: "listing", label: l.title, href: `/admin/listings/${row.linked_target_id}` }
          : { type: "listing", label: `Listing #${row.linked_target_id} no longer exists`, href: null }
      );
    } else if (row.linked_target_type === "tee_time_invite") {
      const i = inviteById.get(row.linked_target_id);
      summaries.set(
        k,
        i
          ? { type: "tee_time_invite", label: i.club_name, href: `/admin/tee-times/${row.linked_target_id}` }
          : { type: "tee_time_invite", label: `Invite #${row.linked_target_id} no longer exists`, href: null }
      );
    } else if (row.linked_target_type === "report") {
      const r = reportById.get(row.linked_target_id);
      summaries.set(
        k,
        r
          ? { type: "report", label: `Report #${r.id}`, href: `/admin/reports/${row.linked_target_id}` }
          : { type: "report", label: `Report #${row.linked_target_id} no longer exists`, href: null }
      );
    } else {
      // conversation — deliberately not resolved into a link, even though a
      // conversations table exists (0025_messaging.sql): there is no general
      // conversation-browsing admin page, by design (see reports.ts's
      // comment on REPORT_TARGET_TYPES) — message content only ever surfaces
      // through a report's own permission-gated, audited reveal flow.
      summaries.set(k, { type: "conversation", label: `Conversation #${row.linked_target_id}`, href: null });
    }
  }

  return summaries;
}

/**
 * Paginated, server-side-filtered case list for /admin/support. Same
 * indexed-search shape as listReports() — see buildSupportCaseSearchOrFilter()
 * — rather than a full-table fetch.
 */
export async function listSupportCases(
  query = "",
  filters: AdminSupportCaseFilters = {},
  page = 1
): Promise<AdminSupportCasePage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * SUPPORT_CASES_PAGE_SIZE;
  const rangeTo = rangeFrom + SUPPORT_CASES_PAGE_SIZE - 1;

  const trimmedQuery = query.trim();
  const term = trimmedQuery ? sanitizeSearchTerm(trimmedQuery) : "";

  // Resolve requester matches (by name AND email — unlike reports' reporter
  // search, which is name-only) before the cases query runs; support_cases
  // has no name/email column to search directly.
  let requesterMatchedIds: string[] = [];
  if (term || trimmedQuery) {
    const pattern = `%${term}%`;
    const [{ data: matchedProfiles }, authUsers] = await Promise.all([
      term
        ? admin
            .from("profiles")
            .select("id")
            .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
            .returns<Pick<Profile, "id">[]>()
        : Promise.resolve({ data: [] as Pick<Profile, "id">[] }),
      authUserMap(),
    ]);
    const nameMatched = (matchedProfiles ?? []).map((p) => p.id);
    const emailMatched = [...authUsers.entries()]
      .filter(([, info]) => info.email?.toLowerCase().includes(trimmedQuery.toLowerCase()))
      .map(([id]) => id);
    requesterMatchedIds = [...new Set([...nameMatched, ...emailMatched])];
  }

  let casesQuery = admin
    .from("support_cases")
    .select("*", { count: "exact" })
    // Stable sort — same reasoning as listReports()/listAuditLog().
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (filters.status) casesQuery = casesQuery.eq("status", filters.status);
  if (filters.priority) casesQuery = casesQuery.eq("priority", filters.priority);
  if (filters.category) casesQuery = casesQuery.eq("category", filters.category);
  if (filters.linkedTargetType) casesQuery = casesQuery.eq("linked_target_type", filters.linkedTargetType);
  if (filters.linkedTargetId) casesQuery = casesQuery.eq("linked_target_id", filters.linkedTargetId);
  if (filters.requesterId) casesQuery = casesQuery.eq("requester_id", filters.requesterId);
  if (filters.assignedAdmin === "unassigned") {
    casesQuery = casesQuery.is("assigned_admin", null);
  } else if (filters.assignedAdmin) {
    casesQuery = casesQuery.eq("assigned_admin", filters.assignedAdmin);
  }

  if (trimmedQuery) {
    const filter = buildSupportCaseSearchOrFilter(trimmedQuery, requesterMatchedIds);
    if (filter) casesQuery = casesQuery.or(filter);
  }

  const { data, error, count } = await casesQuery.returns<AdminSupportCase[]>();
  if (error) throw new Error(`Failed to list support cases: ${error.message}`);
  const rows = data ?? [];

  const [authUsers, linkedTargetSummaries] = await Promise.all([
    authUserMap(),
    resolveLinkedTargetSummaries(admin, rows),
  ]);

  const peopleIds = [
    ...new Set(rows.flatMap((r) => [r.requester_id, r.assigned_admin].filter((id): id is string => !!id))),
  ];
  const { data: peopleProfiles } = peopleIds.length
    ? await admin.from("profiles").select("*").in("id", peopleIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((peopleProfiles ?? []).map((p) => [p.id, p]));

  const resultRows: AdminSupportCaseListItem[] = rows.map((r) => {
    const requesterProfile = profileById.get(r.requester_id) ?? null;
    const assignedProfile = r.assigned_admin ? profileById.get(r.assigned_admin) ?? null : null;
    const linkedTarget =
      r.linked_target_type && r.linked_target_id
        ? linkedTargetSummaries.get(`${r.linked_target_type}:${r.linked_target_id}`) ?? null
        : null;
    return {
      ...r,
      requester: requesterProfile ? withEmail(requesterProfile, authUsers) : null,
      assignedStaff: assignedProfile ? withEmail(assignedProfile, authUsers) : null,
      linkedTarget,
    };
  });

  return { rows: resultRows, total: count ?? 0, page: safePage, pageSize: SUPPORT_CASES_PAGE_SIZE };
}

/**
 * Resolves the "member" field on the /admin/support/new form: a raw uuid is
 * used as-is (the shape a future "open a case for this member" link from
 * /admin/users/[id] would arrive in); anything else is matched against name
 * (indexed ilike, same as listUsers()) and email (the Auth roster, same as
 * listUsers()'s search) and returned as candidates — the caller (the
 * createCase Server Action) requires exactly one match and shows a
 * disambiguation error otherwise, never guesses.
 */
async function findProfileCandidatesByQuery(raw: string): Promise<AdminProfile[]> {
  const admin = createAdminClient();
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const authUsers = await authUserMap();

  if (UUID_RE.test(trimmed)) {
    const { data } = await admin.from("profiles").select("*").eq("id", trimmed).returns<Profile[]>();
    return (data ?? []).map((p) => withEmail(p, authUsers));
  }

  const term = sanitizeSearchTerm(trimmed);
  const emailMatchedIds = [...authUsers.entries()]
    .filter(([, info]) => info.email?.toLowerCase().includes(trimmed.toLowerCase()))
    .map(([id]) => id);

  const orClauses: string[] = [];
  if (term) {
    const pattern = `%${term}%`;
    orClauses.push(`first_name.ilike.${pattern}`, `last_name.ilike.${pattern}`);
  }
  if (emailMatchedIds.length) orClauses.push(`id.in.(${emailMatchedIds.join(",")})`);
  if (!orClauses.length) return [];

  const { data } = await admin.from("profiles").select("*").or(orClauses.join(",")).returns<Profile[]>();
  return (data ?? []).map((p) => withEmail(p, authUsers));
}

export async function findSupportCaseRequesterCandidates(raw: string): Promise<AdminProfile[]> {
  return findProfileCandidatesByQuery(raw);
}

/**
 * Resolves the "member" field on /admin/staff's "Grant staff access" form —
 * same email-then-name lookup as findSupportCaseRequesterCandidates() above
 * (both now share findProfileCandidatesByQuery() so the two never drift
 * apart), because granting staff access is exactly the same kind of
 * "resolve a raw client-supplied identity string to a real, existing member"
 * problem: the caller (grantStaffRole() in src/app/admin/staff/actions.ts)
 * must require exactly one match, never guess, and never create a
 * staff_roles row for anyone who isn't already an established member.
 */
export async function findStaffGrantCandidates(raw: string): Promise<AdminProfile[]> {
  return findProfileCandidatesByQuery(raw);
}

// ---------- Support case notes ----------
//
// Read side of support_case_notes (see supabase/migrations/0026_support_cases.sql).
// The write side (addCaseNote()) lives in src/app/admin/support/[id]/actions.ts,
// same split as listReportNotes()/addReportNote().

export type AdminSupportCaseNote = {
  id: number;
  case_id: number;
  author_id: string;
  author_role: StaffRole;
  body: string;
  created_at: string;
};

export type AdminSupportCaseNoteListItem = AdminSupportCaseNote & { author: AdminProfile | null };

/** Every internal note on one case, newest first — scoped by the indexed
 * (case_id, created_at) composite index, never a full-table read. Same
 * shape as listReportNotes(). */
export async function listSupportCaseNotes(caseId: number): Promise<AdminSupportCaseNoteListItem[]> {
  const admin = createAdminClient();
  const [{ data, error }, authUsers] = await Promise.all([
    admin
      .from("support_case_notes")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .returns<AdminSupportCaseNote[]>(),
    authUserMap(),
  ]);
  if (error) throw new Error(`Failed to list support case notes: ${error.message}`);

  const authorIds = [...new Set((data ?? []).map((n) => n.author_id))];
  const { data: authorProfiles } = authorIds.length
    ? await admin.from("profiles").select("*").in("id", authorIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const authorById = new Map((authorProfiles ?? []).map((p) => [p.id, p]));

  return (data ?? []).map((note) => {
    const authorProfile = authorById.get(note.author_id) ?? null;
    return { ...note, author: authorProfile ? withEmail(authorProfile, authUsers) : null };
  });
}

// ---------- Support case linked actions ----------
//
// Read side of support_case_linked_actions — a pure pointer table from a
// case to an existing, already-authorized admin_audit_log row (see the
// migration's file-header comment). The write side (linkCaseAction()) lives
// in src/app/admin/support/[id]/actions.ts.

export type AdminSupportCaseLinkedAction = {
  id: number;
  case_id: number;
  audit_log_id: number;
  linked_by: string;
  note: string | null;
  created_at: string;
};

export type AdminSupportCaseLinkedActionListItem = AdminSupportCaseLinkedAction & {
  linkedByStaff: AdminProfile | null;
  /** The actual admin_audit_log row this points at — null only if that row
   * somehow no longer exists (audit_log_id has no ON DELETE CASCADE, since
   * audit history is never deleted, but the type stays defensive). */
  auditEntry: AdminAuditLogListItem | null;
};

export async function listSupportCaseLinkedActions(caseId: number): Promise<AdminSupportCaseLinkedActionListItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_case_linked_actions")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .returns<AdminSupportCaseLinkedAction[]>();
  if (error) throw new Error(`Failed to list support case linked actions: ${error.message}`);
  const links = data ?? [];
  if (links.length === 0) return [];

  const auditLogIds = [...new Set(links.map((l) => l.audit_log_id))];
  const [{ data: auditRows }, authUsers] = await Promise.all([
    admin.from("admin_audit_log").select("*").in("id", auditLogIds).returns<AdminAuditLogEntry[]>(),
    authUserMap(),
  ]);

  const peopleIds = [...new Set([...links.map((l) => l.linked_by), ...(auditRows ?? []).map((a) => a.actor_id)])];
  const { data: peopleProfiles } = peopleIds.length
    ? await admin.from("profiles").select("*").in("id", peopleIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((peopleProfiles ?? []).map((p) => [p.id, p]));
  const auditById = new Map((auditRows ?? []).map((a) => [a.id, a]));

  return links.map((link) => {
    const linkedByProfile = profileById.get(link.linked_by) ?? null;
    const auditRow = auditById.get(link.audit_log_id) ?? null;
    const actorProfile = auditRow ? profileById.get(auditRow.actor_id) ?? null : null;
    return {
      ...link,
      linkedByStaff: linkedByProfile ? withEmail(linkedByProfile, authUsers) : null,
      auditEntry: auditRow ? { ...auditRow, actor: actorProfile ? withEmail(actorProfile, authUsers) : null } : null,
    };
  });
}

export type AdminSupportCaseDetail = {
  case: AdminSupportCase;
  requester: AdminProfile | null;
  assignedStaff: AdminProfile | null;
  resolvedByStaff: AdminProfile | null;
  linkedTarget: AdminSupportCaseLinkedTargetSummary | null;
  notes: AdminSupportCaseNoteListItem[];
  linkedActions: AdminSupportCaseLinkedActionListItem[];
  /** This case's own event timeline: every support_case.* admin_audit_log
   * entry recorded against it (created, claimed, status/priority changed,
   * resolved, closed, reopened, note added, action linked), oldest first so
   * it reads top-to-bottom like a real timeline. Reuses listAuditLog()
   * rather than a second, parallel history table — see the migration's
   * file-header comment. Bounded to AUDIT_LOG_PAGE_SIZE (50), same as
   * getListingDetail()'s moderationHistory — plenty for one case's history. */
  timeline: AdminAuditLogListItem[];
  /** The requester's own account moderation history (suspend/reinstate/
   * note_added, etc.) — powers the "link an action to this case" picker's
   * account-side candidates, and lets staff see what's already been done to
   * this member without leaving the case. linkCaseAction() re-verifies any
   * submitted id belongs here (or to linkedTargetHistory below) server-side,
   * never trusting the form alone — same discipline as resolveReport()'s
   * linkedActionId check. */
  requesterAccountHistory: AdminAuditLogListItem[];
  /** This case's own linked target's moderation/action history (e.g. an
   * order's refund history) — empty when the case has no linked target, or
   * the target type isn't an auditable one (conversation isn't — see
   * AUDIT_TARGET_TYPES). The other half of the link-action picker's
   * candidates. */
  linkedTargetHistory: AdminAuditLogListItem[];
};

export async function getSupportCaseDetail(id: number): Promise<AdminSupportCaseDetail | null> {
  const admin = createAdminClient();
  const { data: caseRow, error } = await admin
    .from("support_cases")
    .select("*")
    .eq("id", id)
    .maybeSingle<AdminSupportCase>();
  if (error) throw new Error(`Failed to load support case: ${error.message}`);
  if (!caseRow) return null;

  const isAuditableLinkedTarget =
    caseRow.linked_target_type != null &&
    (AUDIT_TARGET_TYPES as readonly string[]).includes(caseRow.linked_target_type);

  const [authUsers, linkedTargetSummaries, notes, linkedActions, timelinePage, requesterHistoryPage, linkedTargetHistoryPage] =
    await Promise.all([
      authUserMap(),
      resolveLinkedTargetSummaries(admin, [caseRow]),
      listSupportCaseNotes(caseRow.id),
      listSupportCaseLinkedActions(caseRow.id),
      listAuditLog({ targetType: "support_case", targetId: String(caseRow.id) }),
      listAuditLog({ targetType: "user", targetId: caseRow.requester_id }),
      isAuditableLinkedTarget
        ? listAuditLog({ targetType: caseRow.linked_target_type!, targetId: caseRow.linked_target_id! })
        : Promise.resolve({ rows: [], approxTotal: 0, nextCursor: null, pageSize: AUDIT_LOG_PAGE_SIZE } as AuditLogPage),
    ]);

  const peopleIds = [
    ...new Set(
      [caseRow.requester_id, caseRow.assigned_admin, caseRow.resolved_by].filter((id): id is string => !!id)
    ),
  ];
  const { data: peopleProfiles } = peopleIds.length
    ? await admin.from("profiles").select("*").in("id", peopleIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((peopleProfiles ?? []).map((p) => [p.id, p]));

  const requesterProfile = profileById.get(caseRow.requester_id) ?? null;
  const assignedProfile = caseRow.assigned_admin ? profileById.get(caseRow.assigned_admin) ?? null : null;
  const resolvedByProfile = caseRow.resolved_by ? profileById.get(caseRow.resolved_by) ?? null : null;

  return {
    case: caseRow,
    requester: requesterProfile ? withEmail(requesterProfile, authUsers) : null,
    assignedStaff: assignedProfile ? withEmail(assignedProfile, authUsers) : null,
    resolvedByStaff: resolvedByProfile ? withEmail(resolvedByProfile, authUsers) : null,
    linkedTarget:
      caseRow.linked_target_type && caseRow.linked_target_id
        ? linkedTargetSummaries.get(`${caseRow.linked_target_type}:${caseRow.linked_target_id}`) ?? null
        : null,
    notes,
    linkedActions,
    timeline: [...timelinePage.rows].reverse(),
    requesterAccountHistory: requesterHistoryPage.rows,
    linkedTargetHistory: linkedTargetHistoryPage.rows,
  };
}

// ---------- Orders ----------
//
// /admin/orders — see supabase/migrations/0019_orders.sql. Read-only this
// phase (no claim/resolve/note actions like reports have — the task this
// shipped under is explicit: "Do not implement ad-hoc money movement in the
// admin UI in this phase"), so this section is only listOrders()/
// getOrderDetail(), the same shape as listListings()/getListingDetail()
// before Phase 3 added listing moderation actions.

export type AdminOrderListItem = Order & { buyer: AdminProfile | null; seller: AdminProfile | null };

export type AdminOrderPage = {
  rows: AdminOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
};

/** Everything /admin/orders can filter on. `buyer`/`seller` each accept
 * either a profile id directly (the shape a link from /admin/users/[id]
 * arrives in) or free-text to match against that person's name — resolved
 * in listOrders() below, same two-step shape listListings() uses for its
 * seller-name search. `orderId` is an exact primary-key match, not a search
 * term. `from`/`to` are ISO timestamps, inclusive bounds on created_at. */
export type AdminOrderFilters = {
  orderId?: number;
  buyer?: string;
  seller?: string;
  status?: string;
  paymentStatus?: string;
  from?: string;
  to?: string;
};

const ORDERS_PAGE_SIZE = 20;

/**
 * Resolves a buyer/seller filter box's raw input into the profile ids to
 * match against buyer_id/seller_id — a well-formed uuid is used as-is,
 * anything else is treated as a name and looked up against `profiles`
 * (indexed — see 0012_profiles_search_indexes.sql). Returns `{ ids: null }`
 * for an empty/blank filter (meaning "don't filter on this at all") versus
 * `{ ids: [] }` for a name that matched nobody (meaning "filter to zero
 * rows") — listOrders() below relies on that distinction.
 */
async function resolvePersonFilter(
  admin: ReturnType<typeof createAdminClient>,
  raw: string | undefined
): Promise<{ ids: string[] | null }> {
  if (!raw || !raw.trim()) return { ids: null };
  if (UUID_RE.test(raw.trim())) return { ids: [raw.trim()] };

  const term = sanitizeSearchTerm(raw);
  if (!term) return { ids: null };

  const pattern = `%${term}%`;
  const { data } = await admin
    .from("profiles")
    .select("id")
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
    .returns<Pick<Profile, "id">[]>();
  return { ids: (data ?? []).map((p) => p.id) };
}

/**
 * Paginated, server-side-filtered order list for /admin/orders. Same
 * `.range()` + stable `(created_at desc, id desc)` sort as every other list
 * in this file — see listListings()'s file-header comment for why that
 * matters once a table grows past one page.
 */
export async function listOrders(filters: AdminOrderFilters = {}, page = 1): Promise<AdminOrderPage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * ORDERS_PAGE_SIZE;
  const rangeTo = rangeFrom + ORDERS_PAGE_SIZE - 1;

  const [{ ids: buyerIds }, { ids: sellerIds }] = await Promise.all([
    resolvePersonFilter(admin, filters.buyer),
    resolvePersonFilter(admin, filters.seller),
  ]);

  // A name that matched no profile at all means the filter should return
  // zero orders, not "no filter" — short-circuit rather than let an empty
  // `.in()` list silently match everything.
  if ((filters.buyer && buyerIds?.length === 0) || (filters.seller && sellerIds?.length === 0)) {
    return { rows: [], total: 0, page: safePage, pageSize: ORDERS_PAGE_SIZE };
  }

  let query = admin
    .from("orders")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (filters.orderId) query = query.eq("id", filters.orderId);
  if (buyerIds) query = query.in("buyer_id", buyerIds);
  if (sellerIds) query = query.in("seller_id", sellerIds);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.paymentStatus) query = query.eq("payment_status", filters.paymentStatus);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);

  const { data: orders, error, count } = await query.returns<Order[]>();
  if (error) throw new Error(`Failed to list orders: ${error.message}`);

  const authUsers = await authUserMap();
  const peopleIds = [...new Set((orders ?? []).flatMap((o) => [o.buyer_id, o.seller_id]))];
  const { data: profiles } = peopleIds.length
    ? await admin.from("profiles").select("*").in("id", peopleIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const rows = (orders ?? []).map((order) => {
    const buyerProfile = profileById.get(order.buyer_id) ?? null;
    const sellerProfile = profileById.get(order.seller_id) ?? null;
    return {
      ...order,
      buyer: buyerProfile ? withEmail(buyerProfile, authUsers) : null,
      seller: sellerProfile ? withEmail(sellerProfile, authUsers) : null,
    };
  });

  return { rows, total: count ?? 0, page: safePage, pageSize: ORDERS_PAGE_SIZE };
}

export type AdminOrderDetail = {
  order: Order;
  buyer: AdminProfile | null;
  seller: AdminProfile | null;
  /** The listing this order snapshotted from, if it still exists — a
   * drill-through link only. The order's own listing_title/category/
   * condition/image_url fields (the snapshot) are what the detail page
   * actually renders as "the item", never this. */
  listing: Listing | null;
  /** The originating offer, if it still exists — drill-through only, same
   * reasoning as `listing` above. */
  offer: Offer | null;
  /** Any admin_audit_log entries against this order (target_type "order")
   * — includes refund.requested/completed/failed entries as of this phase
   * (src/app/admin/orders/[id]/actions.ts), same forward-looking section
   * shape as getListingDetail()'s moderationHistory. */
  history: AdminAuditLogListItem[];
  /** Every refund ATTEMPT against this order, most recent first — see
   * supabase/migrations/0023_refunds_and_disputes.sql. Distinct from
   * order.refund_reason/refunded_amount_eur/refunded_at, which stay as the
   * order's own aggregate summary maintained by the pre-existing
   * charge.refunded webhook path. */
  refunds: Refund[];
  /** Every Stripe dispute/chargeback linked to this order, most recent
   * first — visibility only, per the task ("links/references rather than
   * attempting to replicate all Stripe dispute tooling"). */
  disputes: Dispute[];
  /** The payout this order's transfer was swept into, once reconciled (see
   * supabase/migrations/0024_payouts.sql) — drill-through only, same
   * reasoning as `listing`/`offer` above. Null until reconciliation runs, or
   * for any order that predates Phase 12. */
  payout: Payout | null;
};

export async function getOrderDetail(id: number): Promise<AdminOrderDetail | null> {
  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (error) throw new Error(`Failed to load order: ${error.message}`);
  if (!order) return null;

  const [authUsers, { data: profiles }, { data: listing }, { data: offer }, historyResult, { data: refunds }, { data: disputes }, { data: payout }] =
    await Promise.all([
      authUserMap(),
      admin.from("profiles").select("*").in("id", [order.buyer_id, order.seller_id]).returns<Profile[]>(),
      order.listing_id
        ? admin.from("listings").select("*").eq("id", order.listing_id).maybeSingle<Listing>()
        : Promise.resolve({ data: null as Listing | null }),
      order.offer_id
        ? admin.from("offers").select("*").eq("id", order.offer_id).maybeSingle<Offer>()
        : Promise.resolve({ data: null as Offer | null }),
      listAuditLog({ targetType: "order", targetId: String(id) }),
      admin.from("refunds").select("*").eq("order_id", id).order("created_at", { ascending: false }).returns<Refund[]>(),
      admin.from("disputes").select("*").eq("order_id", id).order("created_at", { ascending: false }).returns<Dispute[]>(),
      order.payout_id
        ? admin.from("payouts").select("*").eq("id", order.payout_id).maybeSingle<Payout>()
        : Promise.resolve({ data: null as Payout | null }),
    ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const buyerProfile = profileById.get(order.buyer_id) ?? null;
  const sellerProfile = profileById.get(order.seller_id) ?? null;

  return {
    order,
    buyer: buyerProfile ? withEmail(buyerProfile, authUsers) : null,
    seller: sellerProfile ? withEmail(sellerProfile, authUsers) : null,
    listing: listing ?? null,
    offer: offer ?? null,
    history: historyResult.rows,
    refunds: refunds ?? [],
    disputes: disputes ?? [],
    payout: payout ?? null,
  };
}

// ---------- Seller connected accounts (Stripe Connect) ----------
//
// /admin/payouts — see supabase/migrations/0020_stripe_connected_accounts.sql.
// Same read-only list + detail shape as Orders above, plus one audited
// action this file doesn't define: refreshSellerAccountStatus() in
// src/app/admin/payouts/[id]/actions.ts, which calls recordAdminAction()
// itself, same split as every other admin mutation.

export type AdminSellerAccountListItem = StripeConnectedAccount & { seller: AdminProfile | null };

export type AdminSellerAccountPage = {
  rows: AdminSellerAccountListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminSellerAccountFilters = {
  /** Same two-step name-or-uuid resolution as orders' buyer/seller filters
   * — see resolvePersonFilter() above. */
  seller?: string;
  /** "Needs attention" = payouts_enabled is false. This deliberately doesn't
   * also check requirements_past_due directly (that would need an array
   * `<> '{}'` filter PostgREST doesn't have a clean operator for) — in
   * practice Stripe disables payouts on an account once its requirements go
   * past due, so payouts_enabled=false already captures that case. Good
   * enough for a quick admin filter at this table's scale; a
   * finance-critical query would want to check the array directly. */
  needsAttention?: boolean;
};

const SELLER_ACCOUNTS_PAGE_SIZE = 20;

/**
 * Paginated, server-side-filtered seller connected-account list for
 * /admin/payouts. Same `.range()` + stable sort shape as every other list in
 * this file, sorted by most-recently-synced first (stripe_connected_accounts_
 * updated_at_idx) rather than created_at, since "what changed recently on
 * Stripe's side" is the more useful default order for this table.
 */
export async function listSellerAccounts(
  filters: AdminSellerAccountFilters = {},
  page = 1
): Promise<AdminSellerAccountPage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * SELLER_ACCOUNTS_PAGE_SIZE;
  const rangeTo = rangeFrom + SELLER_ACCOUNTS_PAGE_SIZE - 1;

  const { ids: sellerIds } = await resolvePersonFilter(admin, filters.seller);
  if (filters.seller && sellerIds?.length === 0) {
    return { rows: [], total: 0, page: safePage, pageSize: SELLER_ACCOUNTS_PAGE_SIZE };
  }

  let query = admin
    .from("stripe_connected_accounts")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (sellerIds) query = query.in("user_id", sellerIds);
  if (filters.needsAttention) query = query.eq("payouts_enabled", false);

  const { data: accounts, error, count } = await query.returns<StripeConnectedAccount[]>();
  if (error) throw new Error(`Failed to list seller connected accounts: ${error.message}`);

  const authUsers = await authUserMap();
  const sellerProfileIds = [...new Set((accounts ?? []).map((a) => a.user_id))];
  const { data: profiles } = sellerProfileIds.length
    ? await admin.from("profiles").select("*").in("id", sellerProfileIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const rows = (accounts ?? []).map((account) => {
    const sellerProfile = profileById.get(account.user_id) ?? null;
    return { ...account, seller: sellerProfile ? withEmail(sellerProfile, authUsers) : null };
  });

  return { rows, total: count ?? 0, page: safePage, pageSize: SELLER_ACCOUNTS_PAGE_SIZE };
}

export type AdminSellerAccountDetail = {
  account: StripeConnectedAccount;
  seller: AdminProfile | null;
  /** admin_audit_log entries against this account (target_type
   * "seller_account") — populated once an admin has clicked "Refresh from
   * Stripe" at least once. */
  history: AdminAuditLogListItem[];
};

/**
 * Looked up by Pinpals user_id, not the connected-account row's own bigint
 * id — the migration's unique(user_id) constraint makes that a safe 1:1
 * lookup, and it means a link from /admin/users/[id] (which only knows the
 * user id) doesn't need to look up an unrelated internal id first.
 */
export async function getSellerAccountDetail(userId: string): Promise<AdminSellerAccountDetail | null> {
  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("stripe_connected_accounts")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<StripeConnectedAccount>();
  if (error) throw new Error(`Failed to load seller connected account: ${error.message}`);
  if (!account) return null;

  const [authUsers, { data: profile }, historyResult] = await Promise.all([
    authUserMap(),
    admin.from("profiles").select("*").eq("id", userId).maybeSingle<Profile>(),
    listAuditLog({ targetType: "seller_account", targetId: String(account.id) }),
  ]);

  return {
    account,
    seller: profile ? withEmail(profile, authUsers) : null,
    history: historyResult.rows,
  };
}

// ---------- Webhook events ----------
//
// /admin/webhook-events — see supabase/migrations/0021_payments.sql. Same
// read-only list + detail shape as Orders/Payouts above, plus one audited
// action this file doesn't define: retryFailedWebhookEvent() in
// src/app/admin/webhook-events/[id]/actions.ts, which calls
// recordAdminAction() itself, same split as every other admin mutation.

// Every column except `payload` — that's the verified, full Stripe event
// body (arbitrary nested JSON, can run to tens of KB per row for a rich
// event like an invoice or a charge with expanded objects). The list view
// never renders it (see /admin/webhook-events/page.tsx), so there's no
// reason to pull 20 rows' worth of full event payloads on every page load;
// getWebhookEventDetail() below still selects "*" for the one row an admin
// actually opens.
export type AdminWebhookEventListItem = Omit<WebhookEvent, "payload">;

export type AdminWebhookEventPage = {
  rows: AdminWebhookEventListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminWebhookEventFilters = {
  status?: string;
  eventType?: string;
  orderId?: number;
};

const WEBHOOK_EVENTS_PAGE_SIZE = 20;

const WEBHOOK_EVENT_LIST_COLUMNS =
  "id, provider, event_id, event_type, api_version, status, attempts, last_error, related_order_id, received_at, processed_at, created_at, updated_at";

/**
 * Paginated, server-side-filtered webhook event list for
 * /admin/webhook-events. Same `.range()` + stable sort shape as every other
 * list in this file — default sort is most-recently-received first, since
 * "what just came in / what's failing right now" is what this queue is for.
 */
export async function listWebhookEvents(
  filters: AdminWebhookEventFilters = {},
  page = 1
): Promise<AdminWebhookEventPage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * WEBHOOK_EVENTS_PAGE_SIZE;
  const rangeTo = rangeFrom + WEBHOOK_EVENTS_PAGE_SIZE - 1;

  let query = admin
    .from("webhook_events")
    .select(WEBHOOK_EVENT_LIST_COLUMNS, { count: "exact" })
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.eventType) query = query.eq("event_type", filters.eventType);
  if (filters.orderId) query = query.eq("related_order_id", filters.orderId);

  const { data, error, count } = await query.returns<AdminWebhookEventListItem[]>();
  if (error) throw new Error(`Failed to list webhook events: ${error.message}`);

  return { rows: data ?? [], total: count ?? 0, page: safePage, pageSize: WEBHOOK_EVENTS_PAGE_SIZE };
}

/**
 * Distinct event types seen so far, for the list page's filter dropdown.
 * Calls the `admin_distinct_webhook_event_types()` SQL function (see
 * 0030_webhook_event_types_rpc.sql) rather than `select("event_type")` over
 * every row: webhook_events grows with every Stripe event this app ever
 * receives, so "fetch every row just to dedupe one column in JS" would have
 * become a full-table transfer at scale. The DISTINCT now runs inside
 * Postgres, backed by webhook_events_event_type_idx (same migration).
 */
export async function listWebhookEventTypes(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_distinct_webhook_event_types");
  if (error) throw new Error(`Failed to list webhook event types: ${error.message}`);
  return ((data as { event_type: string }[] | null) ?? []).map((row) => row.event_type);
}

export type AdminWebhookEventDetail = {
  event: WebhookEvent;
  /** The order this event was matched to, if any — a drill-through link
   * only, same reasoning as AdminOrderDetail.listing/offer. */
  relatedOrder: Order | null;
  /** Any admin_audit_log entries against this event (target_type
   * "webhook_event") — populated once an admin has clicked "Retry" at least
   * once. */
  history: AdminAuditLogListItem[];
};

export async function getWebhookEventDetail(id: number): Promise<AdminWebhookEventDetail | null> {
  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from("webhook_events")
    .select("*")
    .eq("id", id)
    .maybeSingle<WebhookEvent>();
  if (error) throw new Error(`Failed to load webhook event: ${error.message}`);
  if (!event) return null;

  const [{ data: relatedOrder }, historyResult] = await Promise.all([
    event.related_order_id
      ? admin.from("orders").select("*").eq("id", event.related_order_id).maybeSingle<Order>()
      : Promise.resolve({ data: null as Order | null }),
    listAuditLog({ targetType: "webhook_event", targetId: String(id) }),
  ]);

  return {
    event,
    relatedOrder: relatedOrder ?? null,
    history: historyResult.rows,
  };
}

// ---------- Payouts (finance ledger + reconciliation) ----------
//
// /admin/payouts/ledger — see supabase/migrations/0024_payouts.sql. Deliberately
// a separate route/section from /admin/payouts above: that page (Phase 9) is
// a seller's Connect ONBOARDING-readiness list (has the account finished
// signing up, are payouts_enabled) — this is the actual MONEY ledger, tracing
// order -> payment -> fee -> transfer -> payout. Same read-only list +
// detail shape as every other section in this file, plus three audited
// actions this file doesn't define — syncPayoutsForSeller(),
// holdPayoutOrders(), releasePayoutOrders() — all in
// src/app/admin/payouts/ledger/[id]/actions.ts, each calling
// recordAdminAction() itself, same split as every other admin mutation.

export type AdminPayoutListItem = Payout & { seller: AdminProfile | null };

export type AdminPayoutPage = {
  rows: AdminPayoutListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type AdminPayoutFilters = {
  /** Same two-step name-or-uuid resolution as orders'/seller-accounts' own
   * seller filters — see resolvePersonFilter() above. */
  seller?: string;
  status?: Payout["status"];
  /** The "failed & blocked" actionable queue — status in (failed, canceled),
   * same reasoning as BLOCKED_PAYOUT_STATUSES in src/lib/admin/format.ts
   * (not imported directly here to keep this file's only dependency on
   * @/lib/types, matching every other filter type in it). */
  blockedOnly?: boolean;
};

const PAYOUTS_PAGE_SIZE = 20;

/**
 * Paginated, server-side-filtered payout list for /admin/payouts/ledger.
 * Same `.range()` + stable sort shape as every other list in this file,
 * sorted by stripe_created_at (when Stripe itself created the payout, the
 * business-meaningful ordering — see the migration) rather than this app's
 * own created_at, which can lag behind on a backfilled sync.
 */
export async function listPayouts(filters: AdminPayoutFilters = {}, page = 1): Promise<AdminPayoutPage> {
  const admin = createAdminClient();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * PAYOUTS_PAGE_SIZE;
  const rangeTo = rangeFrom + PAYOUTS_PAGE_SIZE - 1;

  const { ids: sellerIds } = await resolvePersonFilter(admin, filters.seller);
  if (filters.seller && sellerIds?.length === 0) {
    return { rows: [], total: 0, page: safePage, pageSize: PAYOUTS_PAGE_SIZE };
  }

  let query = admin
    .from("payouts")
    .select("*", { count: "exact" })
    .order("stripe_created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (sellerIds) query = query.in("user_id", sellerIds);
  if (filters.blockedOnly) {
    query = query.in("status", ["failed", "canceled"]);
  } else if (filters.status) {
    query = query.eq("status", filters.status);
  }

  const { data: payouts, error, count } = await query.returns<Payout[]>();
  if (error) throw new Error(`Failed to list payouts: ${error.message}`);

  const authUsers = await authUserMap();
  const sellerProfileIds = [...new Set((payouts ?? []).map((p) => p.user_id))];
  const { data: profiles } = sellerProfileIds.length
    ? await admin.from("profiles").select("*").in("id", sellerProfileIds).returns<Profile[]>()
    : { data: [] as Profile[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const rows = (payouts ?? []).map((payout) => {
    const sellerProfile = profileById.get(payout.user_id) ?? null;
    return { ...payout, seller: sellerProfile ? withEmail(sellerProfile, authUsers) : null };
  });

  return { rows, total: count ?? 0, page: safePage, pageSize: PAYOUTS_PAGE_SIZE };
}

export type AdminPayoutDetail = {
  payout: Payout;
  seller: AdminProfile | null;
  /** Every order this payout has been reconciled against so far (via
   * orders.payout_id, 0024) — the "order -> payment -> fee -> transfer ->
   * payout status" trace the task requires, most recent order first. Can be
   * empty for a payout still pending/in_transit (reconciliation only runs
   * once a payout reaches a terminal state — see reconcilePayoutTransfers()
   * in src/lib/stripe/payouts.ts) or one Stripe reports zero transfers for. */
  orders: Order[];
  /** admin_audit_log entries against this payout (target_type "payout") —
   * sync clicks plus any hold/release actions taken on it. */
  history: AdminAuditLogListItem[];
};

export async function getPayoutDetail(id: number): Promise<AdminPayoutDetail | null> {
  const admin = createAdminClient();
  const { data: payout, error } = await admin.from("payouts").select("*").eq("id", id).maybeSingle<Payout>();
  if (error) throw new Error(`Failed to load payout: ${error.message}`);
  if (!payout) return null;

  const [authUsers, { data: profile }, { data: orders }, historyResult] = await Promise.all([
    authUserMap(),
    admin.from("profiles").select("*").eq("id", payout.user_id).maybeSingle<Profile>(),
    admin
      .from("orders")
      .select("*")
      .eq("payout_id", id)
      .order("created_at", { ascending: false })
      .returns<Order[]>(),
    listAuditLog({ targetType: "payout", targetId: String(id) }),
  ]);

  return {
    payout,
    seller: profile ? withEmail(profile, authUsers) : null,
    orders: orders ?? [],
    history: historyResult.rows,
  };
}

// ---------- Staff (governance) ----------
//
// /admin/staff — read side of staff_roles (see
// supabase/migrations/0007_staff_roles.sql and
// supabase/migrations/0027_staff_roles_lockdown.sql). The write side lives in
// src/app/admin/staff/actions.ts, gated to super_admin only (see
// admin-architecture-review.md §6) — nothing here enforces that; it's a
// read-only query file, same discipline as every other section above.

type StaffRoleRow = {
  id: number;
  user_id: string;
  role: StaffRole;
  status: StaffStatus;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type AdminStaffMember = StaffRoleRow & {
  /** The staff member themselves — their profile/email, same shape used
   * everywhere else in the admin console. */
  member: AdminProfile | null;
  /** Who granted this row, if known — 0007's own manual-SQL bootstrap rows
   * predate this feature and have a null created_by, so this is nullable
   * even though every row created through /admin/staff from here on will
   * always have one. */
  grantedBy: AdminProfile | null;
};

// super_admin sorts first, since that's the row a reviewer of this page most
// needs to double check; a fixed rank (not "most recently changed") keeps
// the list from reordering itself between renders of the same data.
const STAFF_ROLE_RANK: Record<StaffRole, number> = {
  super_admin: 0,
  admin: 1,
  finance: 2,
  moderator: 3,
  support: 4,
};

/** Every staff_roles row — active and disabled alike, so a super_admin can
 * see the whole roster in one place, not just who currently has access. The
 * staff table is tiny (a handful of rows, same scale note as
 * listTeeTimeInvites() above) so this reads it in full rather than paging. */
export async function listStaffMembers(): Promise<AdminStaffMember[]> {
  const admin = createAdminClient();
  const [{ data: rows, error }, authUsers] = await Promise.all([
    admin.from("staff_roles").select("*").returns<StaffRoleRow[]>(),
    authUserMap(),
  ]);
  if (error) throw new Error(`Failed to list staff roles: ${error.message}`);

  const staffRows = rows ?? [];
  if (staffRows.length === 0) return [];

  const profileIds = [
    ...new Set(staffRows.flatMap((r) => [r.user_id, r.created_by].filter((id): id is string => Boolean(id)))),
  ];
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("*")
    .in("id", profileIds)
    .returns<Profile[]>();
  if (profilesError) throw new Error(`Failed to load staff profiles: ${profilesError.message}`);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, withEmail(p, authUsers)]));

  return staffRows
    .map((row) => ({
      ...row,
      member: profileMap.get(row.user_id) ?? null,
      grantedBy: row.created_by ? (profileMap.get(row.created_by) ?? null) : null,
    }))
    .sort((a, b) => {
      const rankDiff = STAFF_ROLE_RANK[a.role] - STAFF_ROLE_RANK[b.role];
      if (rankDiff !== 0) return rankDiff;
      const nameA = a.member ? `${a.member.first_name} ${a.member.last_name}` : "";
      const nameB = b.member ? `${b.member.first_name} ${b.member.last_name}` : "";
      return nameA.localeCompare(nameB);
    });
}
