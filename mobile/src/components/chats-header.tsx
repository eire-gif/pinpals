import { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * The Chats tab's header buttons (Oct 2026, after WhatsApp): Alerts, the
 * camera, and a green + that opens "Start something".
 *
 * Alerts left the chat list for the bell — a chat is somebody waiting on
 * you, an alert is something that happened, and mixing them made the list
 * look busy. The bell carries its own count, and the list still pins any
 * alert that wants an answer (inbox.tsx).
 *
 * The camera takes the photo first and asks where it's going after: a post
 * on Social or something to sell. A photo for a chat is taken inside the
 * chat, where it can't go to the wrong person.
 */
export type ChatsCan = {
  chat: boolean;
  social: boolean;
  sell: boolean;
  teeTimes: boolean;
  createGroups: boolean;
};

export function ChatsHeaderButtons({ alerts, can, onDark = false }: { alerts: number; can: ChatsCan; onDark?: boolean }) {
  const ink = onDark ? colors.cream50 : colors.ink900;
  const round = [styles.round, onDark && styles.roundDark];
  const [open, setOpen] = useState(false);

  const camera = () => {
    const options = [
      can.social ? { text: "Share on Social", onPress: () => router.push({ pathname: "/new-post", params: { type: "photo", camera: "1" } }) } : null,
      can.sell ? { text: "Sell it on the Marketplace", onPress: () => router.push({ pathname: "/new-listing", params: { camera: "1" } }) } : null,
    ].filter((o): o is { text: string; onPress: () => void } => o !== null);
    if (options.length === 0) return;
    Alert.alert("Take a photo for…", "To send a photo in a chat, use the camera inside that chat.", [
      ...options,
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => router.setParams({ filter: "alerts", at: String(Date.now()) })}
        hitSlop={6}
        style={round}
        accessibilityRole="button"
        accessibilityLabel={alerts > 0 ? `Alerts, ${alerts} new` : "Alerts"}
      >
        <Ionicons name="notifications-outline" size={21} color={ink} />
        {alerts > 0 ? (
          <View style={[styles.count, onDark && { borderColor: colors.navy900 }]}>
            <Text style={styles.countLabel}>{alerts > 99 ? "99+" : alerts}</Text>
          </View>
        ) : null}
      </Pressable>
      {can.social || can.sell ? (
        <Pressable onPress={camera} hitSlop={6} style={round} accessibilityRole="button" accessibilityLabel="Camera">
          <Ionicons name="camera-outline" size={22} color={ink} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={[styles.round, onDark ? styles.plusDark : styles.plus]}
        accessibilityRole="button"
        accessibilityLabel="Start a chat, group, tee time or listing"
      >
        <Ionicons name="add" size={26} color={onDark ? colors.navy900 : colors.cream50} />
      </Pressable>
      <StartSheet open={open} onClose={() => setOpen(false)} can={can} />
    </View>
  );
}

type Option = { key: string; title: string; sub: string; icon: keyof typeof Ionicons.glyphMap; fg: string; bg: string; href: Href; on: boolean };

function StartSheet({ open, onClose, can }: { open: boolean; onClose: () => void; can: ChatsCan }) {
  const insets = useSafeAreaInsets();
  const options: Option[] = (
    [
      { key: "chat", title: "New chat", sub: "Message one of your PinPals", icon: "chatbubble-outline", fg: colors.navy900, bg: "#e3e6ec", href: "/new-chat", on: can.chat },
      { key: "group", title: "New Golf Buddies group", sub: "Your fourball or regular group — its chat comes with it", icon: "people-outline", fg: colors.green700, bg: colors.green100, href: "/groups/new?kind=crew", on: can.createGroups },
      { key: "trip", title: "Plan a golf trip", sub: "A trip with its own chat and itinerary", icon: "airplane-outline", fg: colors.navy900, bg: "#e3e6ec", href: "/groups/new?kind=trip", on: can.createGroups },
      { key: "tee", title: "Offer a tee time", sub: "Post spare places and invite players", icon: "golf-outline", fg: colors.green700, bg: colors.green100, href: "/post-tee-time", on: can.teeTimes },
      { key: "sell", title: "Sell an item", sub: "Snap your clubs and list them", icon: "pricetag-outline", fg: "#7a5a12", bg: "#f5e6c2", href: "/new-listing", on: can.sell },
      { key: "wanted", title: "Post a wanted ad", sub: "Tell sellers what you're looking for", icon: "search-outline", fg: "#7a5a12", bg: "#f5e6c2", href: "/wanted/new", on: can.sell },
    ] as Option[]
  ).filter((o) => o.on);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.veil} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grab} />
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} accessibilityRole="header">Start something</Text>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={colors.ink900} />
          </Pressable>
        </View>
        {options.map((o, i) => (
          <Pressable
            key={o.key}
            onPress={() => {
              onClose();
              router.push(o.href);
            }}
            style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surfaceTint }]}
            accessibilityRole="button"
          >
            <View style={[styles.optionIcon, { backgroundColor: o.bg }]}>
              <Ionicons name={o.icon} size={22} color={o.fg} />
            </View>
            <View style={[styles.optionText, i < options.length - 1 && styles.optionLine]}>
              <Text style={styles.optionTitle}>{o.title}</Text>
              <Text style={styles.optionSub} numberOfLines={2}>{o.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: spacing.md },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  plus: { backgroundColor: colors.green700, borderColor: colors.green700 },
  // On the navy Chats band: see-through buttons in a thin gold ring, and a
  // cream + so the one thing that starts something still stands out.
  roundDark: { backgroundColor: "rgba(255,255,255,0.10)", borderColor: colors.gold500, borderWidth: 1.5 },
  plusDark: { backgroundColor: colors.cream50, borderColor: colors.cream50 },
  count: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.gold500,
    borderWidth: 1.5,
    borderColor: colors.cream50,
    alignItems: "center",
    justifyContent: "center",
  },
  countLabel: { fontFamily: fonts.bodyBold, fontSize: 10, lineHeight: 13, color: colors.navy900 },

  veil: { flex: 1, backgroundColor: "rgba(12,32,56,0.45)" },
  sheet: {
    backgroundColor: colors.cream50,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
  },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 6 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: 4 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink900 },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream100 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: spacing.lg, minHeight: 70 },
  optionIcon: { width: 44, height: 44, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  optionText: { flex: 1, minHeight: 70, justifyContent: "center", gap: 2 },
  optionLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  optionTitle: { fontFamily: fonts.bodySemi, fontSize: 16.5, color: colors.ink900 },
  optionSub: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500 },
});
