import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AchievementCard } from "@/components/achievement-card";
import { coursePhoto } from "@/components/course-photos";
import { achievementOf, ACHIEVEMENT_INFO } from "@/lib/achievements";
import type { FeedPost } from "@/lib/feed";
import {
  PROFILE_TABS,
  PROFILE_TAB_LABELS,
  achievementTally,
  chunk,
  dateBadge,
  roundStats,
  vsParLabel,
  type IdentityTile,
  type ProfileCourse,
  type ProfileTab,
  type RoundRow,
} from "@/lib/profile-sections";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The pieces of a member's page (phase 10): identity tiles, the section
 * tabs, and the Rounds / Courses / Highlights / Achievements sections.
 * Posts is the existing post list. What goes into each comes from
 * profile-sections.ts (pure, tested) and member-profile.ts / feed.ts (reads
 * under RLS) — nothing here decides who may see what.
 */

const openPost = (id: number) => router.push({ pathname: "/post/[id]", params: { id: String(id) } });
const openCourse = (id: number) => router.push({ pathname: "/course/[id]", params: { id: String(id) } });

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function IdentityTiles({ tiles, onPress }: { tiles: IdentityTile[]; onPress: (key: IdentityTile["key"]) => void }) {
  return (
    <View style={styles.tiles}>
      {tiles.map((t, i) => (
        <Pressable
          key={t.key}
          style={[styles.tile, i > 0 && styles.tileDivider]}
          onPress={() => onPress(t.key)}
          accessibilityRole="button"
          accessibilityLabel={`${t.value} ${t.label}${t.note ? `, ${t.note}` : ""}`}
        >
          <Text style={[styles.tileValue, t.empty && styles.tileValueEmpty]} numberOfLines={1}>
            {t.value}
          </Text>
          <Text style={styles.tileLabel}>{t.label}</Text>
          {t.note ? (
            <View style={styles.tileNote}>
              <Ionicons name="lock-closed" size={9} color={colors.ink500} />
              <Text style={styles.tileNoteText}>{t.note}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function ProfileTabs({ tab, onChange }: { tab: ProfileTab; onChange: (tab: ProfileTab) => void }) {
  return (
    <View style={styles.tabsWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
        {PROFILE_TABS.map((t) => {
          const on = t === tab;
          return (
            <Pressable
              key={t}
              onPress={() => onChange(t)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{PROFILE_TAB_LABELS[t]}</Text>
              <View style={[styles.tabBar, on && styles.tabBarOn]} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export function RoundsSection({ rows, empty }: { rows: RoundRow[]; empty: string }) {
  if (rows.length === 0) return <Empty icon="golf-outline" text={empty} />;
  const stats = roundStats(rows);
  return (
    <View style={styles.section}>
      <View style={styles.statStrip}>
        <MiniStat label="Rounds" value={String(stats.rounds)} />
        <MiniStat label="Best" value={stats.best ? String(stats.best.score) : "—"} />
        <MiniStat label="Average" value={stats.average === null ? "—" : String(stats.average)} />
        <MiniStat label="Birdies" value={String(stats.birdies)} />
      </View>
      {rows.map((r) => {
        const d = dateBadge(r.date);
        const rel = vsParLabel(r.vsPar);
        const sub = [r.holes === 9 ? "9 holes" : "18 holes", r.tee ? `${r.tee} tees` : null, r.birdies ? `${r.birdies} ${r.birdies === 1 ? "birdie" : "birdies"}` : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <Pressable
            key={r.postId}
            style={styles.roundRow}
            onPress={() => openPost(r.postId)}
            accessibilityRole="button"
            accessibilityLabel={`${r.course ?? "A round"}, ${d.day} ${d.month}. ${r.score}${rel ? `, ${rel}` : ""}. ${sub}`}
          >
            <View style={styles.dateBadge}>
              <Text style={styles.dateDay}>{d.day}</Text>
              <Text style={styles.dateMonth}>{d.month.toUpperCase()}</Text>
            </View>
            <View style={styles.roundText}>
              <Text style={styles.roundCourse} numberOfLines={1}>
                {r.course ?? "A round of golf"}
              </Text>
              <Text style={styles.roundSub} numberOfLines={1}>
                {sub}
              </Text>
              {r.achievement ? (
                <View style={styles.achievementTag}>
                  <Ionicons name={ACHIEVEMENT_INFO[r.achievement].icon as keyof typeof Ionicons.glyphMap} size={11} color={colors.navy900} />
                  <Text style={styles.achievementTagText}>{ACHIEVEMENT_INFO[r.achievement].title}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.roundScore}>
              <Text style={styles.roundScoreValue}>{r.score}</Text>
              {rel ? <Text style={[styles.roundRel, r.vsPar !== null && r.vsPar <= 0 && styles.roundRelUnder]}>{rel}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatValue}>{value}</Text>
      <Text style={styles.miniStatLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export function CoursesSection({
  played,
  bucket,
  empty,
  onAdd,
}: {
  played: ProfileCourse[];
  bucket: ProfileCourse[];
  empty: string;
  /** The owner's way to add courses; absent for other readers. */
  onAdd?: () => void;
}) {
  if (played.length === 0 && bucket.length === 0) {
    return <Empty icon="flag-outline" text={empty} action={onAdd ? { label: "Add courses", onPress: onAdd } : undefined} />;
  }
  return (
    <View style={styles.section}>
      {played.length > 0 && (
        <>
          <Text style={styles.groupTitle}>
            Played <Text style={styles.groupCount}>· {played.length}</Text>
          </Text>
          {played.map((c) => (
            <CourseRow key={`p${c.clubId}`} course={c} />
          ))}
        </>
      )}
      {bucket.length > 0 && (
        <>
          <Text style={[styles.groupTitle, played.length > 0 && { marginTop: spacing.md }]}>
            Bucket list <Text style={styles.groupCount}>· {bucket.length}</Text>
          </Text>
          {bucket.map((c) => (
            <CourseRow key={`b${c.clubId}`} course={c} bucket />
          ))}
        </>
      )}
      {onAdd ? (
        <Pressable onPress={onAdd} style={styles.addLink} accessibilityRole="button">
          <Ionicons name="add-circle-outline" size={18} color={colors.green700} />
          <Text style={styles.addLinkText}>Add courses</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CourseRow({ course, bucket = false }: { course: ProfileCourse; bucket?: boolean }) {
  return (
    <Pressable
      style={styles.courseRow}
      onPress={() => openCourse(course.clubId)}
      accessibilityRole="link"
      accessibilityLabel={`${course.name}${course.home ? ", home course" : ""}${course.rating ? `, rated ${course.rating} of 5` : ""}`}
    >
      <Image source={coursePhoto(course.clubId, course.name)} style={styles.courseThumb} />
      <View style={styles.courseText}>
        <View style={styles.courseNameRow}>
          <Text style={styles.courseName} numberOfLines={1}>
            {course.name}
          </Text>
          {course.home ? (
            <View style={styles.homeBadge}>
              <Text style={styles.homeBadgeText}>HOME</Text>
            </View>
          ) : null}
        </View>
        {course.place ? <Text style={styles.coursePlace}>{course.place}</Text> : null}
        {course.rating ? (
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Ionicons key={n} name={n <= course.rating! ? "star" : "star-outline"} size={12} color={colors.gold500} />
            ))}
          </View>
        ) : null}
      </View>
      <Ionicons name={bucket ? "bookmark-outline" : "chevron-forward"} size={16} color={colors.ink500} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

export function HighlightsSection({ posts, width, empty, isMe = false }: { posts: FeedPost[]; width: number; empty: string; isMe?: boolean }) {
  if (posts.length === 0) return <Empty icon="sparkles-outline" text={empty} />;
  const gap = 4;
  const size = Math.floor((width - gap * 2) / 3);
  return (
    <View style={[styles.section, { gap }]}>
      <Text style={styles.sectionNote}>{isMe ? "Your" : "Their"} most-reacted posts</Text>
      {chunk(posts, 3).map((row, i) => (
        <View key={i} style={{ flexDirection: "row", gap }}>
          {row.map((p) => (
            <HighlightTile key={p.id} post={p} size={size} />
          ))}
        </View>
      ))}
    </View>
  );
}

function HighlightTile({ post, size }: { post: FeedPost; size: number }) {
  const photo = post.photos[0]?.url;
  const achievement = achievementOf({ kind: post.kind, details: post.details, courseName: post.club?.name ?? null });
  const label = achievement?.achievementTitle ?? (post.kind === "round" ? "Round" : post.kind === "hole" ? "Hole" : post.kind === "shot" ? "Shot" : null);
  return (
    <Pressable
      onPress={() => openPost(post.id)}
      style={[styles.hTile, { width: size, height: size }]}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${label ?? "Post"}${post.body ? `: ${post.body.slice(0, 80)}` : ""}. ${post.likeCount} reactions`}
    >
      <Image source={photo ? { uri: photo } : coursePhoto(post.club?.id ?? null, post.club?.name ?? null)} style={styles.hImage} />
      {!photo ? (
        <View style={styles.hVeil}>
          <Text style={styles.hText} numberOfLines={3}>
            {post.body || post.club?.name || label || ""}
          </Text>
        </View>
      ) : null}
      {achievement ? (
        <View style={styles.hMedal}>
          <Ionicons name={achievement.icon as keyof typeof Ionicons.glyphMap} size={11} color={colors.navy900} />
        </View>
      ) : null}
      <View style={styles.hCount}>
        <Ionicons name="flame" size={11} color={colors.cream50} />
        <Text style={styles.hCountText}>{post.likeCount}</Text>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export function AchievementsSection({ posts, width, empty }: { posts: FeedPost[]; width: number; empty: string }) {
  const cards = posts
    .map((p) => ({ post: p, a: achievementOf({ kind: p.kind, details: p.details, courseName: p.club?.name ?? null, createdAt: p.createdAt }) }))
    .filter((x): x is { post: FeedPost; a: NonNullable<typeof x.a> } => x.a !== null);
  if (cards.length === 0) return <Empty icon="trophy-outline" text={empty} />;
  const tally = achievementTally(cards.map((c) => c.post));
  return (
    <View style={styles.section}>
      <View style={styles.tally}>
        {tally.map((t) => (
          <View key={t.type} style={styles.tallyChip} accessible accessibilityLabel={`${t.title}, ${t.count}`}>
            <View style={styles.tallyMedal}>
              <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={12} color={colors.navy900} />
            </View>
            <Text style={styles.tallyText}>{t.title}</Text>
            {t.count > 1 ? <Text style={styles.tallyCount}>×{t.count}</Text> : null}
          </View>
        ))}
      </View>
      {cards.map(({ post, a }) => (
        <AchievementCard
          key={post.id}
          achievement={a}
          width={width}
          photo={post.photos[0]?.url ? { uri: post.photos[0].url } : coursePhoto(post.club?.id ?? null, post.club?.name ?? null)}
          onPress={() => openPost(post.id)}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------

function Empty({
  icon,
  text,
  action,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={colors.ink500} />
      <Text style={styles.emptyText}>{text}</Text>
      {action ? (
        <Pressable onPress={action.onPress} style={styles.emptyButton} accessibilityRole="button">
          <Text style={styles.emptyButtonText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: "row",
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 4,
    shadowColor: colors.navy900,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  tile: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 52, paddingHorizontal: 2 },
  tileDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.line },
  tileValue: { fontFamily: fonts.display, fontSize: 21, color: colors.ink900 },
  tileValueEmpty: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.green700, paddingVertical: 3 },
  tileLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, marginTop: 1 },
  tileNote: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  tileNoteText: { fontFamily: fonts.bodySemi, fontSize: 10, color: colors.ink500 },

  tabsWrap: { marginTop: spacing.lg, marginHorizontal: -spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  tabs: { flexGrow: 1, justifyContent: "space-between", paddingHorizontal: spacing.sm },
  tab: { minHeight: 44, paddingHorizontal: 6, justifyContent: "flex-end" },
  tabText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.ink500, paddingBottom: spacing.sm },
  tabTextOn: { color: colors.ink900 },
  tabBar: { height: 3, borderRadius: 2, backgroundColor: "transparent" },
  tabBarOn: { backgroundColor: colors.green700 },

  section: { marginTop: spacing.md, gap: spacing.sm },
  sectionNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginBottom: 2 },
  groupTitle: { fontFamily: fonts.display, fontSize: type.heading, color: colors.ink900 },
  groupCount: { fontFamily: fonts.body, fontSize: 15, color: colors.ink500 },

  statStrip: { flexDirection: "row", gap: spacing.sm, marginBottom: 2 },
  miniStat: { flex: 1, alignItems: "center", backgroundColor: colors.green100, borderRadius: radii.md, paddingVertical: spacing.sm + 2 },
  miniStatValue: { fontFamily: fonts.display, fontSize: 20, color: colors.green800 },
  miniStatLabel: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 0.8, color: colors.green700, marginTop: 1 },

  roundRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.sm + 4,
    minHeight: 64,
  },
  dateBadge: { width: 46, height: 50, borderRadius: radii.md, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  dateDay: { fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: colors.ink900 },
  dateMonth: { fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 1, color: colors.ink500 },
  roundText: { flex: 1, minWidth: 0 },
  roundCourse: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.ink900 },
  roundSub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },
  achievementTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.gold400,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 5,
  },
  achievementTagText: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.navy900 },
  roundScore: { alignItems: "flex-end", minWidth: 48 },
  roundScoreValue: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.ink900 },
  roundRel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink500 },
  roundRelUnder: { color: colors.green700 },

  courseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.sm,
    paddingRight: spacing.sm + 4,
    minHeight: 64,
  },
  courseThumb: { width: 52, height: 52, borderRadius: radii.md, backgroundColor: colors.cream100 },
  courseText: { flex: 1, minWidth: 0 },
  courseNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  courseName: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  coursePlace: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },
  homeBadge: { backgroundColor: colors.green700, borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 1 },
  homeBadgeText: { fontFamily: fonts.bodySemi, fontSize: 9.5, letterSpacing: 0.8, color: colors.cream50 },
  stars: { flexDirection: "row", gap: 1, marginTop: 3 },
  addLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: 44 },
  addLinkText: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.green700 },

  hTile: { borderRadius: radii.sm, overflow: "hidden", backgroundColor: colors.navy900 },
  hImage: { width: "100%", height: "100%" },
  hVeil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(12,32,56,0.6)", padding: 8, justifyContent: "center" },
  hText: { fontFamily: fonts.bodySemi, fontSize: 12.5, lineHeight: 16, color: colors.cream50 },
  hMedal: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.gold400,
    alignItems: "center",
    justifyContent: "center",
  },
  hCount: {
    position: "absolute",
    left: 6,
    bottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(12,32,56,0.65)",
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  hCountText: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.cream50 },

  tally: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: 2 },
  tallyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.navy900,
    borderRadius: radii.pill,
    paddingLeft: 4,
    paddingRight: 12,
    paddingVertical: 4,
  },
  tallyMedal: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  tallyText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.cream50 },
  tallyCount: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.gold400 },

  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyText: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500, textAlign: "center" },
  emptyButton: { marginTop: spacing.xs, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.green700, paddingHorizontal: spacing.md, minHeight: 40, justifyContent: "center" },
  emptyButtonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
