/**
 * Shared rounds — the model (Oct 2026 feed redesign, phase 9).
 *
 * KEPT IDENTICAL in two places, like post-details.ts and achievements.ts:
 *
 *   src/lib/shared-round.ts          (website: the future /api/app/rounds)
 *   mobile/src/lib/shared-round.ts   (app: the future shared-round card)
 *
 * src/lib/shared-round.test.ts fails if they differ. No imports.
 *
 * WHAT A SHARED ROUND IS: one played round that several PinPals were part
 * of — a course, a day, the people who played, each player's score, the
 * photos any of them took, one conversation, and (one day) shot maps.
 *
 * WHAT EXISTS TODAY, and what this builds from, with no new tables:
 *
 *   the round      a tee time (`tee_time_invites`) whose day has passed
 *   participants   its host + every `tee_time_interests` row 'confirmed'
 *   each score     each participant's own round post carrying
 *                  `details.tee_time_id` (phase 7; createPost checks the
 *                  poster hosted or confirmed for it)
 *   media          the photos on those posts
 *   comments       the thread on the FIRST of those posts
 *   shot maps      nothing captures them yet — always empty
 *
 * So four players who each share their recap already point at the same
 * round; buildSharedRound() folds their posts into one SharedRound rather
 * than four copies of it. What it can't do without the backend changes in
 * claude/shared-round-model.md is let a player add a photo WITHOUT making a
 * post of their own, or keep one thread when the first post is deleted.
 * The shape below is the one those tables will fill, so screens built on it
 * won't change when they arrive.
 */

export type SharedRoundRole = "host" | "player";

export type SharedRoundScore = {
  score: number;
  holes: 9 | 18;
  coursePar: number | null;
  /** Strokes against par, when par is known. */
  vsPar: number | null;
  /** The post the score came from. */
  postId: number;
};

export type SharedRoundParticipant = {
  memberId: string;
  name: string;
  role: SharedRoundRole;
  /** Null until they share their numbers — playing isn't publishing. */
  score: SharedRoundScore | null;
};

export type SharedRoundMedia = {
  path: string;
  /** Who took it: credited on the card, and whose deletion removes it. */
  contributorId: string;
  /** Today a photo lives on a post; tomorrow on the round (see the doc). */
  postId: number;
  width: number | null;
  height: number | null;
};

export type ShotPoint = { lat: number; lng: number; club?: string; lie?: string };
export type ShotMap = { hole: number; contributorId: string; shots: ShotPoint[] };

export type SharedRound = {
  /** Stable id for lists and caches: "tee:<tee time id>". */
  key: string;
  teeTimeId: number;
  course: { id: number | null; name: string };
  /** YYYY-MM-DD. */
  date: string;
  /** Host first, then by name. */
  participants: SharedRoundParticipant[];
  media: SharedRoundMedia[];
  /** The post whose comment thread is the round's conversation: the first
   *  one shared. Null until somebody shares. */
  threadPostId: number | null;
  /** Every post folded into this round, oldest first. */
  postIds: number[];
  shotMaps: ShotMap[];
};

/** Six photos a post, four players: a round's album is never bigger. */
export const SHARED_ROUND_MAX_MEDIA = 24;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The round a post belongs to, or null: a round post tagged with a tee time. */
export function sharedRoundKey(kind: string, details: unknown): string | null {
  if (kind !== "round" || !details || typeof details !== "object") return null;
  const id = (details as Record<string, unknown>).tee_time_id;
  return isNum(id) && Number.isInteger(id) && id > 0 ? `tee:${id}` : null;
}

export type SharedRoundPostInput = {
  id: number;
  authorId: string;
  kind: string;
  details: unknown;
  createdAt: string;
  photos: { path: string; width: number | null; height: number | null }[];
};

export type SharedRoundInput = {
  teeTime: { id: number; clubId: number | null; clubName: string; playDate: string; hostId: string };
  /** Everyone who played: the host and each confirmed player. */
  players: { memberId: string; name: string }[];
  /** Whatever posts the reader can see; anything not for this round, or by
   *  someone who didn't play it, is ignored. */
  posts: SharedRoundPostInput[];
};

function scoreOf(post: SharedRoundPostInput): SharedRoundScore | null {
  const d = post.details as Record<string, unknown>;
  if (!isNum(d.score)) return null;
  const par = isNum(d.course_par) ? d.course_par : null;
  return {
    score: d.score,
    holes: d.holes === 9 ? 9 : 18,
    coursePar: par,
    vsPar: par === null ? null : d.score - par,
    postId: post.id,
  };
}

