import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { officeAreas } from "@/lib/groups";
import { outingDateLabel } from "@/lib/outing-rules";
import { loadCupPage, saveCupSessions, tripDayNumber, type CupPage } from "@/lib/trip-cup";
import { CUP_ALLOWANCE_LABEL, CUP_FORMATS, CUP_FORMAT_LABEL, matchesFor, pts, type CupFormat } from "@/lib/trip-cup-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

type Plan = Map<string, CupFormat>; // `${itemId}:${slot}` → format

/**
 * Ryder Cup mode (0200): a session for each round on the itinerary — its
 * format, the matches and points it's worth — and an afternoon session for a
 * 36-hole day. Whoever runs the trip plans them; everyone else sees the plan.
 */
export default function CupSessionsScreen() {
  const { id: rawId, outingId: rawOuting } = useLocalSearchParams<{ id: string; outingId: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [page, setPage] = useState<CupPage | null | undefined>(undefined);
  const [officer, setOfficer] = useState(false);
  const [failed, setFailed] = useState(false);
  const [plan, setPlan] = useState<Plan>(new Map());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [p, g] = await Promise.all([loadCupPage(outingId), loadGroupPage(groupId, me).catch(() => null)]);
      setPage(p);
      setOfficer(officeAreas(g?.myRole ?? null, g?.myOffice ?? null).includes("events"));
      if (p) {
        const next: Plan = new Map(p.sessions.map((s) => [`${s.itemId}:${s.slot}`, s.format]));
        // A new Cup: every round planned, singles on the last day, fourballs before.
        if (p.sessions.length === 0) p.rounds.forEach((r, i) => next.set(`${r.id}:1`, i === p.rounds.length - 1 && p.rounds.length > 1 ? "singles" : i % 2 === 0 ? "fourball" : "foursomes"));
        setPlan(next);
        setDirty(p.sessions.length === 0 && p.rounds.length > 0);
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, outingId, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (failed && page === undefined) return <LoadError size="screen" onRetry={() => void load()} what="the sessions" />;
  if (page === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.green700} />
      </View>
    );
  }
  if (!page) return <StateMessage size="screen" icon="trophy-outline" title="No Cup on this trip" />;

  const n1 = page.members.filter((m) => m.team === 1).length;
  const n2 = page.members.length - n1;
  const started = new Map(page.sessions.filter((s) => s.matchDayId != null).map((s) => [`${s.itemId}:${s.slot}`, s]));
  const pointsOf = (key: string, f: CupFormat) => started.get(key)?.score.points ?? matchesFor(f, n1, n2);
  const total = [...plan.entries()].reduce((n, [k, f]) => n + pointsOf(k, f), 0);
  const holders = page.cup.holders;

  const set = (key: string, f: CupFormat | null) => {
    setPlan((prev) => {
      const next = new Map(prev);
      if (f) next.set(key, f);
      else next.delete(key);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveCupSessions(
        page.cup.id,
        [...plan.entries()].map(([k, format]) => {
          const [itemId, slot] = k.split(":").map(Number);
          return { itemId, slot: slot === 2 ? 2 : 1, format };
        })
      );
      setDirty(false);
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save the sessions", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.cream50 }} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: "Sessions" }} />
      <Text style={styles.meta}>One session for each round on the trip. Every match is worth a point; a halved match is ½ each.</Text>

      {page.rounds.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.meta}>There are no rounds on the itinerary yet. Add them to the trip first.</Text>
        </View>
      ) : null}

      {page.rounds.map((r) => {
        const n = tripDayNumber(page.tripStartsOn, r.onDate);
        return (
          <View key={r.id} style={styles.card}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <Text style={styles.rowTitle}>{`${n && n > 0 ? `Day ${n} · ` : ""}${outingDateLabel(r.onDate)}`}</Text>
              <Text style={[styles.meta, { flexShrink: 1 }]} numberOfLines={1}>
                {r.title}
              </Text>
            </View>
            {([1, 2] as const).map((slot) => {
              const key = `${r.id}:${slot}`;
              const f = plan.get(key) ?? null;
              const s = started.get(key);
              if (slot === 2 && !f) {
                return officer && plan.has(`${r.id}:1`) ? (
                  <Pressable key={key} style={styles.add} onPress={() => set(key, "foursomes")} accessibilityRole="button">
                    <Text style={styles.addText}>+ Add an afternoon session (36 holes)</Text>
                  </Pressable>
                ) : null;
              }
              return (
                <View key={key} style={{ gap: 8 }}>
                  {slot === 2 ? <Text style={styles.slot}>AFTERNOON</Text> : null}
                  {s ? (
                    <Text style={styles.meta}>{`${CUP_FORMAT_LABEL[s.format]} · started · ${s.score.points} matches`}</Text>
                  ) : (
                    <>
                      <View style={styles.chips}>
                        {CUP_FORMATS.map((x) => {
                          const on = f === x;
                          return (
                            <Pressable
                              key={x}
                              disabled={!officer}
                              style={[styles.chip, on && styles.chipOn]}
                              onPress={() => set(key, x)}
                              accessibilityRole="radio"
                              accessibilityState={{ selected: on, disabled: !officer }}
                            >
                              <Text style={[styles.chipText, on && styles.chipTextOn]}>{CUP_FORMAT_LABEL[x]}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {f ? <Text style={styles.meta}>{`${pointsOf(key, f)} ${pointsOf(key, f) === 1 ? "match" : "matches"} · ${pointsOf(key, f)} points · ${CUP_ALLOWANCE_LABEL[f]}`}</Text> : <Text style={styles.meta}>Not part of the Cup</Text>}
                      {officer ? (
                        <Pressable style={styles.add} onPress={() => {
                            if (f) {
                              set(key, null);
                              if (slot === 1 && !started.has(`${r.id}:2`)) set(`${r.id}:2`, null);
                            } else set(key, "fourball");
                          }} accessibilityRole="button">
                          <Text style={styles.addText}>{f ? (slot === 2 ? "Remove the afternoon session" : "Leave this round out of the Cup") : "Put this round in the Cup"}</Text>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </View>
              );
            })}
          </View>
        );
      })}

      <View style={styles.total}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={styles.rowTitle}>{`${pts(total)} points to play for`}</Text>
          <Text style={styles.rowTitle}>{`${pts(total / 2 + 0.5)} wins`}</Text>
        </View>
        <Text style={[styles.meta, { color: colors.green800 }]}>
          {holders ? `${page.cup.teamNames[holders - 1]} hold the Cup, so ${pts(total / 2)} keeps it for them.` : "Level at the end, it's shared."}
          {n1 !== n2 ? ` The teams are ${n1} v ${n2}: matches are counted from the smaller team.` : ""}
          {page.members.length === 0 ? " Make the teams to see how many matches each session has." : ""}
        </Text>
      </View>

      {officer ? (
        <Pressable style={[styles.save, (!dirty || saving) && { opacity: 0.5 }]} disabled={!dirty || saving} onPress={save} accessibilityRole="button">
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.saveText}>Save the sessions</Text>}
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: 10 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  slot: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, color: colors.ink500, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900 },
  chipTextOn: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  add: { minHeight: 40, justifyContent: "center", alignSelf: "flex-start" },
  addText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  total: { backgroundColor: colors.green100, borderRadius: radii.lg, padding: spacing.md, gap: 6 },
  save: { minHeight: 48, borderRadius: radii.md, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  saveText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
