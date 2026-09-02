import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Listing, Offer, Profile, TeeTimeInterest, TeeTimeInvite } from "@/lib/types";

// Every read in this file goes through the service-role client, deliberately
// bypassing RLS: the admin console needs to see every user's data (not just
// what a given staff member's own row would let them see under the app's
// normal owner-scoped policies), and every caller of these functions sits
// behind requireStaff() already — see src/lib/admin/authorization.ts. This
// file only ever reads. The moment a Phase 3 mutation needs this client, it
// must also write an audit_log row (see admin-architecture-review.md §6) —
// nothing here does that yet because nothing here writes anything yet.
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

async function emailMap(): Promise<Map<string, string | null>> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`Failed to list auth users: ${error.message}`);
  return new Map(data.users.map((u) => [u.id, u.email ?? null]));
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

export type AdminProfile = Profile & { email: string | null };

function withEmail(profile: Profile, emails: Map<string, string | null>): AdminProfile {
  return { ...profile, email: emails.get(profile.id) ?? null };
}

// ---------- Users ----------

export type AdminUserListItem = AdminProfile & {
  listing_count: number;
  invite_count: number;
};

export async function listUsers(query = ""): Promise<AdminUserListItem[]> {
  const admin = createAdminClient();
  const [{ data: profiles, error }, emails, { data: listingRows }, { data: inviteRows }] =
    await Promise.all([
      admin.from("profiles").select("*").order("created_at", { ascending: false }).returns<Profile[]>(),
      emailMap(),
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
      ...withEmail(profile, emails),
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
  const [{ data: profile }, emails, { data: listings }, { data: invites }, { data: offersMade }] =
    await Promise.all([
      admin.from("profiles").select("*").eq("id", id).maybeSingle<Profile>(),
      emailMap(),
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
    profile: withEmail(profile, emails),
    listings: listings ?? [],
    invites: invites ?? [],
    offersMade: offersMade ?? [],
  };
}

// ---------- Listings ----------

export type AdminListingListItem = Listing & { seller: AdminProfile | null };

export async function listListings(query = "", status = ""): Promise<AdminListingListItem[]> {
  const admin = createAdminClient();
  const [{ data: listings, error }, { data: profiles }, emails] = await Promise.all([
    admin.from("listings").select("*").order("created_at", { ascending: false }).returns<Listing[]>(),
    admin.from("profiles").select("*").returns<Profile[]>(),
    emailMap(),
  ]);
  if (error) throw new Error(`Failed to list listings: ${error.message}`);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (listings ?? [])
    .map((listing) => {
      const sellerProfile = profileById.get(listing.seller_id) ?? null;
      return {
        ...listing,
        seller: sellerProfile ? withEmail(sellerProfile, emails) : null,
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
  const [{ data: listing }, emails, { data: offers }] = await Promise.all([
    admin.from("listings").select("*").eq("id", id).maybeSingle<Listing>(),
    emailMap(),
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
    seller: sellerProfile ? withEmail(sellerProfile, emails) : null,
    offers: (offers ?? []).map((offer) => {
      const buyerProfile = buyerById.get(offer.buyer_id) ?? null;
      return { ...offer, buyer: buyerProfile ? withEmail(buyerProfile, emails) : null };
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
  const [{ data: invites, error }, { data: profiles }, emails, { data: interestRows }] =
    await Promise.all([
      admin
        .from("tee_time_invites")
        .select("*")
        .order("play_date", { ascending: false })
        .returns<TeeTimeInvite[]>(),
      admin.from("profiles").select("*").returns<Profile[]>(),
      emailMap(),
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
        host: hostProfile ? withEmail(hostProfile, emails) : null,
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
  const [{ data: invite }, emails, { data: interests }] = await Promise.all([
    admin.from("tee_time_invites").select("*").eq("id", id).maybeSingle<TeeTimeInvite>(),
    emailMap(),
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
    host: hostProfile ? withEmail(hostProfile, emails) : null,
    interests: (interests ?? []).map((interest) => {
      const memberProfile = memberById.get(interest.member_id) ?? null;
      return { ...interest, member: memberProfile ? withEmail(memberProfile, emails) : null };
    }),
  };
}
