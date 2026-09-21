import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  MESSAGE_MAX_LENGTH,
  conversationHeader,
  dayLabel,
  listMessages,
  markRead,
  sendMessage,
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

  // Guards against the same message arriving twice — once as the reply to our
  // own POST, once over the broadcast channel — and against a duplicate
  // broadcast, which is explicitly allowed to happen.
  const add = useCallback((incoming: Message) => {
    setMessages((prev) =>
      prev.some((m) => m.id === incoming.id) ? prev : [incoming, ...prev]
    );
  }, []);

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
    } catch {
      setError("Couldn't load this conversation.");
    } finally {
      setLoading(false);
    }
  }, [conversationId, userId]);

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
    } catch {
      // Stop paging rather than erroring — the thread they can already see
      // is still perfectly usable.
      setCursor(null);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, cursor, loading, loadingOlder]);

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
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
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
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  mine,
  avatarUrl,
  avatarColor,
  name,
}: {
  message: Message;
  mine: boolean;
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
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        <Text style={[styles.body, mine && styles.bodyMine]}>
          {message.body}
        </Text>
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
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
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
