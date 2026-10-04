import { achievementOf } from "@/lib/achievements";
import { LIE_LABELS, roundScoreLabel, scoreName, type HoleDetails, type PostKind, type RoundDetails, type ShotDetails } from "@/lib/post-details";

/**
 * What a share card says — pure, so it's tested without rendering
 * (share-card.test.ts). app/s/[token]/opengraph-image.tsx draws it.
 *
 * THE RULE: golf details only when the person sharing is the post's author
 * and the post is still up. Anyone else sharing gets a plain PinPals card —
 * no name, no course, no score. A member's 92 at their home club is theirs
 * to publish, not a reader's.
 *
 * The picture is never the member's own photo (those are private, signed,
 * and may be connections-only). It is one of PinPals' course photographs,
 * picked steadily per course so a course always looks the same. Hole maps
 * and shot paths would go here once anything captures them.
 */

export type ShareCardPost = {
  id: number;
  authorId: string;
  authorFirstName: string | null;
  kind: PostKind;
  details: unknown;
  clubId: number | null;
  clubName: string | null;
  hidden: boolean;
};

export type ShareStat = { label: string; value: string };

export type ShareCard = {
  rich: boolean;
  /** Small caps over the title: ROUND, HOLE, SHOT, or PINPALS. */
  kicker: string;
  title: string;
  subtitle: string | null;
  /** The big number and what sits beside it, e.g. 78 and "+6". */
  hero: { big: string; small: string | null } | null;
  stats: ShareStat[];
  photo: number;
  /** The page's <title> and description, for link previews that use text. */
  pageTitle: string;
  pageDescription: string;
};

export const SHARE_PHOTOS = 6;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(iso: string | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const PLAIN = (photo: number): ShareCard => ({
  rich: false,
  kicker: "PINPALS",
  title: "Golf, together",
  subtitle: "Tee times, rounds and kit from golfers across Ireland",
  hero: null,
  stats: [],
  photo,
  pageTitle: "A post on PinPals",
  pageDescription: "Join PinPals to see it — tee times, rounds and golf kit from golfers across Ireland.",
});

export function buildShareCard(post: ShareCardPost | null, sharerId: string): ShareCard {
  const photo = post ? (post.clubId ?? post.id) % SHARE_PHOTOS : 0;
  if (!post || post.hidden || post.authorId !== sharerId) return PLAIN(photo);
  const card = buildRichCard(post, photo);
  // An achievement (phase 8) names itself on the card — "PERSONAL BEST",
  // "HOLE IN ONE" — and leads the preview's title.
  const achievement = achievementOf({ kind: post.kind, details: post.details, courseName: post.clubName });
  if (!achievement) return card;
  return {
    ...card,
    kicker: achievement.achievementTitle.toUpperCase(),
    pageTitle: `${achievement.achievementTitle}! ${card.pageTitle}`,
  };
}

function buildRichCard(post: ShareCardPost, photo: number): ShareCard {
  const who = post.authorFirstName?.trim() || "A PinPal";
  const course = post.clubName?.trim() || null;
  const at = course ? ` at ${course}` : "";

  if (post.kind === "round" && post.details && typeof post.details === "object") {
    const d = post.details as RoundDetails;
    const label = roundScoreLabel(d.score, d.course_par);
    const rel = d.course_par === undefined ? null : label.slice(label.indexOf("(") + 1, -1);
    const stats: ShareStat[] = [];
    if (d.birdies !== undefined) stats.push({ label: "Birdies", value: String(d.birdies) });
    if (d.gir !== undefined) stats.push({ label: "GIR", value: String(d.gir) });
    if (d.putts !== undefined) stats.push({ label: "Putts", value: String(d.putts) });
    if (d.fairways_hit !== undefined)
      stats.push({ label: "Fairways", value: `${d.fairways_hit}${d.fairways_total ? `/${d.fairways_total}` : ""}` });
    return {
      rich: true,
      kicker: d.holes === 9 ? "9-HOLE ROUND" : "ROUND",
      title: course ?? "A round of golf",
      subtitle: [who, d.tee ? `${d.tee} tees` : null, day(d.played_on)].filter(Boolean).join(" · "),
      hero: { big: String(d.score), small: rel },
      stats: stats.slice(0, 4),
      photo,
      pageTitle: `${who} shot ${label}${at}`,
      pageDescription: `${who} shared a round on PinPals${at}.`,
    };
  }

  if (post.kind === "hole" && post.details && typeof post.details === "object") {
    const d = post.details as HoleDetails;
    const name = d.score !== undefined ? scoreName(d.score, d.par) : null;
    const stats: ShareStat[] = [];
    if (d.par !== undefined) stats.push({ label: "Par", value: String(d.par) });
    if (d.yards !== undefined) stats.push({ label: "Yards", value: String(d.yards) });
    if (d.score !== undefined) stats.push({ label: "Score", value: String(d.score) });
    return {
      rich: true,
      kicker: "HOLE",
      title: course ?? "On the course",
      subtitle: who,
      hero: { big: `Hole ${d.hole}`, small: name },
      stats,
      photo,
      pageTitle: `${who}${name ? `: ${name}` : ""} on the ${d.hole}${at}`,
      pageDescription: `${who} shared a hole on PinPals${at}.`,
    };
  }

  if (post.kind === "shot" && post.details && typeof post.details === "object") {
    const d = post.details as ShotDetails;
    const stats: ShareStat[] = [];
    if (d.hole !== undefined) stats.push({ label: "Hole", value: String(d.hole) });
    if (d.shot_number !== undefined) stats.push({ label: "Shot", value: String(d.shot_number) });
    if (d.lie) stats.push({ label: "From", value: LIE_LABELS[d.lie] });
    if (d.result) stats.push({ label: "Result", value: d.result });
    const big = d.distance_yards !== undefined ? `${d.distance_yards} yds` : d.club ?? d.result ?? "Great shot";
    const small = d.distance_yards !== undefined ? d.club ?? null : null;
    return {
      rich: true,
      kicker: "SHOT",
      title: course ?? "On the course",
      subtitle: who,
      hero: { big, small },
      stats: stats.slice(0, 4),
      photo,
      pageTitle: `${who}'s shot${at}`,
      pageDescription: `${who} shared a shot on PinPals${at}.`,
    };
  }

  return {
    rich: true,
    kicker: "PINPALS",
    title: course ?? "On the course",
    subtitle: who,
    hero: null,
    stats: [],
    photo,
    pageTitle: `${who} shared a post${at}`,
    pageDescription: `${who} shared a post on PinPals${at}.`,
  };
}
