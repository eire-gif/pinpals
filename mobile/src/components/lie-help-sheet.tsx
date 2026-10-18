import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LIES, forHand, lieById } from "@/lib/training";
import { useTraining } from "@/lib/training-store";
import { colors, creamAlpha, fonts, navyAlpha, radii, spacing } from "@/lib/theme";

/**
 * Lie help on the live scoring screen (Training, Oct 2026): pick the lie
 * you're facing and get the three things to do, without leaving the round.
 * Content from lib/training.ts; "Full guide" opens the lie's page.
 * Offline, like the rest of Training. Remembers right- or left-handed.
 */
export function LieHelpSheet({ visible, onClose, onOpenGuide }: { visible: boolean; onClose: () => void; onOpenGuide: (lieId: string) => void }) {
  const insets = useSafeAreaInsets();
  const { hand } = useTraining();
  const [pick, setPick] = useState("uphill");
  const lie = lieById(pick) ?? LIES[0];
  const h = (s: string) => forHand(s, hand);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close lie help" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="help-buoy-outline" size={20} color={colors.gold400} />
              <Text style={styles.title} accessibilityRole="header">
                Lie help
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel="Close lie help">
              <Ionicons name="close" size={18} color={colors.cream50} />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {LIES.map((l) => {
              const on = l.id === lie.id;
              return (
                <Pressable key={l.id} onPress={() => setPick(l.id)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{l.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.facts}>
            {[
              ["CLUB", lie.club],
              ["AIM", h(lie.aim)],
              ["BALL", lie.ball],
            ].map(([k, v]) => (
              <View key={k} style={styles.fact}>
                <Text style={styles.factLabel}>{k}</Text>
                <Text style={styles.factValue}>{v.charAt(0).toUpperCase() + v.slice(1)}</Text>
              </View>
            ))}
          </View>

          <View style={{ gap: 8 }} accessibilityLiveRegion="polite">
            {lie.onCourse.map((line, i) => (
              <View key={line} style={styles.line}>
                <Text style={styles.num}>{i + 1}</Text>
                <Text style={styles.lineText}>{h(line)}</Text>
              </View>
            ))}
          </View>

          <Pressable onPress={() => onOpenGuide(lie.id)} style={({ pressed }) => [styles.full, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityHint="Opens the full guide for this lie">
            <Text style={styles.fullText}>Full guide</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.navy900} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: navyAlpha(0.45) },
  sheet: { backgroundColor: "#0a1a30", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: spacing.md + 2, paddingTop: 10, gap: 14, borderTopWidth: 1, borderColor: "rgba(211,165,63,0.45)" },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: creamAlpha(0.25) },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: creamAlpha(0.12), alignItems: "center", justifyContent: "center" },
  chips: { gap: 6, paddingRight: spacing.md },
  chip: { minHeight: 38, paddingHorizontal: 13, borderRadius: radii.pill, borderWidth: 1, borderColor: creamAlpha(0.3), justifyContent: "center" },
  chipOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream100 },
  chipTextOn: { color: colors.navy900 },
  facts: { flexDirection: "row", gap: 8 },
  fact: { flex: 1, backgroundColor: colors.navy800, borderRadius: 12, padding: 10, gap: 2 },
  factLabel: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1.4, color: colors.gold500 },
  factValue: { fontFamily: fonts.bodyBold, fontSize: 14, lineHeight: 18, color: colors.cream50 },
  line: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  num: { width: 22, height: 22, borderRadius: 11, overflow: "hidden", textAlign: "center", lineHeight: 22, backgroundColor: creamAlpha(0.12), fontFamily: fonts.bodyBold, fontSize: 12, color: colors.gold400 },
  lineText: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.cream50 },
  full: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 50, borderRadius: radii.pill, backgroundColor: colors.gold400 },
  fullText: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.navy900 },
});