const oldestFirst = (a: SharedRoundPostInput, b: SharedRoundPostInput) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id;

/**
 * One shared round from a tee time, its players and their posts.
 *
 *   - a post counts only if it names this tee time AND its author played
 *     (the database check is the guarantee; this is the belt to its braces)
 *   - a player's score is from their LATEST round post, so a correction
 *     posted later wins
 *   - photos are every counted post's, oldest post first, each path once,
 *     at most SHARED_ROUND_MAX_MEDIA
 *   - the conversation is the first post's thread
 */
export function buildSharedRound(input: SharedRoundInput): SharedRound {
  const key = `tee:${input.teeTime.id}`;
  const hostId = input.teeTime.hostId;
  const played = new Map(input.players.map((p) => [p.memberId, p.name]));

  const posts = input.posts
    .filter((p) => sharedRoundKey(p.kind, p.details) === key && played.has(p.authorId))
    .sort(oldestFirst);

  const latestScore = new Map<string, SharedRoundScore>();
  for (const post of posts) {
    const score = scoreOf(post);
    if (score) latestScore.set(post.authorId, score);
  }

  const participants: SharedRoundParticipant[] = [...played.entries()]
    .map(([memberId, name]) => ({
      memberId,
      name,
      role: (memberId === hostId ? "host" : "player") as SharedRoundRole,
      score: latestScore.get(memberId) ?? null,
    }))
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "host" ? -1 : 1));

  const seen = new Set<string>();
  const media: SharedRoundMedia[] = [];
  for (const post of posts) {
    for (const photo of post.photos) {
      if (seen.has(photo.path) || media.length >= SHARED_ROUND_MAX_MEDIA) continue;
      seen.add(photo.path);
      media.push({ path: photo.path, contributorId: post.authorId, postId: post.id, width: photo.width, height: photo.height });
    }
  }

  return {
    key,
    teeTimeId: input.teeTime.id,
    course: { id: input.teeTime.clubId, name: input.teeTime.clubName },
    date: input.teeTime.playDate,
    participants,
    media,
    threadPostId: posts[0]?.id ?? null,
    postIds: posts.map((p) => p.id),
    shotMaps: [],
  };
}

/**
 * For a page of feed posts: each round post that is NOT the first of its
 * round mapped to the one that is — what a feed collapsing duplicates
 * would fold away. Within the page only; posts with no round are absent.
 */
export function duplicateRoundPosts(
  posts: Pick<SharedRoundPostInput, "id" | "kind" | "details" | "createdAt">[],
): Map<number, number> {
  const first = new Map<string, { id: number; createdAt: string }>();
  for (const p of posts) {
    const key = sharedRoundKey(p.kind, p.details);
    if (!key) continue;
    const seen = first.get(key);
    if (!seen || p.createdAt < seen.createdAt || (p.createdAt === seen.createdAt && p.id < seen.id)) {
      first.set(key, { id: p.id, createdAt: p.createdAt });
    }
  }
  const out = new Map<number, number>();
  for (const p of posts) {
    const key = sharedRoundKey(p.kind, p.details);
    const head = key ? first.get(key) : undefined;
    if (head && head.id !== p.id) out.set(p.id, head.id);
  }
  return out;
}

/**
 * Who a reader may see on the round. Its players see everyone who played;
 * anyone else sees only players who shared something (a score or a photo).
 * Playing with someone is known to the fourball (0078), not to the world —
 * being named on a friend's post is something a member opts into by
 * posting, never a side effect of turning up.
 */
export function visibleParticipants(round: SharedRound, viewerId: string | null): SharedRoundParticipant[] {
  if (viewerId && round.participants.some((p) => p.memberId === viewerId)) return round.participants;
  const contributed = new Set(round.media.map((m) => m.contributorId));
  return round.participants.filter((p) => p.score !== null || contributed.has(p.memberId));
}

/** "Ciarán 78 (+6) · Aoife 84 (+12)" — who shot what, for a caption or a
 *  screen reader. Players who haven't shared are left out. */
export function scoreLine(round: SharedRound): string {
  return round.participants
    .filter((p) => p.score)
    .map((p) => {
      const s = p.score!;
      const rel = s.vsPar === null ? "" : ` (${s.vsPar === 0 ? "E" : s.vsPar > 0 ? `+${s.vsPar}` : s.vsPar})`;
      return `${p.name.split(" ")[0]} ${s.score}${rel}`;
    })
    .join(" · ");
}
