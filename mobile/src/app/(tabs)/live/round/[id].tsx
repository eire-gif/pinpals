import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FourballConnect } from "@/components/fourball-connect";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { ScoreMark, ScoreMarkKey } from "@/components/score-mark";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { SIDE_COLORS, SIDE_TEXT, asMatchPlayers, loadMatchDayHeader, type MatchDay } from "@/lib/live-match-days";
import {
  deleteLiveRound,
  finishLiveRound,
  loadCourseCards,
  loadLiveRound,
  saveCourseCard,
  setLiveDrive,
  setLiveHole,
  setLiveScore,
  subscribeToLiveRound,
  type LiveRoundData,
} from "@/lib/live-rounds";
import {
  buildBoard,
  driveCounts,
  driveShortfall,
  formatInfo,
  isOneBallPerSide,
  matchCompetitors,
  netScoreName,
  shotsSoFar,
  stablefordPoints,
  teamMatchState,
  toParLabel,
  type CardHole,
  type MatchFormat,
  type ScoreSheet,
} from "@/lib/live-scoring";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";
import { scorecardFromLiveRound } from "@/lib/scorecards";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { goHome } from "@/lib/go-home";

/**
 * Scoring a round, and its leaderboard.
 *
 * One screen with two views rather than two screens: a group flicks between
 * "put my 5 in" and "where does that leave me" constantly, and a back
 * button in between would cost a tap every time.
 *
 * Scores are shown the moment they're tapped (optimistic) and written in
 * the background. Every other phone in the group re-fetches on the round's
 * live ping (0103). If a write fails, the screen reloads from the database
 * and says so — the database is the only copy that counts.
 *
 * The card can be incomplete: most Irish courses have no stroke indexes on
 * file, so the scorer enters them here, hole by hole, from the card. A
 * hole's shots count as soon as its own index is in (shotsSoFar); a match
 * plays on hole by hole and waits at the first hole that still needs one.
 * Each index can be on one hole only — used ones are locked, and 0105
 * refuses a duplicate from any client.
 */
