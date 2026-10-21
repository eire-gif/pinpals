import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { MatchRow, Pills, SectionTitle } from "@/components/compete-bits";
import { Button, Card, Chip, Kicker, ordinal } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import {
  STAGE_LABEL,
  balancedGroups,
  challengeable,
  feeLabel,
  groupCount,
  groupLabels,
  groupTable,
  knockoutBracket,
  type MatchStage,
  type TableRow,
} from "@/lib/matchplay";
import {
  cancelLeague,
  challenge,
  enterLeague,
  loadLeague,
  makeDraw,
  markPaid,
  startKnockout,
  type LeagueEntry,
  type LeaguePage,
} from "@/lib/matchplay-data";
import { outingDateLabel } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { myRoundRight } from "@/components/my-round-pill";

const KNOCKOUT_ORDER: MatchStage[] = ["r32", "r16", "qf", "sf", "final"];
const PAID: Record<NonNullable<LeagueEntry["paid"]>, string> = { cash: "Paid cash", transfer: "Paid by transfer", waived: "Fee waived" };

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * One league or ladder (0148). Entries, the draw, the group tables and
 * fixtures, the knockout, or the ladder and its challenges — whichever
 * stage it's at. The organiser's tools sit on the same screen, shown only
 * to them; the database checks every one of them again.
 */
