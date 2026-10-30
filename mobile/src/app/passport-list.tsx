import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldButton } from "@/components/gold-button";
import { TONES } from "@/components/live-scoring-card";
import { LoadError, StateMessage } from "@/components/state-message";
import { TintedHeader } from "@/components/tinted-header";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { COUNTRY_LABEL, IRISH_LINKS_TRAIL, loadPassport, type Passport } from "@/lib/passport";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * A bucket list from the Course Passport: the Irish Links Trail (twelve of
 * the island's great links), or the member's own list (courses they've
 * saved to "My bucket list" from a course page or their profile). Played
 * courses tick off with the date; the rest open the course.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (iso: string) => {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
};

type Row = { key: string; label: string; place: string; clubId: number | null; played: boolean; when: string | null; rounds: number };

export default function PassportListScreen() {
  const params = useLocalSearchParams<{ list?: string }>();
  const trail = params.list !== "mine";
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [data, setData] = useState<Passport | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setFailed(false);
      setData(await loadPassport(userId));
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const header = <TintedHeader color={TONES.claret.card} title={trail ? "Irish Links Trail" : "My Bucket List"} subtitle="Bucket list" />;

  if (!isOn("coursePassport")) {
    return (
      <>
        {header}
        <StateMessage size="screen" icon="list-outline" title="Bucket lists are on their way" />
      </>
    );
  }
  if (failed) {
    return (
      <>
        {header}
        <LoadError size="screen" what="the list" onRetry={() => void load()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </>
    );
  }

  const stampOf = new Map(data.stamps.map((s) => [s.id, s]));
  const rows: Row[] = trail
    ? IRISH_LINKS_TRAIL.map((t) => {
        const c = data.trail.get(t.key) ?? null;
        const s = c ? stampOf.get(c.id) : undefined;
        return { key: t.key, label: t.label, place: t.place, clubId: c?.id ?? null, played: !!s, when: s?.lastPlayed ?? null, rounds: s?.rounds ?? 0 };
      })
    : data.bucket.map((b) => {
        const s = stampOf.get(b.id);
        return {
          key: String(b.id),
          label: b.name,
          place: [b.region, COUNTRY_LABEL[b.country] ?? b.country].filter(Boolean).join(", "),
          clubId: b.id,
          played: !!s,
          when: s?.lastPlayed ?? null,
          rounds: s?.rounds ?? 0,
        };
      });
  rows.sort((a, b) => Number(b.played) - Number(a.played));
  const done = rows.filter((r) => r.played).length;
  const total = rows.length;

  return (
    <>
      {header}
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <View style={styles.count} accessible accessibilityLabel={`${done} of ${total} played`}>
            <Text style={styles.countBig}>{done}</Text>
            <Text style={styles.countOf}>{`of ${total}`}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>BUCKET LIST</Text>
            <Text style={styles.heroTitle}>{trail ? "Irish Links Trail" : "My bucket list"}</Text>
            <Text style={styles.heroSub}>{total - done === 0 && total > 0 ? "Every one played — well done" : `${total - done} to go`}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${total ? Math.round((done / total) * 100) : 0}%` }]} />
            </View>
          </View>
        </View>

        {rows.length === 0 ? (
          <StateMessage
            icon="bookmark-outline"
            title="Nothing on your list yet"
            body="Open any course and add it to your bucket list, and it'll show here and on your passport map."
          />
        ) : (
          <View style={styles.list}>
            {rows.map((r, i) => (
              <Pressable
                key={r.key}
                onPress={() => r.clubId != null && router.push(`/course/${r.clubId}`)}
                disabled={r.clubId == null}
                style={[styles.row, i < rows.length - 1 && styles.rowLine]}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}, ${r.played ? "played" : "not played yet"}`}
              >
                {r.played ? (
                  <View style={styles.ok}>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </View>
                ) : (
                  <View style={styles.no} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{r.label}</Text>
                  <Text style={styles.meta}>
                    {r.played ? (r.when ? `Played ${monthYear(r.when)}${r.rounds > 1 ? ` · ${r.rounds} rounds` : ""}` : "Played") : r.place}
                  </Text>
                </View>
                {!r.played && r.clubId != null ? <Text style={styles.go}>View</Text> : null}
              </Pressable>
            ))}
          </View>
        )}

        {total - done > 0 ? (
          <GoldButton label="Plan a golf trip" onPress={() => router.push({ pathname: "/groups/new", params: { kind: "trip" } })} />
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: 14 },
  hero: { flexDirection: "row", alignItems: "center", gap: 16, backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md },
  count: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  countBig: { fontFamily: fonts.bodyBold, fontSize: 28, color: colors.cream50, lineHeight: 30 },
  countOf: { fontFamily: fonts.bodySemi, fontSize: 12, color: "#d9d2c2" },
  track: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.14)", overflow: "hidden", marginTop: 8 },
  fill: { height: "100%", borderRadius: 4, backgroundColor: colors.gold400 },
  heroEyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, color: colors.gold400 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50, marginTop: 4 },
  heroSub: { fontFamily: fonts.body, fontSize: 15, color: "#d9d2c2", marginTop: 2 },
  list: { backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: "#e6dcc6", overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 60 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: "#efe7d6" },
  ok: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  no: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderStyle: "dashed", borderColor: "#b9ae98" },
  name: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.navy900 },
  meta: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500, marginTop: 2 },
  go: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900, backgroundColor: "#f3ede1", borderWidth: 1.5, borderColor: "#e6dcc6", paddingHorizontal: 12, paddingVertical: 9, borderRadius: radii.pill, overflow: "hidden" },
});
