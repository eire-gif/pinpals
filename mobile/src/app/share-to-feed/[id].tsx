import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";
import { QuotedPost } from "@/components/quoted-post";
import { LoadError } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { useContentWidth } from "@/lib/content-width";
import { createPost, loadPost, type FeedPost } from "@/lib/feed";
import { POST_VISIBILITIES, POST_VISIBILITY_LABELS, type PostVisibility } from "@/lib/feed-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const MAX_BODY = 2000;

/**
 * Share to your feed (0166) — from the share sheet. The member's own words
 * (optional) over the post they're sharing, to everyone or to their
 * connections. The database decides what may be shared: a post they can
 * see, shared with all members; a share of a share becomes a share of the
 * original. The original's author is told, in their alerts.
 */
function ShareToFeedInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = Number(id);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { width } = useContentWidth();

  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("members");
  const [posting, setPosting] = useState(false);

  const load = async () => {
    if (!userId || !Number.isInteger(postId)) return;
    setFailed(false);
    try {
      const p = await loadPost(userId, postId);
      // Sharing a share shares what it shared.
      setPost(p?.shared ? p.shared.post : p);
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per post
  }, [userId, postId]);

  const cardWidth = width - spacing.md * 2;
  const canShare = !!post && post.visibility === "members" && !post.hidden;
  // A few words for now — app versions from before sharing would show a
  // share with none as an empty card (validatePostDraft on the website).
  const ready = canShare && body.trim().length > 0;

  async function share() {
    if (!post || posting || !ready) return;
    setPosting(true);
    try {
      const { id: newId } = await createPost({
        body,
        visibility,
        clubId: null,
        photoPaths: [],
        sharedPostId: post.id,
      });
      if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: "/post/[id]", params: { id: String(newId) } });
    } catch (err) {
      Alert.alert("Couldn't share that", err instanceof Error ? err.message : "Please try again.");
      setPosting(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Share to your feed",
          headerRight: () => (
            <Pressable
              onPress={() => void share()}
              disabled={!ready || posting}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Share now"
              style={{ opacity: !ready || posting ? 0.4 : 1 }}
            >
              {posting ? <ActivityIndicator color={colors.green700} /> : <Text style={styles.headerAction}>Share</Text>}
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardDismissMode={KEYBOARD_DISMISS_MODE}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {failed ? (
          <LoadError onRetry={() => void load()} what="the post" />
        ) : post === undefined ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="Say something about this post…"
              placeholderTextColor={colors.ink500}
              style={styles.input}
              multiline
              maxLength={MAX_BODY}
              autoFocus={canShare}
              accessibilityLabel="Your words"
            />
            <QuotedPost post={post} width={cardWidth} interactive={false} />
            {post && !canShare ? (
              <Text style={styles.note}>
                {post.hidden
                  ? "This post can't be shared."
                  : `This post is for ${post.author.name.split(" ")[0]}'s connections only, so it can be sent in a chat but not shared to your feed.`}
              </Text>
            ) : null}

            <Text style={styles.label}>Who can see it</Text>
            <View style={styles.group}>
              {POST_VISIBILITIES.map((v, i) => {
                const on = v === visibility;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setVisibility(v)}
                    style={[styles.option, i > 0 && styles.optionBorder]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Ionicons name={v === "members" ? "earth" : "people"} size={18} color={colors.green700} />
                    <Text style={styles.optionLabel}>{POST_VISIBILITY_LABELS[v]}</Text>
                    <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.green700 : colors.ink500} />
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => void share()}
              disabled={!ready || posting}
              style={({ pressed }) => [styles.button, (!ready || posting) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              {posting ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.buttonLabel}>Share to your feed</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  headerAction: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green700 },
  input: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.sm + 4,
    minHeight: 88,
    textAlignVertical: "top",
  },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.red600 },
  label: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.ink500, marginBottom: -spacing.sm },
  group: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, overflow: "hidden" },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2, minHeight: 52, paddingHorizontal: spacing.md - 2 },
  optionBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  optionLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  button: { minHeight: 52, borderRadius: radii.md, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  buttonLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
});

export default function ShareToFeedScreen() {
  const gate = useAgeGate("social");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="social" title="Social" />;
  return <ShareToFeedInner />;
}