export default function LiveRoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const roundId = Number(id);
  const [data, setData] = useState<LiveRoundData | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"score" | "board">("score");
  const [hole, setHole] = useState(1);
  const [editingCard, setEditingCard] = useState(false);
  // Is this round's card already saved for the course? "same" hides the
  // save button: a second player tapping it used to get an error (0106).
  const [cardOnFile, setCardOnFile] = useState<"same" | "different" | "none" | null>(null);
  const [dayHeader, setDayHeader] = useState<Pick<MatchDay, "id" | "createdBy" | "title" | "teamNames"> | null>(null);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const started = useRef(false);
  // The card view, so finishing can bring its top — the result — into view.
  const boardScroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const d = await loadLiveRound(roundId);
      setData(d);
      if (d && d.round.clubId != null && d.card.every((c) => c.strokeIndex != null)) {
        const tee = (d.round.teeName ?? "Standard").trim().toLowerCase();
        const saved = (await loadCourseCards(d.round.clubId).catch(() => [])).find(
          (c) => c.teeName.trim().toLowerCase() === tee && c.holes === d.round.holes
        );
        setCardOnFile(
          !saved
            ? "none"
            : saved.card.length === d.card.length &&
                d.card.every((h) => saved.card.some((s) => s.hole === h.hole && s.par === h.par && s.strokeIndex === h.strokeIndex))
              ? "same"
              : "different"
        );
      }
      if (d?.round.matchDayId != null) setDayHeader(await loadMatchDayHeader(d.round.matchDayId));
      // Open on the first hole anyone still has to score, once.
      if (d && !started.current) {
        started.current = true;
        const next = d.card.find((h) => d.players.some((p) => !d.scores.get(p.id)?.has(h.hole)));
        setHole(next?.hole ?? d.card[d.card.length - 1]?.hole ?? 1);
      }
    } catch {
      setFailed(true);
    }
  }, [roundId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );
  useEffect(() => subscribeToLiveRound(roundId, () => void load()), [roundId, load]);
  useLiveRefresh(load, data?.round.status === "live");

  const board = useMemo(
    () => {
      if (!data) return null;
      const scr = data.round.scramble;
      if (!scr) return buildBoard(data.round.format, data.card, data.players, data.scores);
      // A scramble team is one "player": its first, off the team handicap.
      const lead = [...data.players].sort((a, b) => a.position - b.position)[0];
      if (!lead) return null;
      return buildBoard("stroke", data.card, [{ id: lead.id, name: teamLabel(data), playingHandicap: scr.teamHandicap }], data.scores);
    },
    [data]
  );

  if (!isOn("liveScoring")) return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;
  if (failed) return <LoadError size="screen" what="this round" onRetry={() => void load()} />;
  if (data === undefined) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  if (data === null) return <StateMessage size="screen" icon="lock-closed-outline" title="This round isn't available" body="It may have been removed, or you're not in it." />;

  const { round, players, card, scores, drives } = data;
  const scr = round.scramble;
  // Scramble is net stroke play for the team (0113).
  const strokeLike = round.format === "stroke" || scr != null;
  const live = round.status === "live";
  const h = card.find((c) => c.hole === hole) ?? card[0];
  const matchFormat: MatchFormat | null = round.matchFormat;
  const info = formatInfo(matchFormat ?? round.format);

  // Who may enter scores: the round's own players, whoever started it, and a
  // match day's organiser (0104). Everyone else in a match day can watch.
  const canScore =
    live &&
    (round.createdBy === me || players.some((p) => p.memberId != null && p.memberId === me) || (dayHeader?.createdBy != null && dayHeader.createdBy === me));

  // Shots on this hole. A match gives them out per competitor (a player, or a
  // pair in foursomes), off the lowest in the match; a stroke or Stableford
  // round from each player's own playing handicap.
  const competitors = matchFormat ? matchCompetitors(matchFormat, asMatchPlayers(players)) : null;
  const shotsFor = (playerId: number): number | null => {
    if (scr) return shotsSoFar(scr.teamHandicap, card).get(h.hole) ?? null;
    const comp = competitors?.find((c) => c.playerIds.includes(playerId));
    if (comp) return shotsSoFar(comp.shots, card).get(h.hole) ?? null;
    const p = players.find((x) => x.id === playerId);
    return p ? (shotsSoFar(p.playingHandicap, card).get(h.hole) ?? null) : null;
  };
  /** Shots for every player on every hole, for the card under the entry rows. */
  const shotsAt = (playerId: number, holeNo: number): number | null => {
    if (scr) return shotsSoFar(scr.teamHandicap, card).get(holeNo) ?? null;
    const comp = competitors?.find((c) => c.playerIds.includes(playerId));
    const hcp = comp ? comp.shots : players.find((x) => x.id === playerId)?.playingHandicap;
    return hcp == null ? null : (shotsSoFar(hcp, card).get(holeNo) ?? null);
  };
  const matchNow = matchFormat ? teamMatchState(matchFormat, card, asMatchPlayers(players), scores) : null;
  const sideName = (n: number) =>
    dayHeader?.teamNames?.[n - 1] ?? players.filter((p) => p.side === n).map((p) => p.name.split(" ")[0]).join(" & ");

  // The rows to score. One per player, except foursomes and greensomes:
  // one per pair, written against the pair's first player.
  type Row = { id: number; name: string; side: number | null };
  const lead = [...players].sort((a, b) => a.position - b.position)[0];
  const rows: Row[] = scr
    ? lead
      ? [{ id: lead.id, name: teamLabel(data), side: null }]
      : []
    : matchFormat && isOneBallPerSide(matchFormat)
      ? [1, 2].map((n) => {
          const pair = players.filter((p) => p.side === n).sort((a, b) => a.position - b.position);
          return { id: pair[0]?.id ?? -n, name: pair.map((p) => p.name.split(" ")[0]).join(" & "), side: n };
        }).filter((r) => r.id > 0)
      : [...players].sort((a, b) => (a.side ?? 0) - (b.side ?? 0) || a.position - b.position).map((p) => ({ id: p.id, name: p.name, side: p.side ?? null }));

  /** Optimistic: draw it now, write it, reload on failure. */
  const score = async (playerId: number, strokes: number | null, clear = false) => {
    if (!live) return;
    setData((d) => {
      if (!d) return d;
      const next = new Map(d.scores);
      const mine = new Map(next.get(playerId) ?? []);
      if (clear) mine.delete(h.hole);
      else mine.set(h.hole, strokes);
      next.set(playerId, mine);
      return { ...d, scores: next };
    });
    try {
      await setLiveScore(round.id, playerId, h.hole, strokes, clear);
    } catch (e) {
      Alert.alert("That score didn't save", e instanceof Error ? e.message : "Check your signal and try again.");
      void load();
    }
  };

  /** Scramble: whose drive was used here. Tapping the chosen one clears it. */
  const pickDrive = async (position: number) => {
    if (!live || !canScore) return;
    const next = drives.get(h.hole) === position ? null : position;
    setData((d) => {
      if (!d) return d;
      const m = new Map(d.drives);
      if (next == null) m.delete(h.hole);
      else m.set(h.hole, next);
      return { ...d, drives: m };
    });
    try {
      await setLiveDrive(round.id, h.hole, next);
    } catch (e) {
      Alert.alert("That drive didn't save", e instanceof Error ? e.message : "Check your signal and try again.");
      void load();
    }
  };

  const editHole = async (par: number, strokeIndex: number | null) => {
    setData((d) => (d ? { ...d, card: d.card.map((c) => (c.hole === h.hole ? { ...c, par, strokeIndex } : c)) } : d));
    try {
      await setLiveHole(round.id, h.hole, par, strokeIndex);
    } catch (e) {
      Alert.alert("The card didn't save", e instanceof Error ? e.message : "Please try again.");
      void load();
    }
  };

  const finish = () =>
    Alert.alert("Finish the round?", "Scores can't be changed after this. Everyone in the round sees the final leaderboard.", [
      { text: "Not yet", style: "cancel" },
      {
        text: "Finish",
        onPress: async () => {
          try {
            await finishLiveRound(round.id);
            // Oct 2026: finishing used to leave you at the bottom of the page
            // with nothing seeming to happen. Now it takes you to this game's
            // card, from the top, with the final scores on it.
            setView("board");
            await load();
            boardScroll.current?.scrollTo({ y: 0, animated: true });
          } catch (e) {
            Alert.alert("Couldn't finish the round", e instanceof Error ? e.message : "Please try again.");
          }
        },
      },
    ]);

  const saveMyScorecard = async () => {
    try {
      const id = await scorecardFromLiveRound(round.id);
      router.push({ pathname: "/scorecards/[id]", params: { id: String(id) } });
    } catch (e) {
      const msg = (e as { message?: unknown } | null)?.message;
      Alert.alert("Couldn't save your card", typeof msg === "string" && msg ? msg : "Please try again.");
    }
  };

  const cardComplete = card.every((c) => c.strokeIndex != null);

  // Oct 2026: once every hole is in (or the round is finished), a way back
  // to the Live Scoring page — for a round, a match or a scramble alike.
  const allScored = rows.length > 0 && card.every((c) => rows.every((p) => scores.get(p.id)?.has(c.hole)));
  const showBackToLive = !live || allScored || !!matchNow?.finished;
  const backToLive = () => {
    if (router.canDismiss()) router.dismissAll();
    router.navigate("/live");
  };
  const backToLiveButton = showBackToLive ? (
    <Pressable onPress={backToLive} style={({ pressed }) => [styles.backLive, pressed && { opacity: 0.85 }]} accessibilityRole="button">
      <Ionicons name="podium" size={18} color={colors.gold400} />
      <Text style={styles.backLiveLabel}>Back to Live Scoring</Text>
    </Pressable>
  ) : null;
  const saveCard = async () => {
    try {
      await saveCourseCard(round, card);
      setCardOnFile("same");
      Alert.alert("Card saved", `The next round at ${round.courseName} will start with these stroke indexes.`);
    } catch (e) {
      // Supabase's errors aren't Error instances; their message is the reason.
      const msg = (e as { message?: unknown } | null)?.message;
      Alert.alert("Couldn't save the card", typeof msg === "string" && msg ? msg : "Please try again.");
    }
  };

  // Which hole each index is already on, so it can't be picked twice.
  const usedSI = new Map(card.filter((c) => c.hole !== h.hole && c.strokeIndex != null).map((c) => [c.strokeIndex!, c.hole]));

  // Whoever started the round, or the match day's organiser, can delete it.
  const canDelete = me != null && (round.createdBy === me || dayHeader?.createdBy === me);
  const remove = () =>
    Alert.alert(
      matchFormat && round.matchDayId != null ? "Delete this match?" : "Delete this round?",
      `The card and every score go for everyone in it${live ? ", even though it's still being played" : ""}. This can't be undone.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteLiveRound(round.id);
              // Home, not the match day or the hub: the game is gone, and
              // Back shouldn't lead to its empty screen either.
              goHome();
            } catch (e) {
              Alert.alert("Couldn't delete it", e instanceof Error ? e.message : "Please try again.");
            }
          },
        },
      ]
    );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: round.matchNumber ? `Match ${round.matchNumber}` : round.courseName }} />
      {dayHeader ? (
        <Pressable
          onPress={() => router.push({ pathname: "/live/day/[id]", params: { id: String(dayHeader.id) } })}
          style={styles.dayLink}
          accessibilityRole="button"
        >
          <Ionicons name="podium-outline" size={16} color={colors.green700} />
          <Text style={styles.link}>{dayHeader.title}: all matches</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.green700} />
        </Pressable>
      ) : null}

      <View style={styles.tabs} accessibilityRole="tablist">
        {(["score", "board"] as const).map((v) => (
          <Pressable
            key={v}
            onPress={() => setView(v)}
            style={[styles.tab, view === v && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === v }}
          >
            <Text style={[styles.tabLabel, view === v && styles.tabLabelOn]}>{v === "score" ? "Score" : "Leaderboard"}</Text>
          </Pressable>
        ))}
      </View>

      {view === "score" ? (
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.holeCard}>
            <View style={styles.holeTop}>
              <Text style={styles.holeMeta}>
                {info.label}
                {round.teeName ? ` · ${round.teeName} tees` : ""}
              </Text>
              {live ? (
                <View style={styles.liveTag}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>Live</Text>
                </View>
              ) : (
                <Text style={styles.holeMeta}>Finished</Text>
              )}
            </View>
            <View style={styles.holeNav}>
              <RoundButton icon="chevron-back" label="Previous hole" disabled={hole <= 1} onPress={() => setHole(hole - 1)} />
              <View style={{ alignItems: "center" }}>
                <Text style={styles.holeEyebrow}>Hole</Text>
                <Text style={styles.holeNumber}>{h.hole}</Text>
                <Pressable onPress={() => live && setEditingCard((o) => !o)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit par and stroke index">
                  <Text style={styles.holeInfo}>
                    Par {h.par} · {h.strokeIndex != null ? `SI ${h.strokeIndex}` : "SI not set"}
                    {live ? "  ✎" : ""}
                  </Text>
                </Pressable>
                {isOn("shotMaps") && round.clubId != null ? (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: "/hole-map", params: { clubId: String(round.clubId), hole: String(h.hole), roundId: String(round.id) } })
                    }
                    style={styles.mapPill}
                    accessibilityRole="button"
                    accessibilityLabel={`Hole ${h.hole} map and GPS yardages`}
                  >
                    <Ionicons name="map-outline" size={14} color={colors.navy900} />
                    <Text style={styles.mapPillText}>Hole map</Text>
                  </Pressable>
                ) : null}
              </View>
              <RoundButton icon="chevron-forward" label="Next hole" disabled={hole >= card.length} onPress={() => setHole(hole + 1)} />
            </View>
            <View style={styles.strip}>
              {card.map((c) => {
                const done = rows.every((p) => scores.get(p.id)?.has(c.hole));
                return (
                  <Pressable
                    key={c.hole}
                    onPress={() => setHole(c.hole)}
                    style={[styles.stripCell, done && styles.stripDone, c.hole === h.hole && styles.stripNow]}
                    accessibilityLabel={`Hole ${c.hole}${done ? ", scored" : ""}`}
                    hitSlop={{ top: 10, bottom: 10 }}
                  />
                );
              })}
            </View>
            {matchNow ? (
              <Pressable onPress={() => setView("board")} style={styles.matchLine} accessibilityRole="button" accessibilityLabel="See the match">
                <Text style={styles.matchLineText}>
                  {matchNow.leader === 0 ? matchNow.margin : `${sideName(matchNow.leader)} ${matchNow.margin}`}
                  {matchNow.holes.length > 0 && !matchNow.finished ? ` · thru ${matchNow.holes.length}` : ""}
                </Text>
                {matchNow.waitingForIndex != null && matchNow.waitingForIndex !== h.hole && scores.size > 0 ? (
                  <Text style={styles.matchLineWait}>Waiting on hole {matchNow.waitingForIndex}'s SI</Text>
                ) : null}
              </Pressable>
            ) : null}
          </View>

          {editingCard || h.strokeIndex == null ? (
            <View style={styles.cardEditor}>
              {h.strokeIndex == null && !editingCard ? (
                <Text style={styles.cardEditorNote}>
                  Enter this hole's stroke index from the card so everyone's shots are counted. You only need to do it
                  once — you can save the card for {round.courseName} at the end.
                </Text>
              ) : null}
              {live ? (
                <>
                  <Text style={styles.editorLabel}>Par</Text>
                  <View style={styles.chips}>
                    {[3, 4, 5, 6].map((p) => (
                      <Pressable key={p} onPress={() => void editHole(p, h.strokeIndex)} style={[styles.chip, h.par === p && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: h.par === p }}>
                        <Text style={[styles.chipText, h.par === p && styles.chipTextOn]}>{p}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.editorLabel}>Stroke index</Text>
                  <View style={styles.chips}>
                    {Array.from({ length: 18 }, (_, i) => i + 1).map((si) => {
                      const on = h.strokeIndex === si;
                      const usedOn = usedSI.get(si);
                      const used = usedOn != null;
                      return (
                        <Pressable
                          key={si}
                          onPress={() => {
                            if (used || on) return;
                            void editHole(h.par, si);
                          }}
                          disabled={used}
                          style={[styles.chip, styles.chipSmall, on && styles.chipOn, used && !on && styles.chipUsed]}
                          accessibilityRole="button"
                          accessibilityLabel={`Stroke index ${si}${used ? `, already on hole ${usedOn}` : ""}`}
                          accessibilityState={{ selected: on, disabled: used }}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn, used && !on && styles.chipTextUsed]}>{si}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {usedSI.size > 0 ? <Text style={styles.playerMeta}>Greyed numbers are already on another hole.</Text> : null}
                  {editingCard ? (
                    <Pressable onPress={() => setEditingCard(false)} hitSlop={8}>
                      <Text style={styles.link}>Done</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}

          {rows.map((p, i) => {
            const shots = shotsFor(p.id);
            const sideHeader = matchFormat && p.side != null && (i === 0 || rows[i - 1].side !== p.side);
            const mine = scores.get(p.id);
            const entered = mine?.has(h.hole) ?? false;
            const strokes = entered ? (mine!.get(h.hole) ?? null) : null;
            const shown = entered ? strokes : h.par + (shots ?? 0);
            const pts = entered && shots != null ? stablefordPoints(strokes, h.par, shots) : null;
            const name = entered && strokes != null && shots != null ? netScoreName(strokes, h.par, shots) : entered && strokes == null ? "Picked up" : null;
            return (
              <View key={p.id} style={{ gap: spacing.sm }}>
              {sideHeader ? (
                <View style={[styles.sideTag, { backgroundColor: SIDE_COLORS[(p.side ?? 1) - 1] }]}>
                  <Text style={[styles.sideTagText, { color: SIDE_TEXT[(p.side ?? 1) - 1] }]}>{sideName(p.side ?? 1)}</Text>
                </View>
              ) : null}
              <View style={styles.player}>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.playerName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    {shots != null && shots !== 0 ? (
                      <View style={styles.dots} accessibilityLabel={`${shots > 0 ? "Gets" : "Gives"} ${Math.abs(shots)} ${Math.abs(shots) === 1 ? "shot" : "shots"} here`}>
                        {Array.from({ length: Math.abs(shots) }, (_, i) => (
                          <View key={i} style={[styles.shotDot, shots < 0 && styles.shotDotGive]} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                  {scr && scr.teamName ? (
                    <Text style={styles.playerMeta} numberOfLines={1}>
                      {[...players].sort((x, y) => x.position - y.position).map((x) => x.name.split(" ")[0]).join(" · ")}
                    </Text>
                  ) : null}
                  <View style={styles.nameRow}>
                    {round.format === "stableford" && pts != null ? (
                      <Text style={[styles.badge, pts >= 3 ? styles.badgeGood : pts === 0 ? styles.badgeNil : null]}>{pts} pts</Text>
                    ) : null}
                    <Text style={styles.playerMeta}>{name ?? (entered ? "" : shots != null ? `${shots} ${Math.abs(shots) === 1 ? "shot" : "shots"} here` : "")}</Text>
                  </View>
                </View>
                {canScore ? (
                  <View style={styles.stepper}>
                    <StepButton label="−" a11y={`One fewer for ${p.name}`} onPress={() => void score(p.id, Math.max(1, (shown ?? h.par) - 1))} />
                    <Pressable
                      onPress={() => void score(p.id, shown ?? h.par)}
                      onLongPress={() => entered && void score(p.id, null, true)}
                      style={styles.strokesBox}
                      accessibilityRole="button"
                      accessibilityLabel={entered ? `${p.name}: ${strokes ?? "picked up"}. Hold to clear.` : `Confirm ${shown} for ${p.name}`}
                    >
                      {/* Marked against par (gross), like the card: circle for a
                          birdie, square for a bogey. */}
                      <ScoreMark strokes={entered ? strokes : shown} par={h.par} size={48} ghost={!entered} textStyle={[styles.strokesMark, !entered && styles.strokesGhost]} />
                    </Pressable>
                    <StepButton label="+" dark a11y={`One more for ${p.name}`} onPress={() => void score(p.id, Math.min(20, (shown ?? h.par) + 1))} />
                  </View>
                ) : (
                  entered ? <ScoreMark strokes={strokes} par={h.par} size={48} textStyle={styles.strokesMark} /> : <Text style={styles.strokes}>–</Text>
                )}
              </View>
              </View>
            );
          })}

          {scr ? (
            <DrivePicker
              players={[...players].sort((a, b) => a.position - b.position)}
              drives={drives}
              hole={h.hole}
              minimum={scr.driveMinimum}
              holesLeft={card.filter((c) => !drives.has(c.hole)).length}
              canScore={canScore}
              onPick={(pos) => void pickDrive(pos)}
            />
          ) : null}

          {!canScore && live ? (
            <Text style={styles.footNote}>{scr ? "You're watching this team. Its own players score it." : "You're watching this match. Its own players score it."}</Text>
          ) : null}

          <LiveCard
            card={card}
            rows={rows}
            scores={scores}
            hole={h.hole}
            onPickHole={setHole}
            shotsAt={shotsAt}
            second={round.format === "stableford" && !matchFormat ? "points" : "net"}
          />
          {canScore ? (
            <View style={styles.footerRow}>
              <Text style={styles.footNote}>Tap the number to confirm it · hold it to clear</Text>
              <View style={styles.pickupRow}>
                {rows.map((p) => (
                  <Pressable key={p.id} onPress={() => void score(p.id, null)} style={styles.pickup} accessibilityRole="button">
                    <Text style={styles.pickupText}>{scr ? "Team picked up" : `${p.name.split(" ")[0]} picked up`}</Text>
                  </Pressable>
                ))}
              </View>
              {hole < card.length ? (
                <Pressable onPress={() => setHole(hole + 1)} style={styles.next} accessibilityRole="button">
                  <Text style={styles.nextLabel}>Next hole</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => setView("board")} style={styles.next} accessibilityRole="button">
                  <Text style={styles.nextLabel}>See the leaderboard</Text>
                </Pressable>
              )}
            </View>
          ) : null}
          {backToLiveButton}
        </ScrollView>
      ) : (
        <ScrollView ref={boardScroll} contentContainerStyle={styles.page}>
          {board?.cardIncomplete && !matchFormat ? (
            <Text style={styles.warn}>
              Some holes have no stroke index yet, so shots aren't counted there. Fill them in on the Score tab.
            </Text>
          ) : null}

          {matchFormat ? (
            <MatchView data={data} format={matchFormat} sideName={sideName} />          ) : (
            <View style={styles.table}>
              <View style={[styles.tr, styles.th]}>
                <Text style={[styles.thText, styles.cPos]}>Pos</Text>
                <Text style={[styles.thText, { flex: 1 }]}>Player</Text>
                <Text style={[styles.thText, styles.cNum]}>Thru</Text>
                <Text style={[styles.thText, styles.cNum]}>{strokeLike ? "Gross" : "Pace"}</Text>
                <Text style={[styles.thText, styles.cBig]}>{strokeLike ? "Net" : "Pts"}</Text>
              </View>
              {board?.rows.map((r) => (
                <View key={r.playerId} style={styles.tr}>
                  <Text style={[styles.pos, styles.cPos]}>{r.position || "–"}</Text>
                  <Text style={[styles.playerName, { flex: 1 }]} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={[styles.cell, styles.cNum]}>{r.thru}</Text>
                  <Text style={[styles.cell, styles.cNum]}>{strokeLike ? r.gross || "–" : r.thru ? toParLabel(r.pace).replace("E", "0") : "–"}</Text>
                  <Text style={[styles.big, styles.cBig]}>{strokeLike ? (r.thru ? toParLabel(r.netToPar) : "–") : r.points}</Text>
                </View>
              ))}
            </View>
          )}

          {!matchFormat ? (
            <Text style={styles.footNote}>
              {strokeLike
                ? "Net is against par for the holes played."
                : "Pace is points against two a hole, so groups on different holes compare fairly."}
            </Text>
          ) : null}

          <View style={styles.handicaps}>
            <Text style={styles.editorLabel}>
              {scr ? `Team handicap · ${scr.size}-person scramble` : `Handicaps · ${Math.round(round.allowance * 100)}% allowance`}
            </Text>
            {scr ? <Text style={styles.playerName}>{teamLabel(data)} plays off {scr.teamHandicap}</Text> : null}
            {players.map((p) => (
              <Text key={p.id} style={styles.playerMeta}>
                {p.name}: index {p.handicapIndex}, course {p.courseHandicap}
                {p.estimated ? " (estimated)" : ""}
                {scr ? `, share ${p.playingHandicap}` : matchFormat ? "" : `, plays off ${p.playingHandicap}`}
              </Text>
            ))}
            {competitors && competitors.some((c) => c.shots > 0) ? (
              <Text style={styles.playerMeta}>
                Shots in this match:{" "}
                {competitors
                  .filter((c) => c.shots > 0)
                  .map((c) => `${c.playerIds.map((id) => players.find((p) => p.id === id)?.name.split(" ")[0]).join(" & ")} ${c.shots}`)
                  .join(", ")}
              </Text>
            ) : null}
          </View>

          {cardComplete && round.clubId != null && cardOnFile === "same" ? (
            <View style={styles.cardSaved} accessibilityRole="text">
              <Ionicons name="bookmark" size={18} color={colors.green700} />
              <Text style={styles.cardSavedText}>
                Card saved for {round.courseName}
                {round.teeName ? ` · ${round.teeName} tees` : ""}. The next round there starts filled in.
              </Text>
            </View>
          ) : cardComplete && round.clubId != null && cardOnFile !== null ? (
            <Pressable onPress={() => void saveCard()} style={styles.secondary} accessibilityRole="button">
              <Ionicons name="bookmark-outline" size={18} color={colors.green700} />
              <Text style={styles.link}>Save this card for {round.courseName}</Text>
            </Pressable>
          ) : null}

          {/* Scorecards (0110): your own line as a card in your profile.
              Saving again later refreshes the same card. */}
          {isOn("scorecards") && !scr && me != null && players.some((p) => p.memberId === me) ? (
            <Pressable onPress={() => void saveMyScorecard()} style={styles.secondary} accessibilityRole="button">
              <Ionicons name="document-text-outline" size={18} color={colors.green700} />
              <Text style={styles.link}>{live ? "Save my scorecard so far" : "Save my scorecard"}</Text>
            </Pressable>
          ) : null}

          {canScore ? (
            <Pressable onPress={finish} style={styles.next} accessibilityRole="button">
              <Text style={styles.nextLabel}>{matchFormat ? "Finish match" : "Finish round"}</Text>
            </Pressable>
          ) : null}

          {/* After the round (Find PinPals, mock-up 5): connect with the
              fourball, send a guest their scorecard. */}
          {!live && me != null && players.some((p) => p.memberId === me) ? (
            <FourballConnect me={me} courseName={round.courseName} players={players.map((p) => ({ id: p.id, memberId: p.memberId, name: p.name }))} />
          ) : null}

          {backToLiveButton}

          {canDelete ? (
            <Pressable onPress={remove} style={styles.delete} accessibilityRole="button">
              <Text style={styles.deleteLabel}>{round.matchDayId != null ? "Delete this match" : "Delete round"}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function MatchView({ data, format, sideName }: { data: LiveRoundData; format: MatchFormat; sideName: (n: number) => string }) {
  const m = teamMatchState(format, data.card, asMatchPlayers(data.players), data.scores);
  if (!m) return null;
  const stuck = m.waitingForIndex != null && data.players.some((p) => data.scores.get(p.id)?.has(m.waitingForIndex!));
  const byHole = new Map(m.holes.map((r) => [r.hole, r.result]));
  const status = m.leader === 0 ? m.margin : `${sideName(m.leader)} ${m.margin}`;
  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.matchCard}>
        <Text style={styles.matchSide}>{sideName(1)}</Text>
        <View style={styles.matchStatus}>
          <Text style={styles.matchLabel}>{status}</Text>
          <Text style={styles.matchSub}>
            {m.finished ? "Match over" : m.dormie ? `Dormie · ${m.holesLeft} to play` : `thru ${m.holes.length} · ${m.holesLeft} to play`}
          </Text>
        </View>
        <Text style={[styles.matchSide, { textAlign: "right" }]}>{sideName(2)}</Text>
      </View>
      <View style={styles.grid}>
        {data.card.map((c) => {
          const r = byHole.get(c.hole);
          const bg = r === "won" ? SIDE_COLORS[0] : r === "lost" ? SIDE_COLORS[1] : null;
          const fg = r === "won" ? SIDE_TEXT[0] : r === "lost" ? SIDE_TEXT[1] : colors.ink900;
          return (
            <View key={c.hole} style={styles.gridCell}>
              <Text style={styles.gridHole}>{c.hole}</Text>
              <View style={[styles.gridMark, bg ? { backgroundColor: bg, borderColor: bg, borderStyle: "solid" } : null, r === "halved" && styles.gHalf]}>
                <Text style={[styles.gridText, { color: fg }]}>{r === "halved" ? "½" : r ? "●" : ""}</Text>
              </View>
            </View>
          );
        })}
      </View>
      {stuck ? (
        <Text style={styles.warn}>
          Hole {m.waitingForIndex} has scores but no stroke index yet, so the match can't count it. Add it on the Score tab.
        </Text>
      ) : null}
      <Text style={styles.footNote}>Each hole is coloured by the side that won it; ½ is a halved hole.</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The card under the entry rows (Oct 2026: "more options to view the
// scorecard underneath when putting in the score").
// ---------------------------------------------------------------------------

type CardMode = "strokes" | "points" | "net";

/** A scramble team's name: its own, or its players' first names. */
function teamLabel(d: LiveRoundData): string {
  return (
    d.round.scramble?.teamName ??
    [...d.players]
      .sort((a, b) => a.position - b.position)
      .map((p) => p.name.split(" ")[0])
      .join(" & ")
  );
}

/**
 * Scramble: whose drive the team took on this hole, and the running count
 * against the minimum. Warns when the holes left can't cover what's owed.
 */
function DrivePicker({
  players,
  drives,
  hole,
  minimum,
  holesLeft,
  canScore,
  onPick,
}: {
  players: { position: number; name: string }[];
  drives: ReadonlyMap<number, number>;
  hole: number;
  minimum: number | null;
  holesLeft: number;
  canScore: boolean;
  onPick: (position: number) => void;
}) {
  const counts = driveCounts(drives, players.map((p) => p.position));
  // The hole being scored isn't "left" once its drive is in.
  const left = holesLeft;
  const short = driveShortfall(counts, minimum, left);
  const chosen = drives.get(hole) ?? null;
  const first = (pos: number) => players.find((p) => p.position === pos)?.name.split(" ")[0] ?? "";
  return (
    <View style={styles.drives}>
      <View style={styles.drivesHead}>
        <Text style={styles.drivesTitle}>Whose drive?</Text>
        {minimum ? <Text style={styles.playerMeta}>Minimum {minimum} each</Text> : null}
      </View>
      <View style={styles.driveChips}>
        {players.map((p) => {
          const on = chosen === p.position;
          const n = counts.get(p.position) ?? 0;
          const done = minimum != null && n >= minimum;
          return (
            <Pressable
              key={p.position}
              onPress={() => onPick(p.position)}
              disabled={!canScore}
              style={[styles.driveChip, on && styles.driveChipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: !canScore }}
              accessibilityLabel={`${p.name}'s drive. ${n} used${minimum ? ` of ${minimum}` : ""}.`}
            >
              <Text style={[styles.driveName, on && styles.driveNameOn]} numberOfLines={1}>
                {p.name.split(" ")[0]}
              </Text>
              <Text style={[styles.driveCount, on && styles.driveNameOn, done && !on && { color: colors.green700 }]}>
                {minimum ? `${n}/${minimum}` : n}
                {done ? " ✓" : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {short.impossible ? (
        <Text style={[styles.driveNote, { color: colors.red600 }]}>
          Not enough holes left: {short.needs.map((x) => `${first(x.position)} needs ${x.needed}`).join(", ")}.
        </Text>
      ) : short.tight ? (
        <Text style={[styles.driveNote, { color: colors.red600 }]}>
          Every hole left must go to {short.needs.map((x) => first(x.position)).join(" or ")}.
        </Text>
      ) : short.needs.length > 0 ? (
        <Text style={styles.driveNote}>Still owed: {short.needs.map((x) => `${first(x.position)} ${x.needed}`).join(" · ")}</Text>
      ) : minimum ? (
        <Text style={[styles.driveNote, { color: colors.green700 }]}>Everyone has their drives in.</Text>
      ) : null}
    </View>
  );
}

