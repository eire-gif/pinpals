import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { GearCard } from "@/components/gear-card";
import { useAuth } from "@/lib/auth";
import { listMemberListings, type Card } from "@/lib/marketplace";
import {
  EMPTY_STATS,
  FEEDBACK_PAGE,
  FEEDBACK_TAG_LABELS,
  memberFeedback,
  memberStats,
  positiveShare,
  type FeedbackEntry,
  type MemberStats,
} from "@/lib/marketplace-cash";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A seller's marketplace page (mock-up 4) — the only place their feedback
 * lives. Their golf profile never shows it: buying a putter off someone says
 * nothing about their golf, and a bad trade shouldn't follow them onto the
 * first tee.
 */
type Person = { name: string; homeClub: string | null; avatarUrl: string | null; avatarColor: string | null; since: string | null };

export default function SellerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const memberId = String(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [person, setPerson] = useState<Person | null>(null);
  const [stats, setStats] = useState<MemberStats>(EMPTY_STATS);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [more, setMore] = useState(false);
  const [listings, setListings] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [profile, record, entries, cards] = await Promise.all([
        supabase
          .from("profiles")
          .select("first_name, last_name, home_club, avatar_url, avatar_color, created_at")
          .eq("id", memberId)
          .maybeSingle<{ first_name: string | null; last_name: string | null; home_club: string | null; avatar_url: string | null; avatar_color: string | null; created_at: string | null }>(),
        memberStats(memberId),
        memberFeedback(memberId),
        listMemberListings(memberId, userId).catch(() => []),
      ]);
      const p = profile.data;
      setPerson(
        p
          ? {
              name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "A member",
              homeClub: p.home_club,
              avatarUrl: p.avatar_url,
              avatarColor: p.avatar_color,
              since: p.created_at,
            }
          : null
      );
      setStats(record);
      setFeedback(entries);
      setMore(entries.length === FEEDBACK_PAGE);
      setListings(cards);
      setLoading(false);
    })();
  }, [memberId, userId]);

  const loadMore = useCallback(async () => {
    const last = feedback[feedback.length - 1];
    if (!last) return;
    const next = await memberFeedback(memberId, last.id);
    setFeedback((prev) => [...prev, ...next]);
    setMore(next.length === FEEDBACK_PAGE);
  }, [feedback, memberId]);

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Seller", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  if (!person) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <Stack.Screen options={{ title: "Seller", headerBackTitle: "Back" }} />
        <Text style={styles.emptyTitle}>Member not found</Text>
      </View>
    );
  }

  const total = stats.positive + stats.negative;
  const share = positiveShare(stats);
  const first = person.name.split(" ")[0];
  const trusted = stats.positive >= 10 && total > 0 && stats.positive / total >= 0.95;

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: memberId === userId ? "My marketplace page" : "Seller", headerBackTitle: "Back" }} />

      <View style={styles.head}>
        <Avatar url={person.avatarUrl} color={person.avatarColor} name={person.name} size={84} />
        <Text style={styles.name}>{person.name}</Text>
        <Text style={styles.meta}>
          {[person.homeClub, person.since ? `On PinPals since ${monthYear(person.since)}` : null].filter(Boolean).join(" · ")}
        </Text>
        <View style={styles.badges}>
          {trusted ? (
            <View style={[styles.badge, styles.badgeGreen]}>
              <Ionicons name="shield-checkmark" size={13} color={colors.green800} />
              <Text style={[styles.badgeText, { color: colors.green800 }]}>Trusted seller</Text>
            </View>
          ) : null}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{stats.sales} {stats.sales === 1 ? "sale" : "sales"}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>Marketplace feedback</Text>
          <Text style={styles.share}>{share ?? "No feedback yet"}</Text>
        </View>
        <Bar count={stats.positive} of={total} label="Positive" color={colors.green700} />
        <Bar count={stats.negative} of={total} label="Negative" color={colors.red600} />
        {stats.tags.length > 0 ? (
          <View style={styles.tagRow}>
            {stats.tags.slice(0, 6).map((t) => (
              <View key={t.tag} style={styles.tagChip}>
                <Text style={styles.tagChipText}>
                  {FEEDBACK_TAG_LABELS[t.tag]} <Text style={styles.tagCount}>· {t.count}</Text>
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ gap: 10 }}>
        <Text style={styles.section}>What people say</Text>
        {feedback.length === 0 ? (
          <Text style={styles.muted}>No feedback yet. It appears here once both sides of a sale have left theirs, or a week after.</Text>
        ) : (
          feedback.map((f) => (
            <View key={f.id} style={styles.entry}>
              <View style={styles.entryHead}>
                <Ionicons name={f.positive ? "thumbs-up" : "thumbs-down"} size={15} color={f.positive ? colors.green700 : colors.red600} />
                <Text style={[styles.entryWho, { color: f.positive ? colors.green700 : colors.red600 }]} numberOfLines={1}>
                  {f.reviewerName}
                </Text>
                <Text style={styles.entryWhen}>{ago(f.createdAt)}</Text>
              </View>
              {f.body ? <Text style={styles.entryBody}>{f.body}</Text> : null}
              {f.tags.length > 0 ? <Text style={styles.entryTags}>{f.tags.map((t) => FEEDBACK_TAG_LABELS[t]).join(" · ")}</Text> : null}
              <Text style={styles.entryItem} numberOfLines={1}>
                {f.role === "seller" ? "Bought" : "Sold them"}: {f.itemTitle}
              </Text>
            </View>
          ))
        )}
        {more ? (
          <Pressable onPress={() => void loadMore()} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryLabel}>Show more</Text>
          </Pressable>
        ) : null}
      </View>

      {listings.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.section}>For sale by {first} · {listings.length}</Text>
          <View style={styles.grid}>
            {listings.map((card) => (
              <View key={card.id} style={styles.gridCell}>
                <GearCard card={card} onPress={() => router.push(`/listing/${card.id}`)} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function monthYear(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IE", { month: "short", year: "numeric" });
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return monthYear(iso);
}

function Bar({ count, of, label, color }: { count: number; of: number; label: string; color: string }) {
  const width = of > 0 ? `${Math.max(count > 0 ? 3 : 0, Math.round((count / of) * 100))}%` : "0%";
  return (
    <View style={styles.bar}>
      <Text style={styles.barCount}>{count}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: width as `${number}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.barLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl },
  head: { alignItems: "center", gap: 6 },
  name: { fontFamily: fonts.display, fontSize: 26, color: colors.ink900, textAlign: "center" },
  meta: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
  badges: { flexDirection: "row", gap: 6, marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  badgeGreen: { backgroundColor: colors.green100, borderColor: colors.green100 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.ink900 },
  card: { gap: 12, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.navy900 },
  share: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12 },
  barCount: { width: 36, fontFamily: fonts.bodyBold, fontSize: 19, color: colors.ink900 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.cream100, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  barLabel: { width: 64, fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surfaceTint, borderWidth: 1, borderColor: colors.cream100 },
  tagChipText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink900 },
  tagCount: { fontFamily: fonts.body, color: colors.ink500 },
  section: { fontFamily: fonts.display, fontSize: 20, color: colors.navy900 },
  muted: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500 },
  entry: { gap: 4, padding: 14, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  entryHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  entryWho: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.small },
  entryWhen: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  entryBody: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink900 },
  entryTags: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.navy900 },
  entryItem: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  secondary: { minHeight: 44, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  secondaryLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gridCell: { width: "47.5%" },
  emptyTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
});
