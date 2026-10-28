import { groupResultFrom, type GroupResult } from "./competition-data";
import type { Results } from "./competition-results";
import { loadFollowing } from "./live-follow";
import { isOn } from "./features";
import { irishToday } from "./outing-rules";
import type { LiveCircle } from "./social-live-rules";
import { supabase } from "./supabase";

/**
 * Social's live pieces (Oct 2026, 0194, claude/social-live.md): the circles
 * across the top, society results in the feed, and the comments and Great
 * Shots on a live day. Everything is read under RLS with the member's own
 * client: a circle only appears for a day the member may watch (they're
 * playing, they run it, or it's their group's and the leaderboard isn't
 * secret), and a comment only for someone who can see that day.
 */

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

type DayRow = { id: number; title: string; created_by: string | null; group_id: number | null; played_on: string };
type GroupRow = { id: number; name: string; kind: string; logo_url: string | null };

/** The days going on now that this member may watch, other than one they're playing in. */
async function liveDays(playingRoundId: number | null): Promise<LiveCircle[]> {
  const today = irishToday();
  const { data: days } = await supabase
    .from("live_match_days")
    .select("id, title, created_by, group_id, played_on")
    .gte("played_on", today)
    .order("played_on", { ascending: false })
    .limit(30)
    .overrideTypes<DayRow[]>();
  const ids = (days ?? []).map((d) => d.id);
  if (ids.length === 0) return [];

  const [{ data: rounds }, { data: outings }] = await Promise.all([
    supabase
      .from("live_rounds")
      .select("id, match_day_id, status, live_round_players(count)")
      .in("match_day_id", ids)
      .overrideTypes<{ id: number; match_day_id: number; status: string; live_round_players: { count: number }[] }[]>(),
    supabase.from("society_outings").select("group_id, match_day_id").in("match_day_id", ids).overrideTypes<{ group_id: number; match_day_id: number }[]>(),
  ]);
  const live = new Set((rounds ?? []).filter((r) => r.status === "live").map((r) => r.match_day_id));
  const mine = new Set((rounds ?? []).filter((r) => r.id === playingRoundId).map((r) => r.match_day_id));
  const playing = new Map<number, number>();
  for (const r of rounds ?? []) playing.set(r.match_day_id, (playing.get(r.match_day_id) ?? 0) + (r.live_round_players?.[0]?.count ?? 0));
  const outingGroup = new Map((outings ?? []).map((o) => [o.match_day_id, o.group_id]));

  const shown = (days ?? []).filter((d) => live.has(d.id) && !mine.has(d.id));
  const groupIds = [...new Set(shown.map((d) => d.group_id ?? outingGroup.get(d.id)).filter((g): g is number => g != null))];
  const groups = await loadGroups(groupIds);
  return shown.map((d) => {
    const g = groups.get(d.group_id ?? outingGroup.get(d.id) ?? -1) ?? null;
    return { kind: "day", dayId: d.id, title: d.title, groupName: g?.name ?? null, logoUrl: g?.logo_url ?? null, playing: playing.get(d.id) ?? 0 };
  });
}

async function loadGroups(ids: number[]): Promise<Map<number, GroupRow>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("groups").select("id, name, kind, logo_url").in("id", ids).overrideTypes<GroupRow[]>();
  return new Map((data ?? []).map((g) => [g.id, g]));
}

/** Results published to the member's groups in the last two days. */
async function freshResults(): Promise<LiveCircle[]> {
  const since = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data } = await supabase
    .from("competition_results")
    .select("match_day_id, group_id, results")
    .eq("status", "published")
    .not("group_id", "is", null)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(6)
    .overrideTypes<{ match_day_id: number; group_id: number; results: Results }[]>();
  const groups = await loadGroups([...new Set((data ?? []).map((r) => r.group_id))]);
  return (data ?? []).flatMap((r) => {
    const g = groups.get(r.group_id);
    return g ? [{ kind: "results" as const, dayId: r.match_day_id, groupId: g.id, groupName: g.name, title: r.results.event?.title ?? "Results" }] : [];
  });
}

/**
 * Every circle but "post" and "mine" (the screen adds those from the MY ROUND
 * pill's state). One piece failing leaves the others: the row is a bonus,
 * never a reason for the feed not to load.
 */
export async function loadLiveCircles(playingRoundId: number | null): Promise<LiveCircle[]> {
  if (!isOn("liveScoring")) return [];
  const [days, follows, results] = await Promise.all([
    liveDays(playingRoundId).catch(() => [] as LiveCircle[]),
    isOn("liveFollow")
      ? loadFollowing()
          .then((items) =>
            items
              .filter((f) => f.card.state === "live")
              .map(
                (f): LiveCircle => ({
                  kind: "follow",
                  followId: f.followId,
                  name: f.card.firstName || f.card.name,
                  detail: f.card.nowPlaying ? `H${f.card.nowPlaying} · ${f.card.summary.big}` : f.card.summary.progress,
                })
              )
          )
          .catch(() => [] as LiveCircle[])
      : Promise.resolve([] as LiveCircle[]),
    freshResults().catch(() => [] as LiveCircle[]),
  ]);
  return [...days, ...follows, ...results];
}

