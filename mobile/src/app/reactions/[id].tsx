import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";
import { ReactionDisc, ReactionStack } from "@/components/reactions";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadPost, loadReactors, loadResharers, type FeedPost, type Reactor, type Resharer } from "@/lib/feed";
import { ago, handicapLabel } from "@/lib/feed-rules";
import { connectionStates, conversationWith, requestConnection, type ConnectionState } from "@/lib/members";
import { REACTIONS, REACTION_INFO, topReactions, type ReactionKey } from "@/lib/reactions";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Who reacted to a post (Oct 2026, the "Reactions & Share" mock-ups) —
 * opened from "Seán Byrne and 11 others" on a card, as a sheet like
 * Comments and Share (presentation set in app/_layout.tsx).
 *
 *   header   Reactions · Comments · Shares, with their numbers. Comments
 *            opens the Comments sheet in place of this one.
 *   chips    All, then each reaction in use with its count.
 *   rows     face with their reaction on it, name, handicap (if shared) and
 *            club; Message for your PinPals, Add PinPal for anyone else.
 *   Shares   who shared it to their feed — the only shares with names
 *            (0166: a chat send or another app is counted, never named).
 *
 * Params: id, tab=shares to open on Shares.
 */
type Tab = "reactions" | "shares";

function ReactionsScreenInner() {
  const { id, tab: startTab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const postId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [tab, setTab] = useState<Tab>(startTab === "shares" ? "shares" : "reactions");
  const [filter, setFilter] = useState<ReactionKey | "all">("all");
  const [post, setPost] = useState<FeedPost | null>(null);
  const [reactors, setReactors] = useState<Reactor[] | null>(null);
  const [resharers, setResharers] = useState<Resharer[] | null>(null);
  const [links, setLinks] = useState<Map<string, ConnectionState>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(postId)) return;
    setFailed(false);
    try {
      const [p, r, s, c] = await Promise.all([
        loadPost(userId, postId),
        loadReactors(userId, postId),
        loadResharers(postId),
        connectionStates(userId).catch(() => new Map<string, ConnectionState>()),
      ]);
      setPost(p);
      setReactors(r);
      setResharers(s);
      setLinks(c);
    } catch {
      setFailed(true);
    }
  }, [userId, postId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Counts from the rows the viewer can actually see, so a chip never
  // promises people the list then doesn't show.
  const counts = useMemo(() => {
    const out: Partial<Record<ReactionKey, number>> = {};
    for (const r of reactors ?? []) out[r.reaction] = (out[r.reaction] ?? 0) + 1;
    return out;
  }, [reactors]);
  const used = REACTIONS.filter((r) => (counts[r] ?? 0) > 0).sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
  const shown = (reactors ?? []).filter((r) => filter === "all" || r.reaction === filter);

  async function message(member: { memberId: string }) {
    setBusy(member.memberId);
    try {
      const conversation = await conversationWith(member.memberId);
      router.push({ pathname: "/conversation/[id]", params: { id: String(conversation) } });
    } catch (err) {
      Alert.alert("Couldn't open that chat", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function addPinPal(member: { memberId: string; name: string }) {
    if (!userId) return;
    setBusy(member.memberId);
    try {
      await requestConnection(userId, member.memberId);
      setLinks((m) => new Map(m).set(member.memberId, { connectionId: -1, status: "pending", theirsToAnswer: false }));
    } catch (err) {
      Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const openMember = (memberId: string) => router.push({ pathname: "/member/[id]", params: { id: memberId } });

  const header = (
    <View style={styles.tabs} accessibilityRole="tablist">
      <Pressable
        onPress={() => setTab("reactions")}
        style={[styles.tab, tab === "reactions" && styles.tabOn]}
        accessibilityRole="tab"
        accessibilityState={{ selected: tab === "reactions" }}
        accessibilityLabel={`${reactors?.length ?? post?.likeCount ?? 0} reactions`}
      >
        <Text style={[styles.tabLabel, tab === "reactions" && styles.tabLabelOn]}>{reactors?.length ?? post?.likeCount ?? 0}</Text>
        {post && post.likeCount > 0 ? <ReactionStack reactions={topReactions(post.reactionCounts)} size={18} /> : null}
      </Pressable>
      <Pressable
        onPress={() => router.replace({ pathname: "/comments/[id]", params: { id: String(postId) } })}
        style={styles.tab}
        accessibilityRole="tab"
        accessibilityState={{ selected: false }}
      >
        <Text style={styles.tabLabel}>
          {post?.commentCount ?? 0} {post?.commentCount === 1 ? "comment" : "comments"}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => setTab("shares")}
        style={[styles.tab, tab === "shares" && styles.tabOn]}
        accessibilityRole="tab"
        accessibilityState={{ selected: tab === "shares" }}
      >
        <Text style={[styles.tabLabel, tab === "shares" && styles.tabLabelOn]}>
          {post?.shareCount ?? 0} {post?.shareCount === 1 ? "share" : "shares"}
        </Text>
      </Pressable>
    </View>
  );

  const body = (() => {
    if (failed) return <LoadError onRetry={() => void load()} what="reactions" size="screen" />;
    if (!reactors || !resharers) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;

    if (tab === "shares") {
      return (
        <FlatList
          data={resharers}
          keyExtractor={(s) => String(s.postId)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <StateMessage
              icon="arrow-redo-outline"
              title={post && post.shareCount > 0 ? "Shared privately" : "No shares yet"}
              body={
                post && post.shareCount > 0
                  ? "Nobody has shared this to their feed yet. Shares sent in a chat or to another app are counted, but never named."
                  : "When someone shares this post, it's counted here."
              }
            />
          }
          ListFooterComponent={
            resharers.length > 0 && post && post.shareCount > resharers.length ? (
              <Text style={styles.footnote}>Shares sent in a chat or to another app are counted, but never named.</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/post/[id]", params: { id: String(item.postId) } })}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="link"
              accessibilityLabel={`${item.name} shared this to their feed. Open their post`}
            >
              <Avatar url={item.avatarUrl} color={item.avatarColor} name={item.name} size={46} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {item.body ? `“${item.body}”` : "Shared to their feed"} · {ago(item.createdAt)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
            </Pressable>
          )}
        />
      );
    }

    return (
      <FlatList
        data={shown}
        keyExtractor={(r) => r.memberId}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          used.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} />
              {used.map((r) => (
                <Chip
                  key={r}
                  reaction={r}
                  label={String(counts[r])}
                  a11y={`${REACTION_INFO[r].label}, ${counts[r]}`}
                  selected={filter === r}
                  onPress={() => setFilter(r)}
                />
              ))}
            </ScrollView>
          ) : null
        }
        ListEmptyComponent={<StateMessage icon="golf-outline" title="No reactions yet" body="Be the first — tap React on the post." />}
        renderItem={({ item }) => {
          const link = links.get(item.memberId);
          const details = [item.handicap !== null ? handicapLabel(item.handicap) : null, item.homeClub].filter(Boolean).join(" · ");
          return (
            <View style={styles.row}>
              <Pressable
                onPress={() => openMember(item.memberId)}
                style={styles.rowMain}
                accessibilityRole="link"
                accessibilityLabel={`${item.isMe ? "You" : item.name}, ${REACTION_INFO[item.reaction].label}. Open profile`}
              >
                <View>
                  <Avatar url={item.avatarUrl} color={item.avatarColor} name={item.name} size={46} />
                  <View style={styles.badge}>
                    <ReactionDisc reaction={item.reaction} size={20} ring={colors.surface} />
                  </View>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.isMe ? `${item.name} (you)` : item.name}
                  </Text>
                  {details ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {details}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {item.isMe ? null : busy === item.memberId ? (
                <ActivityIndicator color={colors.green700} style={styles.button} />
              ) : link?.status === "accepted" ? (
                <Pressable onPress={() => void message(item)} style={[styles.button, styles.buttonOutline]} accessibilityRole="button" accessibilityLabel={`Message ${item.name}`}>
                  <Text style={styles.buttonOutlineLabel}>Message</Text>
                </Pressable>
              ) : link?.status === "pending" ? (
                link.theirsToAnswer ? (
                  <Pressable onPress={() => openMember(item.memberId)} style={[styles.button, styles.buttonOutline]} accessibilityRole="button" accessibilityLabel={`Answer ${item.name}'s request`}>
                    <Text style={styles.buttonOutlineLabel}>Respond</Text>
                  </Pressable>
                ) : (
                  <View style={[styles.button, styles.buttonQuiet]} accessibilityLabel="PinPal request sent">
                    <Text style={styles.buttonQuietLabel}>Requested</Text>
                  </View>
                )
              ) : (
                <Pressable onPress={() => void addPinPal(item)} style={[styles.button, styles.buttonSolid]} accessibilityRole="button" accessibilityLabel={`Add ${item.name} as a PinPal`}>
                  <Text style={styles.buttonSolidLabel}>Add PinPal</Text>
                </Pressable>
              )}
            </View>
          );
        }}
      />
    );
  })();

  return (
    <>
      <Stack.Screen
        options={{
          title: tab === "shares" ? "Shares" : "Reactions",
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.ink900} />
            </Pressable>
          ),
        }}
      />
      <View style={styles.fill}>
        {header}
        {body}
      </View>
    </>
  );
}

