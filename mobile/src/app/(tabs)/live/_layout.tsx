import { Stack } from "expo-router";

import { colors, fonts } from "@/lib/theme";

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
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 19 },
        headerBackTitle: "Back",
        contentStyle: { backgroundColor: colors.cream50 },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Live scoring" }} />
      <Stack.Screen name="new" options={{ title: "Set up a round" }} />
      <Stack.Screen name="round/[id]" options={{ title: "Scoring" }} />
    </Stack>
  );
}
