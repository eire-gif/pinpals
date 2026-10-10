import { Pressable, StyleSheet, Text, View } from "react-native";

import { Section } from "@/components/form-bits";
import { SCRAMBLE_WEIGHTS, type ScrambleSize } from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Team size and minimum drives for a scramble (0113) — the same two
 * questions on a single team and on a scramble day.
 *
 * The drive choices are the ones societies actually use: in a four over 18
 * holes, three or four each; in a pair, six or seven. Nine holes, about half.
 */
export function driveChoices(size: ScrambleSize, holes: 9 | 18): number[] {
  if (size === 4) return holes === 18 ? [3, 4] : [1, 2];
  return holes === 18 ? [6, 7] : [3, 4];
}

export function ScrambleOptions({
  size,
  onSize,
  driveMinimum,
  onDriveMinimum,
  holes,
}: {
  size: ScrambleSize;
  onSize: (s: ScrambleSize) => void;
  driveMinimum: number | null;
  onDriveMinimum: (n: number | null) => void;
  holes: 9 | 18;
}) {
  const weights = SCRAMBLE_WEIGHTS[size].map((w) => `${Math.round(w * 100)}%`).join(" / ");
  return (
    <>
      <Section title="Team size" hint={`Handicap: ${weights} of course handicaps, lowest first, added up.`}>
        <View style={styles.row}>
          {([4, 2] as const).map((s) => (
            <Chip key={s} label={s === 4 ? "Teams of 4" : "Teams of 2"} on={size === s} onPress={() => onSize(s)} />
          ))}
        </View>
      </Section>
      <Section title="Minimum drives" hint="Each player's drive must be used this many times. Tap whose drive you took on each hole.">
        <View style={styles.row}>
          <Chip label="None" on={driveMinimum == null} onPress={() => onDriveMinimum(null)} />
          {driveChoices(size, holes).map((n) => (
            <Chip key={n} label={`${n} each`} on={driveMinimum === n} onPress={() => onDriveMinimum(n)} />
          ))}
        </View>
      </Section>
    </>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  chipTextOn: { color: colors.cream50, fontFamily: fonts.bodyBold },
});
