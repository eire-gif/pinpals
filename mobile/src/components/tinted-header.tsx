import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useIsFocused } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { myRoundRight } from "@/components/my-round-pill";
import { colors, fonts } from "@/lib/theme";

/**
 * A screen's name in the navigation bar itself, on a coloured bar, as on
 * Marketplace (Oct 2026). Replaces the photograph band that used to sit
 * under a blank cream bar on Find PinPals, My connections and the Groups
 * pages — the name moves up into space the bar was already taking, and the
 * list starts a band's height higher.
 *
 * The colour carries on from the Home button that leads here (claret for
 * Find Golfers, green for Groups & Societies), and anything directly
 * beneath that should run on from the bar uses the same colour.
 *
 * Back is the chevron alone so the title has room: "My Groups & Societies"
 * does not fit between a "‹ Back" pill and the right-hand button.
 */
export function TintedHeader({
  color,
  title,
  accent,
  subtitle,
  right,
}: {
  /** The bar's colour — TONES.<tone>.card, to match Home's buttons. */
  color: string;
  title: string;
  /** Optional second half of the title, in gold italic. */
  accent?: string;
  /** A short line in gold capitals under the title. */
  subtitle?: string | null;
  right?: () => ReactNode;
}) {
  const focused = useIsFocused();
  return (
    <>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: color },
          headerTintColor: colors.cream50,
          headerShadowVisible: false,
          headerBackTitle: "Back",
          headerBackButtonDisplayMode: "minimal",
          headerTitleAlign: "center",
          headerTitle: () => <TintedTitle title={title} accent={accent} subtitle={subtitle} />,
          ...myRoundRight(right, { onDark: true }),
        }}
      />
      {focused ? <StatusBar style="light" /> : null}
    </>
  );
}

/** The title block alone — for a screen whose header isn't a Stack's (My rounds sits in the tab group). */
export function TintedTitle({ title, accent, subtitle }: { title: string; accent?: string; subtitle?: string | null }) {
  return (
    <View style={styles.titleBox} accessibilityRole="header">
      <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {title}
        {accent ? <Text style={styles.accent}> {accent}</Text> : null}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleBox: { alignItems: "center", maxWidth: 270 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 26, color: colors.cream50 },
  accent: { fontFamily: fonts.displayItalic, color: colors.gold400 },
  subtitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 9.5,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.gold400,
  },
});
