import { Stack } from "expo-router";

import { BackPill, headerButtons } from "@/components/header-actions";
import { colors, fonts, headerTitleStyle } from "@/lib/theme";

/**
 * Live scoring lives INSIDE the tab group, as a stack of its own, so the
 * bottom tab bar stays on every one of its screens — a round is scored
 * between tee and green, and Home, Social and the Inbox should stay one tap
 * away throughout. The tab itself is hidden (href: null in the tabs layout):
 * six tabs is the most an iPhone SE fits, so the way in is the Home card and
 * the menu.
 */
export default function LiveLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.cream50 },
        headerTintColor: colors.ink900,
        headerTitleStyle,
        headerBackTitle: "Back",
        contentStyle: { backgroundColor: colors.cream50 },
      }}
    >
      {/* First in its own stack, so iOS draws no back button: add one. */}
      <Stack.Screen name="index" options={{ title: "Live scoring", ...headerButtons({ left: <BackPill /> }) }} />
      <Stack.Screen name="new" options={{ title: "Set up a round" }} />
      <Stack.Screen name="round/[id]" options={{ title: "Scoring" }} />
      <Stack.Screen name="day/new" options={{ title: "Set up a match day" }} />
      <Stack.Screen name="day/scramble" options={{ title: "Set up a scramble" }} />
      {/* Opened from a group's page it can be the first screen in this
          stack, which leaves iOS nothing to go back to: always draw one. */}
      <Stack.Screen name="day/group" options={{ title: "From a group", ...headerButtons({ left: <BackPill /> }) }} />
      <Stack.Screen name="day/[id]" options={{ title: "Leaderboard" }} />
      {/* Opened from the QR on a clubhouse TV it can be first: draw a back. */}
      <Stack.Screen name="tv" options={{ title: "Show on TV", ...headerButtons({ left: <BackPill /> }) }} />
      {/* Opened from a "results are in" notification it can be first: draw a back. */}
      <Stack.Screen name="day/results/[id]" options={{ title: "Results", ...headerButtons({ left: <BackPill /> }) }} />
    </Stack>
  );
}
