import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSection, useCourseSetup } from "@/components/live-course-section";
import { Section } from "@/components/form-bits";
import { ScrambleOptions } from "@/components/scramble-options";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { createLiveRound } from "@/lib/live-rounds";
import { createMatchDay, createScrambleDay } from "@/lib/live-match-days";
import {
  FOURSOMES_ALLOWANCE,
  LIVE_FORMATS,
  courseHandicap,
  formatInfo,
  foursomesHandicap,
  foursomesLabel,
  parseIndex,
  playingHandicap,
  scrambleHandicap,
  type FoursomesScoring,
  type LiveFormat,
  type ScrambleSize,
} from "@/lib/live-scoring";
import { pinPalsToPlayWith } from "@/lib/age";
import type { Member } from "@/lib/members";
import { loadClub } from "@/lib/outings";
import { loadMyProfile } from "@/lib/profile";
import { teeTimeLineUp, whenLabel, type TeeMate } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { explainStartError, myOpenGame, type MyOpenGame } from "@/lib/open-game-alert";
import { openGamePath } from "@/lib/open-game";

/**
 * Set up a round: course and tees, format, players.
 *
 * Every player's handicap is an INDEX, typed or carried over from their
 * profile, and "plays off" beside it is worked out live from the course's
 * rating and slope (live-scoring.ts) as you type — so the number a member
 * checks is the one they'll actually get shots from.
 *
 * FOURSOMES (Scotch foursomes; 0136): pairs, one ball, alternate shot.
 * Two players are one pair; four are two pairs, 1 & 2 v 3 & 4. Scored by
 * Stableford or stroke play (each pair plays off half its combined course
 * handicaps), or — with four — as a pair v pair match. Two pairs, or a
 * match, start as a small day so both pairs share one leaderboard.
 *
 * Members can add themselves, their PinPals and guests by name. Only
 * accepted PinPals are offered: putting a stranger on a leaderboard is
 * refused by live_round_create anyway, and offering it would be a trap.
 * Under 16 (0159): no PinPals — their parent and the contacts their parent
 * approves are offered instead (pinPalsToPlayWith in lib/age.ts).
 *
 * FROM A TEE TIME (0141): opened with ?teeTime=<id> from a tee time's
 * "Start live scoring", the course is set and everyone on the tee time is
 * added and ticked. Untick anyone not scoring with you — they can be ticked
 * back. The server lets you add people from the same tee time even when
 * they aren't your PinPals yet.
 */

type DraftPlayer = {
  key: string;
  memberId: string | null;
  name: string;
  indexText: string;
  isMe: boolean;
};


let keySeq = 0;
const nextKey = () => `p${++keySeq}`;

