import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { POST_KIND_LABELS } from "@/lib/post-details";
import { createShareLink, loadPost, setSaved, type FeedPost, type ShareTarget } from "@/lib/feed";
import { loadShareTargets, sendPostTo } from "@/lib/share-targets";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Share a post (phase 6), as a sheet — the mockup's "Share Post":
 *
 *   the card       a preview of what a link preview will show (made by the
 *                  website: app/s/[token]/opengraph-image.tsx). Golf details
 *                  only on your own posts; anyone else's shares plainly.
 *   inside PinPals send it to a conversation or a connection, as a message
 *                  the chat draws as a post card (lib/share-targets.ts)
 *   outside        the phone's own share sheet — WhatsApp, Messages,
 *                  Instagram, Copy — with the public share link
 *   save           the same private bookmark as the card's Save
 *
 * Attaching the card itself as an image file (rather than as a link
 * preview) needs a native module (expo-sharing / expo-file-system) and so a
 * TestFlight build; the link preview carries the same picture meanwhile.
 */
export default function ShareScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useWindowDimensions();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [link, setLink] = useState<{ url: string; imageUrl: string; rich: boolean } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [targets, setTargets] = useState<ShareTarget[] | null>(null);
  const [showTargets, setShowTargets] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<Record<string, "sending" | "sent">>({});

  useEffect(() => {
    if (!userId || !Number.isInteger(postId)) return;
    // The post only adds Save and a better message here; the link works without it.
    void loadPost(userId, postId).then(setPost).catch(() => setPost(null));
    createShareLink(postId)
      .then(setLink)
      .catch((err) => setLinkError(err instanceof Error ? err.message : "Couldn't make a share link."));
  }, [userId, postId]);

  useEffect(() => {
    if (showTargets && !targets && userId) void loadShareTargets(userId).then(setTargets).catch(() => setTargets([]));
  }, [showTargets, targets, userId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (targets ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [targets, query]);

  const cardWidth = width - spacing.md * 2;

  async function shareOutside() {
    if (!link) return;
    const where = post?.club ? ` at ${post.club.name}` : "";
    const message = post && link.rich ? `My ${POST_KIND_LABELS[post.kind].toLowerCase()}${where} on PinPals` : "On PinPals";
    try {
      // iOS draws `url` as a rich link (the card); Android has no url
      // field, so the link rides in the message.
      await Share.share(Platform.OS === "ios" ? { message, url: link.url } : { message: `${message}\n${link.url}` });
    } catch {
      // Dismissed.
    }
  }

  async function toggleSave() {
    if (!post || !userId) return;
    const next = !post.savedByMe;
    setPost({ ...post, savedByMe: next });
    try {
      await setSaved(post.id, userId, next);
    } catch (err) {
      setPost({ ...post, savedByMe: !next });
      Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Please try again.");
    }
  }

  async function send(target: ShareTarget) {
    const key = target.kind === "conversation" ? `c${target.conversationId}` : `m${target.memberId}`;
    if (sent[key]) return;
    setSent((s) => ({ ...s, [key]: "sending" }));
    try {
      await sendPostTo(target, postId, note);
      setSent((s) => ({ ...s, [key]: "sent" }));
    } catch (err) {
      setSent((s) => {
        const next = { ...s };
        delete next[key];
        return next;
      });
      Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Please try again.");
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Share post",
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.ink900} />
            </Pressable>
          ),
        }}
      />
      <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { width: cardWidth, height: Math.round((cardWidth * 630) / 1200) }]}>
          {link ? (
            <Image
              source={{ uri: link.imageUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onLoad={() => setImageReady(true)}
              accessibilityLabel="Share card preview"
            />
          ) : null}
          {!imageReady && (
            <View style={styles.cardWaiting}>
              {linkError ? (
                <Text style={styles.cardError}>{linkError}</Text>
              ) : (
                <ActivityIndicator color={colors.cream50} />
              )}
            </View>
          )}
        </View>
        {link && !link.rich ? (
          <Text style={styles.cardNote}>
            Shares a plain PinPals card. Golf details only go on cards for your own posts.
          </Text>
        ) : null}

        <View style={styles.group}>
          <Row
            icon="paper-plane"
            tint={colors.green700}
            title="Share within PinPals"
            subtitle="Send to a pal or a group chat"
            onPress={() => setShowTargets((s) => !s)}
            trailing={<Ionicons name={showTargets ? "chevron-up" : "chevron-down"} size={18} color={colors.ink500} />}
          />
          {showTargets && (
            <View style={styles.targets}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add a message (optional)"
                placeholderTextColor={colors.ink500}
                style={styles.input}
                maxLength={500}
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search chats and connections"
                placeholderTextColor={colors.ink500}
                style={styles.input}
                autoCorrect={false}
              />
              {targets === null ? (
                <ActivityIndicator style={{ marginVertical: spacing.md }} color={colors.green700} />
              ) : shown.length === 0 ? (
                <Text style={styles.emptyTargets}>
                  {query ? "Nobody by that name." : "No chats or connections yet — connect with golfers to share with them."}
                </Text>
              ) : (
                shown.map((t) => {
                  const key = t.kind === "conversation" ? `c${t.conversationId}` : `m${t.memberId}`;
                  const state = sent[key];
                  return (
                    <Pressable
                      key={key}
                      onPress={() => void send(t)}
                      style={({ pressed }) => [styles.target, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={state === "sent" ? `Sent to ${t.name}` : `Send to ${t.name}`}
                    >
                      {t.kind === "conversation" && t.group ? (
                        <View style={styles.groupIcon}>
                          <Ionicons name="people" size={16} color={colors.cream50} />
                        </View>
                      ) : (
                        <Avatar url={t.avatarUrl} color={t.avatarColor} name={t.name} size={34} />
                      )}
                      <Text style={styles.targetName} numberOfLines={1}>
                        {t.name}
                      </Text>
                      {state === "sending" ? (
                        <ActivityIndicator color={colors.green700} />
                      ) : state === "sent" ? (
                        <View style={styles.sentPill}>
                          <Ionicons name="checkmark" size={14} color={colors.green800} />
                          <Text style={styles.sentLabel}>Sent</Text>
                        </View>
                      ) : (
                        <View style={styles.sendPill}>
                          <Text style={styles.sendLabel}>Send</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })
              )}
            </View>
          )}
          <View style={styles.divider} />
          <Row
            icon="share-outline"
            tint={colors.navy800}
            title="Share outside PinPals"
            subtitle="WhatsApp, Messages, Instagram, copy link…"
            onPress={() => void shareOutside()}
            disabled={!link}
          />
          <View style={styles.divider} />
          <Row
            icon={post?.savedByMe ? "bookmark" : "bookmark-outline"}
            tint={colors.gold500}
            title={post?.savedByMe ? "Saved" : "Save post"}
            subtitle={post?.savedByMe ? "In your saved posts — only you can see them" : "Keep it in your saved posts"}
            onPress={() => void toggleSave()}
            disabled={!post}
          />
        </View>
      </ScrollView>
    </>
  );
}

function Row({
  icon,
  tint,
  title,
  subtitle,
  onPress,
  trailing,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && { opacity: 0.5 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <View style={[styles.rowIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={18} color={colors.cream50} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {trailing ?? <Ionicons name="chevron-forward" size={18} color={colors.ink500} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.md },
  card: { borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.navy900, alignSelf: "center" },
  cardWaiting: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  cardError: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.cream50, textAlign: "center", padding: spacing.md },
  cardNote: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, textAlign: "center", marginTop: -spacing.xs },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md - 2, minHeight: 64 },
  pressed: { backgroundColor: colors.surfaceTint },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  rowSubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 62 },
  targets: { paddingHorizontal: spacing.md - 2, paddingBottom: spacing.sm, gap: spacing.sm },
  input: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surfaceTint,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm + 4,
    minHeight: 44,
  },
  emptyTargets: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, paddingVertical: spacing.sm },
  target: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, minHeight: 52, borderRadius: radii.md, paddingHorizontal: 4 },
  groupIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.navy800, alignItems: "center", justifyContent: "center" },
  targetName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  sendPill: { backgroundColor: colors.green700, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  sendLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  sentPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.green100, borderRadius: radii.pill, paddingHorizontal: spacing.sm + 4, paddingVertical: 6 },
  sentLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green800 },
});
