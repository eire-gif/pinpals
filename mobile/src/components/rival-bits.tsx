import { View } from "react-native";

import type { Rivalry } from "@/lib/rivalry-rules";
import { colors } from "@/lib/theme";

/** Rivalries: the last five meetings, newest on the left — gold won, grey lost, dark halved. */
export function LastFive({ r }: { r: Pick<Rivalry, "meetings"> }) {
  const five = r.meetings.slice(0, 5);
  return (
    <View style={{ flexDirection: "row", gap: 4 }} accessible accessibilityLabel={`Last ${five.length}, newest first: ${five.map((m) => m.outcome).join(", ")}`}>
      {five.map((m) => (
        <View key={m.roundId} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: m.outcome === "won" ? colors.gold400 : m.outcome === "lost" ? "#8796ab" : "#3a5478" }} />
      ))}
    </View>
  );
}