function Chip({
  label,
  reaction,
  selected,
  onPress,
  a11y,
}: {
  label: string;
  reaction?: ReactionKey;
  selected: boolean;
  onPress: () => void;
  a11y?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={a11y ?? label}
    >
      {reaction ? <ReactionDisc reaction={reaction} size={18} /> : null}
      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface },
  tabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md - 4,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  tab: { flexDirection: "row", alignItems: "center", gap: spacing.sm - 2, minHeight: 40, paddingHorizontal: spacing.sm + 4, borderRadius: radii.pill },
  tabOn: { backgroundColor: colors.green100 },
  tabLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  tabLabelOn: { fontFamily: fonts.bodyBold, color: colors.green800 },
  list: { paddingBottom: spacing.xl * 2, flexGrow: 1 },
  chips: { gap: spacing.sm - 2, paddingHorizontal: spacing.md, paddingTop: spacing.sm + 2, paddingBottom: spacing.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  chipLabelOn: { color: colors.cream50 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 64 },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm + 4 },
  pressed: { backgroundColor: colors.surfaceTint },
  badge: { position: "absolute", right: -3, bottom: -3 },
  rowText: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.ink900 },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
  button: { minHeight: 36, minWidth: 96, borderRadius: radii.pill, paddingHorizontal: spacing.md - 2, alignItems: "center", justifyContent: "center" },
  buttonSolid: { backgroundColor: colors.green700 },
  buttonSolidLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.cream50 },
  buttonOutline: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  buttonOutlineLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  buttonQuiet: { backgroundColor: colors.cream100 },
  buttonQuietLabel: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink500 },
  footnote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "center", padding: spacing.md },
});

/** Junior members (0159): Social isn't for under 18s — same gate as Comments and Share. */
export default function ReactionsScreen() {
  const gate = useAgeGate("social");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="social" title="Social" />;
  return <ReactionsScreenInner />;
}