/** A day of the given group going on now, for the LIVE banner on its page. */
export async function liveDayOfGroup(groupId: number): Promise<{ dayId: number; title: string; courseName: string; playing: number } | null> {
  const today = irishToday();
  const [{ data: direct }, { data: outings }] = await Promise.all([
    supabase.from("live_match_days").select("id").eq("group_id", groupId).gte("played_on", today).overrideTypes<{ id: number }[]>(),
    supabase.from("society_outings").select("match_day_id").eq("group_id", groupId).gte("plays_on", today).not("match_day_id", "is", null).overrideTypes<{ match_day_id: number }[]>(),
  ]);
  const ids = [...new Set([...(direct ?? []).map((d) => d.id), ...(outings ?? []).map((o) => o.match_day_id)])];
  if (ids.length === 0) return null;
  const { data: rounds } = await supabase
    .from("live_rounds")
    .select("match_day_id, status, live_round_players(count)")
    .in("match_day_id", ids)
    .overrideTypes<{ match_day_id: number; status: string; live_round_players: { count: number }[] }[]>();
  const live = (rounds ?? []).find((r) => r.status === "live");
  if (!live) return null;
  const { data: day } = await supabase
    .from("live_match_days")
    .select("id, title, course_name")
    .eq("id", live.match_day_id)
    .maybeSingle<{ id: number; title: string; course_name: string }>();
  if (!day) return null;
  const playing = (rounds ?? []).filter((r) => r.match_day_id === day.id).reduce((n, r) => n + (r.live_round_players?.[0]?.count ?? 0), 0);
  return { dayId: day.id, title: day.title, courseName: day.course_name, playing };
}

/** A day started straight from a group's page belongs to that group (0194), so its members can watch. */
export async function setMatchDayGroup(dayId: number, groupId: number): Promise<void> {
  const { error } = await supabase.rpc("set_match_day_group", { p_day_id: dayId, p_group_id: groupId });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Comments with likes, and Great Shots, on a day
// ---------------------------------------------------------------------------

export type DayComment = {
  id: number;
  author: { id: string; name: string; avatarUrl: string | null; avatarColor: string | null };
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  pinned: boolean;
  isMine: boolean;
};

type CommentRow = {
  id: number;
  author_id: string;
  body: string;
  like_count: number;
  pinned_at: string | null;
  created_at: string;
  author: { first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null } | null;
};

const COMMENT_SELECT =
  "id, author_id, body, like_count, pinned_at, created_at, author:profiles!live_day_comments_author_id_fkey ( first_name, last_name, avatar_url, avatar_color )";

/** The newest comments on a day (oldest of them first, as a chat reads), the pinned one, and how many there are. */
export async function loadDayComments(
  dayId: number,
  viewerId: string,
  limit = 40
): Promise<{ comments: DayComment[]; pinned: DayComment | null; count: number }> {
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from("live_day_comments")
      .select(COMMENT_SELECT)
      .eq("match_day_id", dayId)
      .order("created_at", { ascending: false })
      .limit(limit)
      .overrideTypes<CommentRow[]>(),
    supabase.from("live_day_comments").select("id", { count: "exact", head: true }).eq("match_day_id", dayId),
  ]);
  if (error) throw new Error("Couldn't load the comments.");
  const rows = [...(data ?? [])];
  // The pinned one may be older than the page.
  if (!rows.some((r) => r.pinned_at)) {
    const { data: pin } = await supabase
      .from("live_day_comments")
      .select(COMMENT_SELECT)
      .eq("match_day_id", dayId)
      .not("pinned_at", "is", null)
      .limit(1)
      .overrideTypes<CommentRow[]>();
    if (pin?.[0]) rows.push(pin[0]);
  }
  const ids = rows.map((r) => r.id);
  const { data: likes } = ids.length
    ? await supabase.from("live_day_comment_likes").select("comment_id").eq("member_id", viewerId).in("comment_id", ids).overrideTypes<{ comment_id: number }[]>()
    : { data: [] as { comment_id: number }[] };
  const liked = new Set((likes ?? []).map((l) => l.comment_id));
  const all = rows.map(
    (r): DayComment => ({
      id: r.id,
      author: {
        id: r.author_id,
        name: [r.author?.first_name, r.author?.last_name].filter(Boolean).join(" ") || "A member",
        avatarUrl: r.author?.avatar_url ?? null,
        avatarColor: r.author?.avatar_color ?? null,
      },
      body: r.body,
      createdAt: r.created_at,
      likeCount: r.like_count,
      likedByMe: liked.has(r.id),
      pinned: r.pinned_at != null,
      isMine: r.author_id === viewerId,
    })
  );
  const pinned = all.find((c) => c.pinned) ?? null;
  const comments = all.filter((c) => !c.pinned).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { comments, pinned, count: count ?? all.length };
}

