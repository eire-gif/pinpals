import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { isOn } from "@/lib/features";
import { sendListingTo, wantedLine, wantedMatches, type WantedMatch } from "@/lib/wanted";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Wanted ads (0203), on the seller's own live listing: who's looking for one
 * — the ones it fits (already told by PinPals) and the close ones (a little
 * over their price) — each with Send them your ad.
 */
export function WantedMatches({ listingId }: { listingId: number }) {
  const [list, setList] = useState<WantedMatch[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    void wantedMatches(listingId).then(setList);
  }, [listingId]);
  useEffect(load, [load]);

  if (!isOn("wantedAds") || !list || list.length === 0) return null;

  const send = async (m: WantedMatch) => {
    setBusy(m.wantedId);
    try {
      await sendListingTo(m.wantedId, listingId);
      load();
    } catch (e) {
      Alert.alert("Couldn't send it", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{`${list.length} ${list.length === 1 ? "golfer is" : "golfers are"} looking for one`}</Text>
      {list.map((m) => (
        <View key={m.wantedId} style={[styles.card, m.fit === "fits" && styles.cardFits]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{m.firstName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{m.county ? `${m.firstName} · ${m.county}` : m.firstName}</Text>
              <Text style={styles.meta}>{wantedLine({ details: m.details, category: "Drivers", flex: m.flex, hand: null, maxPriceCents: m.maxPriceCents, county: m.county })}</Text>
            </View>
            <Text style={[styles.badge, m.fit === "fits" ? styles.badgeFits : styles.badgeClose]}>{m.fit === "fits" ? "Fits" : "Close"}</Text>
          </View>
          {m.told ? (
            <View style={styles.told}>
              <Ionicons name="checkmark-circle" size={18} color={colors.green700} />
              <Text style={styles.toldText}>{`${m.firstName} has been told`}</Text>
            </View>
          ) : (
            <Pressable style={[styles.send, m.fit === "close" && styles.sendClose]} disabled={busy === m.wantedId} onPress={() => void send(m)} accessibilityRole="button">
              {busy === m.wantedId ? <ActivityIndicator color={colors.ink900} /> : <Text style={styles.sendText}>{`Send ${m.firstName} your ad`}</Text>}
            </Pressable>
          )}
        </View>
      ))}
      <Text style={styles.meta}>Anyone it fits is told by PinPals as soon as it&apos;s live. Close ones are a little over their price — send it if you&apos;d take less.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink900 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: 10 },
  cardFits: { borderWidth: 2, borderColor: colors.buy500 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700 },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  badge: { fontFamily: fonts.bodyBold, fontSize: 12, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4, overflow: "hidden" },
  badgeFits: { backgroundColor: colors.green100, color: colors.green700 },
  badgeClose: { backgroundColor: "#fbf3dc", color: "#5a4512" },
  send: { minHeight: 44, borderRadius: radii.md, backgroundColor: colors.buy500, alignItems: "center", justifyContent: "center" },
  sendClose: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.navy900 },
  sendText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  told: { flexDirection: "row", alignItems: "center", gap: 6 },
  toldText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.green700 },
});
