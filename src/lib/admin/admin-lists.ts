import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { listCampaigns } from "./advertising";

// Reads for the tidied admin: the Overview's attention cards and community
// snapshot, and the Groups & societies pages (0120+). Same conventions as
// queries.ts: service-role client, head-only exact counts on filtered (and
// so index-bounded) queries, real `.range()` pagination for lists.

type CountResult = { count: number | null; error: { message: string } | null };

/** A count that degrades to null (shown as "—") rather than failing the
 * whole Overview when one table or column isn't there yet. */
async function safeCount(query: PromiseLike<CountResult>): Promise<number | null> {
  try {
    const { count, error } = await query;
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export type AdminAttention = {
  openReports: number | null;
  openSupportCases: number | null;
  suspendedMembers: number | null;
  listingsAwaitingReview: number | null;
  hiddenListings: number | null;
  hiddenPosts: number | null;
  // Finance-only (null when not asked for).
  problemSales: number | null;
  ordersAwaitingPayment: number | null;
  webhookFailures7d: number | null;
  sellersIncomplete: number | null;
  liveAdCampaigns: number | null;
};

const DAY = 24 * 60 * 60 * 1000;

export async function getAdminAttention({
  finance,
  suspendedMembers,
  openSupportCases,
}: {
  finance: boolean;
  /** Already counted by getOverviewMetrics() — passed in, not re-read. */
  suspendedMembers: number;
  openSupportCases: number;
}): Promise<AdminAttention> {
  const admin = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const head = { count: "exact" as const, head: true };

  const [openReports, listingsAwaitingReview, hiddenListings, hiddenPosts] = await Promise.all([
    safeCount(admin.from("reports").select("*", head).in("status", ["open", "claimed"])),
    safeCount(admin.from("listings").select("*", head).eq("status", "pending_review")),
    safeCount(admin.from("listings").select("*", head).eq("status", "removed")),
    safeCount(admin.from("posts").select("*", head).not("hidden_at", "is", null)),
  ]);

  let problemSales: number | null = null;
  let ordersAwaitingPayment: number | null = null;
  let webhookFailures7d: number | null = null;
  let sellersIncomplete: number | null = null;
  if (finance) {
    [problemSales, ordersAwaitingPayment, webhookFailures7d, sellersIncomplete] = await Promise.all([
      safeCount(admin.from("orders").select("*", head).not("problem_at", "is", null).is("released_at", null)),
      safeCount(admin.from("orders").select("*", head).eq("status", "pending").in("payment_status", ["pending", "failed"])),
      safeCount(admin.from("webhook_events").select("*", head).eq("status", "failed").gte("received_at", weekAgo)),
      safeCount(admin.from("stripe_connected_accounts").select("*", head).eq("payouts_enabled", false)),
    ]);
  }

  let liveAdCampaigns: number | null = null;
  try {
    liveAdCampaigns = (await listCampaigns()).filter((c) => c.view === "live").length;
  } catch {
    liveAdCampaigns = null; // 0139 not applied — show "—", not an error page
  }

  return {
    openReports,
    openSupportCases,
    suspendedMembers,
    listingsAwaitingReview,
    hiddenListings,
    hiddenPosts,
    problemSales,
    ordersAwaitingPayment,
    webhookFailures7d,
    sellersIncomplete,
    liveAdCampaigns,
  };
}

export type CommunitySnapshot = {
  groups: number | null;
  societies: number | null;
  upcomingEvents: number | null;
  postsThisWeek: number | null;
  newMembersThisWeek: number | null;
};

export async function getCommunitySnapshot(): Promise<CommunitySnapshot> {
  const admin = createAdminClient();
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const head = { count: "exact" as const, head: true };
  const [groups, societies, upcomingEvents, postsThisWeek, newMembersThisWeek] = await Promise.all([
    safeCount(admin.from("groups").select("*", head).is("hidden_at", null)),
    safeCount(admin.from("groups").select("*", head).is("hidden_at", null).eq("kind", "society")),
    safeCount(admin.from("society_outings").select("*", head).eq("status", "open").gte("plays_on", today)),
    safeCount(admin.from("posts").select("*", head).gte("created_at", weekAgo)),
    safeCount(admin.from("profiles").select("*", head).gte("created_at", weekAgo)),
  ]);
  return { groups, societies, upcomingEvents, postsThisWeek, newMembersThisWeek };
}

// ============ Groups & societies (0120) ============

export const GROUP_KIND_LABELS: Record<string, string> = {
  crew: "Crew",
  trip: "Golf trip",
  society: "Society",
  area: "Area",
  club: "Club",
};

export const GROUP_PRIVACY_LABELS: Record<string, string> = {
  open: "Anyone can join",
  request: "Ask to join",
  invite: "Invite only",
};

export type AdminGroupRow = {
  id: number;
  kind: string;
  name: string;
  privacy: string;
  member_count: number;
  created_at: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  club_id: number | null;
  owner: { id: string; first_name: string | null; last_name: string | null } | null;
};

export type AdminGroupFilters = { q?: string; kind?: string; showHidden?: boolean };

export const GROUPS_PAGE_SIZE = 25;

/** The search box is matched with ilike; strip the characters PostgREST's
 * filter syntax and LIKE give meaning to. */
export function cleanSearch(raw: string | undefined): string {
  return (raw ?? "").replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);
}

export async function listGroups(filters: AdminGroupFilters, page: number) {
  const admin = createAdminClient();
  let q = admin
    .from("groups")
    .select("id, kind, name, privacy, member_count, created_at, hidden_at, hidden_reason, club_id, created_by", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * GROUPS_PAGE_SIZE, page * GROUPS_PAGE_SIZE - 1);
  const term = cleanSearch(filters.q);
  if (term) q = q.ilike("name", `%${term}%`);
  if (filters.kind && GROUP_KIND_LABELS[filters.kind]) q = q.eq("kind", filters.kind);
  if (!filters.showHidden) q = q.is("hidden_at", null);

  const { data, count, error } = await q;
  if (error) throw new Error(`Failed to load groups: ${error.message}`);
  const rows = (data ?? []) as (Omit<AdminGroupRow, "owner"> & { created_by: string | null })[];

  // The owner is the group_members row with role 'owner' (created_by can be
  // someone who has since handed it over).
  const ids = rows.map((r) => r.id);
  const { data: owners } = ids.length
    ? await admin
        .from("group_members")
        .select("group_id, profiles ( id, first_name, last_name )")
        .in("group_id", ids)
        .eq("role", "owner")
    : { data: [] };
  const ownerBy = new Map<number, AdminGroupRow["owner"]>();
  for (const o of (owners ?? []) as unknown as { group_id: number; profiles: AdminGroupRow["owner"] }[]) {
    ownerBy.set(o.group_id, o.profiles);
  }

  return {
    rows: rows.map((r) => {
      const { created_by: _ignored, ...rest } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { ...rest, owner: ownerBy.get(r.id) ?? null };
    }) as AdminGroupRow[],
    total: count ?? 0,
  };
}

export type AdminGroupDetail = AdminGroupRow & {
  about: string | null;
  starts_on: string | null;
  ends_on: string | null;
  features: string[];
  conversation_id: number | null;
  club_name: string | null;
  members: { member_id: string; role: string; joined_at: string; first_name: string | null; last_name: string | null }[];
  events: AdminOutingRow[];
  pendingRequests: number;
};

export async function getGroupDetail(id: number): Promise<AdminGroupDetail | null> {
  const admin = createAdminClient();
  const { data: g } = await admin
    .from("groups")
    .select(
      "id, kind, name, about, privacy, member_count, created_at, hidden_at, hidden_reason, club_id, starts_on, ends_on, features, conversation_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (!g) return null;

  const [{ data: members }, { data: club }, events, { count: pendingRequests }] = await Promise.all([
    admin
      .from("group_members")
      .select("member_id, role, joined_at, profiles ( first_name, last_name )")
      .eq("group_id", id)
      .order("joined_at", { ascending: true })
      .limit(200),
    g.club_id ? admin.from("clubs").select("name").eq("id", g.club_id).maybeSingle() : Promise.resolve({ data: null }),
    listOutings({ groupId: id, showHidden: true }, 1).then((r) => r.rows),
    admin
      .from("group_invitations")
      .select("*", { count: "exact", head: true })
      .eq("group_id", id)
      .eq("direction", "request")
      .eq("status", "pending"),
  ]);

  const memberRows = ((members ?? []) as unknown as {
    member_id: string;
    role: string;
    joined_at: string;
    profiles: { first_name: string | null; last_name: string | null } | null;
  }[]).map((m) => ({
    member_id: m.member_id,
    role: m.role,
    joined_at: m.joined_at,
    first_name: m.profiles?.first_name ?? null,
    last_name: m.profiles?.last_name ?? null,
  }));
  const owner = memberRows.find((m) => m.role === "owner");

  return {
    ...(g as Omit<AdminGroupDetail, "owner" | "members" | "events" | "pendingRequests" | "club_name">),
    owner: owner ? { id: owner.member_id, first_name: owner.first_name, last_name: owner.last_name } : null,
    club_name: (club as { name: string } | null)?.name ?? null,
    members: memberRows,
    events,
    pendingRequests: pendingRequests ?? 0,
  };
}

// ============ Group events (society_outings, 0125/0129) ============

export const OUTING_KIND_LABELS: Record<string, string> = { day: "Day out", overnight: "Overnight", abroad: "Trip abroad" };

export type AdminOutingRow = {
  id: number;
  group_id: number;
  title: string;
  kind: string | null;
  course_name: string | null;
  location: string | null;
  plays_on: string;
  status: string;
  hidden_at: string | null;
  hidden_reason: string | null;
  created_at: string;
  group: { id: number; name: string; kind: string } | null;
  entries: number;
};

export type AdminOutingFilters = { q?: string; groupId?: number; status?: string; when?: string; showHidden?: boolean };

export async function listOutings(filters: AdminOutingFilters, page: number) {
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  let q = admin
    .from("society_outings")
    .select(
      "id, group_id, title, kind, course_name, location, plays_on, status, hidden_at, hidden_reason, created_at, groups ( id, name, kind ), society_outing_entries ( count )",
      { count: "exact" }
    )
    .range((page - 1) * GROUPS_PAGE_SIZE, page * GROUPS_PAGE_SIZE - 1);

  if (filters.when === "past") q = q.lt("plays_on", today).order("plays_on", { ascending: false });
  else if (filters.when === "upcoming") q = q.gte("plays_on", today).order("plays_on", { ascending: true });
  else q = q.order("plays_on", { ascending: false });
  q = q.order("id", { ascending: false });

  const term = cleanSearch(filters.q);
  if (term) q = q.ilike("title", `%${term}%`);
  if (filters.groupId) q = q.eq("group_id", filters.groupId);
  if (filters.status === "open" || filters.status === "cancelled") q = q.eq("status", filters.status);
  // hidden_at is 0140's — apply the migration before deploying this page.
  if (!filters.showHidden) q = q.is("hidden_at", null);

  const { data, count, error } = await q;
  if (error) throw new Error(`Failed to load events: ${error.message}`);

  const rows = ((data ?? []) as unknown as (Omit<AdminOutingRow, "group" | "entries"> & {
    groups: AdminOutingRow["group"];
    society_outing_entries: { count: number }[];
  })[]).map(({ groups, society_outing_entries, ...r }) => ({
    ...r,
    group: groups,
    entries: society_outing_entries?.[0]?.count ?? 0,
  }));
  return { rows, total: count ?? 0 };
}
