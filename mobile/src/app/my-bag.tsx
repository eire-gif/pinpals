import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { LongestShots } from "@/components/longest-shots";
import { CLUBS, LEARNED_FROM, clubDistanceM, type BagClub } from "@/lib/bag";
import { loadMyBag, saveBagClub } from "@/lib/hole-extras";
import { METRES_PER_YARD } from "@/lib/hole-geo";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/** A usual set, to start from in one tap. */
const STARTER = ["driver", "3w", "5h", "5i", "6i", "7i", "8i", "9i", "pw", "sw"];

/**
 * My bag (Oct 2026, 0153): the clubs a member carries and how far they hit
 * each — typed in to start, then learned from the shots they tag on the
 * hole map ("Which club?" after marking a shot). The hole map suggests the
 * club nearest the plays-like distance. Private to the member.
 */
export default function MyBagScreen() {
  const [bag, setBag] = useState<BagClub[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setBag(await loadMyBag());
    } catch {
      setBag((b) => b ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const byKey = new Map((bag ?? []).map((c) => [c.club, c]));
  const save = async (club: string, change: { yards?: number | null; inBag?: boolean }) => {
    setBusy(club);
    try {
      await saveBagClub(club, change);
      await load();
    } catch {
      Alert.alert("That didn't save", "Please try again.");
    } finally {
      setBusy(null);
    }
  };
  const saveYards = (club: string) => {
    const raw = drafts[club];
    if (raw === undefined) return;
    const n = raw.trim() === "" ? null : Math.round(Number(raw));
    if (n != null && (!Number.isFinite(n) || n < 20 || n > 400)) {
      Alert.alert("Between 20 and 400 yards", "How far you usually carry it, in yards.");
      return;
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[club];
      return next;
    });
    void save(club, { yards: n, inBag: true });
  };
  const starter = async () => {
    setBusy("starter");
    try {
      for (const k of STARTER) await saveBagClub(k, { inBag: true });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (bag === null) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;

  const anyInBag = bag.some((c) => c.inBag);
  const all = CLUBS.map((c) => ({ info: c, row: byKey.get(c.key) ?? null }));
  const carried = all.filter((x) => x.row?.inBag);
  const others = all.filter((x) => !x.row?.inBag);
  // The bar's scale: 50 yds to the longest club (or 280).
  const longest = Math.max(280, ...carried.map((x) => (x.row && (x.row.highM ?? clubDistanceM(x.row)) ? (x.row.highM ?? clubDistanceM(x.row)!) / METRES_PER_YARD : 0)));
  const pct = (y: number) => Math.max(0, Math.min(100, ((y - 50) / (longest - 50)) * 100));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardDismissMode={KEYBOARD_DISMISS_MODE}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <Text style={styles.intro}>
        How far you really hit each club. Type a number to start; after that PinPals learns it from the shots you mark on the hole map — tap the club under "Which club?" after each shot.
      </Text>

      {!anyInBag ? (
        <Pressable onPress={() => void starter()} disabled={busy != null} style={styles.starter} accessibilityRole="button">
          <Text style={styles.starterText}>{busy === "starter" ? "Adding…" : "Start with a usual set of clubs"}</Text>
        </Pressable>
      ) : null}

      {carried.length ? (
        <View style={styles.card}>
          <View style={styles.headRow}>
            <Text style={[styles.head, { flex: 1 }]}>In my bag</Text>
            <Text style={styles.head}>Yards</Text>
          </View>
          {carried.map(({ info, row }) => {
            const learned = row && row.medianM != null ? Math.round(row.medianM / METRES_PER_YARD) : null;
            const lo = row?.lowM != null ? row.lowM / METRES_PER_YARD : null;
            const hi = row?.highM != null ? row.highM / METRES_PER_YARD : null;
            const using = row ? clubDistanceM(row) : null;
            return (
              <View key={info.key} style={styles.row}>
                <View style={styles.rowTop}>
                  <Text style={styles.clubName}>{info.name}</Text>
                  <TextInput
                    value={drafts[info.key] ?? (row?.yards != null ? String(row.yards) : "")}
                    onChangeText={(t) => setDrafts((d) => ({ ...d, [info.key]: t.replace(/[^0-9]/g, "") }))}
                    onBlur={() => saveYards(info.key)}
                    onSubmitEditing={() => saveYards(info.key)}
                    placeholder="–"
                    placeholderTextColor={colors.ink500}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    maxLength={3}
                    style={styles.input}
                    accessibilityLabel={`${info.name}: yards you carry it`}
                  />
                  <Switch
                    value
                    onValueChange={() => void save(info.key, { inBag: false })}
                    disabled={busy === info.key}
                    trackColor={{ true: colors.green600, false: colors.line }}
                    accessibilityLabel={`${info.name} in my bag`}
                  />
                </View>
                {learned != null && lo != null && hi != null ? (
                  <View style={styles.learned}>
                    <View style={styles.bar}>
                      <View style={[styles.barFill, { left: `${pct(lo)}%`, width: `${Math.max(2, pct(hi) - pct(lo))}%` }]} />
                      <View style={[styles.barDot, { left: `${pct(learned)}%` }]} />
                    </View>
                    <Text style={styles.learnedText}>
                      Your shots: <Text style={styles.learnedBig}>{learned}</Text> · usually {Math.round(lo)}–{Math.round(hi)} · {row!.shots} shot{row!.shots === 1 ? "" : "s"}
                      {row!.shots < LEARNED_FROM ? ` (using your number until ${LEARNED_FROM})` : ""}
                    </Text>
                  </View>
                ) : using == null ? (
                  <Text style={styles.hint}>Type a distance, or tag a few shots with it.</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      <LongestShots />

      <View style={styles.card}>
        <Text style={styles.head}>Add clubs</Text>
        <View style={styles.addGrid}>
          {others.map(({ info }) => (
            <Pressable key={info.key} onPress={() => void save(info.key, { inBag: true })} disabled={busy != null} style={styles.addChip} accessibilityRole="button" accessibilityLabel={`Add ${info.name}`}>
              <Text style={styles.addChipText}>+ {info.name}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Text style={styles.footnote}>Only you see your bag. The suggestion on the hole map is a guide — the wind, the lie and the day count too.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  intro: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.ink500 },
  starter: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  starterText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.md, gap: spacing.sm },
  headRow: { flexDirection: "row", alignItems: "center", paddingRight: 64 },
  head: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green700 },
  row: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.cream100, gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  clubName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.navy900 },
  input: { width: 64, height: 40, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, textAlign: "center", fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900, backgroundColor: colors.surfaceTint },
  learned: { gap: 4 },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.cream100 },
  barFill: { position: "absolute", top: 0, bottom: 0, borderRadius: 4, backgroundColor: "#c9dcc6" },
  barDot: { position: "absolute", top: -3, width: 14, height: 14, marginLeft: -7, borderRadius: 7, backgroundColor: colors.green700, borderWidth: 2, borderColor: colors.surface },
  learnedText: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  learnedBig: { fontFamily: fonts.bodyBold, color: colors.navy900 },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  addGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  addChip: { minHeight: 40, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, justifyContent: "center", backgroundColor: colors.surfaceTint },
  addChipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.navy900 },
  footnote: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.ink500, textAlign: "center" },
});
