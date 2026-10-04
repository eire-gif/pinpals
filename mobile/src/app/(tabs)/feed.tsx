import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { PostCard, postCardWidth } from "@/components/post-card";
import { RecapPrompt } from "@/components/recap-prompt";
import { ScreenHeader, useCollapsingHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import { loadFeed, type FeedEntry, type FeedPost } from "@/lib/feed";
import { openPostType } from "@/lib/post-compose";
import { POST_TYPE_INFO, type PostType } from "@/lib/post-details";
import { FEED_SCOPES, FEED_SCOPE_LABELS, type FeedScope } from "@/lib/feed-rules";
import { priceLine } from "@/lib/marketplace";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

/**
 * The Feed tab: what members are playing, posting and selling.
 *
 * Sits beside Marketplace in the tab bar. Posts are photos of rounds (or
 * anything golf), with likes and comments. Two tabs (phase 2): For You is
 * every post you may see, with a few new marketplace listings from the same
 * stretch of time; Following is your connections' posts, people only. Both
 * newest first. "My posts" sits beside them.
 *
 * Reads are direct to Supabase and RLS decides what appears — see
 * mobile/src/lib/feed.ts. Every write goes through the website.
 */
export default function FeedScreen() {
  // The photograph band shrinks to a strip as the list scrolls (see
  // screen-header.tsx), and opens again whenever the list is rebuilt.
  const { scrollY, resetY, scrollProps } = useCollapsingHeader();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useWindowDimensions();
  const cardWidth = postCardWidth(width);

  const [scope, setScope] = useState<FeedScope>("all");
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [noConnections, setNoConnections] = useState(false);
  const [loading, setLoading] = useState(true);
  // The list unmounts while loading, so its scroll position goes back to
  // the top — the band has to follow, or it stays collapsed over a list
  // that is no longer scrolled.
  useEffect(() => {
    if (loading) resetY.setValue(0);
  }, [loading, resetY]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ name: string; avatarUrl: string | null; avatarColor: string | null } | null>(null);

  // A slow first page must never land on top of a fast one for a different
  // scope. Same guard as the marketplace tab.
  const token = useRef(0);

  const load = useCallback(async () => {
    if (!userId) return;
    const mine = ++token.current;
    setError(null);
    try {
      const page = await loadFeed(userId, scope, null);
      if (mine !== token.current) return;
      setEntries(page.entries);
      setCursor(page.cursor);
      setNoConnections(page.noConnections);
    } catch (err) {
      if (mine === token.current) setError(err instanceof Error ? err.message : "Couldn't load the feed.");
    } finally {
      if (mine === token.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [userId, scope]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Coming back from posting, or from a post where you commented, should
  // show it. A focus refresh is cheaper than threading callbacks through
  // the router.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void load();
    }, [load])
  );

  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("profiles")
      .select("first_name, last_name, avatar_url, avatar_color")
      .eq("id", userId)
      .maybeSingle<{ first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null }>()
      .then(({ data }) => {
        if (data) {
          setMe({
            name: [data.first_name, data.last_name].filter(Boolean).join(" "),
            avatarUrl: data.avatar_url,
            avatarColor: data.avatar_color,
          });
        }
      });
  }, [userId]);

  async function loadMore() {
    if (!userId || !cursor || loadingMore) return;
    setLoadingMore(true);
    const mine = token.current;
    try {
      const page = await loadFeed(userId, scope, cursor);
      if (mine !== token.current) return;
      setEntries((prev) => [...prev, ...page.entries]);
      setCursor(page.cursor);
    } catch {
      // The posts already on screen are still good; a banner for a page
      // nobody asked for is noise.
    } finally {
      setLoadingMore(false);
    }
  }

  const update = useCallback((postId: number, change: (post: FeedPost) => FeedPost) => {
    setEntries((prev) =>
      prev.map((e) => (e.kind === "post" && e.item.id === postId ? { kind: "post", item: change(e.item) } : e))
    );
  }, []);
  const remove = useCallback((postId: number) => {
    setEntries((prev) => prev.filter((e) => !(e.kind === "post" && e.item.id === postId)));
  }, []);
  // A block takes the member's posts out of the list and their comments out
  // of everyone else's posts at once; the database hides them from here on.
  const afterBlock = useCallback((memberId: string) => {
    setEntries((prev) =>
      prev
        .filter((e) => !(e.kind === "post" && e.item.author.id === memberId))
        .map((e) =>
          e.kind === "post" && e.item.comments.some((c) => c.author.id === memberId)
            ? { kind: "post", item: { ...e.item, comments: e.item.comments.filter((c) => c.author.id !== memberId) } }
            : e
        )
    );
  }, []);
  const actions = usePostActions({ update, remove, reload: load, afterBlock });

  const header = (
    <View>
      <RecapPrompt userId={userId} style={styles.recap} />
      <View style={styles.compose}>
        <View style={styles.composeTop}>
          <Pressable
            onPress={() => router.push("/compose")}
            style={styles.composeMain}
            accessibilityRole="button"
            accessibilityLabel="Create a post"
          >
            <Avatar url={me?.avatarUrl} color={me?.avatarColor} name={me?.name} size={40} />
            <View style={styles.composeText}>
              <Text style={styles.composeTitle}>How did the round go?</Text>
              <Text style={styles.composePrompt} numberOfLines={1}>
                Share the view, the card, the fourball
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => openPostType("photo")}
            style={styles.composeCamera}
            accessibilityRole="button"
            accessibilityLabel="Share photos"
          >
            <Ionicons name="camera-outline" size={20} color={colors.cream50} />
          </Pressable>
        </View>
        {/* Straight to the four kinds members post most; the rest are a tap
            on the prompt away (compose.tsx). */}
        <View style={styles.quick}>
          {QUICK_TYPES.map(({ type: t, label }) => (
            <Pressable
              key={t}
              onPress={() => openPostType(t)}
              style={({ pressed }) => [styles.quickChip, pressed && styles.quickChipPressed]}
              accessibilityRole="button"
              accessibilityLabel={POST_TYPE_INFO[t].title}
            >
              <Ionicons name={POST_TYPE_INFO[t].icon as keyof typeof Ionicons.glyphMap} size={15} color={colors.green700} />
              <Text style={styles.quickLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.scopes}>
        <View style={styles.segment} accessibilityRole="tablist" accessibilityLabel="Feed">
          {FEED_SCOPES.map((s) => {
            const active = s === scope;
            return (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{FEED_SCOPE_LABELS[s]}</Text>
              </Pressable>
            );
          })}
        </View>
        {userId && (
          <Pressable
            onPress={() => router.push({ pathname: "/member/[id]", params: { id: userId } })}
            style={styles.myPosts}
            accessibilityRole="link"
            accessibilityLabel="My posts"
            hitSlop={6}
          >
            <Ionicons name="person-circle-outline" size={18} color={colors.green700} />
            <Text style={styles.myPostsLabel}>My posts</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.fill}>
      <ScreenHeader scene="oldHead" title="Feed" subtitle="Rounds and photos from PinPals members" scrollY={scrollY} />

      {loading ? (
        <View style={styles.list}>
          {header}
          <SkeletonCard />
          <View style={{ height: spacing.md }} />
          <SkeletonCard />
        </View>
      ) : (
        <FlatList
          {...scrollProps}
          data={entries}
          keyExtractor={(e) => `${e.kind}-${e.item.id}`}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
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
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.green700} /> : null}
          ListEmptyComponent={
            error ? (
              <Text style={styles.error}>{error}</Text>
            ) : noConnections ? (
              <Empty
                title="Nobody to follow yet"
                body="Following shows posts from golfers you're connected with. Connect with a few and their rounds land here."
                cta="Find golfers"
                onPress={() => router.push("/members")}
              />
            ) : (
              <Empty
                title="Be the first to post"
                body="Share a photo from your last round — the view from the 7th, the scorecard, the fourball."
                cta="Share a post"
                onPress={() => router.push("/compose")}
              />
            )
          }
          renderItem={({ item }) =>
            item.kind === "post" ? (
              <PostCard
                post={item.item}
                width={cardWidth}
                onLike={actions.like}
                onReact={actions.react}
                onShare={actions.share}
                onSave={actions.save}
                onMenu={actions.menu}
                onComment={(p) =>
                  router.push({ pathname: "/comments/[id]", params: { id: String(p.id), focus: "comment" } })
                }
                onCommentOptions={actions.commentOptions}
              />
            ) : (
              <Pressable
                onPress={() => router.push({ pathname: "/listing/[id]", params: { id: String(item.item.id) } })}
                style={styles.listing}
                accessibilityRole="link"
                accessibilityLabel={`New in the marketplace: ${item.item.title}`}
              >
                <View style={styles.listingKickerRow}>
                  <Ionicons name="pricetag" size={11} color={colors.gold500} />
                  <Text style={styles.listingKicker}>NEW IN THE MARKETPLACE</Text>
                </View>
                <View style={styles.listingRow}>
                  {item.item.imageUrl ? (
                    <Image source={{ uri: item.item.imageUrl }} style={styles.listingImage} />
                  ) : (
                    <View style={[styles.listingImage, styles.listingImageEmpty]}>
                      <Ionicons name="pricetag-outline" size={26} color={colors.ink500} />
                    </View>
                  )}
                  <View style={styles.listingText}>
                    <Text style={styles.listingTitle} numberOfLines={2}>
                      {item.item.title}
                    </Text>
                    <Text style={styles.listingPrice}>{priceLine(item.item).value}</Text>
                    {item.item.county ? <Text style={styles.listingMeta}>{item.item.county}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
                </View>
              </Pressable>
            )
          }
        />
      )}
    </View>
  );
}

/**
 * The shape of a post while the first page loads: a face, two lines, a
 * photograph and an action bar, gently pulsing. Better than a spinner on a
 * blank cream page — the member sees where things will land, and the list
 * appears into the space it already had.
 */
function SkeletonCard() {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[styles.skeleton, { opacity: pulse }]}
      accessible
      accessibilityLabel="Loading posts"
      accessibilityRole="progressbar"
    >
      <View style={styles.skeletonHeader}>
        <View style={styles.skeletonAvatar} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={[styles.skeletonLine, { width: "45%" }]} />
          <View style={[styles.skeletonLine, { width: "30%", height: 9 }]} />
        </View>
      </View>
      <View style={styles.skeletonPhoto} />
      <View style={[styles.skeletonLine, { width: "70%", marginHorizontal: spacing.md, marginTop: spacing.md }]} />
      <View style={[styles.skeletonLine, { width: "40%", marginHorizontal: spacing.md, marginVertical: spacing.sm }]} />
    </Animated.View>
  );
}

