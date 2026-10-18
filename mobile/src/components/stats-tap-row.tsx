import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FIRST_PUTTS, GREEN_MISSES, hasTeeShot, missedGreen, type GreenMiss, type HoleStat, type TeeShot } from "@/lib/hole-stats";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * My Game's taps for one hole (0178): tee shot on par 4s and 5s, putts,
 * how far the first putt was (0179, once there are putts — it feeds holing
 * % by distance in My Game and the Putting Lab), which way the green was
 * missed (only when the score and putts say it was), and penalty strokes. Used on the live scoring screen and in the 60-second
 * review. Tapping a chosen chip again clears it.
 */
export function StatsTapRow({
  par,
  strokes,
  value,
  onChange,
  title = "YOUR STATS",
  note = "Only you see these",
}: {
  par: number;
  strokes: number | null;
  value: HoleStat;
  onChange: (next: HoleStat) => void;
  title?: string;
  note?: string;
}) {
  const set = (patch: Partial<HoleStat>) => onChange({ ...value, ...patch });
  const missed = missedGreen(strokes, value.putts, par);
  const pens = value.penalties ?? 0;

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.note}>{note}</Text>
      </View>

      {hasTeeShot(par) ? (
        <Group label="Tee shot">
          {(
            [
              ["left", "← Left"],
              ["fairway", "✓ Fairway"],
              ["right", "Right →"],
            ] as [TeeShot, string][]
          ).map(([v, label]) => (
            <Chip key={v} label={label} on={value.tee === v} onPress={() => set({ tee: value.tee === v ? null : v })} a11y={`Tee shot ${v}`} />
          ))}
        </Group>
      ) : null}

      <Group label="Putts">
        {[0, 1, 2, 3, 4].map((n) => (
          <Chip
            key={n}
            label={n === 4 ? "4+" : String(n)}
            on={value.putts === n}
            // No putts (chipped in) means no first putt to measure.
            onPress={() => set(value.putts === n ? { putts: null, firstPutt: null } : n === 0 ? { putts: 0, firstPutt: null } : { putts: n })}
            a11y={`${n === 4 ? "4 or more" : n} putts`}
          />
        ))}
      </Group>

      {value.putts != null && value.putts >= 1 ? (
        <Group label="First putt from (feet)">
          {FIRST_PUTTS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              on={value.firstPutt === f.id}
              onPress={() => set({ firstPutt: value.firstPutt === f.id ? null : f.id })}
              a11y={`First putt from ${f.long}`}
              small
            />
          ))}
        </Group>
      ) : null}

      {missed ? (
        <Group label="Missed the green — which way?">
          {GREEN_MISSES.map((m: GreenMiss) => (
            <Chip
              key={m}
              label={m[0].toUpperCase() + m.slice(1)}
              on={value.greenMiss === m}
              onPress={() => set({ greenMiss: value.greenMiss === m ? null : m })}
              a11y={`Missed the green ${m}`}
            />
          ))}
        </Group>
      ) : null}

      <View style={styles.foot}>
        <Text style={styles.derived}>
          {missed == null ? (strokes == null ? "Enter the score, then putts" : "Tap putts to finish the hole") : missed ? "Green missed · worked out for you" : "Green in regulation ✓ · worked out for you"}
        </Text>
        <Pressable
          onPress={() => set({ penalties: pens >= 2 ? null : pens + 1 })}
          style={[styles.chip, styles.penalty, pens > 0 && styles.chipOn]}
          accessibilityRole="button"
          accessibilityLabel={pens > 0 ? `${pens} penalty ${pens === 1 ? "shot" : "shots"}. Tap to change.` : "Add a penalty shot"}
        >
          <Text style={[styles.chipText, pens > 0 && styles.chipTextOn]}>{pens > 0 ? `+${pens} penalty` : "+1 penalty"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

function Chip({ label, on, onPress, a11y, small = false }: { label: string; on: boolean; onPress: () => void; a11y: string; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, small && styles.chipTextSmall, on && styles.chipTextOn]} numberOfLines={1} adjustsFontSizeToFit>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm + 4, padding: spacing.md - 2, borderRadius: radii.lg, borderWidth: 1.5, borderColor: colors.gold500, backgroundColor: colors.surfaceTint },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: "#8a6a1f" },
  note: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  label: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.ink900 },
  row: { flexDirection: "row", gap: spacing.sm },
  chip: { flex: 1, minHeight: 44, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  chipTextOn: { color: colors.gold400 },
  chipTextSmall: { fontSize: 13 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  derived: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  penalty: { flex: 0, paddingHorizontal: 14 },
});
