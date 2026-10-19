import { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import type { GroupEventCard } from "@/lib/group-chat";
import { eventWhen, shortDate } from "@/lib/group-chat-rules";
import type { ThreadMember } from "@/lib/messages";
import { setOutingEntry } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Pieces of a Golf Buddies or trip chat (0181): the next event pinned under
 * the bar, the group's events as cards among the messages, and the + sheet.
 *
 * The cards are read from the group's events themselves, not stored as
 * messages, so they're always current: "3 in" changes when the fourth
 * joins, and a cancelled event says so.
 */

const openEvent = (e: GroupEventCard) =>
  router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(e.groupId), outingId: String(e.id) } });

/** "I'm in" straight from the chat, for a first-come event; anything with a
 *  request queue goes to its own screen, where the rules are explained. */
function useJoin(event: GroupEventCard, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const join = async () => {
    if (event.entryMode === "request") {
      router.push({ pathname: "/group/[id]/outing/request", params: { id: String(event.groupId), outingId: String(event.id) } });
      return;
    }
    setBusy(true);
    try {
      await setOutingEntry(event.id, true);
      onChanged();
    } catch (err) {
      Alert.alert("Couldn't add you", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, join };
}

const placesLine = (e: GroupEventCard) => (e.maxEntries ? `${e.entrants.length} of ${e.maxEntries} in` : `${e.entrants.length} in`);
const where = (e: GroupEventCard) => e.courseName ?? e.location ?? null;

/** The strip under the bar: the next event, and your answer to it. */
export function NextUpStrip({ event, onChanged }: { event: GroupEventCard; onChanged: () => void }) {
  const { busy, join } = useJoin(event, onChanged);
  const trip = event.outingKind !== "day";
  const course = where(event);
  return (
    <View style={styles.strip}>
      <Pressable style={styles.stripMain} onPress={() => openEvent(event)} accessibilityRole="button" accessibilityLabel={`Next: ${event.title}, ${eventWhen(event.playsOn, event.firstTee)}. Open it.`}>
        <View style={styles.stripIcon}>
          <Ionicons name={trip ? "airplane" : "flag"} size={17} color={colors.green700} />
        </View>
        <View style={styles.stripText}>
          <Text style={styles.stripKicker} numberOfLines={1}>
            {`NEXT · ${placesLine(event).toUpperCase()}`}
          </Text>
          <Text style={styles.stripLine} numberOfLines={1}>
            {[eventWhen(event.playsOn, event.firstTee), course].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </Pressable>
      {event.mine ? (
        <View style={styles.inPill} accessibilityLabel="You're in">
          <Ionicons name="checkmark" size={14} color={colors.green800} />
          <Text style={styles.inPillText}>In</Text>
        </View>
      ) : (
        <Pressable style={styles.stripButton} onPress={() => void join()} disabled={busy} accessibilityRole="button" accessibilityLabel={`I'm in for ${event.title}`}>
          {busy ? <ActivityIndicator size="small" color={colors.cream50} /> : <Text style={styles.stripButtonText}>{event.entryMode === "request" ? "Ask" : "I'm in"}</Text>}
        </Pressable>
      )}
    </View>
  );
}

/** One of the group's events, as it sits in the chat. */
export function EventCard({
  event,
  members,
  nameOf,
  meId,
  today,
  onChanged,
}: {
  event: GroupEventCard;
  members: ThreadMember[];
  nameOf: (id: string) => string | null;
  meId: string | null;
  today: string;
  onChanged: () => void;
}) {
  const { busy, join } = useJoin(event, onChanged);
  const byWho = event.createdBy === meId ? "You" : event.createdBy ? (nameOf(event.createdBy)?.split(" ")[0] ?? "Someone") : "Someone";
  const trip = event.outingKind !== "day";
  const over = (event.endsOn ?? event.playsOn) < today;
  const cancelled = event.status === "cancelled";
  const faces = event.entrants.slice(0, 5).map((id) => members.find((m) => m.id === id)).filter(Boolean) as ThreadMember[];
  const course = where(event);

  return (
    <View style={styles.cardWrap}>
      <Text style={styles.cardSystem}>
        {`${byWho} posted ${trip ? "a trip" : "a round"} · ${shortDate(event.created_at.slice(0, 10))}`}
      </Text>
      <Pressable style={[styles.card, (cancelled || over) && styles.cardDim]} onPress={() => openEvent(event)} accessibilityRole="button" accessibilityLabel={`${event.title}. ${eventWhen(event.playsOn, event.firstTee)}. Open it.`}>
        <View style={styles.cardHead}>
          <Text style={styles.cardKicker}>{cancelled ? "CANCELLED" : over ? "PLAYED" : trip ? "GROUP TRIP" : "GROUP ROUND"}</Text>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {event.title}
          </Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardWhen} numberOfLines={2}>
            {[trip && event.endsOn ? `${shortDate(event.playsOn)} – ${shortDate(event.endsOn)}` : eventWhen(event.playsOn, event.firstTee), course].filter(Boolean).join(" · ")}
          </Text>
          <View style={styles.cardFaces}>
            {faces.map((m) => (
              <View key={m.id} style={styles.face}>
                <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={26} />
              </View>
            ))}
            <Text style={styles.cardCount}>{placesLine(event)}</Text>
            {event.entryFeeCents ? <Text style={styles.cardFee}>{`€${Math.round(event.entryFeeCents / 100)} each`}</Text> : null}
          </View>
          {!cancelled && !over ? (
            <View style={styles.cardButtons}>
              {event.mine ? (
                <View style={[styles.cardButton, styles.cardButtonDone]}>
                  <Text style={styles.cardButtonDoneText}>You&apos;re in</Text>
                </View>
              ) : (
                <Pressable style={[styles.cardButton, styles.cardButtonMain]} onPress={() => void join()} disabled={busy} accessibilityRole="button">
                  {busy ? <ActivityIndicator size="small" color={colors.cream50} /> : <Text style={styles.cardButtonMainText}>{event.entryMode === "request" ? "Ask for a place" : "I'm in"}</Text>}
                </Pressable>
              )}
              <Pressable style={styles.cardButton} onPress={() => openEvent(event)} accessibilityRole="button">
                <Text style={styles.cardButtonText}>{trip ? "Itinerary" : "Open"}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

export type AddOption = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; organiser?: boolean; onPress: () => void };

/** The + beside the message box: photo for everyone, events for whoever runs them. */
export function ChatAddSheet({ open, options, onClose }: { open: boolean; options: AddOption[]; onClose: () => void }) {
  const anyOrganiser = options.some((o) => o.organiser);
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.veil} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.grab} />
        <View style={styles.sheetHead}>
          <Text style={styles.sheetTitle} accessibilityRole="header">
            Add to the chat
          </Text>
          <Pressable style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={20} color={colors.navy900} />
          </Pressable>
        </View>
        <View style={styles.grid}>
          {options.map((o) => (
            <Pressable
              key={o.key}
              style={[styles.tile, o.organiser && styles.tileOrganiser]}
              onPress={() => {
                onClose();
                o.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={o.organiser ? `${o.label}, organisers only` : o.label}
            >
              <View style={[styles.tileIcon, o.organiser && styles.tileIconOrganiser]}>
                <Ionicons name={o.icon} size={20} color={o.organiser ? colors.gold400 : colors.green700} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={2}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {anyOrganiser ? (
          <View style={styles.legend}>
            <View style={styles.legendBox} />
            <Text style={styles.legendText}>Gold-edged items are for the group&apos;s organisers</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingLeft: 14, paddingRight: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line },
  stripMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  stripIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  stripText: { flex: 1, gap: 1 },
  stripKicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.green700 },
  stripLine: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  stripButton: { height: 38, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center", minWidth: 72 },
  stripButtonText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.cream50 },
  inPill: { flexDirection: "row", alignItems: "center", gap: 3, height: 32, paddingHorizontal: 10, borderRadius: 10, backgroundColor: colors.green100 },
  inPillText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green800 },

  cardWrap: { alignItems: "center", gap: 6, marginVertical: 8 },
  cardSystem: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  card: { width: "86%", maxWidth: 320, borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  cardDim: { opacity: 0.7 },
  cardHead: { backgroundColor: colors.green700, paddingHorizontal: 12, paddingVertical: 9, gap: 1 },
  cardKicker: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: "#bfe0cb" },
  cardTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.cream50 },
  cardBody: { padding: 12, gap: 10 },
  cardWhen: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  cardFaces: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  face: { marginRight: -2 },
  cardCount: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900, marginLeft: 6 },
  cardFee: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginLeft: 6 },
  cardButtons: { flexDirection: "row", gap: 8 },
  cardButton: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  cardButtonText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  cardButtonMain: { backgroundColor: colors.green700, borderColor: colors.green700 },
  cardButtonMainText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  cardButtonDone: { backgroundColor: colors.green100, borderColor: colors.green100 },
  cardButtonDoneText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green800 },

  veil: { flex: 1, backgroundColor: "rgba(8,18,34,0.5)" },
  sheet: { backgroundColor: colors.cream50, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34, gap: 14 },
  grab: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: "#cfc6b3" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexBasis: "30%", flexGrow: 1, minHeight: 96, borderRadius: 16, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", gap: 8, padding: spacing.sm },
  tileOrganiser: { borderWidth: 1.5, borderColor: colors.gold500, backgroundColor: "#fffaf0" },
  tileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  tileIconOrganiser: { backgroundColor: colors.navy900 },
  tileLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900, textAlign: "center" },
  legend: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendBox: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: colors.gold500, backgroundColor: "#fffaf0" },
  legendText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
});
