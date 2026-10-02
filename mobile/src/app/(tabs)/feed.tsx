import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { PostCard } from "@/components/post-card";
import { ScreenHeader } from "@/components/screen-header";
import { useAuth } from "@/lib/auth";
import { loadFeed, type FeedEntry, type FeedPost } from "@/lib/feed";
import { FEED_SCOPES, FEED_SCOPE_LABELS, type FeedScope } from "@/lib/feed-rules";
import { priceLine } from "@/lib/marketplace";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { usePostActions } from "@/lib/use-post-actions";

/**
 * The Feed tab: what members are playing, posting and selling.
 *
 * Sits beside Marketplace in the tab bar. Posts are photos of rounds (or
 * anything golf), with likes and comments; "All PinPals" mixes in a few new
 * marketplace listings from the same stretch of time, "My connections" is
 * people only.
 *
 * Reads are direct to Supabase and RLS decides what appears — see
 * mobile/src/lib/feed.ts. Every write goes through the website.
 */
export default function FeedScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useWindowDimensions();
  const cardWidth = width - spacing.md * 2 - 2;

  const [scope, setScope] = useState<FeedScope>("all");
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [noConnections, setNoConnections] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const actions = usePostActions({ update, remove, reload: load });

  const header = (
    <View>
      <Pressable
        onPress={() => router.push("/new-post")}
        style={styles.compose}
        accessibilityRole="button"
        accessibilityLabel="Share a post"
      >
        <Avatar url={me?.avatarUrl} color={me?.avatarColor} name={me?.name} size={38} />
        <Text style={styles.composePrompt}>How did the round go?</Text>
        <Ionicons name="images-outline" size={22} color={colors.green700} />
      </Pressable>

      <View style={styles.scopes} accessibilityRole="tablist">
        {FEED_SCOPES.map((s) => {
          const active = s === scope;
          return (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              style={[styles.chip, active && styles.chipActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{FEED_SCOPE_LABELS[s]}</Text>
            </Pressable>
          );
        })}
        {userId && (
          <Pressable
            onPress={() => router.push({ pathname: "/member/[id]", params: { id: userId } })}
            style={styles.myPosts}
            accessibilityRole="link"
          >
            <Text style={styles.myPostsLabel}>My posts</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.fill}>
      <ScreenHeader scene="oldHead" title="Feed" subtitle="Rounds and photos from PinPals members" />

      {loading ? (
        <ActivityIndicator style={styles.spinner} color={colors.green700} />
      ) : (
        <FlatList
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
                title="No connections yet"
                body="Posts from golfers you connect with appear here."
                cta="Find golfers"
                onPress={() => router.push("/members")}
              />
            ) : (
              <Empty
                title="Be the first to post"
                body="Share a photo from your last round — the view from the 7th, the scorecard, the fourball."
                cta="Share a post"
                onPress={() => router.push("/new-post")}
              />
            )
          }
          renderItem={({ item }) =>
            item.kind === "post" ? (
              <PostCard
                post={item.item}
                width={cardWidth}
                onLike={actions.like}
                onMenu={actions.menu}
                onComment={(p) =>
                  router.push({ pathname: "/post/[id]", params: { id: String(p.id), focus: "comment" } })
                }
                onDeleteComment={actions.removeComment}
                onReportComment={actions.reportComment}
              />
            ) : (
              <Pressable
                onPress={() => router.push({ pathname: "/listing/[id]", params: { id: String(item.item.id) } })}
                style={styles.listing}
                accessibilityRole="link"
                accessibilityLabel={`New in the marketplace: ${item.item.title}`}
              >
                <Text style={styles.listingKicker}>NEW IN THE MARKETPLACE</Text>
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

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  compose: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.sm + 4,
  },
  composePrompt: { flex: 1, fontFamily: fonts.body, fontSize: type.body, color: colors.ink500 },
  scopes: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipLabel: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink900 },
  chipLabelActive: { color: colors.cream50 },
  myPosts: { marginLeft: "auto", paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  myPostsLabel: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.green700 },
  listing: {
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.sm + 4,
  },
  listingKicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.4, color: colors.gold500, marginBottom: spacing.sm },
  listingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  listingImage: { width: 76, height: 76, borderRadius: radii.md, backgroundColor: colors.cream100 },
  listingImageEmpty: { alignItems: "center", justifyContent: "center" },
  listingText: { flex: 1, minWidth: 0 },
  listingTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  listingPrice: { fontFamily: fonts.display, fontSize: 17, color: colors.green700, marginTop: 2 },
  listingMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: 2 },
  error: { fontFamily: fonts.body, fontSize: type.small, color: colors.red600, textAlign: "center", marginTop: spacing.lg },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
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