/** Just the count and the two most-liked recent comments — for a results card. */
export async function loadDayCommentPreview(dayId: number, viewerId: string): Promise<{ comments: DayComment[]; count: number }> {
  const { comments, pinned, count } = await loadDayComments(dayId, viewerId, 12);
  const pool = pinned ? [pinned, ...comments] : comments;
  const top = [...pool].sort((a, b) => b.likeCount - a.likeCount || b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
  return { comments: top, count };
}

export async function addDayComment(dayId: number, body: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  if (text.length > 300) throw new Error("Please keep a comment under 300 characters.");
  const { error } = await supabase.from("live_day_comments").insert({ match_day_id: dayId, body: text });
  if (error) throw new Error(error.code === "P0001" || error.code === "42501" ? error.message : "Couldn't post that. Please try again.");
}

export async function setDayCommentLike(commentId: number, viewerId: string, liked: boolean): Promise<void> {
  const table = supabase.from("live_day_comment_likes");
  const { error } = liked
    ? await table.insert({ comment_id: commentId })
    : await table.delete().eq("comment_id", commentId).eq("member_id", viewerId);
  // Already liked on another phone: nothing to do.
  if (error && error.code !== "23505") throw new Error("Couldn't save that. Please try again.");
}

export async function deleteDayComment(commentId: number): Promise<void> {
  const { error } = await supabase.from("live_day_comments").delete().eq("id", commentId);
  if (error) throw new Error("Couldn't delete that. Please try again.");
}

export async function pinDayComment(commentId: number, pin: boolean): Promise<void> {
  const { error } = await supabase.rpc("live_day_comment_pin", { p_comment_id: commentId, p_pin: pin });
  if (error) throw new Error(error.message);
}

export async function loadCheers(dayId: number, viewerId: string): Promise<{ count: number; mine: boolean }> {
  const [{ count }, { data }] = await Promise.all([
    supabase.from("live_day_cheers").select("member_id", { count: "exact", head: true }).eq("match_day_id", dayId),
    supabase.from("live_day_cheers").select("member_id").eq("match_day_id", dayId).eq("member_id", viewerId).maybeSingle(),
  ]);
  return { count: count ?? 0, mine: data != null };
}

export async function setCheer(dayId: number, viewerId: string, on: boolean): Promise<void> {
  const table = supabase.from("live_day_cheers");
  const { error } = on ? await table.insert({ match_day_id: dayId }) : await table.delete().eq("match_day_id", dayId).eq("member_id", viewerId);
  if (error && error.code !== "23505") throw new Error("Couldn't save that. Please try again.");
}

// ---------------------------------------------------------------------------
// Results in the feed
// ---------------------------------------------------------------------------

export type FeedResult = GroupResult & {
  groupId: number;
  groupName: string;
  logoUrl: string | null;
  publishedAt: string;
  cheers: { count: number; mine: boolean };
  comments: DayComment[];
  commentCount: number;
};

/**
 * Results published to the member's groups (0138 RLS: a group's members read
 * them) between two times — the window of posts a feed page covers.
 */
export async function loadFeedResults(
  viewerId: string,
  newerThan: string | null,
  olderThan: string | null,
  only: { groupId: number; limit: number } | null = null
): Promise<FeedResult[]> {
  let query = supabase
    .from("competition_results")
    .select("match_day_id, group_id, version, published_at, results")
    .eq("status", "published")
    .not("group_id", "is", null)
    .gte("published_at", newerThan ?? new Date(Date.now() - 30 * 86400_000).toISOString())
    .order("published_at", { ascending: false })
    .limit(only?.limit ?? 5);
  if (olderThan) query = query.lt("published_at", olderThan);
  if (only) query = query.eq("group_id", only.groupId);
  const { data } = await query.overrideTypes<{ match_day_id: number; group_id: number; version: number; published_at: string; results: Results }[]>();
  const rows = data ?? [];
  if (rows.length === 0) return [];
  const groups = await loadGroups([...new Set(rows.map((r) => r.group_id))]);
  return Promise.all(
    rows.map(async (r) => {
      const [cheers, preview] = await Promise.all([
        loadCheers(r.match_day_id, viewerId).catch(() => ({ count: 0, mine: false })),
        loadDayCommentPreview(r.match_day_id, viewerId).catch(() => ({ comments: [] as DayComment[], count: 0 })),
      ]);
      const g = groups.get(r.group_id);
      return {
        ...groupResultFrom(r, viewerId),
        groupId: r.group_id,
        groupName: g?.name ?? "Your group",
        logoUrl: g?.logo_url ?? null,
        publishedAt: r.published_at,
        cheers,
        comments: preview.comments,
        commentCount: preview.count,
      };
    })
  );
}

/** Everyone in the member's groups (and the member) — the Groups tab's authors. */
export async function groupMateIds(viewerId: string): Promise<string[]> {
  const { data: mine } = await supabase.from("group_members").select("group_id").eq("member_id", viewerId).overrideTypes<{ group_id: number }[]>();
  const groupIds = (mine ?? []).map((m) => m.group_id);
  if (groupIds.length === 0) return [];
  const { data } = await supabase.from("group_members").select("member_id").in("group_id", groupIds).limit(2000).overrideTypes<{ member_id: string }[]>();
  return [...new Set([viewerId, ...(data ?? []).map((m) => m.member_id)])];
}