/** The quick chips under the feed's prompt, as in the mockup. */
const QUICK_TYPES: { type: PostType; label: string }[] = [
  { type: "photo", label: "Photo" },
  { type: "round", label: "Round" },
  { type: "hole", label: "Hole" },
  { type: "shot", label: "Shot" },
];

function Empty({ title, body, cta, onPress }: { title: string; body: string; cta: string; onPress: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      <Pressable onPress={onPress} style={styles.emptyButton} accessibilityRole="button">
        <Text style={styles.emptyButtonLabel}>{cta}</Text>
      </Pressable>
    </View>
  );
}

/** The same lift the post card uses, so everything in the list sits on the
 *  cream at one height. */
const lift = {
  shadowColor: colors.navy900,
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  compose: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingTop: spacing.sm + 4,
    paddingHorizontal: spacing.md - 2,
    ...lift,
  },
  // Only applied when the prompt renders (it's null with nothing to offer).
  recap: { marginBottom: spacing.md },
  composeTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  composeMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, minHeight: 44 },
  quick: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingVertical: spacing.xs,
  },
  quickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  quickChipPressed: { backgroundColor: colors.surfaceTint },
  quickLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  composeText: { flex: 1, minWidth: 0 },
  composeTitle: { fontFamily: fonts.display, fontSize: 17, color: colors.ink900 },
  composePrompt: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },
  composeCamera: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  scopes: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  // A segmented control rather than two loose chips: it is one choice
  // between two views of the same list, and should look like one.
  segment: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.cream100,
    borderRadius: radii.pill,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm - 1,
    borderRadius: radii.pill,
    minHeight: 38,
    justifyContent: "center",
  },
  segmentItemActive: { backgroundColor: colors.navy900 },
  segmentLabel: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink500 },
  segmentLabelActive: { color: colors.cream50 },
  myPosts: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 40,
    paddingHorizontal: spacing.xs,
  },
  myPostsLabel: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  listing: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.sm + 4,
    ...lift,
  },
  listingKickerRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: spacing.sm },
  listingKicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.4, color: colors.gold500 },
  listingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  listingImage: { width: 76, height: 76, borderRadius: radii.md, backgroundColor: colors.cream100 },
  listingImageEmpty: { alignItems: "center", justifyContent: "center" },
  listingText: { flex: 1, minWidth: 0 },
  listingTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  listingPrice: { fontFamily: fonts.display, fontSize: 17, color: colors.green700, marginTop: 2 },
  listingMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 2 },
  error: { fontFamily: fonts.body, fontSize: type.small, color: colors.red600, textAlign: "center", marginTop: spacing.lg },
  skeleton: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingBottom: spacing.sm,
  },
  skeletonHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md },
  skeletonAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.cream100 },
  skeletonLine: { height: 11, borderRadius: 6, backgroundColor: colors.cream100 },
  skeletonPhoto: { height: 220, backgroundColor: colors.cream100 },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyTitle: { fontFamily: fonts.display, fontSize: type.title, color: colors.ink900 },
  emptyBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", marginTop: spacing.sm },
  emptyButton: {
    marginTop: spacing.md,
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
  },
  emptyButtonLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
});
