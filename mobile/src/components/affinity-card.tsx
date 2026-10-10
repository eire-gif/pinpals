import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import type { Affinity } from "@/lib/find-pinpals";
import { colors, fonts } from "@/lib/theme";

/**
 * "Why you'd get on" on a member's page (approved mock-up 3; member_affinity(),
 * 0118): mutual PinPals, same club, courses you've both played, handicaps,
 * having played together — and their next open place in a game.
 * Renders nothing when there's nothing to say.
 */
export function AffinityCard({ affinity, firstName }: { affinity: Affinity; firstName: string }) {
  const lines: { icon: keyof typeof Ionicons.glyphMap; text: React.ReactNode }[] = [];
  if (affinity.playedTogether) lines.push({ icon: "golf-outline", text: <>You&apos;ve <Text style={styles.b}>played together</Text></> });
  if (affinity.sameClub && affinity.clubName) lines.push({ icon: "flag-outline", text: <>You&apos;re both members at <Text style={styles.b}>{affinity.clubName}</Text></> });
  if (affinity.sharedCourseCount > 0) {
    const names = affinity.sharedCourses.slice(0, 2);
    const more = affinity.sharedCourseCount - names.length;
    lines.push({
      icon: "location-outline",
      text: (
        <>
          Both played <Text style={styles.b}>{names.join(" and ")}</Text>
          {more > 0 ? ` and ${more} more` : ""}
        </>
      ),
    });
  }
  if (affinity.theirHandicap != null && affinity.myHandicap != null && Math.abs(affinity.theirHandicap - affinity.myHandicap) <= 6) {
    lines.push({
      icon: "trending-up-outline",
      text: (
        <>
          Similar handicap — <Text style={styles.b}>{affinity.theirHandicap}</Text> and your <Text style={styles.b}>{affinity.myHandicap}</Text>
        </>
      ),
    });
  }

  const open = affinity.openRound;
  if (affinity.mutualCount === 0 && lines.length === 0 && !open) return null;

  return (
    <View style={{ gap: 12 }}>
      {affinity.mutualCount > 0 || lines.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>Why you&apos;d get on</Text>
          {affinity.mutualCount > 0 ? (
            <View style={styles.line}>
              <View style={styles.stack}>
                {affinity.mutual.map((m, i) => (
                  <View key={`${m.initials}-${i}`} style={[styles.stackItem, i > 0 && { marginLeft: -10 }]}>
                    <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.firstName || m.initials} size={30} />
                  </View>
                ))}
              </View>
              <Text style={styles.text}>
                <Text style={styles.b}>
                  {affinity.mutualCount} mutual {affinity.mutualCount === 1 ? "PinPal" : "PinPals"}
                </Text>
                {affinity.mutual.length > 0
                  ? ` — ${affinity.mutual.map((m) => m.firstName).filter(Boolean).slice(0, 2).join(", ")}${affinity.mutualCount > 2 ? ` and ${affinity.mutualCount - 2} more` : ""}`
                  : ""}
              </Text>
            </View>
          ) : null}
          {lines.map((l, i) => (
            <View key={i} style={styles.line}>
              <Ionicons name={l.icon} size={19} color={colors.green700} />
              <Text style={styles.text}>{l.text}</Text>
            </View>
          ))}
          {affinity.roundsLogged > 0 ? (
            <Text style={styles.note}>
              {firstName} has logged {affinity.roundsLogged} {affinity.roundsLogged === 1 ? "round" : "rounds"} on PinPals
            </Text>
          ) : null}
        </View>
      ) : null}

      {open ? (
        <Pressable onPress={() => router.push(`/invite/${open.id}`)} style={styles.open} accessibilityRole="button" accessibilityLabel={`${firstName} has a place in a game — ask to join`}>
          <View style={styles.dot} />
          <Text style={styles.openText}>
            Has {open.spaces === 1 ? "a place" : `${open.spaces} places`} in a game, {dayLabel(open.playDate)}
            {open.exactTeeTime || open.timeFrom ? `, ${(open.exactTeeTime ?? open.timeFrom ?? "").slice(0, 5)}` : ""}
            {open.clubName ? ` at ${open.clubName}` : ""}
          </Text>
          <Text style={styles.openLink}>Ask to join</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    shadowColor: colors.navy900,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  title: { fontSize: 16, fontWeight: "800", color: colors.navy900 },
  line: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink900, lineHeight: 19 },
  b: { fontFamily: fonts.bodyBold },
  note: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  stack: { flexDirection: "row" },
  stackItem: { borderRadius: 17, borderWidth: 2, borderColor: colors.surface },
  open: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.green100, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#2f7a3e" },
  openText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 13.5, color: "#1f4a2a" },
  openLink: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.navy900 },
});
