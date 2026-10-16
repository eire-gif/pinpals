import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";

import { StateMessage } from "@/components/state-message";
import { useAgeAccess } from "@/lib/age";
import type { AgeFeature } from "@/lib/age-rules";
import { goHome } from "@/lib/go-home";
import { colors } from "@/lib/theme";

/**
 * Junior members (0159): what a screen shows a member who isn't old enough
 * for it, instead of a form the database would refuse anyway.
 *
 * The menu, the tabs and the buttons already hide these screens from
 * under-18s; this is for the ways in that can't be hidden — a link in an
 * email, an old notification, a deep link. One panel, one wording, so it
 * reads as a rule of PinPals rather than something broken.
 */

const TITLES: Partial<Record<AgeFeature, string>> = {
  teeTimes: "Tee times open at 18",
  social: "Social opens at 18",
  chat: "Messages open at 18",
  connections: "Your parent picks your PinPals",
  sell: "Selling opens at 18",
  buy: "A parent buys for you",
  createGroups: "Starting a group opens at 18",
  groupOfficer: "Running a group opens at 18",
};

export function NotForUnder18({ feature, title }: { feature: AgeFeature; title?: string }) {
  const under16 = feature === "connections";
  return (
    <View style={styles.fill}>
      {title !== undefined ? <Stack.Screen options={{ title }} /> : null}
      <StateMessage
        size="screen"
        icon="shield-checkmark-outline"
        title={TITLES[feature] ?? "Not available yet"}
        body={
          under16
            ? "Members under 16 play with their parent and the PinPals their parent approves. Live scoring, scorecards and the course directory are all yours."
            : feature === "buy"
              ? "Under 18s can browse the marketplace; a parent buys for you. Live scoring, scorecards and the course directory are all yours."
              : "This part of PinPals opens at 18. Live scoring, scorecards, the hole map and the course directory are all yours."
        }
        action={{ label: "Back to Home", onPress: () => (router.canGoBack() ? router.back() : goHome()) }}
      />
    </View>
  );
}

/**
 * Wraps a screen that's only for members allowed `feature`. Draws the
 * screen straight away for everyone the app knows nothing against (see
 * lib/age.ts on failing open), and the panel once the answer says no.
 */
export function useAgeGate(feature: AgeFeature): "allowed" | "blocked" | "loading" {
  const { loaded, allows } = useAgeAccess();
  if (!loaded) return "loading";
  return allows(feature) ? "allowed" : "blocked";
}

/** A spinner while the first answer is fetched — rare, the answer is cached. */
export function AgeGateLoading() {
  return (
    <View style={[styles.fill, styles.centre]}>
      <ActivityIndicator color={colors.green700} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
});
