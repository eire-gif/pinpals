import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { goHome } from "@/lib/go-home";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The way out at the bottom of a screen you've just finished setting
 * something up on — an event, a trip's itinerary, a tee time (Oct 2026).
 * Before it, the only way back was the arrow at the top left, which takes
 * you back into the form you'd just filled in.
 *
 * `saved`: a line saying it's done ("Saved — everyone in the group can see
 * it"), shown with a tick above the button.
 */
export function DoneHome({ saved }: { saved?: string | null }) {
  return (
    <View style={styles.wrap}>
      {saved ? (
        <View style={styles.saved} accessibilityRole="text">
          <Ionicons name="checkmark-circle" size={18} color={colors.green700} />
          <Text style={styles.savedText}>{saved}</Text>
        </View>
      ) : null}
      <Pressable onPress={goHome} style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        <Ionicons name="home-outline" size={18} color={colors.cream50} />
        <Text style={styles.label}>Done — back to Home</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  saved: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: spacing.sm + 2, borderRadius: radii.md, backgroundColor: colors.green100 },
  savedText: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green800 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 50, borderRadius: radii.pill, backgroundColor: colors.navy900 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
