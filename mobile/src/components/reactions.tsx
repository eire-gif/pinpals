import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { REACTIONS, REACTION_INFO, type ReactionKey } from "@/lib/reactions";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Golf reactions, drawn (Oct 2026 feed redesign, phase 4).
 *
 * Every reaction is the same object: a disc of its own PinPals colour with
 * a white Ionicons glyph — a golf ball, a flame, a flag, a trophy, a rain
 * cloud. No emoji and nobody else's artwork, and the discs read at 16pt in
 * a count row as well as at 46pt in the picker.
 *
 * The picker is a cream "scorecard strip" that rises from the React button:
 * the strip slides up a few points and fades in, then the discs land one
 * after another, left to right, like balls dropping onto a green. Native
 * driver throughout, so it holds 60fps mid-scroll.
 */

type GlyphName = keyof typeof Ionicons.glyphMap;

export function ReactionDisc({ reaction, size = 18, ring }: { reaction: ReactionKey; size?: number; ring?: string }) {
  const info = REACTION_INFO[reaction];
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: info.color },
        ring ? { borderWidth: Math.max(1.5, size / 14), borderColor: ring } : null,
      ]}
    >
      <Ionicons name={info.icon as GlyphName} size={Math.round(size * 0.56)} color={colors.surface} />
    </View>
  );
}

/** Overlapping discs for a count row: most-used first, on the left. */
export function ReactionStack({ reactions, size = 18 }: { reactions: ReactionKey[]; size?: number }) {
  return (
    <View style={styles.stack}>
      {reactions.map((r, i) => (
        <View key={r} style={[i > 0 && { marginLeft: -size * 0.3 }, { zIndex: reactions.length - i }]}>
          <ReactionDisc reaction={r} size={size} ring={colors.surface} />
        </View>
      ))}
    </View>
  );
}

const TRAY_PAD = 10;
const ITEM = 56;

/**
 * The picker. `anchor` is where the React button is on screen (from
 * measureInWindow); the strip sits just above it, kept on screen.
 * Choosing the reaction you already have takes it away.
 */
export function ReactionPicker({
  visible,
  anchor,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  anchor: { x: number; y: number; width: number } | null;
  current: ReactionKey | null;
  onPick: (reaction: ReactionKey | null) => void;
  onClose: () => void;
}) {
  const { width: screen } = useWindowDimensions();
  const rise = useRef(new Animated.Value(0)).current;
  const drops = useRef(REACTIONS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!visible) return;
    rise.setValue(0);
    drops.forEach((d) => d.setValue(0));
    Animated.parallel([
      Animated.timing(rise, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.stagger(
        35,
        drops.map((d) => Animated.spring(d, { toValue: 1, friction: 5, tension: 170, useNativeDriver: true }))
      ),
    ]).start();
  }, [visible, rise, drops]);

  if (!anchor) return null;
  const trayWidth = REACTIONS.length * ITEM + TRAY_PAD * 2;
  const left = Math.min(Math.max(spacing.sm, anchor.x + anchor.width / 2 - trayWidth / 2), screen - trayWidth - spacing.sm);
  // Above the button; the tray is about 92pt tall with its labels.
  const top = Math.max(spacing.xl * 2, anchor.y - 100);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close reactions" />
      <Animated.View
        style={[
          styles.tray,
          { left, top, width: trayWidth },
          {
            opacity: rise,
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          },
        ]}
        accessibilityRole="menu"
        accessibilityLabel="React to this post"
      >
        <Text style={styles.trayTitle}>React to this post</Text>
        <View style={styles.trayRow}>
          {REACTIONS.map((r, i) => {
            const selected = r === current;
            return (
              <Animated.View
                key={r}
                style={{
                  opacity: drops[i],
                  transform: [
                    { scale: drops[i].interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                    { translateY: drops[i].interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
                  ],
                }}
              >
                <Pressable
                  onPress={() => onPick(selected ? null : r)}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  accessibilityLabel={selected ? `${REACTION_INFO[r].label}, chosen. Tap to remove` : REACTION_INFO[r].label}
                >
                  <ReactionDisc reaction={r} size={42} ring={selected ? colors.gold400 : undefined} />
                  <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]} numberOfLines={2}>
                    {REACTION_INFO[r].label}
                  </Text>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  disc: { alignItems: "center", justifyContent: "center" },
  stack: { flexDirection: "row", alignItems: "center" },
  tray: {
    position: "absolute",
    backgroundColor: colors.cream50,
    borderRadius: radii.lg + 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    paddingHorizontal: TRAY_PAD,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm - 2,
    shadowColor: colors.navy900,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  trayTitle: {
    fontFamily: fonts.bodySemi,
    fontSize: 11.5,
    letterSpacing: 0.4,
    color: colors.ink500,
    textAlign: "center",
    marginBottom: 4,
  },
  trayRow: { flexDirection: "row" },
  item: { width: ITEM, alignItems: "center", paddingVertical: 4, borderRadius: radii.md, minHeight: 44 },
  itemPressed: { backgroundColor: colors.cream100 },
  itemLabel: {
    fontFamily: fonts.bodySemi,
    fontSize: 10.5,
    lineHeight: 12,
    color: colors.ink900,
    textAlign: "center",
    marginTop: 4,
  },
  itemLabelSelected: { color: colors.green800 },
});
