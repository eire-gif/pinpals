import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { matchChip, SectionTitle } from "@/components/compete-bits";
import { CourseSearch } from "@/components/course-search";
import { DateSheet, dateToIso, dayLabel } from "@/components/date-sheet";
import { Button, Card, Chip, Kicker } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { TimeSheet } from "@/components/time-sheet";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { COMMON_MARGINS, EXTRA_HOLES, MORE_MARGINS, STAGE_LABEL, hoursUntilStands, isKnockout, myMatchState, resultLine, shotsFromIndexes } from "@/lib/matchplay";
import { arrangeMatch, confirmResult, disputeResult, loadMatch, reportResult, resolveMatch, type MatchPage } from "@/lib/matchplay-data";
import { conversationWith } from "@/lib/members";
import { outingDateLabel } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

type Winner = "me" | "them" | "half";

/**
 * One match (0148): who, how many shots, when and where, and the result.
 * Either player reports it; the other confirms or disputes; it stands after
 * 48 hours. The organiser can settle a dispute, give a walkover or void it.
 */
export default function MatchScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [page, setPage] = useState<MatchPage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Reporting
  const [reporting, setReporting] = useState(false);
  const [winner, setWinner] = useState<Winner | null>(null);
  const [margin, setMargin] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  // Disputing
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  // Arranging
  const [arranging, setArranging] = useState(false);
  const [date, setDate] = useState(dateToIso(new Date()));
  const [time, setTime] = useState("09:00");
  const [club, setClub] = useState<{ id: number; name: string } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  // Settling (organiser)
  const [settling, setSettling] = useState(false);
  const [sWinner, setSWinner] = useState<"a" | "b" | "half" | null>(null);
  const [sMargin, setSMargin] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(id)) return;
    try {
      setPage(await loadMatch(id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function run(fn: () => Promise<unknown>, title: string, after?: () => void) {
    setBusy(true);
    try {
      await fn();
      after?.();
      await load();
    } catch (err) {
      Alert.alert(title, err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const header = <Stack.Screen options={{ title: "Match", headerBackTitle: "Back" }} />;

  if (!isOn("competitions")) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="trophy-outline" title="Competitions are on their way" size="screen" />
      </View>
    );
  }
  if (failed && !page) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="this match" size="screen" />
      </View>
    );
  }
  if (page === undefined) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!page) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="trophy-outline" title="This match isn't available" size="screen" />
      </View>
    );
  }

  const { match, league, players, organiser } = page;
  const a = match.playerA ? players[match.playerA] : undefined;
  const b = match.playerB ? players[match.playerB] : undefined;
  const nameOf = (u: string | null) => (u ? players[u]?.name ?? "A member" : "To be decided");
  const mine = !!me && (me === match.playerA || me === match.playerB);
  const opponent = mine ? (me === match.playerA ? b : a) : undefined;
  const state = me ? myMatchState(match, me) : "done";
  const knockout = isKnockout(match.stage);
  const chip = matchChip(match, me);
  const shots = a && b ? shotsFromIndexes(a.handicapIndex, b.handicapIndex) : null;
  const higher = a && b ? (a.handicapIndex > b.handicapIndex ? a : b) : null;
  const stageLabel = match.stage === "group" ? `Group ${match.groupLabel} · Round ${match.roundNo}` : STAGE_LABEL[match.stage];
  const leagueOpen = league.status !== "finished" && league.status !== "cancelled";
  const reportedLine = match.winner ? resultLine(match, nameOf) : "";

  const chipsFor = (list: readonly string[], value: string | null, set: (m: string) => void) => (
    <View style={styles.chips}>
      {list.map((m) => {
        const on = value === m;
        return (
          <Pressable key={m} onPress={() => set(m)} style={[styles.pick, on && styles.pickOn]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={m.replace("&", " and ")}>
            <Text style={[styles.pickText, on && styles.pickTextOn]}>{m}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  async function message() {
    if (!opponent) return;
    try {
      const conversation = await conversationWith(opponent.userId);
      router.push({ pathname: "/conversation/[id]", params: { id: String(conversation) } });
    } catch {
      router.push(`/member/${opponent.userId}`);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      {header}
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.intro} onPress={() => router.push(`/compete/${league.id}`)} accessibilityRole="button" accessibilityLabel={`${league.name}, ${stageLabel}. Open the competition`}>
          <Text style={styles.introKicker}>{`${league.name} · ${stageLabel}`.toUpperCase()}</Text>
          <Text style={styles.introTitle}>{`${nameOf(match.playerA)} v ${nameOf(match.playerB)}`}</Text>
          {chip ? <Chip tone={chip.tone} style={{ marginTop: 4 }}>{chip.label}</Chip> : null}
        </Pressable>

        <View style={styles.players}>
          {[a, b].map((p, i) => (
            <View key={i} style={styles.player}>
              <Avatar url={p?.avatarUrl} color={p?.avatarColor} name={p?.name ?? "?"} size={52} />
              <Text style={styles.playerName} numberOfLines={1}>
                {p ? (p.userId === me ? `${p.name} (you)` : p.name) : "To be decided"}
              </Text>
              <Text style={styles.small}>{p ? `HI ${p.handicapIndex}` : match.stage === "ladder" ? "" : "Winner of the match before"}</Text>
            </View>
          ))}
        </View>

        {shots != null && higher ? (
          <Card>
            <Kicker>Shots</Kicker>
            <Text style={styles.body}>
              {shots === 0 ? "Level: no shots either way." : `About ${shots} ${shots === 1 ? "shot" : "shots"} to ${higher.userId === me ? "you" : higher.name}, on the stroke index holes.`}
            </Text>
            <Text style={styles.small}>Full difference between your course handicaps, as Golf Ireland plays singles matchplay. Check them from the tees you play on the day.</Text>
          </Card>
        ) : null}

        <Card>
          <Kicker>When and where</Kicker>
          {match.arrangedAt ? (
            <Text style={styles.body}>
              {[
                new Date(match.arrangedAt).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
                match.arrangedClubName,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : (
            <Text style={styles.body}>Not arranged yet.</Text>
          )}
          {match.playBy ? <Text style={styles.small}>{`Play by ${outingDateLabel(match.playBy)}.`}</Text> : null}
          {mine && match.status === "open" && opponent ? (
            arranging ? (
              <View style={{ gap: spacing.sm }}>
                <Pressable style={styles.picker} onPress={() => setDateOpen(true)} accessibilityRole="button" accessibilityLabel={`Date, ${dayLabel(date)}`}>
                  <Ionicons name="calendar-outline" size={18} color={colors.navy900} />
                  <Text style={styles.pickerText}>{dayLabel(date)}</Text>
                </Pressable>
                <Pressable style={styles.picker} onPress={() => setTimeOpen(true)} accessibilityRole="button" accessibilityLabel={`Tee time, ${time}`}>
                  <Ionicons name="time-outline" size={18} color={colors.navy900} />
                  <Text style={styles.pickerText}>{time}</Text>
                </Pressable>
                {club ? (
                  <Pressable style={styles.picker} onPress={() => setClub(null)} accessibilityRole="button" accessibilityLabel={`${club.name}. Change the club`}>
                    <Ionicons name="golf-outline" size={18} color={colors.navy900} />
                    <Text style={[styles.pickerText, { flex: 1 }]}>{club.name}</Text>
                    <Ionicons name="close" size={18} color={colors.ink500} />
                  </Pressable>
                ) : (
                  <CourseSearch placeholder="Which club? (optional)" onPick={(c) => setClub({ id: c.id, name: c.name })} />
                )}
                <View style={styles.row}>
                  <Button label="Cancel" tone="line" onPress={() => setArranging(false)} style={{ flex: 1 }} />
                  <Button
                    label="Save and tell them"
                    busy={busy}
                    onPress={() => {
                      const [y, mo, d] = date.split("-").map(Number);
                      const [h, mi] = time.split(":").map(Number);
                      const at = new Date(y, mo - 1, d, h, mi).toISOString();
                      void run(() => arrangeMatch(id, at, club?.id ?? null), "Couldn't save the time", () => setArranging(false));
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.row}>
                <Button label={`Message ${opponent.name.split(" ")[0]}`} tone="line" icon="chatbubble-outline" onPress={() => void message()} style={{ flex: 1 }} />
                <Button label={match.arrangedAt ? "Change" : "Set a time"} icon="calendar-outline" onPress={() => setArranging(true)} style={{ flex: 1 }} />
              </View>
            )
          ) : null}
        </Card>

        {/* ---------------- The result ---------------- */}
        {match.status === "confirmed" || match.status === "void" ? (
          <Card>
            <Kicker>Result</Kicker>
            <Text style={styles.result}>{match.status === "void" ? "Void" : reportedLine}</Text>
          </Card>
        ) : null}

        {match.status === "reported" ? (
          <Card>
            <Kicker>{state === "confirm" ? "Your opponent reported" : "Reported"}</Kicker>
            <Text style={styles.result}>{reportedLine}</Text>
            <Text style={styles.small}>{`It stands in ${hoursUntilStands(match.standsAt)} hours unless it's disputed.`}</Text>
            {state === "confirm" ? (
              disputing ? (
                <View style={{ gap: spacing.sm }}>
                  <TextInput style={[styles.input, styles.multi]} value={note} onChangeText={setNote} placeholder="What was the result? The organiser will settle it." placeholderTextColor={colors.ink500} multiline maxLength={500} accessibilityLabel="Why you're disputing it" />
                  <View style={styles.row}>
                    <Button label="Back" tone="line" onPress={() => setDisputing(false)} style={{ flex: 1 }} />
                    <Button label="Send to the organiser" tone="danger" busy={busy} onPress={() => void run(() => disputeResult(id, note.trim() || null), "Couldn't send the dispute", () => setDisputing(false))} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <View style={styles.row}>
                  <Button label="Dispute" tone="line" onPress={() => setDisputing(true)} style={{ flex: 1 }} />
                  <Button label="Confirm result" busy={busy} onPress={() => match.winner && void run(() => confirmResult(id, match.winner as "a" | "b" | "half", match.margin), "Couldn't confirm the result")} style={{ flex: 1 }} />
                </View>
              )
            ) : state === "waiting" ? (
              <Button label="Change what I reported" tone="line" onPress={() => setReporting(true)} />
            ) : null}
          </Card>
        ) : null}

        {match.status === "disputed" ? (
          <Card>
            <Kicker>With the organiser</Kicker>
            {reportedLine ? <Text style={styles.body}>{`Reported: ${reportedLine}.`}</Text> : null}
            {match.disputeNote ? <Text style={styles.body}>{`“${match.disputeNote}”`}</Text> : null}
            <Text style={styles.small}>The organiser settles it and both of you are told.</Text>
          </Card>
        ) : null}

        {mine && leagueOpen && opponent && (state === "arrange" || state === "arranged" || (state === "waiting" && reporting)) ? (
          reporting ? (
            <Card>
              <Kicker>Report the result</Kicker>
              <Text style={styles.label}>Who won?</Text>
              <View style={styles.chips}>
                {(
                  [
                    ["me", "I won"],
                    ["them", `${opponent.name.split(" ")[0]} won`],
                    ...(knockout ? [] : [["half", "Halved"]]),
                  ] as [Winner, string][]
                ).map(([w, label]) => {
                  const on = winner === w;
                  return (
                    <Pressable key={w} onPress={() => setWinner(w)} style={[styles.pick, styles.pickWide, on && styles.pickOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[styles.pickText, on && styles.pickTextOn]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {winner && winner !== "half" ? (
                <>
                  <Text style={styles.label}>By how much?</Text>
                  {chipsFor(COMMON_MARGINS, margin, setMargin)}
                  {knockout ? (
                    <>
                      <Text style={styles.small}>Level after 18? Extra holes:</Text>
                      {chipsFor(EXTRA_HOLES, margin, setMargin)}
                    </>
                  ) : null}
                  {more ? chipsFor(MORE_MARGINS, margin, setMargin) : (
                    <Pressable onPress={() => setMore(true)} style={styles.moreBtn} accessibilityRole="button">
                      <Text style={styles.moreText}>More results</Text>
                    </Pressable>
                  )}
                </>
              ) : null}
              <View style={styles.row}>
                <Button label="Cancel" tone="line" onPress={() => setReporting(false)} style={{ flex: 1 }} />
                <Button
                  label="Send"
                  busy={busy}
                  disabled={!winner || (winner !== "half" && !margin)}
                  onPress={() =>
                    void run(async () => {
                      const outcome = await reportResult(id, winner as Winner, winner === "half" ? null : margin);
                      if (outcome === "disputed") Alert.alert("That doesn't match", "Your opponent reported a different result, so it has gone to the organiser to settle.");
                    }, "Couldn't report the result", () => setReporting(false))
                  }
                  style={{ flex: 1 }}
                />
              </View>
              <Text style={styles.small}>Your opponent confirms it. If they don't dispute it, it stands after 48 hours.</Text>
            </Card>
          ) : (
            <Button label="Report the result" icon="flag-outline" tone="gold" onPress={() => setReporting(true)} />
          )
        ) : null}

        {/* ---------------- The organiser ---------------- */}
        {organiser && leagueOpen && a && b && match.margin !== "bye" && !(match.stage === "ladder" && match.status === "confirmed") ? (
          <>
            <SectionTitle>Organiser</SectionTitle>
            {settling ? (
              <Card>
                <Kicker>Settle this match</Kicker>
                <Text style={styles.small}>Use this for a dispute, a walkover or a match that won't be played.</Text>
                <View style={styles.chips}>
                  {(
                    [
                      ["a", `${a.name} won`],
                      ["b", `${b.name} won`],
                      ...(knockout ? [] : [["half", "Halved"]]),
                    ] as ["a" | "b" | "half", string][]
                  ).map(([w, label]) => {
                    const on = sWinner === w;
                    return (
                      <Pressable key={w} onPress={() => setSWinner(w)} style={[styles.pick, styles.pickWide, on && styles.pickOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
                        <Text style={[styles.pickText, on && styles.pickTextOn]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {sWinner && sWinner !== "half" ? chipsFor(["w/o", ...COMMON_MARGINS, ...(knockout ? EXTRA_HOLES : []), ...MORE_MARGINS], sMargin, setSMargin) : null}
                <View style={styles.row}>
                  <Button label="Cancel" tone="line" onPress={() => setSettling(false)} style={{ flex: 1 }} />
                  <Button
                    label="Settle it"
                    busy={busy}
                    disabled={!sWinner || (sWinner !== "half" && !sMargin)}
                    onPress={() => void run(() => resolveMatch(id, sWinner, sWinner === "half" ? null : sMargin), "Couldn't settle the match", () => setSettling(false))}
                    style={{ flex: 1 }}
                  />
                </View>
                {!knockout ? (
                  <Button
                    label="Void the match"
                    tone="danger"
                    onPress={() =>
                      Alert.alert("Void this match?", "It won't count for either player.", [
                        { text: "Keep it", style: "cancel" },
                        { text: "Void", style: "destructive", onPress: () => void run(() => resolveMatch(id, null, null, true), "Couldn't void the match", () => setSettling(false)) },
                      ])
                    }
                  />
                ) : null}
              </Card>
            ) : (
              <Button label={match.status === "confirmed" ? "Change the result" : "Settle this match"} tone="line" icon="hammer-outline" onPress={() => setSettling(true)} />
            )}
          </>
        ) : null}
      </ScrollView>

      <DateSheet open={dateOpen} title="Date of the match" value={date} maxDaysAhead={120} onClose={() => setDateOpen(false)} onChange={setDate} />
      <TimeSheet open={timeOpen} title="Tee time" value={time} onClose={() => setTimeOpen(false)} onChange={setTime} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  intro: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  introKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.gold400 },
  introTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50 },
  players: { flexDirection: "row", gap: spacing.sm },
  player: { flex: 1, alignItems: "center", gap: 4, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  playerName: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  body: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, lineHeight: 18 },
  label: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900 },
  result: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  row: { flexDirection: "row", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pick: { minWidth: 64, minHeight: 44, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  pickWide: { flexGrow: 1 },
  pickOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  pickText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  pickTextOn: { color: colors.cream50 },
  moreBtn: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  moreText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickerText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  input: { minHeight: 48, paddingHorizontal: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.line, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.cream50 },
  multi: { minHeight: 88, paddingTop: 10, textAlignVertical: "top" },
});
