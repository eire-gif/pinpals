import { Stack } from "expo-router";

import { colors } from "@/lib/theme";

/** The profile builder: five steps, no header — each step draws its own back and Skip. */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream50 },
      }}
    />
  );
}
