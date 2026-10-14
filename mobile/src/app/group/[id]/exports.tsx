import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Linking from "expo-linking";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Card, Chip, Kicker } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import type { SocietyArea } from "@/lib/groups";
import { listOutings, type OutingSummary } from "@/lib/outings";
import { irishToday, outingDateLabel } from "@/lib/outing-rules";
import { EXPORTS, exportLog, makeExport, mySocietyAreas, type ExportFile, type ExportLog } from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

type ExportDef = (typeof EXPORTS)[number];

/** May someone with these areas download this file? Mirrors the website's check. */
function allowed(e: ExportDef, areas: readonly SocietyArea[]): boolean {
  if (e.area === "any") return areas.length > 0;
  if (e.area === "people") return areas.includes("people") || areas.includes("money");
  return areas.includes(e.area);
}

const exportTitle = (file: ExportFile) => EXPORTS.find((e) => e.file === file)?.title ?? file;

const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
};

/**
 * A society's CSV exports (0145). Each file is made on the website and
 * comes back as a short-lived link the phone opens; the committee sees only
 * the files their areas allow, and every download is logged.
 */
export default function SocietyExportsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [areas, setAreas] = useState<SocietyArea[] | null>(null);
  const [events, setEvents] = useState<OutingSummary[]>([]);
  const [eventId, setEventId] = useState<number | null>(null);
  const [log, setLog] = useState<ExportLog[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<ExportFile | null>(null);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(groupId)) return;
    try {
      const a = await mySocietyAreas(groupId);
      setAreas(a);
      if (a.length === 0) return;
      const today = irishToday();
      const [upcoming, past, l] = await Promise.all([
        a.includes("events") ? listOutings(groupId, userId, { fromDate: today }) : Promise.resolve([]),
        a.includes("events") ? listOutings(groupId, userId, { fromDate: today, past: true }) : Promise.resolve([]),
        exportLog(groupId),
      ]);
      const list = [...upcoming, ...past].filter((o) => o.status === "open");
      setEvents(list);
      setEventId((cur) => (cur != null && list.some((o) => o.id === cur) ? cur : (list[0]?.id ?? null)));
      setLog(l);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const files = useMemo(() => (areas ? EXPORTS.filter((e) => allowed(e, areas)) : []), [areas]);

  async function download(e: ExportDef) {
    if (e.needsEvent && eventId == null) {
      Alert.alert("Pick an event", "Choose which event the booking sheet is for.");
      return;
    }
    setBusy(e.file);
    try {
      const result = await makeExport(groupId, e.file, e.needsEvent ? eventId : null);
      await Linking.openURL(result.url);
      setLog(await exportLog(groupId));
    } catch (err) {
      Alert.alert("Couldn't make the file", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const header = <Stack.Screen options={{ title: "Export", headerBackTitle: "Back" }} />;

  if (failed && !areas) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="the exports" size="screen" />
      </View>
    );
  }
  if (!areas) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (files.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="lock-closed-outline" title="For the committee" body="Exports are for the society's owner and committee." size="screen" />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {header}
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Download a spreadsheet</Text>
        <Text style={styles.sub}>Each file is a CSV that opens in Excel, Numbers or Google Sheets.</Text>

        {files.map((e) => {
          const locked = e.area === "people" || e.area === "money";
          const running = busy === e.file;
          const blocked = !!e.needsEvent && eventId == null;
          return (
            <Card key={e.file}>
              <View style={styles.fileTop}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.fileTitle}>{e.title}</Text>
                  <Text style={styles.fileDetail}>{e.detail}</Text>
                  <View style={styles.whoLine}>
                    {locked ? <Ionicons name="lock-closed" size={13} color={colors.navy900} accessibilityLabel="Restricted" /> : null}
                    <Chip tone={locked ? "navy" : "grey"}>{e.who}</Chip>
                  </View>
                </View>
                <Pressable
                  style={[styles.download, (running || blocked || busy != null) && styles.downloadOff]}
                  onPress={() => void download(e)}
                  disabled={running || busy != null}
                  accessibilityRole="button"
                  accessibilityLabel={`Download ${e.title}`}
                  accessibilityState={{ busy: running, disabled: busy != null || blocked }}
                >
                  {running ? <ActivityIndicator color={colors.navy900} /> : <Ionicons name="download-outline" size={22} color={colors.navy900} />}
                </Pressable>
              </View>

              {e.needsEvent ? (
                events.length === 0 ? (
                  <Text style={styles.small}>No events yet. Add one first, then come back for its booking sheet.</Text>
                ) : (
                  <View style={{ gap: 6 }}>
                    <Kicker>Which event</Kicker>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.events}>
                      {events.map((o) => {
                        const on = o.id === eventId;
                        return (
                          <Pressable
                            key={o.id}
                            onPress={() => setEventId(o.id)}
                            style={[styles.event, on && styles.eventOn]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={`${o.title}, ${outingDateLabel(o.playsOn)}`}
                          >
                            <Text style={[styles.eventTitle, on && styles.eventTextOn]} numberOfLines={1}>
                              {o.title}
                            </Text>
                            <Text style={[styles.eventDate, on && styles.eventTextOn]}>{outingDateLabel(o.playsOn)}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                )
              ) : null}
            </Card>
          );
        })}

        <View style={styles.note} accessible accessibilityRole="text">
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.green700} />
          <Text style={styles.noteText}>Mobile numbers are only in the members list, and only the ones you can already see. Every download is recorded below.</Text>
        </View>

        <Kicker>Recent exports</Kicker>
        {log.length === 0 ? (
          <Text style={styles.small}>No downloads yet.</Text>
        ) : (
          <Card style={{ gap: 0, paddingVertical: spacing.xs }}>
            {log.map((l, i) => (
              <View key={l.id} style={[styles.logRow, i > 0 && styles.logRowLine]} accessible accessibilityLabel={`${exportTitle(l.file)}, by ${l.who ?? "a committee member"}, ${dateLabel(l.createdAt)}, ${l.rows} rows`}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={styles.logTitle}>{exportTitle(l.file)}</Text>
                  <Text style={styles.small}>{[l.who ?? "A committee member", dateLabel(l.createdAt)].filter(Boolean).join(" · ")}</Text>
                </View>
                <Text style={styles.logRows}>{`${l.rows} ${l.rows === 1 ? "row" : "rows"}`}</Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: type.title, color: colors.navy900 },
  sub: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginBottom: spacing.xs },
  fileTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  fileTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  fileDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, lineHeight: 19 },
  whoLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  download: { width: 48, height: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold400 },
  downloadOff: { opacity: 0.5 },
  events: { gap: 6 },
  event: { minHeight: 52, maxWidth: 200, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceTint, justifyContent: "center" },
  eventOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  eventTitle: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  eventDate: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  eventTextOn: { color: colors.cream50 },
  note: { flexDirection: "row", gap: spacing.sm, padding: 12, borderRadius: radii.md, backgroundColor: colors.green100, marginVertical: spacing.xs },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, lineHeight: 19, color: colors.green800 },
  small: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  logRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10 },
  logRowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  logTitle: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  logRows: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.navy900 },
});
