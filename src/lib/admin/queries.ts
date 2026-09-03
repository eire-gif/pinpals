import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Listing, Offer, Profile, TeeTimeInterest, TeeTimeInvite } from "@/lib/types";
import type { StaffRole } from "./roles";

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