export default function NewLiveRound() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const course = useCourseSetup();
  const { club, rating, slope, par, holes } = course;
  const [format, setFormat] = useState<LiveFormat>("stableford");
  const [players, setPlayers] = useState<DraftPlayer[]>([]);
  const [pals, setPals] = useState<Member[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // Scramble (0113): one team here; several teams is a scramble day.
  const [size, setSize] = useState<ScrambleSize>(4);
  const [teamName, setTeamName] = useState("");
  const [driveMinimum, setDriveMinimum] = useState<number | null>(null);
  const scramble = format === "scramble";
  // Foursomes (0136): how it's scored.
  const foursomes = format === "foursomes";
  const [scoring, setScoring] = useState<FoursomesScoring | "matchplay">("stableford");

  // 0157: one open game per player. If you're already in one — the other
  // player on the tee time started it — say so up front and offer to open it,
  // rather than let you set up a second game that will be refused.
  const [openGame, setOpenGame] = useState<MyOpenGame | null>(null);
  useEffect(() => {
    let live = true;
    void myOpenGame().then((g) => {
      if (live) setOpenGame(g);
    });
    return () => {
      live = false;
    };
  }, []);

  // From a tee time: who was on it, so they can be ticked in or out.
  const { teeTime } = useLocalSearchParams<{ teeTime?: string }>();
  const [fromTee, setFromTee] = useState<{ label: string; mates: TeeMate[] } | null>(null);
  const setClub = course.setClub;
  useEffect(() => {
    const id = Number.parseInt(String(teeTime ?? ""), 10);
    if (!Number.isFinite(id) || !userId) return;
    let live = true;
    void (async () => {
      try {
        const got = await teeTimeLineUp(id);
        if (!got || !live) return;
        const mates = got.mates.filter((m) => m.id !== userId);
        const clubName = got.invite.club?.name ?? got.invite.club_name ?? "your tee time";
        setFromTee({ label: `${clubName} · ${whenLabel(got.invite)}`, mates });
        setPlayers((ps) => [
          ...ps,
          ...mates
            .filter((m) => !ps.some((p) => p.memberId === m.id))
            .map((m) => ({ key: nextKey(), memberId: m.id, name: m.name, indexText: m.handicap != null ? String(m.handicap) : "", isMe: false })),
        ]);
        if (got.invite.club_id != null) {
          const club = await loadClub(got.invite.club_id);
          if (club && live) setClub(club);
        }
      } catch {
        // The tee time is a shortcut, not a requirement: set the round up by hand.
      }
    })();
    return () => {
      live = false;
    };
  }, [teeTime, userId, setClub]);

  const toggleMate = (m: TeeMate) =>
    setPlayers((ps) =>
      ps.some((p) => p.memberId === m.id)
        ? ps.filter((p) => p.memberId !== m.id)
        : [...ps, { key: nextKey(), memberId: m.id, name: m.name, indexText: m.handicap != null ? String(m.handicap) : "", isMe: false }]
    );

  // Me first, with the handicap from my profile if I've given one.
  useEffect(() => {
    if (!userId) return;
    void loadMyProfile(userId).then((me) => {
      const name = me ? [me.firstName, me.lastName].filter(Boolean).join(" ") || "You" : "You";
      setPlayers((ps) =>
        ps.some((p) => p.isMe)
          ? ps
          : [{ key: nextKey(), memberId: userId, name, indexText: me?.handicap != null ? String(me.handicap) : "", isMe: true }, ...ps]
      );
    });
  }, [userId]);

  const info = formatInfo(format);

  // Plays-off for every row, recomputed as anything above changes.
  const worked = useMemo(
    () =>
      players.map((p) => {
        const index = parseIndex(p.indexText);
        if (index == null) return null;
        const ch = courseHandicap(index, { slope, courseRating: rating, par });
        return { index, ...ch, playing: playingHandicap(ch.courseHandicap, info.allowance) };
      }),
    [players, slope, rating, par, info.allowance]
  );

  // A scramble team's handicap: WHS shares of each course handicap, summed
  // then rounded. Only once every player has an index and the team is full.
  const team = useMemo(() => {
    if (!scramble || players.length !== size || worked.some((w) => w == null)) return null;
    return scrambleHandicap(worked.map((w) => w!.courseHandicap));
  }, [scramble, players.length, size, worked]);

  const problems: string[] = [];
  problems.push(...course.problems);
  if (players.length === 0) problems.push("Add at least one player");
  if (worked.some((w) => w == null)) problems.push("Every player needs a handicap index");
  if (players.some((p) => p.name.trim() === "")) problems.push("Every guest needs a name");
  if (format === "matchplay" && players.length !== 2) problems.push("Singles matchplay is two players");
  if (scramble && players.length !== size) problems.push(`A team of ${size} needs ${size} players`);
  if (foursomes && scoring === "matchplay" && players.length !== 4) problems.push("A foursomes match is four players: two pairs");
  else if (foursomes && players.length !== 2 && players.length !== 4) problems.push("Foursomes is played in pairs: add two or four players");

  // Foursomes pairs: 1 & 2, then 3 & 4. Each plays off half its combined
  // course handicaps — once both have an index.
  const pairs = foursomes
    ? [0, 2]
        .filter((i) => i < players.length)
        .map((i) => {
          const ws = [worked[i], worked[i + 1]];
          return { first: i, handicap: ws.every((w) => w != null) && ws.length === 2 ? foursomesHandicap(ws.map((w) => w!.courseHandicap)) : null };
        })
    : [];
  const pairName = (i: number) =>
    players
      .slice(i, i + 2)
      .map((p) => p.name.trim().split(" ")[0])
      .join(" & ");

  const update = (key: string, change: Partial<DraftPlayer>) =>
    setPlayers((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  const remove = (key: string) => setPlayers((ps) => ps.filter((p) => p.key !== key));

  const openPals = async () => {
    setPicking(true);
    if (pals == null && userId) {
      try {
        setPals(await pinPalsToPlayWith(userId));
      } catch {
        setPals([]);
      }
    }
  };

  const addPal = (m: Member) => {
    setPlayers((ps) => [...ps, { key: nextKey(), memberId: m.id, name: m.name, indexText: m.handicap != null ? String(m.handicap) : "", isMe: false }]);
    setPicking(false);
  };

  const addGuest = () =>
    setPlayers((ps) => [...ps, { key: nextKey(), memberId: null, name: "", indexText: "", isMe: false }]);

  const startFoursomes = async () => {
    if (!club) return;
    const holeCard = course.holeCard();
    const asPlayer = (i: number) => ({
      memberId: players[i].memberId,
      name: players[i].name.trim(),
      handicapIndex: worked[i]!.index,
      courseHandicap: worked[i]!.courseHandicap,
      playingHandicap: playingHandicap(worked[i]!.courseHandicap, FOURSOMES_ALLOWANCE),
      estimated: worked[i]!.estimated,
    });
    const day = {
      title: `${scoring === "matchplay" ? "Foursomes match" : foursomesLabel(scoring)} · ${club.name}`,
      courseName: club.name,
      clubId: club.id,
      teeName: course.teeName.trim() || null,
      holes,
      courseRating: rating,
      slope,
      parTotal: par,
    };
    if (scoring === "matchplay") {
      const id = await createMatchDay(
        { ...day, teamNames: null },
        [{ format: "foursomes", teeTime: null, players: players.map((_, i) => ({ ...asPlayer(i), side: i < 2 ? 1 : 2 })) }],
        holeCard
      );
      router.replace({ pathname: "/live/day/[id]", params: { id: String(id), created: "1" } });
      return;
    }
    if (players.length === 2) {
      const id = await createLiveRound(
        {
          courseName: club.name,
          clubId: club.id,
          teeName: day.teeName,
          format: "foursomes",
          holes,
          courseRating: rating,
          slope,
          parTotal: par,
          allowance: FOURSOMES_ALLOWANCE,
          foursomes: { scoring, teamName: pairName(0), teamHandicap: pairs[0].handicap! },
        },
        [asPlayer(0), asPlayer(1)],
        holeCard
      );
      router.replace({ pathname: "/live/round/[id]", params: { id: String(id) } });
      return;
    }
    const id = await createScrambleDay(
      { ...day, size: 2, driveMinimum: null, foursomes: scoring },
      pairs.map((pr) => ({
        name: pairName(pr.first),
        teeTime: null,
        teamHandicap: pr.handicap!,
        players: [asPlayer(pr.first), asPlayer(pr.first + 1)],
      })),
      holeCard
    );
    router.replace({ pathname: "/live/day/[id]", params: { id: String(id), created: "1" } });
  };

  const start = async () => {
    if (!club || problems.length > 0) return;
    setSaving(true);
    if (foursomes) {
      try {
        await startFoursomes();
      } catch (e) {
        explainStartError(e, "Couldn't start the round");
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      const holeCard = course.holeCard();
      const id = await createLiveRound(
        {
          courseName: club.name,
          clubId: club.id,
          teeName: course.teeName.trim() || null,
          format,
          holes,
          courseRating: rating,
          slope,
          parTotal: par,
          allowance: scramble ? (size === 4 ? 0.25 : 0.35) : info.allowance,
          scramble: scramble && team ? { size, teamName: teamName.trim() || null, teamHandicap: team.team, driveMinimum } : undefined,
        },
        players.map((p, i) => ({
          memberId: p.memberId,
          name: p.name.trim(),
          handicapIndex: worked[i]!.index,
          courseHandicap: worked[i]!.courseHandicap,
          // In a scramble, each player's share of the team handicap.
          playingHandicap: scramble && team ? Math.round(team.shares[i]) : worked[i]!.playing,
          estimated: worked[i]!.estimated,
        })),
        holeCard
      );
      router.replace({ pathname: "/live/round/[id]", params: { id: String(id) } });
    } catch (e) {
      explainStartError(e, "Couldn't start the round");
    } finally {
      setSaving(false);
    }
  };

  if (!isOn("liveScoring")) {
    return <StateMessage size="screen" icon="podium-outline" title="Live scoring is on its way" />;
  }

  const added = new Set(players.map((p) => p.memberId).filter(Boolean));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {openGame ? (
          <Pressable
            style={[styles.card, styles.openGame]}
            onPress={() => router.replace(openGamePath(openGame) as Href)}
            accessibilityRole="button"
            accessibilityLabel="Open the game you're already in"
          >
            <Ionicons name="podium" size={22} color={colors.green700} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>You&apos;re already in a live game</Text>
              <Text style={styles.cardMeta}>
                {openGame.startedBy ? `${openGame.startedBy} started it` : "It's started"} at {openGame.courseName}. Open it — a second game can&apos;t be started with the same players.
              </Text>
            </View>
            <Text style={styles.link}>Open</Text>
          </Pressable>
        ) : null}

        <CourseSection setup={course} />

        <Section title="Format">
          <View style={styles.formats}>
            {LIVE_FORMATS.map((f) => {
              const on = format === f.id;
              return (
                <Pressable
                  key={f.id}
                  disabled={!f.available}
                  onPress={() => setFormat(f.id)}
                  style={[styles.format, on && styles.formatOn, !f.available && styles.formatOff]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !f.available }}
                >
                  <Text style={[styles.formatLabel, !f.available && styles.muted]}>{f.label}</Text>
                  <Text style={[styles.formatBlurb, on && styles.formatBlurbOn]}>{f.available ? f.blurb : f.matchDay ? "Use a match day" : "Coming soon"}</Text>
                </Pressable>
              );
            })}
          </View>
          {scramble || foursomes ? null : <Text style={styles.hint}>Handicap allowance: {Math.round(info.allowance * 100)}%</Text>}
        </Section>

        {foursomes ? (
          <Section
            title="Foursomes scoring"
            hint="Scotch foursomes: two players share one ball and take alternate shots. One partner tees off on the odd holes, the other on the even holes. Each pair plays off half its combined course handicaps."
          >
            <View style={styles.formats}>
              {(
                [
                  { id: "stableford", label: "Stableford", blurb: "Pairs on points" },
                  { id: "stroke", label: "Stroke play", blurb: "Pairs on net score" },
                  { id: "matchplay", label: "Matchplay", blurb: "Pair v pair" },
                ] as const
              ).map((o) => {
                const on = scoring === o.id;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => setScoring(o.id)}
                    style={[styles.format, on && styles.formatOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                  >
                    <Text style={styles.formatLabel}>{o.label}</Text>
                    <Text style={[styles.formatBlurb, on && styles.formatBlurbOn]}>{o.blurb}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>
              {scoring === "matchplay" ? "Add four players: 1 & 2 play 3 & 4." : "Add two players for one pair, or four for two pairs (1 & 2, 3 & 4) on one leaderboard."}
            </Text>
          </Section>
        ) : null}

        {scramble ? (
          <>
            <Pressable
              onPress={() => router.push("/live/day/scramble")}
              style={({ pressed }) => [styles.dayLink, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <Ionicons name="people" size={20} color={colors.gold400} />
              <View style={{ flex: 1 }}>
                <Text style={styles.dayLinkTitle}>Several teams?</Text>
                <Text style={styles.dayLinkBody}>Start a scramble day — every team on one live leaderboard.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.gold400} />
            </Pressable>
            <Section title="Team name" hint="Optional. Shown on the leaderboard.">
              <TextInput
                value={teamName}
                onChangeText={setTeamName}
                placeholder="e.g. The Bandits"
                placeholderTextColor={colors.ink500}
                style={styles.input}
                maxLength={30}
                accessibilityLabel="Team name"
              />
            </Section>
            <ScrambleOptions size={size} onSize={setSize} driveMinimum={driveMinimum} onDriveMinimum={setDriveMinimum} holes={holes} />
          </>
        ) : null}

        {fromTee && fromTee.mates.length > 0 ? (
          <Section title="From your tee time" hint={`${fromTee.label}. Everyone's in — untick anyone who isn't scoring with you.`}>
            <View style={styles.players}>
              {fromTee.mates.map((m, i) => {
                const on = players.some((p) => p.memberId === m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => toggleMate(m)}
                    style={[styles.player, i > 0 && styles.playerDivider]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={m.name}
                  >
                    <Ionicons name={on ? "checkbox" : "square-outline"} size={24} color={on ? colors.green700 : colors.ink500} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.playerName} numberOfLines={1}>{m.name}</Text>
                      <Text style={styles.playerMeta}>{on ? "Playing in this round" : "Left out"}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ) : null}

        <Section title="Players" hint="Enter each player's handicap index. Plays-off is worked out for this course.">
          <View style={styles.players}>
            {players.map((p, i) => {
              const w = worked[i];
              return (
                <View key={p.key}>
                {foursomes && i % 2 === 0 ? (
                  <View style={[styles.pairHead, i > 0 && styles.playerDivider]}>
                    <Text style={styles.pairHeadText}>Pair {i / 2 + 1}</Text>
                    <Text style={styles.pairHeadText}>
                      {pairs[i / 2]?.handicap != null ? `Plays off ${pairs[i / 2].handicap}` : ""}
                    </Text>
                  </View>
                ) : null}
                <View style={[styles.player, i > 0 && !(foursomes && i % 2 === 0) && styles.playerDivider]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    {p.memberId ? (
                      <Text style={styles.playerName} numberOfLines={1}>
                        {p.isMe ? `${p.name} (you)` : p.name}
                      </Text>
                    ) : (
                      <TextInput
                        value={p.name}
                        onChangeText={(name) => update(p.key, { name })}
                        placeholder="Guest's name"
                        placeholderTextColor={colors.ink500}
                        style={styles.nameInput}
                        maxLength={60}
                        accessibilityLabel="Guest's name"
                      />
                    )}
                    <Text style={styles.playerMeta}>
                      {w == null
                        ? "Enter an index, e.g. 14.2 or +1.5"
                        : `Course handicap ${w.courseHandicap}${w.estimated ? " (no slope, estimated)" : ""}`}
                    </Text>
                  </View>
                  <TextInput
                    value={p.indexText}
                    onChangeText={(indexText) => update(p.key, { indexText })}
                    placeholder="Index"
                    placeholderTextColor={colors.ink500}
                    keyboardType="numbers-and-punctuation"
                    style={styles.indexInput}
                    maxLength={5}
                    accessibilityLabel={`${p.name || "Guest"}'s handicap index`}
                  />
                  <View style={styles.playsOff}>
                    <Text style={styles.playsOffNumber}>{scramble ? (team ? team.shares[i] : "–") : foursomes ? (w ? w.courseHandicap : "–") : w ? w.playing : "–"}</Text>
                    <Text style={styles.playsOffLabel}>{scramble ? "share" : foursomes ? "course" : "plays off"}</Text>
                  </View>
                  {!p.isMe ? (
                    <Pressable onPress={() => remove(p.key)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${p.name || "guest"}`}>
                      <Ionicons name="close-circle" size={22} color={colors.ink500} />
                    </Pressable>
                  ) : null}
                </View>
                </View>
              );
            })}

            {scramble ? (
              <View style={[styles.teamRow, styles.playerDivider]}>
                <Text style={styles.playerName}>Team plays off</Text>
                <Text style={styles.teamNumber}>{team ? team.team : "–"}</Text>
              </View>
            ) : null}

            {players.length < (scramble ? size : foursomes ? 4 : 8) ? (
              <View style={[styles.addRow, players.length > 0 && styles.playerDivider]}>
                <Pressable onPress={() => void openPals()} style={styles.addButton} accessibilityRole="button">
                  <Ionicons name="person-add-outline" size={18} color={colors.green700} />
                  <Text style={styles.link}>Add a PinPal</Text>
                </Pressable>
                <Pressable onPress={addGuest} style={styles.addButton} accessibilityRole="button">
                  <Ionicons name="add" size={20} color={colors.green700} />
                  <Text style={styles.link}>Add a guest</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {picking ? (
            <View style={styles.picker}>
              {pals == null ? (
                <ActivityIndicator color={colors.green700} />
              ) : pals.filter((m) => !added.has(m.id)).length === 0 ? (
                <Text style={styles.hint}>No more PinPals to add. Add them as a guest instead.</Text>
              ) : (
                pals
                  .filter((m) => !added.has(m.id))
                  .map((m) => (
                    <Pressable key={m.id} onPress={() => addPal(m)} style={styles.pickRow} accessibilityRole="button">
                      <Text style={styles.playerName}>{m.name}</Text>
                      <Text style={styles.playerMeta}>{m.handicap != null ? `Index ${m.handicap}` : "Handicap not shared"}</Text>
                    </Pressable>
                  ))
              )}
              <Pressable onPress={() => setPicking(false)} hitSlop={8}>
                <Text style={[styles.link, { textAlign: "center", marginTop: spacing.sm }]}>Close</Text>
              </Pressable>
            </View>
          ) : null}
        </Section>

        {problems.length > 0 && club ? <Text style={styles.problem}>{problems[0]}</Text> : null}

        <Pressable
          onPress={() => void start()}
          disabled={problems.length > 0 || saving}
          style={({ pressed }) => [styles.start, (problems.length > 0 || saving) && styles.startOff, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: problems.length > 0 || saving }}
        >
          {saving ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.startLabel}>Tee off</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  cardMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, marginTop: 2 },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  openGame: { borderColor: colors.green700, backgroundColor: colors.green100 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  field: { flexBasis: "22%", flexGrow: 1, gap: 4 },
  fieldWide: { flexBasis: "100%" },
  fieldLabel: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink500 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm + 4,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  formats: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  format: {
    flexBasis: "31%",
    flexGrow: 1,
    minHeight: 60,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: spacing.sm + 2,
    justifyContent: "center",
    gap: 2,
  },
  formatOn: { borderWidth: 2, borderColor: colors.green700, backgroundColor: colors.green100 },
  formatOff: { backgroundColor: colors.surfaceTint },
  formatLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  formatBlurb: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  formatBlurbOn: { color: colors.green800 },
  muted: { color: colors.ink500 },
  players: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg },
  player: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  playerDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  playerName: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  playerMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  nameInput: {
    minHeight: 40,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.ink900,
  },
  indexInput: {
    width: 64,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    textAlign: "center",
    fontFamily: fonts.bodySemi,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.cream50,
  },
  playsOff: { width: 52, alignItems: "center" },
  playsOffNumber: { fontFamily: fonts.display, fontSize: 22, color: colors.navy900 },
  playsOffLabel: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase", color: colors.ink500 },
  addRow: { flexDirection: "row", justifyContent: "space-around" },
  addButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingHorizontal: spacing.sm },
  picker: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pickRow: { minHeight: 48, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: colors.line },
  dayLink: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.gold500 },
  dayLinkTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  dayLinkBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.cream100, marginTop: 2 },
  teamRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, backgroundColor: colors.cream100 },
  teamNumber: { fontFamily: fonts.display, fontSize: 26, color: colors.navy900 },
  pairHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 6, backgroundColor: colors.cream100 },
  pairHeadText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: colors.navy900 },
  problem: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, textAlign: "center" },
  start: {
    minHeight: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
  },
  startOff: { backgroundColor: colors.ink500 },
  startLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});
