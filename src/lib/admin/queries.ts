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
// admin-architecture-review.md). Fetching each table in full and joining /
// searching in memory is simpler and plenty fast at this scale, and it's how
// we get each user's email onto their profile at all — Supabase Auth emails
// live in auth.users, which PostgREST doesn't expose, so the only way to
// read them is the Auth admin API (`auth.admin.listUsers`), not a DB join.
// Once the member base grows past a page of Auth users (1000) or search
// needs real pagination, replace the full-table reads below with
// server-side filtering and a cursor.

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

export async function listUsers(query = ""): Promise<AdminUserListItem[]> {
  const admin = createAdminClient();
  const [{ data: profiles, error }, authUsers, { data: listingRows }, { data: inviteRows }] =
    await Promise.all([
      admin.from("profiles").select("*").order("created_at", { ascending: false }).returns<Profile[]>(),
      authUserMap(),
      admin.from("listings").select("seller_id").returns<Pick<Listing, "seller_id">[]>(),
      admin
        .from("tee_time_invites")
        .select("member_id")
        .returns<Pick<TeeTimeInvite, "member_id">[]>(),
    ]);
  if (error) throw new Error(`Failed to list profiles: ${error.message}`);

  const listingCountBySeller = countBy(listingRows ?? [], "seller_id");
  const inviteCountByMember = countBy(inviteRows ?? [], "member_id");

  return (profiles ?? [])
    .map((profile) => ({
      ...withEmail(profile, authUsers),
      listing_count: listingCountBySeller.get(profile.id) ?? 0,
      invite_count: inviteCountByMember.get(profile.id) ?? 0,
    }))
    .filter((u) => matches(query, u.first_name, u.last_name, u.email, u.home_club, u.county));
}

export type AdminUserDetail = {
  profile: AdminProfile;
  listings: Listing[];
  invites: TeeTimeInvite[];
  offersMade: (Offer & { listing: Pick<Listing, "id" | "title"> | null })[];
};

export async function getUserDetail(id: string): Promise<AdminUserDetail | null> {
  const admin = createAdminClient();
  const [{ data: profile }, authUsers, { data: listings }, { data: invites }, { data: offersMade }] =
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
    ]);

  if (!profile) return null;

  return {
    profile: withEmail(profile, authUsers),
    listings: listings ?? [],
    invites: invites ?? [],
    offersMade: offersMade ?? [],
  };
}

// ---------- Listings ----------

export type AdminListingListItem = Listing & { seller: AdminProfile | null };

export async function listListings(query = "", status = ""): Promise<AdminListingListItem[]> {
  const admin = createAdminClient();
  const [{ data: listings, error }, { data: profiles }, authUsers] = await Promise.all([
    admin.from("listings").select("*").order("created_at", { ascending: false }).returns<Listing[]>(),
    admin.from("profiles").select("*").returns<Profile[]>(),
    authUserMap(),
  ]);
  if (error) throw new Error(`Failed to list listings: ${error.message}`);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (listings ?? [])
    .map((listing) => {
      const sellerProfile = profileById.get(listing.seller_id) ?? null;
      return {
        ...listing,
        seller: sellerProfile ? withEmail(sellerProfile, authUsers) : null,
      };
    })
    .filter((l) => !status || l.status === status)
    .filter((l) =>
      matches(
        query,
        l.title,
        l.description,
        l.category,
        l.county,
        l.seller ? `${l.seller.first_name} ${l.seller.last_name}` : null
      )
    );
}

export type AdminListingDetail = {
  listing: Listing;
  seller: AdminProfile | null;
  offers: (Offer & { buyer: AdminProfile | null })[];
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

  const { data: sellerProfile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", listing.seller_id)
    .maybeSingle<Profile>();

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
