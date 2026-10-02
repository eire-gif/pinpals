import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { EmojiTray } from "@/components/emoji-tray";
import { ApiError, type UploadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  MESSAGE_MAX_LENGTH,
  conversationHeader,
  dayLabel,
  listMessages,
  markRead,
  sendMessage,
  sendPhotoMessage,
  signedImageUrls,
  type ConversationHeader,
  type Cursor,
  type Message,
} from "@/lib/messages";
import { subscribeToConversation } from "@/lib/realtime";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * One conversation.
 *
 * The list is inverted, which is the whole trick to a chat screen: newest at
 * index 0 rendered at the bottom, so "scroll to the latest" is the resting
 * position rather than something to chase after every layout pass, and
 * loading older messages is an ordinary onEndReached at the top.
 *
 * It means the data stays newest-first exactly as the query returns it. No
 * reversing, which is what makes appending a live message a one-line
 * prepend instead of a splice into the middle of an array.
 */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Number(id);
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [header, setHeader] = useState<ConversationHeader | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  /**
   * Signed URLs for the photos in this thread, keyed by storage path.
   *
   * `message-images` is private (0086) and its URLs expire, so a message
   * carries the PATH and the screen asks for a link when it needs one. The
   * bucket's own SELECT policy is what grants it — a member who is not in
   * this conversation is refused by the database, not by this screen
   * choosing not to ask.
   */
  const [imageUrls, setImageUrls] = useState<Map<string, string>>(new Map());

  /** Signs whatever in this batch isn't signed already, and keeps the rest.
   *  Called on load, on every page of older messages, and on each live
   *  arrival — one place, so a photo can never appear without a link. */
  const signFor = useCallback(async (batch: Message[]) => {
    const needed = batch.filter((m) => m.image_path);
    if (needed.length === 0) return;
    const signed = await signedImageUrls(needed);
    if (signed.size === 0) return;
    setImageUrls((prev) => new Map([...prev, ...signed]));
  }, []);

  // Guards against the same message arriving twice — once as the reply to our
  // own POST, once over the broadcast channel — and against a duplicate
  // broadcast, which is explicitly allowed to happen.
  const add = useCallback(
    (incoming: Message) => {
      setMessages((prev) =>
        prev.some((m) => m.id === incoming.id) ? prev : [incoming, ...prev]
      );
      void signFor([incoming]);
    },
    [signFor]
  );

  const load = useCallback(async () => {
    if (!Number.isInteger(conversationId) || !userId) return;
    try {
      const [head, page] = await Promise.all([
        conversationHeader(conversationId, userId),
        listMessages(conversationId),
      ]);
      setHeader(head);
      setMessages(page.messages);
      setCursor(page.next);
      setError(null);
      void signFor(page.messages);
    } catch {
      setError("Couldn't load this conversation.");
    } finally {
      setLoading(false);
    }
  }, [conversationId, userId, signFor]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening a thread is reading it, and so is leaving one you sat in while
  // replies arrived. Twice, not once per message: the cursor only has to end
  // up at or past the newest message, and marking on every arrival would be
  // a write for every line the other person types.
  useEffect(() => {
    if (!userId || !Number.isInteger(conversationId)) return;
    void markRead(conversationId, userId);
    return () => {
      void markRead(conversationId, userId);
    };
  }, [conversationId, userId]);

  useEffect(() => {
    if (!Number.isInteger(conversationId)) return;
    return subscribeToConversation(conversationId, add);
  }, [conversationId, add]);

  const loadOlder = useCallback(async () => {
    if (!cursor || loadingOlder || loading) return;
    setLoadingOlder(true);
    try {
      const page = await listMessages(conversationId, cursor);
      setMessages((prev) => [...prev, ...page.messages]);
      setCursor(page.next);
      void signFor(page.messages);
    } catch {
      // Stop paging rather than erroring — the thread they can already see
      // is still perfectly usable.
      setCursor(null);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, cursor, loading, loadingOlder, signFor]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;

    setSending(true);
    setSendError(null);
    try {
      const sent = await sendMessage(conversationId, body);
      // Cleared only on success. A message the server refused — a card
      // number, a rate limit — stays in the box so it can be edited rather
      // than retyped.
      setDraft("");
      add(sent);
    } catch (err) {
      setSendError(
        err instanceof ApiError ? err.message : "Couldn't send that message."
      );
    } finally {
      setSending(false);
    }
  };

  /**
   * Sends a photo, with whatever is in the box as its caption.
   *
   * ONE REQUEST, not an upload then a send. /api/app/messages/photo does
   * both, so a phone that drops signal part-way cannot leave a picture in
   * Storage that no message points at — see the route's own comment.
   *
   * The app never touches Storage itself, here or anywhere. A phone photo
   * carries EXIF, EXIF carries GPS, and the sharp pipeline on the server is
   * the only thing that strips it; `message-images` gives members no insert
   * policy at all precisely so there is no second path to forget.
   */
  const sendPhoto = async (asset: ImagePicker.ImagePickerAsset) => {
    if (sending) return;

    const file: UploadFile = {
      uri: asset.uri,
      // A camera capture often has no filename of its own.
      name: asset.fileName ?? `photo-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
    };

    setSending(true);
    setSendError(null);
    try {
      const caption = draft.trim();
      const sent = await sendPhotoMessage(conversationId, file, caption);
      setDraft("");
      add(sent);
    } catch (err) {
      setSendError(
        err instanceof ApiError ? err.message : "Couldn't send that photo."
      );
    } finally {
      setSending(false);
    }
  };

  const capture = async (source: "camera" | "library") => {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        source === "camera" ? "Camera is off" : "Photos are off",
        "PinPals needs this to send a photo. You can turn it on in Settings.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings() },
        ]
      );
      return;
    }

    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
            // One at a time. A photo here is a message, and five photos
            // picked at once would be five messages sent without anyone
            // deciding to send five messages.
            allowsMultipleSelection: false,
          });

    if (result.canceled || !result.assets[0]) return;
    await sendPhoto(result.assets[0]);
  };

  const pickPhoto = () => {
    setEmojiOpen(false);
    Alert.alert("Send a photo", undefined, [
      { text: "Take a photo", onPress: () => void capture("camera") },
      { text: "Choose from library", onPress: () => void capture("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  /**
   * The tray and the keyboard are alternatives, never both.
   *
   * Opening the tray dismisses the keyboard, because otherwise the two stack
   * and the message list is squeezed into a few lines. Tapping the box again
   * closes the tray for the same reason, and that is handled on the input's
   * own onFocus rather than here.
   */
  const toggleEmoji = () => {
    setEmojiOpen((open) => {
      if (!open) Keyboard.dismiss();
      return !open;
    });
  };

  const over = draft.trim().length > MESSAGE_MAX_LENGTH;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      // The header is already offset by the safe area; without this the
      // composer floats a header's height above the keyboard.
      keyboardVerticalOffset={Platform.OS === "ios" ? 96 : 0}
    >
      <Stack.Screen
        options={{
          title: header?.otherName ?? "Message",
          headerBackTitle: "Back",
        }}
      />

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.green700} />
        </View>
      ) : (
        <>
          {header?.listingTitle ? (
            <Pressable
              style={styles.context}
              onPress={() =>
                router.push({
                  pathname: "/web",
                  params: {
                    path: `/marketplace/${header.listingId}`,
                    title: header.listingTitle ?? "Listing",
                  },
                })
              }
              accessibilityRole="button"
            >
              <Ionicons
                name="pricetag-outline"
                size={15}
                color={colors.ink500}
              />
              <Text style={styles.contextLabel} numberOfLines={1}>
                {header.listingTitle}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={15}
                color={colors.ink500}
              />
            </Pressable>
          ) : null}

          <FlatList
            inverted
            contentContainerStyle={styles.list}
            data={messages}
            keyExtractor={(item) => String(item.id)}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons
                  name={error ? "cloud-offline-outline" : "chatbubble-outline"}
                  size={40}
                  color={colors.ink500}
                />
                <Text style={styles.emptyTitle}>
                  {error ?? "No messages yet"}
                </Text>
                <Text style={styles.emptyBody}>
                  {error ? "Go back and try again." : "Say hello."}
                </Text>
              </View>
            }
            ListFooterComponent={
              loadingOlder ? (
                <ActivityIndicator
                  color={colors.green700}
                  style={styles.older}
                />
              ) : null
            }
            renderItem={({ item, index }) => {
              // Inverted, so the NEXT item in the array is the previous
              // message in time — and a day heading belongs above the first
              // message of each day, which is the last one we meet.
              const older = messages[index + 1];
              const newDay =
                !older ||
                older.created_at.slice(0, 10) !== item.created_at.slice(0, 10);

              return (
                <>
                  {newDay ? (
                    <Text style={styles.day}>{dayLabel(item.created_at)}</Text>
                  ) : null}
                  <Bubble
                    message={item}
                    mine={item.sender_id === userId}
                    imageUrl={
                      item.image_path ? (imageUrls.get(item.image_path) ?? null) : null
                    }
                    avatarUrl={header?.otherAvatarUrl ?? null}
                    avatarColor={header?.otherAvatarColor ?? null}
                    name={header?.otherName ?? null}
                  />
                </>
              );
            }}
          />

          <View style={styles.composer}>
            {sendError ? (
              <Text style={styles.sendError}>{sendError}</Text>
            ) : null}

            <View style={styles.composerRow}>
              <Pressable
                onPress={pickPhoto}
                disabled={sending}
                style={styles.tool}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Send a photo"
              >
                <Ionicons
                  name="camera-outline"
                  size={23}
                  color={sending ? colors.ink500 : colors.green700}
                />
              </Pressable>

              <Pressable
                onPress={toggleEmoji}
                style={styles.tool}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ expanded: emojiOpen }}
                accessibilityLabel={emojiOpen ? "Hide emoji" : "Add an emoji"}
              >
                <Ionicons
                  name={emojiOpen ? "happy" : "happy-outline"}
                  size={23}
                  color={colors.green700}
                />
              </Pressable>

              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                // The tray takes the keyboard's place, so returning to the
                // box has to put the keyboard back.
                onFocus={() => setEmojiOpen(false)}
                placeholder="Write a message"
                placeholderTextColor={colors.ink500}
                multiline
                // Four lines before it scrolls: enough for a real reply,
                // short enough that it never swallows the conversation.
                maxLength={MESSAGE_MAX_LENGTH + 200}
                accessibilityLabel="Message"
              />
              <Pressable
                onPress={() => void send()}
                disabled={!draft.trim() || sending || over}
                style={[
                  styles.send,
                  (!draft.trim() || sending || over) && styles.sendOff,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send"
              >
                {sending ? (
                  <ActivityIndicator size="small" color={colors.cream50} />
                ) : (
                  <Ionicons name="arrow-up" size={20} color={colors.cream50} />
                )}
              </Pressable>
            </View>

            {over ? (
              <Text style={styles.sendError}>
                That's longer than {MESSAGE_MAX_LENGTH.toLocaleString("en-IE")}{" "}
                characters.
              </Text>
            ) : null}
          </View>

          {/* Below the composer, where the keyboard would be. Appending
              rather than replacing the draft, so an emoji can be added to a
              sentence someone is part-way through writing. */}
          {emojiOpen ? (
            <EmojiTray onPick={(emoji) => setDraft((text) => text + emoji)} />
          ) : null}
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  mine,
  imageUrl,
  avatarUrl,
  avatarColor,
  name,
}: {
  message: Message;
  mine: boolean;
  /** Signed, and short-lived. Null while it is still being signed, or if
   *  signing failed — the placeholder below covers both. */
  imageUrl: string | null;
  avatarUrl: string | null;
  avatarColor: string | null;
  name: string | null;
}) {
  // A hidden message keeps its row rather than vanishing. A conversation that
  // silently loses a line reads as a bug; a line saying it was removed reads
  // as moderation, which is what happened.
  if (message.hidden_at) {
    return (
      <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
        <View style={[styles.bubble, styles.removed]}>
          <Text style={styles.removedLabel}>This message was removed.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      {mine ? null : (
        <Avatar url={avatarUrl} color={avatarColor} name={name} size={26} />
      )}
      <View
        style={[
          styles.bubble,
          mine ? styles.mine : styles.theirs,
          // A photo fills the bubble edge to edge; padding around it would
          // frame it in green, which looks like a mistake rather than a
          // choice.
          message.image_path ? styles.bubblePhoto : null,
        ]}
      >
        {message.image_path ? (
          imageUrl ? (
            <Image
              source={{ uri: imageUrl }}
              style={styles.photo}
              // contain, not cover: this is somebody's photo of a club or a
              // scorecard, and cropping it to a tidy rectangle is how the
              // detail they were pointing at ends up off-screen.
              resizeMode="contain"
              accessibilityLabel="Photo"
            />
          ) : (
            // Covers both "not signed yet" and "signing failed". A spinner
            // that never resolves is worse than a still picture frame, and
            // the difference between the two lasts a few hundred
            // milliseconds.
            <View style={[styles.photo, styles.photoWaiting]}>
              <Ionicons name="image-outline" size={26} color={colors.ink500} />
            </View>
          )
        ) : null}

        {message.body ? (
          <Text
            style={[
              styles.body,
              mine && styles.bodyMine,
              message.image_path ? styles.caption : null,
            ]}
          >
            {message.body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },

  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surfaceTint,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  contextLabel: {
    flex: 1,
    fontFamily: fonts.bodySemi,
    fontSize: type.small,
    color: colors.ink900,
  },

  list: { padding: spacing.md, gap: spacing.sm, flexGrow: 1 },
  older: { paddingVertical: spacing.md },

  day: {
    alignSelf: "center",
    fontFamily: fonts.bodySemi,
    fontSize: type.label,
    color: colors.ink500,
    paddingVertical: spacing.sm,
  },

  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    maxWidth: "88%",
  },
  bubbleRowMine: { alignSelf: "flex-end", justifyContent: "flex-end" },
  bubble: {
    flexShrink: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: radii.lg,
  },
  theirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderBottomLeftRadius: radii.sm,
  },
  mine: {
    backgroundColor: colors.green700,
    borderBottomRightRadius: radii.sm,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 22,
    color: colors.ink900,
  },
  bodyMine: { color: colors.cream50 },

  bubblePhoto: { paddingHorizontal: 0, paddingTop: 0, overflow: "hidden" },
  // 4:3 rather than a fixed height, so a portrait photo and a landscape one
  // occupy the same slot and the list never has to guess a row height.
  photo: {
    width: 232,
    aspectRatio: 4 / 3,
    backgroundColor: colors.surfaceTint,
  },
  photoWaiting: { alignItems: "center", justifyContent: "center" },
  caption: { paddingHorizontal: 13, paddingVertical: 8 },

  removed: {
    backgroundColor: colors.surfaceTint,
    borderWidth: 1,
    borderColor: colors.line,
    borderStyle: "dashed",
  },
  removedLabel: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.ink500,
  },

  composer: {
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.cream50,
  },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  // 44pt square, the iOS minimum touch target, even though the glyph is 23.
  tool: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  // 16pt floor — iOS zooms the screen when a smaller input takes focus.
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.green700,
  },
  sendOff: { backgroundColor: colors.ink500, opacity: 0.4 },
  sendError: {
    fontFamily: fonts.body,
    fontSize: type.small,
    color: colors.red600,
  },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    // The list is inverted, so its children are too.
    transform: [{ scaleY: -1 }],
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.ink900,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink500,
    textAlign: "center",
  },
});
