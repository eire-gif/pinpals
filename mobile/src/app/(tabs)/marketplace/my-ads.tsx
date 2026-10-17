import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GearCard } from "@/components/gear-card";
import { useAuth } from "@/lib/auth";
import { LISTING_STATUS_LABELS, listMyListings, priceLabel, type MyListing } from "@/lib/listings";
import { setFavourite, type Card } from "@/lib/marketplace";
import {
  EMPTY_STATS,
  feedbackDue,
  memberStats,
  positiveShare,
  savedListings,
  useCashMarketplace,
  type FeedbackDue,
  type MemberStats,
} from "@/lib/marketplace-cash";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * My ads (mock-up 8): the member's marketplace profile.
 *
 * Feedback first — it only lives in the marketplace, never on the golf
 * profile, so this is where a member sees their own. Then anything waiting
 * for their feedback, then Selling / Sold / Saved. Each live ad has a "Sold?"
 * button, because marking sold is what opens feedback for both sides.
 */
type Tab = "selling" | "sold" | "saved";

const SELLING = new Set(["draft", "pending_review", "active", "reserved"]);

export default function MyAdsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const cash = useCashMarketplace();

  const [tab, setTab] = useState<Tab>("selling");
  const [mine, setMine] = useState<MyListing[]>([]);
  const [saved, setSaved] = useState<Card[]>([]);
  const [stats, setStats] = useState<MemberStats>(EMPTY_STATS);
  const [due, setDue] = useState<FeedbackDue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      const [listings, favourites, record, waiting] = await Promise.all([
        listMyListings(userId),
        savedListings(userId),
        memberStats(userId),
        feedbackDue(userId).catch(() => []),
      ]);
      setMine(listings);
      setSaved(favourites);
      setStats(record);
      setDue(waiting);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function unsave(card: Card) {
    if (!userId) return;
    setSaved((prev) => prev.filter((c) => c.id !== card.id));
    await setFavourite(card.id, userId, false);
  }

  if (loading) {
    return (
      <View style={[styles.fill, styles.centre]}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }

  const selling = mine.filter((l) => SELLING.has(l.status));
  const sold = mine.filter((l) => l.status === "sold");
  const total = stats.positive + stats.negative;
  const share = positiveShare(stats);

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.green700}
        />
      }
    >
      {/* -------- My feedback -------- */}
      <Pressable
        onPress={() => userId && router.push({ pathname: "/seller/[id]", params: { id: userId } })}
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityLabel="See my feedback"
      >
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>My feedback</Text>
          <Text style={styles.share}>{share ?? "No feedback yet"}</Text>
        </View>
        <Bar label="Positive" count={stats.positive} of={total} color={colors.green700} />
        <Bar label="Negative" count={stats.negative} of={total} color={colors.red600} />
        <Text style={styles.note}>Only shown in the marketplace, never on your golf profile.</Text>
      </Pressable>

      {/* -------- Waiting for my feedback -------- */}
      {due.length > 0 ? (
        <View style={styles.dueBox}>
          <Text style={styles.dueTitle}>Leave feedback</Text>
          {due.map((d) => (
            <Pressable
              key={d.saleId}
              onPress={() => router.push({ pathname: "/feedback/[id]", params: { id: String(d.saleId) } })}
              style={styles.dueRow}
              accessibilityRole="button"
            >
              {d.imageUrl ? <Image source={{ uri: d.imageUrl }} style={styles.dueThumb} /> : <View style={[styles.dueThumb, styles.thumbNone]} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {d.title}
                </Text>
                <Text style={styles.rowMeta}>How was the {d.otherRole}?</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.navy900} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* -------- Selling / Sold / Saved -------- */}
      <View style={styles.segment} accessibilityRole="tablist">
        {(
          [
            ["selling", `Selling · ${selling.length}`],
            ["sold", `Sold · ${sold.length}`],
            ["saved", `Saved · ${saved.length}`],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={[styles.segmentItem, tab === key && styles.segmentOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={[styles.segmentText, tab === key && styles.segmentTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "saved" ? (
        saved.length === 0 ? (
          <Empty icon="heart-outline" title="Nothing saved" body="Tap the heart on a listing to keep it here." />
        ) : (
          <View style={styles.grid}>
            {saved.map((card) => (
              <View key={card.id} style={styles.gridCell}>
                <GearCard card={card} onPress={() => router.push(`/listing/${card.id}`)} onFavourite={() => void unsave(card)} />
              </View>
            ))}
          </View>
        )
      ) : (tab === "selling" ? selling : sold).length === 0 ? (
        tab === "selling" ? (
          <Empty icon="camera-outline" title="Nothing for sale" body="Tap Sell to list your old clubs. It's free and takes a minute." />
        ) : (
          <Empty icon="checkmark-done-outline" title="Nothing sold yet" body="When you mark an ad sold, it moves here." />
        )
      ) : (
        (tab === "selling" ? selling : sold).map((l) => (
          <Pressable
            key={l.id}
            onPress={() => router.push(`/listing/${l.id}`)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            {l.imageUrl ? <Image source={{ uri: l.imageUrl }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbNone]} />}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.rowPrice}>{priceLabel(l.priceEur)}</Text>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {l.title}
              </Text>
              <Text style={styles.rowMeta}>{LISTING_STATUS_LABELS[l.status]}</Text>
            </View>
            {cash && (l.status === "active" || l.status === "reserved") ? (
              <Pressable
                onPress={() => router.push({ pathname: "/mark-sold/[id]", params: { id: String(l.id) } })}
                style={styles.soldButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${l.title} as sold`}
              >
                <Text style={styles.soldLabel}>Sold?</Text>
              </Pressable>
            ) : null}
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function Bar({ label, count, of, color }: { label: string; count: number; of: number; color: string }) {
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

function Empty({ icon, title, body }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={36} color={colors.ink500} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },

  card: { gap: 12, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.navy900 },
  share: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  note: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  bar: { flexDirection: "row", alignItems: "center", gap: 12 },
  barCount: { width: 36, fontFamily: fonts.bodyBold, fontSize: 19, color: colors.ink900 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.cream100, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  barLabel: { width: 64, fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },

  dueBox: { gap: 8, padding: spacing.md, borderRadius: radii.lg, backgroundColor: "#f3ead2" },
  dueTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  dueRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48 },
  dueThumb: { width: 44, height: 44, borderRadius: 10 },

  segment: { flexDirection: "row", padding: 4, borderRadius: radii.md, backgroundColor: colors.cream100 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.surface },
  segmentText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500 },
  segmentTextOn: { fontFamily: fonts.bodyBold, color: colors.navy900 },

  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  thumb: { width: 72, height: 72, borderRadius: radii.md },
  thumbNone: { backgroundColor: colors.surfaceTint },
  rowPrice: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  rowMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  soldButton: { minHeight: 36, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.navy900, justifyContent: "center" },
  soldLabel: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.navy900 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gridCell: { width: "47.5%" },
  empty: { alignItems: "center", gap: 6, paddingVertical: spacing.lg },
  emptyTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink900 },
  emptyBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
});