export default function LeagueScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = Number(rawId);
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [page, setPage] = useState<LeaguePage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"groups" | "knockout">("groups");
  const [group, setGroup] = useState<string | null>(null);
  const [handicap, setHandicap] = useState("");
  // The organiser's previews, before anything is saved.
  const [draw, setDraw] = useState<string[][] | null>(null);
  const [bracket, setBracket] = useState<(string | null)[] | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(id)) return;
    try {
      const p = await loadLeague(id);
      setPage(p);
      if (p?.league.status === "knockout" || p?.league.status === "finished") setView((v) => (v === "groups" && p.league.status === "knockout" ? "knockout" : v));
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

  const names = useMemo(() => new Map((page?.entries ?? []).map((e) => [e.userId, e.name])), [page]);
  const nameOf = useCallback((u: string | null) => (u ? names.get(u) ?? "A member" : "To be decided"), [names]);
  const labels = useMemo(() => (page ? groupLabels(page.entries) : []), [page]);
  const tables = useMemo(() => {
    if (!page) return {} as Record<string, TableRow[]>;
    const l = page.league;
    return Object.fromEntries(labels.map((g) => [g, groupTable(page.entries, page.matches, g, { pointsWin: l.pointsWin, pointsHalf: l.pointsHalf, qualifiersPerGroup: l.qualifiersPerGroup })]));
  }, [page, labels]);

  async function run(fn: () => Promise<unknown>, title: string) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      Alert.alert(title, err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <Stack.Screen
      options={{
        title: page?.league.kind === "ladder" ? "Ladder" : "League",
        headerBackTitle: "Back",
        ...myRoundRight(() =>
          page?.organiser && page.league.status !== "finished" && page.league.status !== "cancelled" ? (
            <Pressable
              style={styles.headerBtn}
              accessibilityRole="button"
              accessibilityLabel="Organiser options"
              onPress={() =>
                Alert.alert(page.league.name, undefined, [
                  { text: "Edit details", onPress: () => router.push({ pathname: "/compete/new", params: { id: String(id) } }) },
                  {
                    text: "Cancel the competition",
                    style: "destructive",
                    onPress: () =>
                      Alert.alert("Cancel it for everyone?", "Every entrant is told, and matches still to play are voided.", [
                        { text: "Keep it", style: "cancel" },
                        { text: "Cancel it", style: "destructive", onPress: () => void run(() => cancelLeague(id), "Couldn't cancel it") },
                      ]),
                  },
                  { text: "Close", style: "cancel" },
                ])
              }
            >
              <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={colors.navy900} />
            </Pressable>
          ) : null),
      }}
    />
  );

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
        <LoadError onRetry={() => void load()} what="this competition" size="screen" />
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
        <StateMessage icon="trophy-outline" title="This competition isn't available" body="It may be for a group you're not in." size="screen" />
      </View>
    );
  }

  const { league, entries, matches, organiser } = page;
  const active = entries.filter((e) => !e.withdrawn);
  const mine = me ? active.find((e) => e.userId === me) : undefined;
  const fee = feeLabel(league.entryFeeCents);
  const entriesOpen = league.kind === "league" && league.status === "entries" && (!league.entriesCloseAt || new Date(league.entriesCloseAt) > new Date());
  const shownGroup = group && labels.includes(group) ? group : (mine?.groupLabel ?? labels[0] ?? null);
  const groupSettled = matches.filter((m) => m.stage === "group").every((m) => m.status === "confirmed" || m.status === "void");
  const where = league.groupName ?? (league.province ? `PinPals · ${league.province[0].toUpperCase()}${league.province.slice(1)}` : "PinPals");

  const enterBlock =
    league.kind === "ladder" ? (
      league.status === "running" ? (
        mine ? (
          <Button label="Leave the ladder" tone="line" busy={busy} onPress={() => Alert.alert("Leave the ladder?", "Everyone below you moves up one.", [{ text: "Stay", style: "cancel" }, { text: "Leave", style: "destructive", onPress: () => void run(() => enterLeague(id, false, null), "Couldn't take you off") }])} />
        ) : (
          <EnterForm handicap={handicap} setHandicap={setHandicap} busy={busy} cta="Join at the bottom" onEnter={(h) => void run(() => enterLeague(id, true, h), "Couldn't add you")} max={league.maxHandicap} />
        )
      ) : null
    ) : entriesOpen ? (
      mine ? (
        <Card>
          <Kicker>You're in</Kicker>
          <Text style={styles.body}>{`Entered off ${mine.handicapIndex}. The draw is made after entries close${league.entriesCloseAt ? ` on ${outingDateLabel(league.entriesCloseAt.slice(0, 10))}` : ""}.`}</Text>
          <Button label="Withdraw" tone="line" busy={busy} onPress={() => void run(() => enterLeague(id, false, null), "Couldn't take you out")} />
        </Card>
      ) : (
        <EnterForm handicap={handicap} setHandicap={setHandicap} busy={busy} cta={fee ? `Enter · ${fee}` : "Enter"} onEnter={(h) => void run(() => enterLeague(id, true, h), "Couldn't enter you")} max={league.maxHandicap} />
      )
    ) : null;

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      {header}
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.intro}>
          <Text style={styles.introKicker}>{where.toUpperCase()}</Text>
          <Text style={styles.introTitle}>{league.name}</Text>
          <View style={styles.chips}>
            <Chip tone="navy">{league.kind === "ladder" ? `Challenge up to ${league.challengeReach} above` : `Groups · top ${league.qualifiersPerGroup} qualify`}</Chip>
            {fee ? <Chip tone="navy">{`${fee} entry`}</Chip> : null}
            {league.maxHandicap != null ? <Chip tone="navy">{`Handicaps to ${league.maxHandicap}`}</Chip> : null}
            {league.status === "cancelled" ? <Chip tone="due">Cancelled</Chip> : null}
            {league.status === "finished" ? <Chip tone="ok">Finished</Chip> : null}
          </View>
          {league.about ? <Text style={styles.introBody}>{league.about}</Text> : null}
        </View>

        {enterBlock}

        {/* ---------------- Ladder ---------------- */}
        {league.kind === "ladder" ? (
          <Ladder page={page} me={me} busy={busy} onChallenge={(u) => void run(() => challenge(id, u).then((mid) => router.push(`/compete/match/${mid}`)), "Couldn't send the challenge")} onOpenMatch={(mid) => router.push(`/compete/match/${mid}`)} nameOf={nameOf} />
        ) : null}

        {/* ---------------- Entries (before the draw) ---------------- */}
        {league.kind === "league" && league.status === "entries" ? (
          <>
            <SectionTitle>{`Entries · ${active.length}`}</SectionTitle>
            {active.length === 0 ? <Text style={styles.quiet}>No one has entered yet.</Text> : null}
            {active.map((e) => (
              <EntrantRow
                key={e.userId}
                entry={e}
                me={me}
                right={organiser && fee ? <Chip tone={e.paid ? "ok" : "due"}>{e.paid ? PAID[e.paid] : "Not paid"}</Chip> : null}
                onPress={
                  organiser && fee
                    ? () =>
                        Alert.alert(e.name, "Entry fee", [
                          { text: "Paid cash", onPress: () => void run(() => markPaid(id, e.userId, "cash"), "Couldn't mark the fee") },
                          { text: "Paid by transfer", onPress: () => void run(() => markPaid(id, e.userId, "transfer"), "Couldn't mark the fee") },
                          { text: "Waive the fee", onPress: () => void run(() => markPaid(id, e.userId, "waived"), "Couldn't mark the fee") },
                          { text: "Not paid", onPress: () => void run(() => markPaid(id, e.userId, null), "Couldn't mark the fee") },
                          { text: "Close", style: "cancel" },
                        ])
                    : undefined
                }
              />
            ))}

            {organiser ? (
              draw ? (
                <Card>
                  <Kicker>The draw: check it, then publish</Kicker>
                  <Text style={styles.small}>Balanced by handicap. Reshuffle for a different mix, or change the number of groups.</Text>
                  <View style={styles.stepper}>
                    <Pressable style={styles.stepBtn} onPress={() => draw.length > 1 && setDraw(balancedGroups(active, draw.length - 1, shuffle))} accessibilityRole="button" accessibilityLabel="Fewer groups">
                      <Ionicons name="remove" size={20} color={colors.navy900} />
                    </Pressable>
                    <Text style={styles.stepText}>{`${draw.length} ${draw.length === 1 ? "group" : "groups"}`}</Text>
                    <Pressable style={styles.stepBtn} onPress={() => active.length / (draw.length + 1) >= 3 && setDraw(balancedGroups(active, draw.length + 1, shuffle))} accessibilityRole="button" accessibilityLabel="More groups">
                      <Ionicons name="add" size={20} color={colors.navy900} />
                    </Pressable>
                    <Pressable style={styles.reshuffle} onPress={() => setDraw(balancedGroups(active, draw.length, shuffle))} accessibilityRole="button">
                      <Ionicons name="shuffle" size={18} color={colors.navy900} />
                      <Text style={styles.reshuffleText}>Reshuffle</Text>
                    </Pressable>
                  </View>
                  {draw.map((g, i) => (
                    <View key={i} style={styles.drawGroup}>
                      <Text style={styles.drawLabel}>{`Group ${String.fromCharCode(65 + i)}${g.length < 3 || g.length > 8 ? " · needs 3 to 8" : ""}`}</Text>
                      <Text style={styles.body}>{g.map((u) => `${nameOf(u)} (${active.find((e) => e.userId === u)?.handicapIndex})`).join(", ")}</Text>
                    </View>
                  ))}
                  <View style={styles.row}>
                    <Button label="Not yet" tone="line" onPress={() => setDraw(null)} style={{ flex: 1 }} />
                    <Button
                      label="Publish the draw"
                      busy={busy}
                      disabled={draw.some((g) => g.length < 3 || g.length > 8)}
                      onPress={() =>
                        Alert.alert("Publish the draw?", "Entries close, the fixtures are made and everyone is told their group.", [
                          { text: "Not yet", style: "cancel" },
                          { text: "Publish", onPress: () => void run(() => makeDraw(id, draw).then(() => setDraw(null)), "Couldn't make the draw") },
                        ])
                      }
                      style={{ flex: 1 }}
                    />
                  </View>
                </Card>
              ) : (
                <Button label="Make the draw" icon="git-network-outline" disabled={active.length < 3} onPress={() => setDraw(balancedGroups(active, groupCount(active.length), shuffle))} />
              )
            ) : null}
          </>
        ) : null}

        {/* ---------------- Groups and knockout ---------------- */}
        {league.kind === "league" && league.status !== "entries" && labels.length ? (
          <>
            {matches.some((m) => m.stage !== "group") ? (
              <Pills
                label="Stage"
                value={view}
                onChange={setView}
                options={[
                  { id: "groups", label: "Groups" },
                  { id: "knockout", label: "Knockout" },
                ]}
              />
            ) : null}

            {view === "groups" && shownGroup ? (
              <>
                {labels.length > 1 ? (
                  <Pills label="Group" value={shownGroup} onChange={setGroup} options={labels.map((g) => ({ id: g, label: `Group ${g}` }))} />
                ) : null}
                <GroupTable rows={tables[shownGroup] ?? []} me={me} />
                <Text style={styles.small}>{`Win ${league.pointsWin} · Half ${league.pointsHalf} · Loss 0. Holes +/- breaks ties. Gold line: knockout places. * includes a result still to be confirmed.`}</Text>
                <SectionTitle>Results and fixtures</SectionTitle>
                {matches
                  .filter((m) => m.stage === "group" && m.groupLabel === shownGroup)
                  .map((m) => (
                    <MatchRow key={m.id} match={m} nameOf={nameOf} me={me} onPress={() => router.push(`/compete/match/${m.id}`)} showStage />
                  ))}
              </>
            ) : null}

            {view === "knockout" ? (
              KNOCKOUT_ORDER.filter((s) => matches.some((m) => m.stage === s)).map((s) => (
                <View key={s} style={{ gap: spacing.sm }}>
                  <SectionTitle>{STAGE_LABEL[s]}</SectionTitle>
                  {matches
                    .filter((m) => m.stage === s)
                    .map((m) => (
                      <MatchRow key={m.id} match={m} nameOf={nameOf} me={me} onPress={() => router.push(`/compete/match/${m.id}`)} />
                    ))}
                </View>
              ))
            ) : null}

            {organiser && league.status === "running" ? (
              bracket ? (
                <Card>
                  <Kicker>The knockout: check it, then start it</Kicker>
                  <Text style={styles.small}>Group winners are seeded first, so a group's winner and runner-up can't meet in the first round. Byes go to the top seeds.</Text>
                  {Array.from({ length: bracket.length / 2 }, (_, i) => (
                    <Text key={i} style={styles.body}>{`${bracket[2 * i] ? nameOf(bracket[2 * i]) : "Bye"}  v  ${bracket[2 * i + 1] ? nameOf(bracket[2 * i + 1]) : "Bye"}`}</Text>
                  ))}
                  <View style={styles.row}>
                    <Button label="Not yet" tone="line" onPress={() => setBracket(null)} style={{ flex: 1 }} />
                    <Button label="Start the knockout" busy={busy} onPress={() => void run(() => startKnockout(id, bracket).then(() => setBracket(null)), "Couldn't start the knockout")} style={{ flex: 1 }} />
                  </View>
                </Card>
              ) : groupSettled ? (
                <Button label="Start the knockout" icon="trophy-outline" onPress={() => setBracket(knockoutBracket(tables, league.qualifiersPerGroup))} />
              ) : (
                <Text style={styles.small}>When every group match is settled (confirmed, given as a walkover or voided), you can start the knockout here. Open a match to settle it.</Text>
              )
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function EnterForm({ handicap, setHandicap, busy, cta, onEnter, max }: { handicap: string; setHandicap: (v: string) => void; busy: boolean; cta: string; onEnter: (h: number | null) => void; max: number | null }) {
  const parsed = handicap.trim() === "" ? null : Number(handicap.replace(",", ".").replace(/^\+/, "-"));
  const bad = parsed != null && (!Number.isFinite(parsed) || parsed < -10 || parsed > 54);
  return (
    <Card>
      <Kicker>Enter</Kicker>
      <Text style={styles.label}>Your handicap index</Text>
      <TextInput
        style={[styles.input, bad && { borderColor: colors.red600 }]}
        value={handicap}
        onChangeText={setHandicap}
        placeholder="From your profile"
        placeholderTextColor={colors.ink500}
        keyboardType="numbers-and-punctuation"
        accessibilityLabel="Your handicap index. Leave blank to use the one on your profile"
      />
      <Text style={styles.small}>{`Shots in each match come from the difference between you and your opponent.${max != null ? ` Handicaps up to ${max}.` : ""}`}</Text>
      <Button label={cta} busy={busy} disabled={bad} onPress={() => onEnter(parsed)} />
    </Card>
  );
}

function EntrantRow({ entry, me, right, onPress }: { entry: LeagueEntry; me: string | null; right?: ReactNode; onPress?: () => void }) {
  const isMe = entry.userId === me;
  const body = (
    <>
      <Avatar url={entry.avatarUrl} color={entry.avatarColor} name={entry.name} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={styles.entrantName}>{isMe ? `${entry.name} (you)` : entry.name}</Text>
        <Text style={styles.small}>{`HI ${entry.handicapIndex}`}</Text>
      </View>
      {right}
    </>
  );
  return onPress ? (
    <Pressable style={[styles.entrant, isMe && styles.entrantMe]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${entry.name}, handicap ${entry.handicapIndex}`}>
      {body}
    </Pressable>
  ) : (
    <View style={[styles.entrant, isMe && styles.entrantMe]} accessible accessibilityLabel={`${entry.name}, handicap ${entry.handicapIndex}`}>
      {body}
    </View>
  );
}

function GroupTable({ rows, me }: { rows: TableRow[]; me: string | null }) {
  const lastQualifier = rows.filter((r) => r.qualifies).length - 1;
  return (
    <View style={styles.table}>
      <View style={styles.tableHead} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={[styles.headText, styles.colPos]}>#</Text>
        <Text style={[styles.headText, { flex: 1 }]}>Player</Text>
        {["P", "W", "H", "L", "+/-"].map((h) => (
          <Text key={h} style={[styles.headText, styles.colNum]}>
            {h}
          </Text>
        ))}
        <Text style={[styles.headText, styles.colPts]}>Pts</Text>
      </View>
      {rows.map((r, i) => {
        const isMe = r.userId === me;
        return (
          <View
            key={r.userId}
            style={[styles.tableRow, i > 0 && styles.rowLine, isMe && styles.rowMe, i === lastQualifier && styles.qualifyLine]}
            accessible
            accessibilityLabel={`${ordinal(r.position)}, ${r.name}${isMe ? " (you)" : ""}, played ${r.played}, won ${r.won}, halved ${r.halved}, lost ${r.lost}, holes ${r.holes}, ${r.points} points${r.qualifies ? ", in a knockout place" : ""}`}
          >
            <Text style={[styles.pos, styles.colPos, r.qualifies && { color: colors.green700 }]}>{r.position}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.tableName, isMe && { color: colors.green800 }]} numberOfLines={1}>
                {`${r.name}${r.provisional ? " *" : ""}`}
              </Text>
              <Text style={styles.tableSub}>{`HI ${r.handicapIndex}`}</Text>
            </View>
            {[r.played, r.won, r.halved, r.lost, r.holes > 0 ? `+${r.holes}` : String(r.holes)].map((v, j) => (
              <Text key={j} style={[styles.num, styles.colNum]}>
                {v}
              </Text>
            ))}
            <Text style={[styles.pts, styles.colPts]}>{r.points}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Ladder({ page, me, busy, onChallenge, onOpenMatch, nameOf }: { page: LeaguePage; me: string | null; busy: boolean; onChallenge: (u: string) => void; onOpenMatch: (id: number) => void; nameOf: (u: string | null) => string }) {
  const rungs = page.entries.filter((e) => !e.withdrawn && e.ladderPosition != null).sort((a, b) => (a.ladderPosition ?? 0) - (b.ladderPosition ?? 0));
  const canHit = new Set(me ? challengeable(page.entries, page.matches, me, page.league.challengeReach).map((e) => e.userId) : []);
  const live = page.matches.filter((m) => m.stage === "ladder" && (m.status === "open" || m.status === "reported" || m.status === "disputed"));
  const done = page.matches.filter((m) => m.stage === "ladder" && m.status === "confirmed").slice(-10).reverse();
  return (
    <>
      {live.length ? (
        <>
          <SectionTitle>Challenges to play</SectionTitle>
          {live.map((m) => (
            <MatchRow key={m.id} match={m} nameOf={nameOf} me={me} onPress={() => onOpenMatch(m.id)} />
          ))}
        </>
      ) : null}
      <SectionTitle>{`The ladder · ${rungs.length}`}</SectionTitle>
      {rungs.length === 0 ? <Text style={styles.quiet}>No one is on it yet. Join to start it off.</Text> : null}
      {rungs.map((e) => (
        <EntrantRow
          key={e.userId}
          entry={{ ...e, name: `${e.ladderPosition}. ${e.name}` }}
          me={me}
          right={
            canHit.has(e.userId) ? (
              <Pressable
                style={styles.challenge}
                disabled={busy}
                onPress={() =>
                  Alert.alert(`Challenge ${e.name}?`, `Play within ${page.league.challengeDays} days. Win and you take their place.`, [
                    { text: "Not now", style: "cancel" },
                    { text: "Challenge", onPress: () => onChallenge(e.userId) },
                  ])
                }
                accessibilityRole="button"
                accessibilityLabel={`Challenge ${e.name}`}
              >
                <Text style={styles.challengeText}>Challenge</Text>
              </Pressable>
            ) : null
          }
        />
      ))}
      {done.length ? (
        <>
          <SectionTitle>Recent results</SectionTitle>
          {done.map((m) => (
            <MatchRow key={m.id} match={m} nameOf={nameOf} me={me} onPress={() => onOpenMatch(m.id)} />
          ))}
        </>
      ) : null}
      <Text style={styles.small}>{`Challenge anyone up to ${page.league.challengeReach} places above you. If you win you take their place and everyone between moves down one; otherwise nothing changes.`}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  headerBtn: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" },
  intro: { gap: 6, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  introKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.gold400 },
  introTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50 },
  introBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.cream100, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  body: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, lineHeight: 18 },
  quiet: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  label: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900 },
  input: { height: 48, paddingHorizontal: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.line, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.cream50 },
  row: { flexDirection: "row", gap: spacing.sm },
  entrant: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  entrantMe: { backgroundColor: colors.green100, borderColor: colors.green100 },
  entrantName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  stepText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900, minWidth: 80, textAlign: "center" },
  reshuffle: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: 12 },
  reshuffleText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  drawGroup: { gap: 2, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line },
  drawLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
  table: { borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  tableHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surfaceTint, borderBottomWidth: 1, borderBottomColor: colors.line },
  headText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, color: colors.ink500, textTransform: "uppercase" },
  tableRow: { flexDirection: "row", alignItems: "center", minHeight: 52, paddingHorizontal: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  rowMe: { backgroundColor: colors.green100 },
  qualifyLine: { borderBottomWidth: 2, borderBottomColor: colors.gold500 },
  colPos: { width: 26 },
  colNum: { width: 30, textAlign: "center" },
  colPts: { width: 36, textAlign: "right" },
  pos: { fontFamily: fonts.display, fontSize: 18, color: colors.navy900 },
  tableName: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  tableSub: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500 },
  num: { fontFamily: fonts.body, fontSize: 13, color: colors.ink900 },
  pts: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900 },
  challenge: { minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.navy900 },
  challengeText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
});
