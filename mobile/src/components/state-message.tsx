import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * The one way a screen or section says "nothing here", "not available" or
 * "couldn't load" (phase 12). An icon, a line, an optional explanation and
 * an optional action — Try again for an error, Add… for an owner's empty
 * section.
 *
 * Errors and emptiness are different messages on purpose: a failed request
 * that renders as "hasn't shared anything" tells the reader something
 * untrue about another member.
 */
export function StateMessage({
  icon,
  title,
  body,
  action,
  size = "section",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  /** Bold line; omit for a single quiet sentence (use `body`). */
  title?: string;
  body?: string;
  action?: { label: string; onPress: () => void };
  /** "screen": a whole screen's state, larger and centred in the space. */
  size?: "screen" | "section";
}) {
  const screen = size === "screen";
  return (
    <View style={[styles.wrap, screen && styles.wrapScreen]} accessibilityRole={action ? undefined : "text"}>
      <Ionicons name={icon} size={screen ? 36 : 28} color={colors.ink500} />
      {title ? <Text style={[styles.title, screen && styles.titleScreen]}>{title}</Text> : null}
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action ? (
        <Pressable onPress={action.onPress} style={styles.button} accessibilityRole="button" hitSlop={4}>
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The Try again message for a failed load. */
export function LoadError({ onRetry, what = "this", size }: { onRetry: () => void; what?: string; size?: "screen" | "section" }) {
  return (
    <StateMessage
      icon="cloud-offline-outline"
      title={`Couldn't load ${what}`}
      body="Check your connection and try again."
      action={{ label: "Try again", onPress: onRetry }}
      size={size}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  wrapScreen: { flex: 1, justifyContent: "center", backgroundColor: colors.cream50 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900, textAlign: "center" },
  titleScreen: { fontFamily: fonts.display, fontSize: type.title },
  body: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 20, color: colors.ink500, textAlign: "center" },
  button: {
    marginTop: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.green700,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
