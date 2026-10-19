import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { chatPreview, type ChatPreview } from "@/lib/group-chat";
import { cardNameColour } from "@/lib/group-chat-rules";
import { inboxTime, sendMessage } from "@/lib/messages";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The chat card at the top of a Golf Buddies group's or a trip's page (0181).
 *
 * The group's chat is the same conversation that sits in Messages, so the
 * unread count here and there is the same number. The card shows the last
 * two messages and takes a quick reply without leaving the page; tapping
 * anywhere else opens the full chat.
 *
 * It refreshes when the page comes back into view rather than listening
 * live: the open chat screen holds the conversation's realtime channel, and
 * two subscriptions to one channel in the same app trip over each other.
 */
export function GroupChatCard({ conversationId, trip, memberCount }: { conversationId: number; trip: boolean; memberCount: number }) {
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setPreview(await chatPreview(conversationId));
    } catch {
      // The card is a shortcut; the chat itself still opens.
      setPreview((p) => p ?? { latest: [], unread: 0 });
    }
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const open = () => router.push({ pathname: "/conversation/[id]", params: { id: String(conversationId) } });

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await sendMessage(conversationId, body);
      setDraft("");
      await load();
    } catch (err) {
      Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSending(false);
    }
  }

  const name = trip ? "Trip chat" : "Group chat";
  const last = preview?.latest[preview.latest.length - 1];
  const sub = last ? `${memberCount} ${trip ? "golfers" : "members"} · last message ${inboxTime(last.created_at)}` : `${memberCount} ${trip ? "golfers" : "members"}`;

  return (
    <View style={styles.card}>
      <Pressable style={styles.top} onPress={open} accessibilityRole="button" accessibilityLabel={`Open the ${name.toLowerCase()}${preview?.unread ? `, ${preview.unread} unread` : ""}`}>
        <View style={styles.icon}>
          <Ionicons name="chatbubbles" size={20} color={colors.navy900} />
        </View>
        <View style={styles.titles}>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        {preview?.unread ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{preview.unread > 99 ? "99+" : preview.unread}</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.gold400} />
        )}
      </Pressable>

      <Pressable style={styles.lines} onPress={open} accessibilityRole="button" accessibilityLabel="Latest messages. Opens the chat.">
        {preview === null ? (
          <ActivityIndicator color={colors.gold400} />
        ) : preview.latest.length === 0 ? (
          <Text style={styles.empty}>
            {trip ? "Everyone you invite to the trip joins this chat. Say hello, share flights, plan the rooms." : "Everyone in the group is in this chat. Get the next round sorted."}
          </Text>
        ) : (
          preview.latest.map((m) => (
            <View key={m.id} style={styles.line}>
              <Text style={[styles.who, { color: cardNameColour(m.sender_id) }]} numberOfLines={1}>
                {m.senderFirstName}
              </Text>
              <Text style={styles.what} numberOfLines={2}>
                {m.body || (m.image_path ? "Photo" : "")}
              </Text>
            </View>
          ))
        )}
      </Pressable>

      <View style={styles.reply}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={trip ? "Message the trip…" : "Message the group…"}
          placeholderTextColor="#9fb0c8"
          returnKeyType="send"
          onSubmitEditing={() => void send()}
          maxLength={4000}
          accessibilityLabel={trip ? "Message the trip" : "Message the group"}
        />
        <Pressable
          style={[styles.send, !draft.trim() && styles.sendIdle]}
          onPress={() => (draft.trim() ? void send() : open())}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel={draft.trim() ? "Send" : "Open the chat"}
        >
          {sending ? <ActivityIndicator size="small" color={colors.navy900} /> : <Ionicons name={draft.trim() ? "arrow-up" : "arrow-forward"} size={18} color={colors.navy900} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.navy900, borderRadius: 20, padding: 14, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  titles: { flex: 1, gap: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  sub: { fontFamily: fonts.body, fontSize: 13, color: "#b9c4d6" },
  badge: { minWidth: 26, height: 26, paddingHorizontal: 7, borderRadius: 13, backgroundColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },
  lines: { gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,0.18)", paddingTop: 11, minHeight: 24 },
  line: { flexDirection: "row", gap: 8 },
  who: { fontFamily: fonts.bodyBold, fontSize: type.small, maxWidth: 110 },
  what: { flex: 1, fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: "#e6ebf3" },
  empty: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: "#d4dcea" },
  reply: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingLeft: spacing.md, paddingRight: 5, height: 46 },
  // 16pt: iOS zooms into anything smaller when it takes focus.
  input: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.cream50, paddingVertical: 0 },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  sendIdle: { opacity: 0.85 },
});
