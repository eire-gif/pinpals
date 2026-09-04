import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  Dispute,
  Listing,
  Offer,
  Order,
  Profile,
  Refund,
  StripeConnectedAccount,
  TeeTimeInterest,
  TeeTimeInvite,
  WebhookEvent,
} from "@/lib/types";
import type { StaffRole } from "./roles";
import type { ReportCategory, ReportPriority, ReportStatus, ReportTargetType } from "./reports";
import { AUDIT_TARGET_TYPES } from "./audit";

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
    listAuditLog({ targetType: "listing", targetId: String(id) }, 1),
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
  total: number;
  page: number;
  pageSize: number;
};

const AUDIT_LOG_PAGE_SIZE = 50;

export async function listAuditLog(filters: AuditLogFilters = {}, page = 1): Promise<AuditLogPage> {
  const admin = createAdminClient();
  const pageSize = AUDIT_LOG_PAGE_SIZE;
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const rangeFrom = (safePage - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  let query = admin
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    // Stable sort: created_at alone can tie (two actions in the same
    // millisecond), so id breaks the tie deterministically rather than
    // leaving page boundaries to whatever order Postgres happens to return
    // equal-timestamp rows in.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

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

  return { rows, total: count ?? 0, page: safePage, pageSize };
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
// comment at the top of this file), every number here is a genuine
// indexed/count query: `{ count: "exact", head: true }` asks PostgREST for
// just the row count, not the rows themselves, so this function's cost does
// not grow with table size the way a fetch-and-filter would. The one
// exception is suspendedMembers, which reuses authUserMap() — that's the
// same bounded (page size 1000) Auth Admin API call every other function in
// this file already relies on for email/ban data, not a new full-table scan.

export type OverviewMetrics = {
  totalMembers: number;
  suspendedMembers: number;
  totalListings: number;
  activeListings: number;
  removedListings: number;
  totalInvites: number;
  openInvites: number;
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
  ] = await Promise.all([
    admin.from("profiles").select("*", { count: "exact", head: true }),
    authUserMap(),
    admin.from("listings").select("*", { count: "exact", head: true }),
    admin.from("listings").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("listings").select("*", { count: "exact", head: true }).eq("status", "removed"),
    admin.from("tee_time_invites").select("*", { count: "exact", head: true }),
    admin.from("tee_time_invites").select("*", { count: "exact", head: true }).eq("status", "open"),
  ]);

  const error =
    membersError ??
    totalListingsError ??
    activeListingsError ??
    removedListingsError ??
    totalInvitesError ??
    openInvitesError;
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
 * message/conversation targets never hit a table — no messaging system
 * exists yet (see src/lib/admin/reports.ts) — so they always resolve to a
 * plain, unlinked label built from the report's own fields.
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
      // message / conversation — no backing table to resolve against yet.
      // See src/lib/admin/reports.ts and the report detail page for the
      // minimal-context handling this deliberately leaves for a future
      // message-moderation phase.
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
   * to this target without leaving the report. Always empty for
   * message/conversation targets (audit.ts's AUDIT_TARGET_TYPES has no entry
   * for either — there's nothing to look up yet) and for targets with no
   * moderation history. */
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
      ? listAuditLog({ targetType: report.target_type, targetId: report.target_id }, 1)
      : Promise.resolve({ rows: [], total: 0, page: 1, pageSize: AUDIT_LOG_PAGE_SIZE } as AuditLogPage),
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
};

export async function getOrderDetail(id: number): Promise<AdminOrderDetail | null> {
  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders").select("*").eq("id", id).maybeSingle<Order>();
  if (error) throw new Error(`Failed to load order: ${error.message}`);
  if (!order) return null;

  const [authUsers, { data: profiles }, { data: listing }, { data: offer }, historyResult, { data: refunds }, { data: disputes }] =
    await Promise.all([
      authUserMap(),
      admin.from("profiles").select("*").in("id", [order.buyer_id, order.seller_id]).returns<Profile[]>(),
      order.listing_id
        ? admin.from("listings").select("*").eq("id", order.listing_id).maybeSingle<Listing>()
        : Promise.resolve({ data: null as Listing | null }),
      order.offer_id
        ? admin.from("offers").select("*").eq("id", order.offer_id).maybeSingle<Offer>()
        : Promise.resolve({ data: null as Offer | null }),
      listAuditLog({ targetType: "order", targetId: String(id) }, 1),
      admin.from("refunds").select("*").eq("order_id", id).order("created_at", { ascending: false }).returns<Refund[]>(),
      admin.from("disputes").select("*").eq("order_id", id).order("created_at", { ascending: false }).returns<Dispute[]>(),
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
    listAuditLog({ targetType: "seller_account", targetId: String(account.id) }, 1),
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

export type AdminWebhookEventListItem = WebhookEvent;

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
    .select("*", { count: "exact" })
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.eventType) query = query.eq("event_type", filters.eventType);
  if (filters.orderId) query = query.eq("related_order_id", filters.orderId);

  const { data, error, count } = await query.returns<WebhookEvent[]>();
  if (error) throw new Error(`Failed to list webhook events: ${error.message}`);

  return { rows: data ?? [], total: count ?? 0, page: safePage, pageSize: WEBHOOK_EVENTS_PAGE_SIZE };
}

/** Distinct event types seen so far, for the list page's filter dropdown —
 * same "small, bounded lookup" shape as listAuditLogActors(). */
export async function listWebhookEventTypes(): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("webhook_events").select("event_type").returns<{ event_type: string }[]>();
  if (error) throw new Error(`Failed to list webhook event types: ${error.message}`);
  return [...new Set((data ?? []).map((row) => row.event_type))].sort();
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
    listAuditLog({ targetType: "webhook_event", targetId: String(id) }, 1),
  ]);

  return {
    event,
    relatedOrder: relatedOrder ?? null,
    history: historyResult.rows,
  };
}
