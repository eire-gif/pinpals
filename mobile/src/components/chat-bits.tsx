import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmojiTray } from "@/components/emoji-tray";
import { Avatar } from "@/components/avatar";
import { QUICK_REACTIONS, quoteLines, readBy } from "@/lib/chat-look";
import { dayLabel, messageTime, type Message, type MessageQuote, type ThreadMember } from "@/lib/messages";
import { colors, fonts, navyAlpha, radii, spacing, type } from "@/lib/theme";

/**
 * The pieces of the chat screen that aren't the list itself (Oct 2026):
 * the long-press sheet, the Info sheet, and the quote block used both inside
 * a bubble and above the composer.
 */

export type MessageAction = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
  onPress: () => void;
};

/**
 * Long-press a message: a row of reactions above it, the message itself so
 * it's clear which one you picked, and what you can do with it below.
 */
export function MessageActionsSheet({
  message,
  mine,
  myReaction,
  canReact,
  preview,
  actions,
  onReact,
  onClose,
}: {
  message: Message | null;
  mine: boolean;
  myReaction: string | null;
  canReact: boolean;
  /** One or two lines of what was said, for the copy of the bubble. */
  preview: string;
  actions: MessageAction[];
  onReact: (emoji: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [more, setMore] = useState(false);
  const open = message !== null;

  const close = () => {
    setMore(false);
    onClose();
  };

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.veil} onPress={close} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
        {canReact ? (
          <View style={[styles.reactBar, mine ? styles.alignEnd : styles.alignStart]}>
            {QUICK_REACTIONS.map((e) => (
              <Pressable
                key={e}
                onPress={() => {
                  onReact(e);
                  close();
                }}
                style={({ pressed }) => [styles.reactBtn, myReaction === e && styles.reactBtnOn, pressed && styles.reactPressed]}
                accessibilityRole="button"
                accessibilityLabel={myReaction === e ? `Remove ${e}` : `React ${e}`}
              >
                <Text style={styles.reactEmoji}>{e}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setMore((m) => !m)}
              style={({ pressed }) => [styles.reactBtn, styles.reactMore, pressed && styles.reactPressed]}
              accessibilityRole="button"
              accessibilityLabel="More emoji"
            >
              <Ionicons name={more ? "close" : "add"} size={22} color={colors.ink500} />
            </Pressable>
          </View>
        ) : null}

        {more ? (
          <View style={styles.trayCard}>
            <EmojiTray
              onPick={(e) => {
                onReact(e);
                close();
              }}
            />
          </View>
        ) : (
          <>
            <View style={[styles.previewBubble, mine ? styles.previewMine : styles.previewTheirs]}>
              <Text style={[styles.previewText, mine && styles.previewTextMine]} numberOfLines={6}>
                {preview}
              </Text>
              {message ? (
                <Text style={[styles.previewTime, mine && styles.previewTimeMine]}>{messageTime(message.created_at)}</Text>
              ) : null}
            </View>

            <View style={styles.actions}>
              {actions.map((a, i) => (
                <Pressable
                  key={a.key}
                  onPress={() => {
                    close();
                    // After the sheet has gone, so an Alert or a new screen
                    // isn't fighting the fade.
                    setTimeout(a.onPress, 250);
                  }}
                  style={({ pressed }) => [styles.action, i > 0 && styles.actionLine, pressed && styles.actionPressed]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.actionLabel, a.destructive && styles.danger]}>{a.label}</Text>
                  <Ionicons name={a.icon} size={20} color={a.destructive ? colors.red600 : colors.ink900} />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

/** Message info: when it was sent, and who has read it. */
export function MessageInfoSheet({
  message,
  members,
  onClose,
}: {
  message: Message | null;
  members: ThreadMember[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const rows = message ? readBy(message, members) : [];
  const read = rows.filter((r) => r.seenAt);
  const waiting = rows.filter((r) => !r.seenAt);
  const byId = new Map(members.map((m) => [m.id, m]));

  return (
    <Modal visible={message !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.veil} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View style={[styles.infoSheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grabber} />
        <Text style={styles.infoTitle}>Message info</Text>
        {message ? (
          <Text style={styles.infoSent}>
            Sent {dayLabel(message.created_at).toLowerCase() === "today" ? "today" : dayLabel(message.created_at)} at{" "}
            {messageTime(message.created_at)}
          </Text>
        ) : null}
        <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 2 }}>
          {read.length ? <Text style={styles.infoHead}>Read by</Text> : null}
          {read.map((r) => (
            <View key={r.id} style={styles.infoRow}>
              <Avatar url={byId.get(r.id)?.avatarUrl} color={byId.get(r.id)?.avatarColor} name={r.name} size={34} />
              <Text style={styles.infoName} numberOfLines={1}>{r.name}</Text>
              <Ionicons name="checkmark-done" size={18} color={colors.green600} />
              <Text style={styles.infoWhen}>{r.seenAt ? messageTime(r.seenAt) : ""}</Text>
            </View>
          ))}
          {waiting.length ? <Text style={styles.infoHead}>Not read yet</Text> : null}
          {waiting.map((r) => (
            <View key={r.id} style={styles.infoRow}>
              <Avatar url={byId.get(r.id)?.avatarUrl} color={byId.get(r.id)?.avatarColor} name={r.name} size={34} />
              <Text style={styles.infoName} numberOfLines={1}>{r.name}</Text>
              <Ionicons name="checkmark" size={18} color={colors.ink500} />
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The quoted message — inside a reply bubble, or above the box while a
 *  reply is being written. */
export function QuoteBlock({
  quote,
  me,
  nameOf,
  colourOf,
  onMine = false,
  onPress,
}: {
  quote: MessageQuote;
  me: string | null;
  nameOf: (id: string) => string | null;
  colourOf: (id: string) => string;
  /** Sitting on one of my own green bubbles. */
  onMine?: boolean;
  onPress?: () => void;
}) {
  const { who, text } = quoteLines(quote, me, nameOf);
  const accent = onMine ? colors.gold400 : quote.sender_id ? colourOf(quote.sender_id) : colors.ink500;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.quote, onMine ? styles.quoteOnMine : styles.quoteOnTheirs, { borderLeftColor: accent }]}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`Replying to ${who}: ${text}`}
    >
      <Text style={[styles.quoteWho, { color: onMine ? colors.gold400 : accent }]} numberOfLines={1}>
        {who}
      </Text>
      <Text style={[styles.quoteText, onMine && styles.quoteTextMine]} numberOfLines={2}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  veil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: navyAlpha(0.55) },
  sheetWrap: { flex: 1, justifyContent: "flex-end", paddingHorizontal: spacing.md, gap: 10 },
  alignEnd: { alignSelf: "flex-end" },
  alignStart: { alignSelf: "flex-start" },

  reactBar: {
    flexDirection: "row",
    gap: 2,
    padding: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  reactBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  reactBtnOn: { backgroundColor: colors.green100 },
  reactPressed: { transform: [{ scale: 1.18 }] },
  reactMore: { backgroundColor: colors.surfaceTint },
  reactEmoji: { fontSize: 27 },

  trayCard: { borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.surface },

  previewBubble: { maxWidth: "86%", paddingHorizontal: 14, paddingTop: 9, paddingBottom: 7, borderRadius: 18 },
  previewMine: { alignSelf: "flex-end", backgroundColor: colors.green700 },
  previewTheirs: { alignSelf: "flex-start", backgroundColor: colors.surface },
  previewText: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink900 },
  previewTextMine: { color: colors.cream50 },
  previewTime: { alignSelf: "flex-end", marginTop: 2, fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500 },
  previewTimeMine: { color: "rgba(247,243,234,0.75)" },

  actions: { borderRadius: radii.lg, backgroundColor: colors.surface, overflow: "hidden" },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 50, paddingHorizontal: 18 },
  actionLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  actionPressed: { backgroundColor: colors.surfaceTint },
  actionLabel: { fontFamily: fonts.body, fontSize: 16.5, color: colors.ink900 },
  danger: { color: colors.red600 },

  infoSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.cream50,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 4 },
  infoTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900, textAlign: "center" },
  infoSent: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
  infoHead: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: colors.ink500, marginTop: 10, marginBottom: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 },
  infoName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15.5, color: colors.ink900 },
  infoWhen: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, minWidth: 56, textAlign: "right" },

  quote: { borderLeftWidth: 4, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 1 },
  quoteOnTheirs: { backgroundColor: "rgba(12,32,56,0.05)" },
  quoteOnMine: { backgroundColor: "rgba(0,0,0,0.16)" },
  quoteWho: { fontFamily: fonts.bodyBold, fontSize: 13 },
  quoteText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink500 },
  quoteTextMine: { color: "rgba(247,243,234,0.85)" },
});