function Tot({ children, head = false, small = false, strong = false }: { children: ReactNode; head?: boolean; small?: boolean; strong?: boolean }) {
  return (
    <View style={[styles.lcTot, head && styles.lcTotHead]}>
      <Text style={[styles.lcCellText, head && styles.lcHeadText, small && styles.lcSmall, strong && styles.lcTotVal]}>{children}</Text>
    </View>
  );
}

function LiveCard({
  card,
  rows,
  scores,
  hole,
  onPickHole,
  shotsAt,
  second,
}: {
  card: CardHole[];
  rows: { id: number; name: string }[];
  scores: ScoreSheet;
  hole: number;
  onPickHole: (n: number) => void;
  shotsAt: (playerId: number, hole: number) => number | null;
  /** The second view: Stableford points, or net strokes for stroke and match play. */
  second: "points" | "net";
}) {
  const eighteen = card.length > 9;
  const [nine, setNine] = useState<"front" | "back" | null>(null);
  const [mode, setMode] = useState<CardMode>("strokes");
  // Follows the hole being scored until the member picks a nine themselves.
  const showing = nine ?? (eighteen && hole > 9 ? "back" : "front");
  const holes = eighteen ? card.filter((c) => (showing === "front" ? c.hole <= 9 : c.hole > 9)) : card;

  const valueOn = (playerId: number, c: CardHole): number | null | undefined => {
    const mine = scores.get(playerId);
    if (!mine?.has(c.hole)) return undefined; // not played
    const strokes = mine.get(c.hole) ?? null;
    if (mode === "strokes") return strokes;
    const shots = shotsAt(playerId, c.hole);
    if (shots == null) return undefined;
    if (mode === "points") return stablefordPoints(strokes, c.par, shots);
    return strokes == null ? null : strokes - shots;
  };
  const sum = (playerId: number, list: CardHole[]): number | null => {
    let total = 0;
    let any = false;
    for (const c of list) {
      const v = valueOn(playerId, c);
      if (v != null) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  };
  const totalLabel = eighteen ? (showing === "front" ? "Out" : "In") : "Tot";
  const parOf = (list: CardHole[]) => list.reduce((n, c) => n + c.par, 0);

  return (
    <View style={styles.lc}>
      <View style={styles.lcHead}>
        <Text style={styles.lcTitle}>Scorecard</Text>
        <View style={styles.lcToggles}>
          {(["strokes", second] as const).map((m) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.lcPill, mode === m && styles.lcPillOn]} accessibilityRole="button" accessibilityState={{ selected: mode === m }}>
              <Text style={[styles.lcPillText, mode === m && styles.lcPillTextOn]}>{m === "strokes" ? "Strokes" : m === "points" ? "Points" : "Net"}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {eighteen ? (
        <View style={styles.lcNines}>
          {(["front", "back"] as const).map((n) => (
            <Pressable key={n} onPress={() => setNine(n)} style={[styles.lcNine, showing === n && styles.lcNineOn]} accessibilityRole="tab" accessibilityState={{ selected: showing === n }}>
              <Text style={[styles.lcNineText, showing === n && styles.lcNineTextOn]}>{n === "front" ? "Front 9" : "Back 9"}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.lcTable}>
        <View style={[styles.lcRow, styles.lcHeadRow]}>
          <Text style={[styles.lcName, styles.lcHeadText]}>Hole</Text>
          {holes.map((c) => (
            <Pressable key={c.hole} onPress={() => onPickHole(c.hole)} style={[styles.lcCell, c.hole === hole && styles.lcNowHead]} accessibilityRole="button" accessibilityLabel={`Go to hole ${c.hole}`}>
              <Text style={[styles.lcCellText, styles.lcHeadText]}>{c.hole}</Text>
            </Pressable>
          ))}
          <Tot head>{totalLabel}</Tot>
          {eighteen && showing === "back" ? <Tot head>Tot</Tot> : null}
        </View>
        <View style={[styles.lcRow, styles.lcParRow]}>
          <Text style={[styles.lcName, styles.lcSmall]}>Par</Text>
          {holes.map((c) => (
            <View key={c.hole} style={[styles.lcCell, c.hole === hole && styles.lcNow]}>
              <Text style={[styles.lcCellText, styles.lcSmall]}>{c.par}</Text>
            </View>
          ))}
          <Tot small>{parOf(holes)}</Tot>
          {eighteen && showing === "back" ? <Tot small>{parOf(card)}</Tot> : null}
        </View>
        {rows.map((p) => (
          <View key={p.id} style={styles.lcRow}>
            <Text style={styles.lcName} numberOfLines={1}>
              {p.name.split(" ")[0]}
            </Text>
            {holes.map((c) => {
              const v = valueOn(p.id, c);
              return (
                <View key={c.hole} style={[styles.lcCell, c.hole === hole && styles.lcNow]}>
                  {v === undefined ? (
                    <Text style={[styles.lcCellText, styles.lcEmpty]}>·</Text>
                  ) : mode === "strokes" ? (
                    <ScoreMark strokes={v} par={c.par} size={22} />
                  ) : (
                    <Text style={styles.lcCellText}>{v ?? "P"}</Text>
                  )}
                </View>
              );
            })}
            <Tot strong>{sum(p.id, holes) ?? "–"}</Tot>
            {eighteen && showing === "back" ? <Tot strong>{sum(p.id, card) ?? "–"}</Tot> : null}
          </View>
        ))}
      </View>
      {mode === "strokes" ? <ScoreMarkKey /> : (
        <Text style={styles.footNote}>{mode === "points" ? "Stableford points with each player's shots." : "Strokes less each player's shots on the hole."}</Text>
      )}
      <Text style={styles.footNote}>Tap a hole number to go to it.</Text>
    </View>
  );
}

function RoundButton({ icon, label, disabled, onPress }: { icon: "chevron-back" | "chevron-forward"; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.roundButton, disabled && { opacity: 0.3 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={colors.cream50} />
    </Pressable>
  );
}

function StepButton({ label, a11y, dark = false, onPress }: { label: string; a11y: string; dark?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.step, dark && styles.stepDark]} accessibilityRole="button" accessibilityLabel={a11y} hitSlop={4}>
      <Text style={[styles.stepLabel, dark && { color: colors.cream50 }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dayLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingTop: spacing.sm, minHeight: 36 },
  sideTag: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 4, borderRadius: radii.pill, marginTop: spacing.xs },
  sideTagText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  tab: { flex: 1, minHeight: 40, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  tabLabel: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  tabLabelOn: { color: colors.cream50 },
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },

  holeCard: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: spacing.md },
  holeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  holeMeta: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.8) },
  liveTag: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green600 },
  liveText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.green100 },
  holeNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  holeEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: colors.gold400 },
  holeNumber: { fontFamily: fonts.display, fontSize: 48, lineHeight: 56, color: colors.cream50 },
  holeInfo: { fontFamily: fonts.body, fontSize: 13, color: creamAlpha(0.85), paddingVertical: 4 },
  mapPill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, paddingHorizontal: 12, minHeight: 30, borderRadius: radii.pill, backgroundColor: colors.gold400 },
  mapPillText: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: colors.navy900 },
  roundButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: creamAlpha(0.25), alignItems: "center", justifyContent: "center" },
  strip: { flexDirection: "row", gap: 3 },
  stripCell: { flex: 1, height: 6, borderRadius: 3, backgroundColor: creamAlpha(0.18) },
  stripDone: { backgroundColor: colors.gold400 },
  stripNow: { backgroundColor: colors.cream50 },

  cardEditor: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gold500, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  cardEditorNote: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink900 },
  editorLabel: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: colors.ink500 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minWidth: 44, height: 44, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, alignItems: "center", justifyContent: "center" },
  chipSmall: { minWidth: 40, height: 40 },
  chipOn: { backgroundColor: colors.green700, borderColor: colors.green700 },
  chipUsed: { backgroundColor: colors.surfaceTint, borderStyle: "dashed" },
  chipText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  chipTextOn: { color: colors.cream50 },
  chipTextUsed: { color: colors.ink500 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },

  player: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  playerName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900, flexShrink: 1 },
  playerMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  dots: { flexDirection: "row", gap: 3 },
  shotDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.green700 },
  shotDotGive: { backgroundColor: colors.red600 },
  badge: { fontFamily: fonts.bodyBold, fontSize: 13, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill, overflow: "hidden", backgroundColor: colors.cream100, color: colors.ink900 },
  badgeGood: { backgroundColor: colors.green700, color: colors.cream50 },
  badgeNil: { backgroundColor: colors.red100, color: colors.red600 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 4 },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, alignItems: "center", justifyContent: "center" },
  stepDark: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  stepLabel: { fontFamily: fonts.bodySemi, fontSize: 22, color: colors.ink900, lineHeight: 26 },
  strokesBox: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  strokes: { fontFamily: fonts.display, fontSize: 28, color: colors.navy900 },
  strokesMark: { fontFamily: fonts.display, color: colors.navy900 },
  strokesGhost: { color: colors.line },

  footerRow: { gap: spacing.sm },
  footNote: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, textAlign: "center" },
  pickupRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  pickup: { minHeight: 36, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, justifyContent: "center", backgroundColor: colors.surface },
  pickupText: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  next: { minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  backLive: { flexDirection: "row", gap: 8, minHeight: 54, borderRadius: radii.pill, backgroundColor: colors.navy900, borderWidth: 1, borderColor: colors.gold500, alignItems: "center", justifyContent: "center" },
  backLiveLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  nextLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  secondary: { flexDirection: "row", gap: spacing.sm, minHeight: 48, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.green700, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
  cardSaved: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.green100, borderRadius: radii.lg, padding: spacing.md },
  cardSavedText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, lineHeight: 20, color: colors.green800 },
  warn: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink900, backgroundColor: colors.cream100, borderRadius: radii.md, padding: spacing.md },

  table: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, overflow: "hidden" },
  tr: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, minHeight: 52, borderTopWidth: 1, borderTopColor: colors.line, gap: spacing.sm },
  th: { minHeight: 36, borderTopWidth: 0 },
  thText: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: colors.ink500 },
  cPos: { width: 36 },
  cNum: { width: 44, textAlign: "center" },
  cBig: { width: 48, textAlign: "right" },
  pos: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  cell: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  big: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  handicaps: { gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md },

  matchLine: { borderTopWidth: 1, borderTopColor: creamAlpha(0.15), paddingTop: spacing.sm, alignItems: "center", gap: 2 },
  matchLineText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.gold400 },
  matchLineWait: { fontFamily: fonts.body, fontSize: 12, color: creamAlpha(0.75) },
  delete: { minHeight: 48, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.red600, alignItems: "center", justifyContent: "center" },
  deleteLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.red600 },
  matchCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: spacing.sm },
  matchSide: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  matchStatus: { backgroundColor: colors.cream50, borderRadius: radii.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" },
  matchLabel: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  matchSub: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.ink500 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  gridCell: { width: "9.5%", flexGrow: 1, alignItems: "center", gap: 2 },
  gridHole: { fontFamily: fonts.body, fontSize: 10, color: colors.ink500 },
  gridMark: { width: "100%", height: 28, borderRadius: 7, borderWidth: 1, borderColor: colors.line, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  gWon: { backgroundColor: colors.green700, borderColor: colors.green700, borderStyle: "solid" },
  gLost: { backgroundColor: colors.red600, borderColor: colors.red600, borderStyle: "solid" },
  gHalf: { backgroundColor: colors.cream100, borderColor: colors.cream100, borderStyle: "solid" },
  drives: { gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md },
  drivesHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  drivesTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  driveChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  driveChip: { flexGrow: 1, flexBasis: "22%", minHeight: 52, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream50, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  driveChipOn: { backgroundColor: colors.navy900, borderColor: colors.gold500 },
  driveName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink900 },
  driveNameOn: { color: colors.cream50 },
  driveCount: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.ink500, marginTop: 1 },
  driveNote: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500 },
  lc: { gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, padding: spacing.md, paddingHorizontal: 10 },
  lcHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  lcTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.navy900 },
  lcToggles: { flexDirection: "row", gap: 4, backgroundColor: colors.cream100, borderRadius: radii.pill, padding: 3 },
  lcPill: { paddingHorizontal: 12, minHeight: 30, borderRadius: radii.pill, justifyContent: "center" },
  lcPillOn: { backgroundColor: colors.navy900 },
  lcPillText: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink900 },
  lcPillTextOn: { color: colors.cream50 },
  lcNines: { flexDirection: "row", gap: 6, paddingHorizontal: 4 },
  lcNine: { flex: 1, minHeight: 34, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  lcNineOn: { borderColor: colors.gold500, backgroundColor: colors.gold400 },
  lcNineText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  lcNineTextOn: { color: colors.navy900, fontFamily: fonts.bodyBold },
  lcTable: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  lcRow: { flexDirection: "row", alignItems: "center", minHeight: 34, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  lcHeadRow: { backgroundColor: colors.navy900, borderTopWidth: 0, minHeight: 30 },
  lcParRow: { backgroundColor: colors.cream100, minHeight: 26 },
  lcHeadText: { color: colors.cream50, fontFamily: fonts.bodyBold },
  lcName: { width: 54, paddingLeft: 8, fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink900 },
  lcCell: { flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  lcNow: { backgroundColor: "rgba(232,196,107,0.22)" },
  lcNowHead: { backgroundColor: colors.gold500 },
  lcCellText: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink900, textAlign: "center" },
  lcSmall: { fontSize: 11, color: colors.ink500 },
  lcEmpty: { color: colors.line },
  lcTot: { width: 32, alignSelf: "stretch", alignItems: "center", justifyContent: "center", backgroundColor: colors.cream100 },
  lcTotHead: { backgroundColor: colors.navy800 },
  lcTotVal: { fontFamily: fonts.bodyBold },
  gridText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink900 },
});
