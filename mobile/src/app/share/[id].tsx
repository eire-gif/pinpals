import { useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useContentWidth } from "@/lib/content-width";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/lib/auth";
import { POST_KIND_LABELS } from "@/lib/post-details";
import { createShareLink, loadPost, recordShare, setSaved, type FeedPost, type ShareTarget } from "@/lib/feed";
import { shareAddress, type ShareChannel } from "@/lib/reaction-summary";
import { loadShareTargets, sendPostTo } from "@/lib/share-targets";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";

/**
 * Share a post, as a sheet (phase 6; rebuilt Oct 2026 to the "Reactions &
 * Share" mock-ups):
 *
 *   the card       a preview of what a link preview will show (made by the
 *                  website: app/s/[token]/opengraph-image.tsx). Golf details
 *                  only on your own posts; anyone else's shares plainly.
 *   Send in PinPals  your recent chats and PinPals as a row of faces — tap
 *                  any number of them (or Search for anyone else), add a
 *                  message, "Send to 3". Each gets it as a message the chat
 *                  draws as a post card (lib/share-targets.ts).
 *   Share to your feed  the post under your own words (0164,
 *                  app/share-to-feed/[id].tsx) — posts shared with all
 *                  members only.
 *   outside        WhatsApp, Messages, Email, Facebook and X open with the
 *                  public share link ready; More is the phone's own sheet
 *                  (Instagram, Copy and the rest).
 *   save           the same private bookmark as the card's Save
 *
 * Every share is counted (record_post_share, 0164) — a number on the post,
 * never who sent it where.
 *
 * Attaching the card itself as an image file (rather than as a link
 * preview), Instagram Stories and a real Copy need native modules and so a
 * store build; the link preview and More cover them meanwhile.
 */
const key = (t: ShareTarget) => (t.kind === "conversation" ? `c${t.conversationId}` : `m${t.memberId}`);
const QUICK = 7;

type Outside = { channel: ShareChannel; label: string; icon: ComponentProps<typeof Ionicons>["name"]; bg: string };

// Brand colours darkened where needed so the white glyph clears 3:1.
const OUTSIDE: Outside[] = [
  { channel: "whatsapp", label: "WhatsApp", icon: "logo-whatsapp", bg: "#1a8d48" },
  { channel: "messages", label: "Messages", icon: "chatbubble", bg: "#2a8a43" },
  { channel: "email", label: "Email", icon: "mail", bg: colors.navy800 },
  { channel: "facebook", label: "Facebook", icon: "logo-facebook", bg: "#1b5fd1" },
  { channel: "x", label: "X", icon: "logo-x", bg: colors.ink900 },
  { channel: "other", label: "More", icon: "ellipsis-horizontal", bg: colors.surface },
];

/** What the phone's share sheet says it went to, as a channel. */
function channelOf(activityType: string | null | undefined): ShareChannel {
  const a = (activityType ?? "").toLowerCase();
  if (a.includes("whatsapp")) return "whatsapp";
  if (a.includes("message")) return "messages";
  if (a.includes("mail")) return "email";
  if (a.includes("facebook")) return "facebook";
  if (a.includes("twitter") || a.endsWith(".x")) return "x";
  if (a.includes("copy") || a.includes("pasteboard")) return "copy_link";
  return "other";
}

function ShareScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useContentWidth();

  const [post, setPost] = useState<FeedPost | null>(null);
  const [link, setLink] = useState<{ url: string; imageUrl: string; rich: boolean } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [targets, setTargets] = useState<ShareTarget[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Map<string, ShareTarget>>(new Map());
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string[] | null>(null);

  useEffect(() => {
    if (!userId || !Number.isInteger(postId)) return;
    // The post only adds Save and a better message here; the link works without it.
    void loadPost(userId, postId).then(setPost).catch(() => setPost(null));
    createShareLink(postId)
      .then(setLink)
      .catch((err) => setLinkError(err instanceof Error ? err.message : "Couldn't make a share link."));
    void loadShareTargets(userId).then(setTargets).catch(() => setTargets([]));
  }, [userId, postId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (targets ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [targets, query]);

  const cardWidth = width - spacing.md * 2;
  // A share of a share shares the original (0164); a connections-only post
  // stays with its author's connections.
  const feedTarget = post?.shared ? post.shared.post : post;
  const feedShareable = !!feedTarget && feedTarget.visibility === "members" && !feedTarget.hidden;

  function toggle(t: ShareTarget) {
    setSentTo(null);
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(key(t))) next.delete(key(t));
      else next.set(key(t), t);
      return next;
    });
  }

  async function sendAll() {
    if (sending || picked.size === 0) return;
    setSending(true);
    const chosen = [...picked.values()];
    const results = await Promise.allSettled(chosen.map((t) => sendPostTo(t, postId, note)));
    const failed = chosen.filter((_, i) => results[i].status === "rejected");
    const done = chosen.filter((_, i) => results[i].status === "fulfilled");
    if (done.length > 0) void recordShare(postId, "pinpals");
    setSending(false);
    if (failed.length === 0) {
      setSentTo(done.map((t) => t.name));
      setPicked(new Map());
      setNote("");
      setSearching(false);
      setQuery("");
    } else {
      // Keep only the ones that didn't go, so a retry doesn't send twice.
      setPicked(new Map(failed.map((t) => [key(t), t])));
      Alert.alert(
        done.length > 0 ? `Sent to ${done.length}, not to ${failed.length}` : "Couldn't send that",
        `${failed.map((t) => t.name).join(", ")} didn't get it. Please try again.`
      );
    }
  }

  async function shareOutside(o: Outside) {
    if (!link) return;
    const where = post?.club ? ` at ${post.club.name}` : "";
    const text = post && link.rich ? `My ${POST_KIND_LABELS[post.kind].toLowerCase()}${where} on PinPals` : "On PinPals";

    const address = shareAddress(o.channel, text, link.url, Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web");
    if (address) {
      try {
        await Linking.openURL(address);
        void recordShare(postId, o.channel);
      } catch {
        if (o.channel === "whatsapp") {
          // Not installed (or not allowed to ask): WhatsApp's web address
          // opens the app if it's there and the website if it isn't.
          try {
            await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(`${text}\n${link.url}`)}`);
            void recordShare(postId, "whatsapp");
          } catch {
            Alert.alert("Couldn't open WhatsApp", "Try More instead.");
          }
        } else {
          Alert.alert(`Couldn't open ${o.label}`, "Try More instead.");
        }
      }
      return;
    }

    try {
      // iOS draws `url` as a rich link (the card); Android has no url
      // field, so the link rides in the message.
      const result = await Share.share(Platform.OS === "ios" ? { message: text, url: link.url } : { message: `${text}\n${link.url}` });
      if (result.action === Share.sharedAction) void recordShare(postId, channelOf(result.activityType));
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

  const quick = (targets ?? []).slice(0, QUICK);
  // Anyone picked from Search who isn't in the quick row still shows there.
  const extraPicked = [...picked.values()].filter((t) => !quick.some((q) => key(q) === key(t)));

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
      <ScrollView
        keyboardDismissMode={KEYBOARD_DISMISS_MODE}
        automaticallyAdjustKeyboardInsets
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
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
              {linkError ? <Text style={styles.cardError}>{linkError}</Text> : <ActivityIndicator color={colors.cream50} />}
            </View>
          )}
        </View>
        {link && !link.rich ? (
          <Text style={styles.cardNote}>Shares a plain PinPals card. Golf details only go on cards for your own posts.</Text>
        ) : null}

        {/* Send in PinPals */}
        <Text style={styles.section}>Send in PinPals</Text>
        {targets === null ? (
          <ActivityIndicator style={{ marginVertical: spacing.sm }} color={colors.green700} />
        ) : targets.length === 0 ? (
          <Text style={styles.empty}>No chats or PinPals yet — add PinPals to send posts to them.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.faces}>
            {[...extraPicked, ...quick].map((t) => (
              <Face key={key(t)} target={t} selected={picked.has(key(t))} onPress={() => toggle(t)} />
            ))}
            <Pressable
              onPress={() => setSearching((s) => !s)}
              style={styles.face}
              accessibilityRole="button"
              accessibilityState={{ expanded: searching }}
              accessibilityLabel="Search chats and PinPals"
            >
              <View style={[styles.faceCircle, styles.searchCircle]}>
                <Ionicons name={searching ? "chevron-up" : "search"} size={22} color={colors.ink900} />
              </View>
              <Text style={styles.faceName}>Search</Text>
            </Pressable>
          </ScrollView>
        )}

        {searching && targets ? (
          <View style={styles.group}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search chats and PinPals"
              placeholderTextColor={colors.ink500}
              style={[styles.input, { margin: spacing.sm }]}
              autoCorrect={false}
              autoFocus
            />
            {shown.length === 0 ? (
              <Text style={[styles.empty, { paddingHorizontal: spacing.md, paddingBottom: spacing.md }]}>Nobody by that name.</Text>
            ) : (
              shown.slice(0, 40).map((t) => {
                const on = picked.has(key(t));
                return (
                  <Pressable
                    key={key(t)}
                    onPress={() => toggle(t)}
                    style={({ pressed }) => [styles.target, pressed && styles.pressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t.name}
                  >
                    <TargetFace target={t} size={36} />
                    <Text style={styles.targetName} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={26} color={on ? colors.green700 : colors.line} />
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}

        {picked.size > 0 ? (
          <View style={styles.sendBox}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add a message (optional)"
              placeholderTextColor={colors.ink500}
              style={styles.input}
              maxLength={500}
            />
            <Pressable
              onPress={() => void sendAll()}
              disabled={sending}
              style={({ pressed }) => [styles.sendButton, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`Send to ${[...picked.values()].map((t) => t.name).join(", ")}`}
            >
              {sending ? (
                <ActivityIndicator color={colors.cream50} />
              ) : (
                <>
                  <Ionicons name="paper-plane" size={18} color={colors.cream50} />
                  <Text style={styles.sendLabel}>
                    Send{picked.size === 1 ? ` to ${[...picked.values()][0].name.split(" ")[0]}` : ` to ${picked.size}`}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        ) : sentTo ? (
          <View style={styles.sent} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={18} color={colors.green700} />
            <Text style={styles.sentLabel} numberOfLines={2}>
              Sent to {sentTo.length <= 2 ? sentTo.join(" and ") : `${sentTo[0]} and ${sentTo.length - 1} others`}
            </Text>
          </View>
        ) : null}

        <View style={styles.group}>
          <Row
            icon="repeat"
            tint={colors.green700}
            title="Share to your feed"
            subtitle={
              !post
                ? "Loading…"
                : feedShareable
                  ? "Add a few words, choose who sees it"
                  : feedTarget?.hidden
                    ? "This post can't be shared"
                    : "This post is for its author's connections only"
            }
            onPress={() => router.push({ pathname: "/share-to-feed/[id]", params: { id: String(postId) } })}
            disabled={!feedShareable}
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

        {/* Outside PinPals */}
        <Text style={styles.section}>Share outside PinPals</Text>
        <View style={styles.grid}>
          {OUTSIDE.map((o) => (
            <Pressable
              key={o.channel}
              onPress={() => void shareOutside(o)}
              disabled={!link}
              style={({ pressed }) => [styles.tile, { width: (cardWidth - spacing.sm * 2) / 3 }, pressed && { opacity: 0.7 }, !link && { opacity: 0.45 }]}
              accessibilityRole="button"
              accessibilityLabel={o.channel === "other" ? "More ways to share, including Instagram and Copy" : `Share on ${o.label}`}
            >
              <View style={[styles.tileIcon, { backgroundColor: o.bg }, o.channel === "other" && styles.tileIconQuiet]}>
                <Ionicons name={o.icon} size={26} color={o.channel === "other" ? colors.ink900 : "#ffffff"} />
              </View>
              <Text style={styles.tileLabel}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

function TargetFace({ target, size }: { target: ShareTarget; size: number }) {
  if (target.kind === "conversation" && target.group) {
    return (
      <View style={[styles.groupIcon, { width: size, height: size, borderRadius: size / 2 }]}>
        <Ionicons name="people" size={Math.round(size * 0.45)} color={colors.gold400} />
      </View>
    );
  }
  return <Avatar url={target.avatarUrl} color={target.avatarColor} name={target.name} size={size} />;
}

function Face({ target, selected, onPress }: { target: ShareTarget; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.face}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={target.name}
    >
      <View style={[styles.faceCircle, selected && styles.faceCircleOn]}>
        <TargetFace target={target} size={56} />
        {selected ? (
          <View style={styles.tick}>
            <Ionicons name="checkmark" size={14} color={colors.cream50} />
          </View>
        ) : null}
      </View>
      <Text style={styles.faceName} numberOfLines={2}>
        {target.kind === "conversation" && target.group ? target.name : target.name.split(" ")[0]}
      </Text>
    </Pressable>
  );
}

function Row({
  icon,
  tint,
  title,
  subtitle,
  onPress,
  disabled = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  title: string;
  subtitle: string;
  onPress: () => void;
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
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
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
  section: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#7a5c12",
    marginBottom: -spacing.sm,
    marginTop: spacing.xs,
  },
  empty: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  faces: { gap: spacing.xs, paddingVertical: spacing.xs },
  face: { width: 72, alignItems: "center", gap: 6 },
  faceCircle: { borderRadius: 32, padding: 2, borderWidth: 2, borderColor: "transparent" },
  faceCircleOn: { borderColor: colors.green700 },
  searchCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green700,
    borderWidth: 2,
    borderColor: colors.cream50,
    alignItems: "center",
    justifyContent: "center",
  },
  faceName: { fontFamily: fonts.body, fontSize: 12, color: colors.ink900, textAlign: "center" },
  groupIcon: { backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
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
  target: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, minHeight: 52, paddingHorizontal: spacing.md - 2 },
  targetName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  sendBox: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.sm + 2,
  },
  sendButton: {
    minHeight: 48,
    borderRadius: radii.md,
    backgroundColor: colors.green700,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  sendLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  sent: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.green100, borderRadius: radii.md, padding: spacing.sm + 4 },
  sentLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 14, color: colors.green800 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 4, padding: spacing.md - 2, minHeight: 64 },
  pressed: { backgroundColor: colors.surfaceTint },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  rowSubtitle: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginLeft: 62 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, rowGap: spacing.md },
  tile: { alignItems: "center", gap: 6, minHeight: 44 },
  tileIcon: { width: 56, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tileIconQuiet: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  tileLabel: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink900 },
});

/** Junior members (0159): social aren't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function ShareScreen() {
  const gate = useAgeGate("social");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="social" title="Social" />;
  return <ShareScreenInner />;
}
