import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import {
  entrantsOf,
  hasResults,
  loadResultsState,
  publishResults,
  resultsLink,
  resultsShareText,
  saveResultsSettings,
  setResultsGroup,
  suggestedGroup,
  withdrawResults,
  workOut,
  type ResultsState,
} from "@/lib/competition-data";
import { loadMyGroups } from "@/lib/groups-data";
import {
  DEFAULT_SETTINGS,
  type Amendment,
  type ResultEntrant,
  countbackSteps,
  evenCuts,
  placeOf,
  type Division,
  type ResultRow,
  type Results,
  type ResultsSettings,
  type TieGroup,
} from "@/lib/competition-results";
import { loadMatchDay, type MatchDayData } from "@/lib/live-match-days";
import { dateLabel } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Competition results (0137) — mock-ups "Provisional podium", "Tap a tie",
 * "Published: full results" and "What a member sees".
 *
 * The organiser sees the results worked out live from the cards, with the
 * settings (how ties are decided, divisions, prizes) above them and the
 * checks that matter before publishing (cards not in, missing stroke
 * indexes, uncertified placers). Publishing stores the result as it stands
 * and tells everyone; republishing a correction shows "Updated".
 *
 * Everyone else sees only published results: their own place first, then
 * every division, the prizes and, on any tie, the countback step by step —
 * the same table the organiser saw.
 *
 * AMENDMENTS (0138): the organiser can correct a hole or disqualify a card
 * before publishing (or in a correction). The players' cards never change;
 * every amended row, the podium and a summary at the top say "Amended",
 * with what was submitted and why.
 *
 * WHO SEES IT: everyone in the day, and — once published — every member of
 * the group whose page lists it (the organiser picks the group; a society
 * day from an event defaults to the event's society). Someone who didn't
 * play can't open the day itself, so the published copy carries its own
 * title, course and date.
 *
 * The rules are in lib/competition-results.ts (R&A matching scorecards).
 */

type Tab = number | "prizes";

const PODIUM = [colors.gold500, "#9aa6b5", "#b0784a"];

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dayId = Number(id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [data, setData] = useState<MatchDayData | null | undefined>(undefined);
  const [state, setState] = useState<ResultsState | null>(null);
  const [settings, setSettings] = useState<ResultsSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(0);
  const [openTie, setOpenTie] = useState<string | null>(null);
  const [groups, setGroups] = useState<{ id: number; name: string }[] | null>(null);
  const [groupId, setGroupId] = useState<number | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const [d, s] = await Promise.all([loadMatchDay(dayId), loadResultsState(dayId)]);
      setData(d);
      setState(s);
      setSettings((cur) => cur ?? s.row?.settings ?? null);
      // The organiser: which group's page lists the results.
      if (d && me != null && d.day.createdBy === me) {
        const chosen = s.row?.groupId ?? null;
        const [mine, suggestion] = await Promise.all([
          loadMyGroups(me).catch(() => null),
          chosen == null && !(s.row?.status === "published") ? suggestedGroup(dayId).catch(() => null) : Promise.resolve(null),
        ]);
        setGroups((mine?.groups ?? []).map((g) => ({ id: g.id, name: g.name })));
        setGroupId((cur) => (cur !== undefined ? cur : (chosen ?? suggestion)));
      }
    } catch {
      setFailed(true);
    }
  }, [dayId, me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const isOrganiser = !!data && me != null && data.day.createdBy === me;
  const published = state?.row?.status === "published" ? state.row : null;

  // The organiser's first visit: sensible defaults, divisions off.
  const current: ResultsSettings = settings ?? DEFAULT_SETTINGS;

  // Save the organiser's settings as they change (draft survives).
  //
  // Debounced, but never dropped: leaving the screen (blur or unmount)
  // sends whatever is still waiting, where it used to cancel it — a change
  // made in the last 600 ms before tapping Back was silently lost. The
  // status is shown on screen so the organiser knows it's safe to leave.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<ResultsSettings | null>(null);
  const [save, setSave] = useState<SaveStatus>({ state: "idle" });
  const flush = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const next = pending.current;
    if (!next) return true;
    pending.current = null;
    setSave({ state: "saving" });
    try {
      await saveResultsSettings(dayId, next);
      if (!pending.current) setSave({ state: "saved", at: new Date() });
      return true;
    } catch {
      // Keep it to try again, unless a newer change has replaced it.
      pending.current = pending.current ?? next;
      setSave({ state: "failed" });
      return false;
    }
  }, [dayId]);
  const change = (next: ResultsSettings) => {
    setSettings(next);
    pending.current = next;
    setSave({ state: "saving" });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), 600);
  };
  useFocusEffect(
    useCallback(
      () => () => {
        void flush();
      },
      [flush]
    )
  );
  useEffect(() => () => void flush(), [flush]);

  /** Where the results will show, saved straight away before the first
   *  publish (the call only files it on the draft); once they're out, a
   *  change waits for "Publish the update", as it always has. */
  const chooseGroup = (id: number | null) => {
    setGroupId(id);
    if (state?.row?.status === "published") return;
    setSave({ state: "saving" });
    setResultsGroup(dayId, id)
      .then(() => setSave({ state: "saved", at: new Date() }))
      .catch(() => setSave({ state: "failed" }));
  };

  /** Leave for Home or the group's page — after anything waiting is saved. */
  const leave = async (to: "home" | "group") => {
    const ok = await flush();
    const go = () => {
      const target = to === "group" && listedOn != null ? { pathname: "/group/[id]" as const, params: { id: String(listedOn) } } : "/";
      router.navigate(target);
    };
    if (ok) return go();
    Alert.alert("Your last change didn't save", "Check your signal. If you leave now, that change is lost — everything before it is saved.", [
      { text: "Try again", onPress: () => void leave(to) },
      { text: "Leave anyway", style: "destructive", onPress: go },
    ]);
  };

  const live: Results | null = useMemo(
    () => (data && state && hasResults(data) ? workOut(data, state, current) : null),
    [data, state, current]
  );

  if (!isOn("liveScoring")) return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;
  if (failed) return <LoadError size="screen" what="the results" onRetry={() => void load()} />;
  if (data === undefined || state == null) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  // Not in the day, but a member of the group the results are shown on:
  // the published copy stands on its own.
  if (data === null && !published?.results) {
    return <StateMessage size="screen" icon="lock-closed-outline" title="These results aren't available" body="The day may have been removed, or you're not in it." />;
  }
  if (data && !hasResults(data)) {
    return <StateMessage size="screen" icon="people-outline" title="A match day's result is its team score" body="It's on the match day's board." />;
  }

  const draftView = !!data && isOrganiser && (!published || editing);
  const results: Results | null = draftView ? live : (published?.results ?? null);

  if (!results) {
    return (
      <StateMessage
        size="screen"
        icon="trophy-outline"
        title="Results aren't out yet"
        body="The organiser publishes them once every card is in. You'll get a notification."
        action={{ label: "See the leaderboard", onPress: () => router.replace({ pathname: "/live/day/[id]", params: { id: String(dayId) } }) }}
      />
    );
  }

  const day = data
    ? data.day
    : {
        title: results.event?.title ?? "Results",
        courseName: results.event?.courseName ?? "",
        playedOn: results.event?.playedOn ?? "",
        foursomes: results.team && results.divisions[0]?.label === "Pairs" ? results.basis : null,
      };
  const divisions = results.divisions;
  const tabIndex = tab === "prizes" ? "prizes" : Math.min(tab, divisions.length - 1);
  const division: Division | null = tabIndex === "prizes" ? null : divisions[tabIndex];
  const basisLabel = results.team
    ? `${day.foursomes ? "Foursomes" : "Scramble"} · ${results.basis === "stableford" ? "Stableford" : "stroke play"}`
    : results.basis === "stableford"
      ? "Stableford"
      : "Stroke play (net)";
  const mine = me && !draftView ? placeOf(results, me) : null;
  const link = published?.shareToken ? resultsLink(published.shareToken) : null;

  const amendedCount = results.amendments?.length ?? 0;
  const entrants: ResultEntrant[] = draftView && data && state ? entrantsOf(data, state.certified) : [];

  const share = async () => {
    await Share.share({ message: resultsShareText(day.title, day.courseName, results, link) }).catch(() => undefined);
  };

  const publish = async () => {
    if (!live) return;
    const stops = live.checks.filter((c) => c.level === "stop");
    const go = async () => {
      setBusy(true);
      try {
        if (groupId !== undefined) await setResultsGroup(dayId, groupId);
        await publishResults(dayId, { ...live, event: { title: day.title, courseName: day.courseName, playedOn: day.playedOn } });
        setEditing(false);
        await load();
      } catch (e) {
        Alert.alert("Couldn't publish the results", e instanceof Error ? e.message : "Please try again.");
      } finally {
        setBusy(false);
      }
    };
    Alert.alert(
      published ? "Publish the update?" : "Publish the results?",
      [
        ...stops.map((s) => s.text),
        ...(live.amendments.length > 0 ? [`${live.amendments.length} amended ${live.amendments.length === 1 ? "card shows" : "cards show"} as Amended, with what the players submitted.`] : []),
        published
          ? "Everyone in the day is told the results have been updated."
          : `Every card is closed and all ${live.counts.entrants} ${results.team ? (day.foursomes ? "pairs" : "teams") : "players"} are told the results.`,
      ].join("\n\n"),
      [
        { text: "Not yet", style: "cancel" },
        { text: published ? "Publish update" : "Publish", onPress: () => void go() },
      ]
    );
  };

  const withdraw = () =>
    Alert.alert("Take the results down?", "Members stop seeing them and the share link stops working. You can publish again.", [
      { text: "Keep them up", style: "cancel" },
      {
        text: "Take down",
        style: "destructive",
        onPress: async () => {
          try {
            await withdrawResults(dayId);
            await load();
          } catch (e) {
            Alert.alert("Couldn't take them down", e instanceof Error ? e.message : "Please try again.");
          }
        },
      },
    ]);

  const listedOn = published?.groupId ?? groupId ?? null;
  const listedName = listedOn != null ? (groups?.find((g) => g.id === listedOn)?.name ?? null) : null;

  const handicaps = data ? data.matches.flatMap((m) => m.players.map((p) => p.playingHandicap)) : [];

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.green700}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Stack.Screen options={{ title: "Results" }} />

      <View style={styles.hero}>
        <View style={[styles.statusPill, draftView ? styles.statusDraft : styles.statusFinal]}>
          <Text style={styles.statusText}>
            {draftView
              ? "Provisional · only you can see this"
              : `${published && published.version > 1 ? "Updated" : "Final"}${amendedCount > 0 ? " · Amended" : ""} · published ${published?.publishedAt ? timeLabel(published.publishedAt) : ""}`}
          </Text>
        </View>
        <Text style={styles.heroTitle}>{day.title}</Text>
        <Text style={styles.heroMeta}>
          {[day.courseName, day.playedOn ? dateLabel(day.playedOn) : null, basisLabel, `${results.counts.complete} of ${results.counts.entrants} cards`].filter(Boolean).join(" · ")}
        </Text>
        {!draftView ? (
          <View style={styles.heroButtons}>
            <Pressable onPress={() => void share()} style={({ pressed }) => [styles.goldButton, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Ionicons name="share-outline" size={18} color={colors.navy900} />
              <Text style={styles.goldButtonText}>Share results</Text>
            </Pressable>
            {isOrganiser ? (
              <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.ghostButton, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <Text style={styles.ghostButtonText}>Correct</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {mine ? <MyResult place={mine} basis={results.basis} /> : null}

      {amendedCount > 0 ? <AmendedSummary results={results} organiserView={draftView} /> : null}

      {draftView ? (
        <SettingsPanel
          settings={current}
          team={results.team}
          holes={results.holes}
          handicaps={handicaps}
          onChange={change}
        />
      ) : null}

      <View style={styles.tabs} accessibilityRole="tablist">
        {divisions.map((d, i) => (
          <TabPill key={d.label} label={d.label} on={tabIndex === i} onPress={() => setTab(i)} />
        ))}
        <TabPill label="Prizes" on={tabIndex === "prizes"} onPress={() => setTab("prizes")} />
      </View>

      {division ? (
        <>
          {division.range ? <Text style={styles.rangeNote}>Playing handicap {division.range}</Text> : null}
          <Podium rows={division.ranking.rows} basis={results.basis} />
          <View style={styles.table}>
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.thText, styles.cPos]}>Pos</Text>
              <Text style={[styles.thText, { flex: 1 }]}>{results.team ? (day.foursomes ? "Pair" : "Team") : "Player"}</Text>
              <Text style={[styles.thText, styles.cNum]}>Hcp</Text>
              <Text style={[styles.thText, styles.cNum]}>{results.holes === 18 ? "B9" : "L6"}</Text>
              <Text style={[styles.thText, styles.cBig]}>{results.basis === "stableford" ? "Pts" : "Net"}</Text>
            </View>
            {division.ranking.rows.map((r) => {
              const tie = r.tie != null ? division.ranking.ties[r.tie] : null;
              const open = tie != null && openTie === `${tabIndex}:${r.tie}`;
              return (
                <View key={r.key}>
                  <Pressable
                    onPress={() => tie && setOpenTie(open ? null : `${tabIndex}:${r.tie}`)}
                    disabled={!tie}
                    style={({ pressed }) => [styles.tr, r.position != null && r.position <= 3 && styles.trPlaced, me != null && r.memberIds.includes(me) && styles.trMine, pressed && { opacity: 0.85 }]}
                    accessibilityRole={tie ? "button" : undefined}
                    accessibilityLabel={`${r.positionLabel}, ${r.name}, ${r.score}${r.note ? `. ${r.note}` : ""}${tie ? ". Tap for the countback" : ""}`}
                  >
                    <Text style={[styles.pos, styles.cPos, r.position == null && styles.muted]}>{r.positionLabel}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.name, r.position == null && styles.muted]} numberOfLines={1}>
                        {r.name}
                        {me != null && r.memberIds.includes(me) ? <Text style={styles.you}>  · You</Text> : null}
                        {r.guest ? <Text style={styles.guestTag}>  Guest</Text> : null}
                      </Text>
                      {r.detail ? <Text style={styles.sub} numberOfLines={1}>{r.detail}</Text> : null}
                      {r.note ? <Text style={[styles.sub, r.wonTie && styles.won]} numberOfLines={2}>{r.note}</Text> : null}
                      {draftView && r.certified === false && r.position != null && r.position <= 3 ? (
                        <Text style={[styles.sub, { color: colors.red600 }]}>Card not certified yet</Text>
                      ) : null}
                      {r.amended.length > 0 ? (
                        <View style={styles.amendedRow}>
                          <Text style={styles.amendedTag}>Amended</Text>
                          <Text style={styles.amendedText} numberOfLines={3}>{r.amended.join(" · ")}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.cell, styles.cNum]}>{r.handicap}</Text>
                    <Text style={[styles.cell, styles.cNum]}>{r.back ?? "–"}</Text>
                    <Text style={[styles.big, styles.cBig, r.position == null && styles.muted]}>{r.score}</Text>
                  </Pressable>
                  {open && tie ? <TieTable tie={tie} basis={results.basis} holes={results.holes} /> : null}
                </View>
              );
            })}
          </View>
          <Text style={styles.foot}>
            {results.holes === 18 ? "B9 = holes 10–18" : "L6 = the last 6 holes"}. Tap a tied {results.team ? "entry" : "player"} to see the countback.
          </Text>
        </>
      ) : (
        <Prizes results={results} />
      )}

      <View style={styles.rule}>
        <Text style={styles.ruleTitle}>How ties are decided</Text>
        <Text style={styles.ruleText}>{results.rule}</Text>
        {results.basis === "stroke" ? (
          <Text style={styles.ruleText}>Net stroke play: each step takes the same share of the handicap off — ½ for 9 holes, ⅓ for 6, ⅙ for 3, 1⁄18 for one — never rounded.</Text>
        ) : (
          <Text style={styles.ruleText}>Stableford: points on those holes, with the shots given by stroke index exactly as in the competition.</Text>
        )}
      </View>

      {draftView && live ? (
        <>
          <Checks results={live} />
          <AmendEditor entrants={entrants} settings={current} onChange={change} />
          <ExtrasEditor settings={current} onChange={change} />
          {groups && groups.length > 0 ? <GroupPicker groups={groups} value={groupId ?? null} onChange={chooseGroup} /> : null}
          <Pressable
            onPress={() => void publish()}
            disabled={busy}
            style={({ pressed }) => [styles.publish, busy && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.cream50} />
            ) : (
              <Text style={styles.publishText}>{published ? "Publish the update" : `Publish results to ${live.counts.entrants} ${results.team ? (day.foursomes ? "pairs" : "teams") : "players"}`}</Text>
            )}
          </Pressable>
          <Text style={styles.foot}>
            Publishing closes every card and tells everyone in the day. A correction later is published as an update.
          </Text>
          {published ? (
            <Pressable onPress={() => setEditing(false)} style={styles.linkRow} accessibilityRole="button">
              <Text style={styles.link}>Back to the published results</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <SavedPanel
        kind={draftView ? (published ? "correcting" : "draft") : isOrganiser ? "published" : "member"}
        save={save}
        groupName={listedName}
        onRetry={() => void flush()}
        onHome={() => void leave("home")}
        onGroup={listedOn != null ? () => void leave("group") : null}
      />

      {isOrganiser && published && !draftView ? (
        <Pressable onPress={withdraw} style={styles.linkRow} accessibilityRole="button">
          <Text style={[styles.link, { color: colors.red600 }]}>Take the results down</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

type SaveStatus = { state: "idle" } | { state: "saving" } | { state: "saved"; at: Date } | { state: "failed" };

/**
 * "You can leave": the end of the page tells the organiser (and anyone
 * else) that nothing here is lost by going back, and where to find it again
 * — with the two ways out people asked for, Home and the group's page.
 *
 * What's saved where: the scores are on the players' own cards, saved hole
 * by hole as they were entered; the organiser's settings, corrections and
 * group choice save as they're made (the status line shows each one land);
 * published results are stored and kept on the group's page.
 */
function SavedPanel({
  kind,
  save,
  groupName,
  onRetry,
  onHome,
  onGroup,
}: {
  kind: "draft" | "correcting" | "published" | "member";
  save: SaveStatus;
  groupName: string | null;
  onRetry: () => void;
  onHome: () => void;
  onGroup: (() => void) | null;
}) {
  const where = groupName ? `${groupName}'s page, under Past results` : "the group's page, under Past results";
  const failed = save.state === "failed";
  const title = failed
    ? "Your last change didn't save"
    : kind === "draft" || kind === "correcting"
      ? "Everything is saved — you can leave"
      : "These results are saved";
  const body = failed
    ? "Check your signal and try again. Everything before it is saved."
    : kind === "draft"
      ? "The scores are on the players' cards, and your settings and corrections save as you make them. Nothing is published until you tap Publish — come back any time from Live scoring or the society's page."
      : kind === "correcting"
        ? `Your corrections are saved as a draft. Members keep seeing the published results until you tap Publish the update. They're on ${where}.`
        : kind === "published"
          ? `Published and stored. You'll find them again on ${where}, and you can correct them later.`
          : `They're kept on ${where}, so you can look back at them any time.`;
  const statusText =
    save.state === "saving" ? "Saving…" : save.state === "saved" ? `Saved at ${save.at.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}` : null;

  return (
    <View style={[styles.saved, failed && styles.savedFailed]} accessibilityLiveRegion="polite">
      <View style={styles.savedTop}>
        <View style={[styles.savedIcon, failed && { backgroundColor: colors.red600 }]}>
          <Ionicons name={failed ? "cloud-offline-outline" : "checkmark"} size={18} color={colors.cream50} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.savedTitle}>{title}</Text>
          {statusText ? <Text style={styles.savedStatus}>{statusText}</Text> : null}
        </View>
      </View>
      <Text style={styles.savedBody}>{body}</Text>
      {failed ? (
        <Pressable onPress={onRetry} style={({ pressed }) => [styles.savedButtonMain, { backgroundColor: colors.red600 }, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Ionicons name="refresh" size={18} color={colors.cream50} />
          <Text style={styles.savedButtonMainText}>Try again</Text>
        </Pressable>
      ) : null}
      <View style={styles.savedButtons}>
        <Pressable onPress={onHome} style={({ pressed }) => [styles.savedButton, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel="Back to Home">
          <Ionicons name="home-outline" size={17} color={colors.navy900} />
          <Text style={styles.savedButtonText}>Back to Home</Text>
        </Pressable>
        {onGroup ? (
          <Pressable onPress={onGroup} style={({ pressed }) => [styles.savedButton, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={groupName ? `Back to ${groupName}` : "Back to the group"}>
            <Ionicons name="people-outline" size={17} color={colors.navy900} />
            <Text style={styles.savedButtonText} numberOfLines={1}>
              {groupName ? `Back to ${groupName}` : "Back to the group"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}

function TabPill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, on && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

function MyResult({ place, basis }: { place: NonNullable<ReturnType<typeof placeOf>>; basis: "stableford" | "stroke" }) {
  const { row, of, division } = place;
  const big = row.position != null ? row.positionLabel.replace("=", "") : row.positionLabel;
  const suffix = row.position != null ? ordinalSuffix(row.position) : "";
  return (
    <View style={styles.mine}>
      <Text style={styles.mineEyebrow}>Your result{division !== "Overall" ? ` · ${division}` : ""}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.sm }}>
        <Text style={styles.mineBig}>
          {row.positionLabel.startsWith("=") ? "=" : ""}
          {big}
          {suffix}
        </Text>
        <Text style={styles.mineMeta}>
          {row.position != null ? `of ${of} · ` : ""}
          {row.status === "ok" ? `${row.score}${basis === "stableford" ? " pts" : " net"}` : row.note ?? ""}
        </Text>
      </View>
      {row.note && row.position != null ? <Text style={styles.mineNote}>{row.note}</Text> : null}
    </View>
  );
}

const ordinalSuffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

function Podium({ rows, basis }: { rows: ResultRow[]; basis: "stableford" | "stroke" }) {
  const top = rows.filter((r) => r.position != null && r.position <= 3).slice(0, 3);
  if (top.length === 0) return <Text style={styles.foot}>No complete cards yet.</Text>;
  // 2nd, 1st, 3rd, as a podium stands.
  const order = [top[1], top[0], top[2]];
  const heights = [70, 100, 50];
  return (
    <View style={styles.podium}>
      {order.map((r, i) =>
        r ? (
          <View key={r.key} style={styles.step}>
            <View style={[styles.medal, { borderColor: PODIUM[[1, 0, 2][i]] }]}>
              <Text style={styles.medalText}>{initials(r.name)}</Text>
            </View>
            <Text style={styles.stepName} numberOfLines={2}>{r.name}</Text>
            <Text style={styles.stepMeta}>
              {r.score}
              {basis === "stableford" ? " pts" : " net"}
              {r.wonTie ? " · cb" : ""}
              {r.amended.length > 0 ? " · amended" : ""}
            </Text>
            <View style={[styles.block, { height: heights[i], backgroundColor: i === 1 ? colors.navy900 : i === 0 ? colors.navy800 : colors.green700 }]}>
              <Text style={[styles.blockText, i === 1 && { color: colors.gold400 }]}>{r.positionLabel}</Text>
            </View>
          </View>
        ) : (
          <View key={`empty${i}`} style={styles.step} />
        )
      )}
    </View>
  );
}

const initials = (name: string) =>
  name
    .split(/[\s&·]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/** "Tap a tie" — the countback, step by step. */
function TieTable({ tie, basis, holes }: { tie: TieGroup; basis: "stableford" | "stroke"; holes: number }) {
  const firstDecided = tie.steps.findIndex((s) => s.decided);
  return (
    <View style={styles.tie}>
      <Text style={styles.tieTitle}>
        Level on {tie.total}
        {basis === "stableford" ? " points" : " net"} — the countback
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.tieRow}>
            <Text style={[styles.tieStep, styles.tieHead]}>Step</Text>
            {tie.names.map((n) => (
              <Text key={n} style={[styles.tieCell, styles.tieHead]} numberOfLines={1}>
                {n.split(" ")[0]}
              </Text>
            ))}
          </View>
          {tie.steps.map((s, i) => {
            const past = firstDecided >= 0 && i > firstDecided && tie.resolvedBy === "countback" && !s.decided;
            return (
              <View key={s.label} style={[styles.tieRow, s.decided && styles.tieDecided]}>
                <View style={styles.tieStep}>
                  <Text style={[styles.tieLabel, past && styles.muted]}>{s.label.replace(/ \(.*\)$/, "")}</Text>
                  <Text style={styles.tieHoles}>{s.holes}</Text>
                </View>
                {s.values.map((v, k) => (
                  <Text key={k} style={[styles.tieCell, s.decided && styles.tieCellDecided, past && styles.muted]}>
                    {v}
                  </Text>
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <Text style={styles.tieFoot}>
        {tie.resolvedBy === "countback"
          ? "Highlighted: the step that separated them."
          : tie.resolvedBy === "draw"
            ? "Level after every step, so the places were decided by a random draw, set when the results were published."
            : "Level after every step, so the place is shared."}
        {basis === "stroke" ? ` Each figure is gross on those holes minus ${holes === 18 ? "½, ⅓, ⅙ or 1⁄18" : "the same share"} of the handicap.` : ""}
      </Text>
    </View>
  );
}

function Prizes({ results }: { results: Results }) {
  return (
    <View style={styles.card}>
      {results.prizes.length === 0 ? <Text style={styles.foot}>No prizes yet.</Text> : null}
      {results.prizes.map((p) => (
        <View key={p.label} style={styles.prize}>
          <Text style={styles.prizeLabel}>{p.label}</Text>
          {p.winners.length === 0 ? <Text style={styles.sub}>Not decided yet</Text> : null}
          {p.winners.map((w, i) => (
            <View key={`${w.name}${i}`} style={styles.prizeRow}>
              {w.place ? <Text style={styles.prizePlace}>{w.place}</Text> : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {w.name}
                  {w.amended ? <Text style={styles.amendedInline}>  Amended</Text> : null}
                </Text>
                {w.note ? <Text style={styles.sub}>{w.note}</Text> : null}
              </View>
              {w.score ? <Text style={styles.prizeScore}>{w.score}</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Checks({ results }: { results: Results }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Before you publish</Text>
      {results.checks.map((c, i) => (
        <View key={i} style={styles.check}>
          <Ionicons
            name={c.level === "ok" ? "checkmark-circle" : c.level === "stop" ? "alert-circle" : "warning"}
            size={20}
            color={c.level === "ok" ? colors.green700 : c.level === "stop" ? colors.red600 : "#9a6a10"}
          />
          <Text style={styles.checkText}>{c.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** "Results settings" — how the winners are decided. */
function SettingsPanel({
  settings,
  team,
  holes,
  handicaps,
  onChange,
}: {
  settings: ResultsSettings;
  team: boolean;
  holes: number;
  handicaps: number[];
  onChange: (s: ResultsSettings) => void;
}) {
  const [open, setOpen] = useState(true);
  const divisions = settings.divisionCuts.length + 1;
  const steps = countbackSteps(Array.from({ length: holes }, (_, i) => ({ hole: i + 1, par: 4, strokeIndex: i + 1 })));
  const setDivisions = (n: number) => onChange({ ...settings, divisionCuts: evenCuts(handicaps, n) });
  const moveCut = (i: number, by: number) => {
    const cuts = [...settings.divisionCuts];
    const lo = (cuts[i - 1] ?? -10) + 1;
    const hi = (cuts[i + 1] ?? 60) - 1;
    cuts[i] = Math.max(lo, Math.min(hi, cuts[i] + by));
    onChange({ ...settings, divisionCuts: cuts });
  };
  const count = (lo: number, hi: number) => handicaps.filter((h) => h >= lo && h < hi).length;

  return (
    <View style={styles.card}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.settingsHead} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={styles.cardTitle}>How the winners are decided</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.ink500} />
      </Pressable>
      {open ? (
        <View style={{ gap: spacing.md }}>
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>Ties: countback (R&A recommendation)</Text>
            <Text style={styles.sub}>
              {steps.map((s) => s.short).join(", ")}. Holes by their number on the card, whichever tee a group started on.
            </Text>
            <Text style={[styles.label, { marginTop: 4 }]}>Still level after every step</Text>
            <View style={styles.row}>
              {(
                [
                  ["draw", "Random draw"],
                  ["share", "Share the place"],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => onChange({ ...settings, tieRule: id })}
                  style={[styles.choice, settings.tieRule === id && styles.choiceOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: settings.tieRule === id }}
                >
                  <Text style={[styles.choiceText, settings.tieRule === id && styles.choiceTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {!team ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.label}>Divisions, by playing handicap</Text>
              <View style={styles.row}>
                {[1, 2, 3].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setDivisions(n)}
                    style={[styles.choice, divisions === n && styles.choiceOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: divisions === n }}
                  >
                    <Text style={[styles.choiceText, divisions === n && styles.choiceTextOn]}>{["One", "Two", "Three"][n - 1]}</Text>
                  </Pressable>
                ))}
              </View>
              {settings.divisionCuts.map((cut, i) => (
                <View key={i} style={styles.cutRow}>
                  <Text style={styles.cutText}>
                    Division {i + 2} from handicap <Text style={{ fontFamily: fonts.bodyBold }}>{cut}</Text> · {count(cut, settings.divisionCuts[i + 1] ?? 999)} players
                  </Text>
                  <Pressable onPress={() => moveCut(i, -1)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Lower the start of division ${i + 2}`}>
                    <Text style={styles.stepBtnText}>−</Text>
                  </Pressable>
                  <Pressable onPress={() => moveCut(i, 1)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Raise the start of division ${i + 2}`}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ gap: 2 }}>
            {!team ? <Toggle label="Best gross" value={settings.bestGross} onChange={(v) => onChange({ ...settings, bestGross: v })} /> : null}
            {!team ? <Toggle label="One prize per player" hint="A player placed in their division doesn't also take best gross." value={settings.onePrizePerPlayer} onChange={(v) => onChange({ ...settings, onePrizePerPlayer: v })} /> : null}
            {!team ? <Toggle label="Guests can win" hint="Off: guests are listed, but only members take places." value={settings.guestsCanWin} onChange={(v) => onChange({ ...settings, guestsCanWin: v })} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleText}>{label}</Text>
        {hint ? <Text style={styles.sub}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.green600 }} accessibilityLabel={label} />
    </View>
  );
}

/** "Prizes you enter": nearest the pin, longest drive — the cards can't tell. */
function ExtrasEditor({ settings, onChange }: { settings: ResultsSettings; onChange: (s: ResultsSettings) => void }) {
  const set = (i: number, change: Partial<{ label: string; winner: string }>) =>
    onChange({ ...settings, extras: settings.extras.map((x, k) => (k === i ? { ...x, ...change } : x)) });
  const add = (label: string) => onChange({ ...settings, extras: [...settings.extras, { label, winner: "" }] });
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Prizes you enter</Text>
      <Text style={styles.sub}>Nearest the pin, longest drive — anything the cards can't decide.</Text>
      {settings.extras.map((x, i) => (
        <View key={i} style={styles.extra}>
          <TextInput value={x.label} onChangeText={(v) => set(i, { label: v })} placeholder="Prize" placeholderTextColor={colors.ink500} style={[styles.input, { flex: 1 }]} maxLength={40} accessibilityLabel="Prize name" />
          <TextInput value={x.winner} onChangeText={(v) => set(i, { winner: v })} placeholder="Winner" placeholderTextColor={colors.ink500} style={[styles.input, { flex: 1 }]} maxLength={60} accessibilityLabel={`${x.label || "Prize"} winner`} />
          <Pressable
            onPress={() => onChange({ ...settings, extras: settings.extras.filter((_, k) => k !== i) })}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${x.label || "prize"}`}
          >
            <Ionicons name="close-circle" size={22} color={colors.ink500} />
          </Pressable>
        </View>
      ))}
      <View style={styles.row}>
        {["Nearest the pin", "Longest drive", "Another prize"].map((l) => (
          <Pressable key={l} onPress={() => add(l === "Another prize" ? "" : l)} style={styles.addChip} accessibilityRole="button">
            <Ionicons name="add" size={16} color={colors.green700} />
            <Text style={styles.link}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** "Amended by the organiser": every change from what the players
 *  submitted, at the top of the results. */
function AmendedSummary({ results, organiserView }: { results: Results; organiserView: boolean }) {
  return (
    <View style={styles.amendedCard}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="create-outline" size={18} color={colors.red600} />
        <Text style={styles.amendedTitle}>{organiserView ? "Your amendments" : "Amended by the organiser"}</Text>
      </View>
      <Text style={styles.sub}>
        {organiserView
          ? "These cards will show as Amended, with what the players submitted and why."
          : "These results differ from what the players submitted on these cards:"}
      </Text>
      {results.amendments.map((a) => (
        <View key={a.name} style={{ gap: 2 }}>
          <Text style={styles.name}>{a.name}</Text>
          {a.lines.map((l, i) => (
            <Text key={i} style={styles.amendedText}>
              {l}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * "Amend a card": correct one hole (a wrong score signed for), or
 * disqualify a card, always with a reason. The players' card isn't
 * touched — the amendment is applied to the results and shown.
 */
function AmendEditor({ entrants, settings, onChange }: { entrants: ResultEntrant[]; settings: ResultsSettings; onChange: (s: ResultsSettings) => void }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [hole, setHole] = useState<number | null>(null);
  const [strokes, setStrokes] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const entrant = entrants.find((e) => e.key === who) ?? null;
  const card = entrant ? [...entrant.card].sort((a, b) => a.hole - b.hole) : [];
  const submitted = entrant && hole != null ? (hole in entrant.scores ? entrant.scores[hole] : undefined) : undefined;
  const nameOf = (key: string) => entrants.find((e) => e.key === key)?.name ?? "A card";

  const reset = () => {
    setWho(null);
    setHole(null);
    setStrokes(null);
    setReason("");
    setQuery("");
    setOpen(false);
  };
  const add = (a: Amendment) => {
    const rest = settings.amendments.filter((x) => !(x.key === a.key && (a.dq ? x.dq : x.hole === a.hole)));
    onChange({ ...settings, amendments: [...rest, a] });
    reset();
  };
  const remove = (i: number) => onChange({ ...settings, amendments: settings.amendments.filter((_, k) => k !== i) });
  const pickHole = (h: number) => {
    setHole(h);
    const was = entrant && h in entrant.scores ? entrant.scores[h] : null;
    setStrokes(was ?? null);
  };
  const shown = entrants.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 30);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Amend a card</Text>
      <Text style={styles.sub}>
        Correct a hole or disqualify a card, with the reason. The players&apos; card stays as they submitted it; the results show it as Amended.
      </Text>
      {settings.amendments.map((a, i) => (
        <View key={`${a.key}${a.hole ?? "dq"}`} style={styles.amendItem}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{nameOf(a.key)}</Text>
            <Text style={styles.amendedText}>
              {a.dq ? "Disqualified" : `Hole ${a.hole}: ${a.strokes == null ? "picked up" : a.strokes}`}
              {a.reason ? ` — ${a.reason}` : ""}
            </Text>
          </View>
          <Pressable onPress={() => remove(i)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove the amendment to ${nameOf(a.key)}`}>
            <Ionicons name="close-circle" size={22} color={colors.ink500} />
          </Pressable>
        </View>
      ))}
      {!open ? (
        <Pressable onPress={() => setOpen(true)} style={styles.addChip} accessibilityRole="button">
          <Ionicons name="create-outline" size={16} color={colors.green700} />
          <Text style={styles.link}>Amend a card</Text>
        </Pressable>
      ) : !entrant ? (
        <View style={{ gap: spacing.sm }}>
          <TextInput value={query} onChangeText={setQuery} placeholder="Find a player or pair" placeholderTextColor={colors.ink500} style={styles.input} accessibilityLabel="Find a player or pair" />
          <View style={styles.row}>
            {shown.map((e) => (
              <Pressable key={e.key} onPress={() => setWho(e.key)} style={styles.choice} accessibilityRole="button">
                <Text style={styles.choiceText}>{e.name}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={reset} style={styles.linkRow} accessibilityRole="button">
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.label}>{entrant.name} — tap the hole to correct</Text>
          <View style={styles.holeGrid}>
            {card.map((h) => {
              const v = h.hole in entrant.scores ? entrant.scores[h.hole] : undefined;
              const on = hole === h.hole;
              return (
                <Pressable key={h.hole} onPress={() => pickHole(h.hole)} style={[styles.holeCell, on && styles.choiceOn]} accessibilityRole="button" accessibilityLabel={`Hole ${h.hole}, ${v === undefined ? "no score" : v === null ? "picked up" : v}`}>
                  <Text style={[styles.holeNo, on && styles.choiceTextOn]}>{h.hole}</Text>
                  <Text style={[styles.holeScore, on && styles.choiceTextOn]}>{v === undefined ? "–" : v === null ? "P" : v}</Text>
                </Pressable>
              );
            })}
          </View>
          {hole != null ? (
            <View style={styles.cutRow}>
              <Text style={styles.cutText}>
                Hole {hole}: submitted {submitted === undefined ? "no score" : submitted === null ? "picked up" : submitted} → <Text style={{ fontFamily: fonts.bodyBold }}>{strokes == null ? "picked up" : strokes}</Text>
              </Text>
              <Pressable onPress={() => setStrokes((v) => (v == null ? 1 : Math.max(1, v - 1)))} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="One fewer">
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Pressable onPress={() => setStrokes((v) => (v == null ? 4 : Math.min(20, v + 1)))} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="One more">
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>
          ) : null}
          <TextInput value={reason} onChangeText={setReason} placeholder="Reason (shown to everyone)" placeholderTextColor={colors.ink500} style={styles.input} maxLength={120} accessibilityLabel="Reason for the amendment" />
          <View style={styles.row}>
            <Pressable
              onPress={() => hole != null && add({ key: entrant.key, hole, strokes, dq: false, reason: reason.trim() })}
              disabled={hole == null || reason.trim() === ""}
              style={[styles.choice, styles.choiceOn, (hole == null || reason.trim() === "") && { opacity: 0.5 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.choiceText, styles.choiceTextOn]}>Save the correction</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert(`Disqualify ${entrant.name}?`, "They'll be listed as DQ with your reason, and can't place.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Disqualify", style: "destructive", onPress: () => add({ key: entrant.key, hole: null, strokes: null, dq: true, reason: reason.trim() }) },
                ])
              }
              disabled={reason.trim() === ""}
              style={[styles.choice, reason.trim() === "" && { opacity: 0.5 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.choiceText, { color: colors.red600 }]}>Disqualify</Text>
            </Pressable>
          </View>
          <Pressable onPress={reset} style={styles.linkRow} accessibilityRole="button">
            <Text style={styles.link}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Which group's page lists the results — members of it can look back at them. */
function GroupPicker({ groups, value, onChange }: { groups: { id: number; name: string }[]; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Show on a group&apos;s page</Text>
      <Text style={styles.sub}>Members of the group can look back at these results under Past results, even if they didn&apos;t play.</Text>
      <View style={styles.row}>
        {groups.map((g) => (
          <Pressable key={g.id} onPress={() => onChange(g.id)} style={[styles.choice, value === g.id && styles.choiceOn]} accessibilityRole="radio" accessibilityState={{ checked: value === g.id }}>
            <Text style={[styles.choiceText, value === g.id && styles.choiceTextOn]}>{g.name}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => onChange(null)} style={[styles.choice, value == null && styles.choiceOn]} accessibilityRole="radio" accessibilityState={{ checked: value == null }}>
          <Text style={[styles.choiceText, value == null && styles.choiceTextOn]}>Players only</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  amendedRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 2 },
  amendedTag: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase", color: colors.cream50, backgroundColor: colors.red600, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: "hidden" },
  amendedText: { flex: 1, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.red600 },
  amendedInline: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.red600 },
  amendedCard: { backgroundColor: colors.red100, borderRadius: radii.lg, padding: spacing.md, gap: 6, borderWidth: 1, borderColor: colors.red600 },
  amendedTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.red600 },
  amendItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 },
  holeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  holeCell: { width: 44, height: 50, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  holeNo: { fontFamily: fonts.body, fontSize: 11, color: colors.ink500 },
  holeScore: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: 8 },
  statusPill: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  statusDraft: { backgroundColor: colors.gold400 },
  statusFinal: { backgroundColor: colors.green100 },
  statusText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: colors.navy900 },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  heroMeta: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.cream100 },
  heroButtons: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
  goldButton: { flex: 1, minHeight: 44, borderRadius: radii.pill, backgroundColor: colors.gold400, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  goldButtonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
  ghostButton: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: "rgba(247,243,234,0.4)", alignItems: "center", justifyContent: "center" },
  ghostButtonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  mine: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.gold500, borderRadius: radii.lg, padding: spacing.md, gap: 4 },
  mineEyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.green700 },
  mineBig: { fontFamily: fonts.display, fontSize: 44, color: colors.navy900 },
  mineMeta: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  mineNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tab: { minHeight: 40, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  tabOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  tabText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  tabTextOn: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  rangeNote: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  podium: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  step: { flex: 1, alignItems: "center", gap: 4 },
  medal: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  medalText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  stepName: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink900, textAlign: "center" },
  stepMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  block: { alignSelf: "stretch", borderTopLeftRadius: 10, borderTopRightRadius: 10, alignItems: "center", justifyContent: "center" },
  blockText: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  table: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm + 2, minHeight: 56, borderTopWidth: 1, borderTopColor: colors.line, gap: 6, paddingVertical: 8 },
  trPlaced: { backgroundColor: "rgba(232,196,107,0.12)" },
  trMine: { backgroundColor: "rgba(44,122,61,0.10)" },
  th: { minHeight: 36, borderTopWidth: 0, backgroundColor: colors.navy900, paddingVertical: 0 },
  thText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: colors.cream50 },
  cPos: { width: 34 },
  cNum: { width: 34, textAlign: "center" },
  cBig: { width: 46, textAlign: "right" },
  pos: { fontFamily: fonts.display, fontSize: 17, color: colors.navy900 },
  name: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  sub: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: colors.ink500 },
  won: { fontFamily: fonts.bodySemi, color: colors.green700 },
  you: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green700 },
  guestTag: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  muted: { color: colors.ink500 },
  cell: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  big: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  foot: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500, textAlign: "center" },
  tie: { backgroundColor: colors.surfaceTint, borderTopWidth: 1, borderTopColor: colors.line, padding: spacing.md, gap: spacing.sm },
  tieTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  tieRow: { flexDirection: "row", alignItems: "center", minHeight: 40, borderRadius: 8 },
  tieDecided: { backgroundColor: colors.green100 },
  tieStep: { width: 132, paddingHorizontal: 6, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  tieHead: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: colors.ink500 },
  tieLabel: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink900 },
  tieHoles: { fontFamily: fonts.body, fontSize: 11.5, color: colors.ink500 },
  tieCell: { width: 66, textAlign: "center", fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  tieCellDecided: { fontFamily: fonts.bodyBold, color: colors.green800 },
  tieFoot: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.ink500 },
  rule: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: 6 },
  ruleTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  ruleText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.cream100 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  settingsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 32 },
  label: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.navy900 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { minHeight: 44, flexGrow: 1, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  choiceOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  choiceText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  choiceTextOn: { fontFamily: fonts.bodyBold, color: colors.cream50 },
  cutRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceTint, borderRadius: radii.md, paddingHorizontal: 10, paddingVertical: 6 },
  cutText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.ink900 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  stepBtnText: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.navy900 },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
  toggleText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.ink900 },
  check: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  checkText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink900 },
  extra: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, paddingHorizontal: 10, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.surface },
  addChip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  linkRow: { minHeight: 44, alignItems: "center", justifyContent: "center" },

  saved: { padding: spacing.md, gap: spacing.sm + 2, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.green100 },
  savedFailed: { borderColor: colors.red600, backgroundColor: colors.red100 },
  savedTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm + 2 },
  savedIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  savedTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  savedStatus: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.green700 },
  savedBody: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 21, color: colors.ink900 },
  savedButtons: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  savedButton: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.navy900,
    backgroundColor: colors.surface,
  },
  savedButtonText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900, flexShrink: 1 },
  savedButtonMain: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radii.pill },
  savedButtonMainText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  publish: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  publishText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  prize: { gap: 6, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  prizeLabel: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.green700 },
  prizeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 36 },
  prizePlace: { width: 44, fontFamily: fonts.display, fontSize: 16, color: colors.navy900 },
  prizeScore: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
});
