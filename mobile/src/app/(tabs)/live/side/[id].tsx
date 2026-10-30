import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GoldButton } from "@/components/gold-button";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAgeAccess } from "@/lib/age";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadLiveRound, subscribeToLiveRound, type LiveRoundData } from "@/lib/live-rounds";
import {
  MAX_STAKE_CENTS,
  NO_EXTRA,
  NO_STAKES,
  STAKE_PICKS,
  euros,
  exposure,
  matchLine,
  parseEuros,
  pointsLabel,
  settle,
  sideGamesBlocked,
  sixesPairs,
  waitingToAgree,
  type SideGame,
  type SideGamesConfig,
  type SideMode,
} from "@/lib/side-games";
import { agreeToSideGames, loadSideGames, markSidePaid, paidKey, pickForWolf, saveSideGames, type SideGamesState } from "@/lib/side-games-data";
import { betLine, extraExposure, sideSummary, wolfOn, wolfToPick, type SideSummary } from "@/lib/side-games-extra";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Side games (0196, claude/side-games.md; approved mock-ups "PinPals
 * Engagement Features", row 1).
 *
 *  - SET UP (whoever started the round, while it's live): Best Front 9,
 *    Back 9, Overall; Sixes individually or in rotating pairs; playing for
 *    bragging rights, points or money with an amount they type in.
 *  - LIVE: each game's standings or match, and "if it ended now".
 *  - SETTLE UP: who won what, each player's total and the fewest payments,
 *    ticked off as paid. PinPals never holds the money.
 *
 * Money needs every member playing to say "I'm in" on their own phone, and
 * isn't offered at all to a member under 18 (the server refuses it too).
 */
export default function SideGamesScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const roundId = Number(params.id);
  const { session } = useAuth();
  const me = session?.user?.id ?? null;
  const { access } = useAgeAccess();
  const minor = access.band !== "adult" && access.band !== "unknown";

  const [data, setData] = useState<LiveRoundData | null>(null);
  const [side, setSide] = useState<SideGamesState | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(roundId)) return;
    try {
      setFailed(false);
      const [d, s] = await Promise.all([loadLiveRound(roundId), loadSideGames(roundId)]);
      setData(d);
      setSide(s);
    } catch {
      setFailed(true);
    }
  }, [roundId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return subscribeToLiveRound(roundId, () => void load());
    }, [load, roundId])
  );

  if (!isOn("sideGames")) {
    return <StateMessage size="screen" icon="trophy-outline" title="Side games are on their way" body="Soon you'll be able to run Best Front 9, Back 9 and Sixes alongside your round." />;
  }
  if (failed) return <LoadError size="screen" what="the side games" onRetry={() => void load()} />;
  if (!data || !side) return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;

  const { round } = data;
  const players = [...data.players].sort((a, b) => a.position - b.position);
  const starter = me != null && round.createdBy === me;
  const blocked = sideGamesBlocked(round, players.length);
  const live = round.status === "live";

  if (!side.config || editing) {
    if (!starter || blocked) {
      return (
        <StateMessage
          size="screen"
          icon="trophy-outline"
          title="No side games on this round"
          body={blocked && starter ? blocked : "Whoever started the round can add side games while it's being played."}
        />
      );
    }
    return (
      <SetUp
        roundId={roundId}
        initial={side.config}
        playerNames={players.map((p) => p.name)}
        playerIds={players.map((p) => p.id)}
        allowMoney={!minor}
        onSaved={() => {
          setEditing(false);
          void load();
        }}
        onCancel={side.config ? () => setEditing(false) : null}
      />
    );
  }

  return (
    <Standings
      data={data}
      side={side}
      me={me}
      starter={starter}
      minor={minor}
      onEdit={live && starter ? () => setEditing(true) : null}
      reload={() => void load()}
    />
  );
}

// ---------------------------------------------------------------------------
// Set-up
// ---------------------------------------------------------------------------

function SetUp({
  roundId,
  initial,
  playerNames,
  playerIds,
  allowMoney,
  onSaved,
  onCancel,
}: {
  roundId: number;
  initial: SideGamesConfig | null;
  playerNames: string[];
  playerIds: number[];
  allowMoney: boolean;
  onSaved: () => void;
  onCancel: (() => void) | null;
}) {
  const four = playerIds.length === 4;
  const [front, setFront] = useState(initial?.bestFront ?? true);
  const [back, setBack] = useState(initial?.bestBack ?? true);
  const [overall, setOverall] = useState(initial?.bestOverall ?? false);
  const [sixesOn, setSixesOn] = useState(initial ? initial.sixes != null : true);
  const [pairs, setPairs] = useState(initial ? initial.sixes === "pairs" : four);
  const [mode, setMode] = useState<SideMode>(initial?.mode && (allowMoney || initial.mode !== "money") ? initial.mode : "pride");
  const startStake = initial?.mode === "money" ? Math.max(initial.stakes.front, initial.stakes.back, initial.stakes.overall, initial.stakes.sixes) : 500;
  const [amount, setAmount] = useState(euros(startStake).replace("€", ""));
  const [perGame, setPerGame] = useState(
    initial?.mode === "money" &&
      new Set([initial.bestFront && initial.stakes.front, initial.bestBack && initial.stakes.back, initial.bestOverall && initial.stakes.overall, initial.sixes && initial.stakes.sixes].filter((x) => x !== false && x != null)).size > 1
  );
  const [each, setEach] = useState({
    front: euros(initial?.stakes.front || startStake).replace("€", ""),
    back: euros(initial?.stakes.back || startStake).replace("€", ""),
    overall: euros(initial?.stakes.overall || startStake).replace("€", ""),
    sixes: euros(initial?.stakes.sixes || startStake).replace("€", ""),
  });
  const [busy, setBusy] = useState(false);
  // Skins, Wolf and Nassau (0201).
  const x0 = initial?.extra ?? NO_EXTRA;
  const [skinsOn, setSkinsOn] = useState(x0.skins != null);
  const [skinsMode, setSkinsMode] = useState<"carry" | "void">(x0.skins ?? "carry");
  const [wolfOnGame, setWolfOnGame] = useState(x0.wolf && four);
  const [nassauOn, setNassauOn] = useState(x0.nassau);
  const [xAmounts, setXAmounts] = useState({
    skins: euros(x0.stakes.skins || 100).replace("€", ""),
    wolf: euros(x0.stakes.wolf || 100).replace("€", ""),
    nassau: euros(x0.stakes.nassau || 500).replace("€", ""),
  });

  useEffect(() => {
    if (!four) {
      setPairs(false);
      setWolfOnGame(false);
    }
  }, [four]);

  const one = parseEuros(amount);
  const stakes = perGame
    ? { front: parseEuros(each.front), back: parseEuros(each.back), overall: parseEuros(each.overall), sixes: parseEuros(each.sixes) }
    : { front: one, back: one, overall: one, sixes: one };
  const oldOn = front || back || overall || sixesOn;
  const xStakes = { skins: parseEuros(xAmounts.skins), wolf: parseEuros(xAmounts.wolf), nassau: parseEuros(xAmounts.nassau) };
  const xOk = mode !== "money" || ((!skinsOn || xStakes.skins != null) && (!wolfOnGame || xStakes.wolf != null) && (!nassauOn || xStakes.nassau != null));
  const stakesOk = (mode !== "money" || !oldOn || Object.values(stakes).every((v) => v != null)) && xOk;
  const config: SideGamesConfig = {
    bestFront: front,
    bestBack: back,
    bestOverall: overall,
    sixes: sixesOn ? (pairs && four ? "pairs" : "individual") : null,
    mode,
    stakes: mode === "money" && stakesOk && oldOn ? (stakes as SideGamesConfig["stakes"]) : { ...NO_STAKES },
    extra: {
      skins: skinsOn ? skinsMode : null,
      wolf: wolfOnGame && four,
      nassau: nassauOn,
      stakes:
        mode === "money" && xOk
          ? { skins: skinsOn ? (xStakes.skins ?? 0) : 0, wolf: wolfOnGame ? (xStakes.wolf ?? 0) : 0, nassau: nassauOn ? (xStakes.nassau ?? 0) : 0 }
          : { ...NO_EXTRA.stakes },
    },
  };
  const anyGame = oldOn || skinsOn || (wolfOnGame && four) || nassauOn;
  const base = exposure(config, playerIds.length);
  const more = extraExposure({ skins: skinsOn, wolf: wolfOnGame && four, nassau: nassauOn, stakes: config.extra!.stakes }, playerIds.length);
  const risk = { maxLoss: base.maxLoss + more.maxLoss, maxWin: base.maxWin + more.maxWin };
  const rotations = sixesPairs(playerIds);
  const nameOf = (id: number) => playerNames[playerIds.indexOf(id)]?.split(" ")[0] ?? "";

  const step = (by: number) => {
    const now = parseEuros(amount) ?? 0;
    const next = Math.max(0, Math.min(MAX_STAKE_CENTS, now + by));
    setAmount(euros(next).replace("€", ""));
  };

  const save = async () => {
    if (!anyGame) {
      Alert.alert("Pick a game", "Switch on at least one side game.");
      return;
    }
    if (mode === "money" && (!stakesOk || [...Object.values(config.stakes), ...Object.values(config.extra!.stakes)].every((v) => v === 0))) {
      Alert.alert("Put in an amount", "Type how much each game is worth — up to €500.");
      return;
    }
    setBusy(true);
    try {
      await saveSideGames(roundId, config);
      onSaved();
    } catch (e) {
      Alert.alert("Couldn't save the side games", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = () =>
    Alert.alert("Turn off side games?", "The games and any agreements to them go. Scores aren't touched.", [
      { text: "Keep them", style: "cancel" },
      {
        text: "Turn off",
        style: "destructive",
        onPress: async () => {
          try {
            await saveSideGames(roundId, null);
            onSaved();
          } catch (e) {
            Alert.alert("Couldn't turn them off", e instanceof Error ? e.message : "Please try again.");
          }
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.banner}>
        <Text style={styles.bannerEyebrow}>RUNS ALONGSIDE YOUR SCORE</Text>
        <Text style={styles.bannerTitle}>Pick your side games</Text>
        <Text style={styles.bannerBody}>Scored on Stableford points from everyone&apos;s own handicap, so the whole fourball has a chance.</Text>
      </View>

      <GameSwitch title="Best Front 9" sub="Most points on holes 1–9" value={front} onChange={setFront} />
      <GameSwitch title="Best Back 9" sub="Most points on holes 10–18" value={back} onChange={setBack} />
      <GameSwitch title="Best Overall" sub="The full 18 — makes it a three-way Nassau" value={overall} onChange={setOverall} />

      <View style={[styles.card, sixesOn && styles.cardGold]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.gameTitle}>Sixes</Text>
            <Text style={styles.gameSub}>Three 6-hole games — three chances to win</Text>
          </View>
          <Switch value={sixesOn} onValueChange={setSixesOn} trackColor={{ true: colors.green700, false: "#cfc6b4" }} accessibilityLabel="Sixes" />
        </View>
        {sixesOn ? (
          <>
            <Segment
              options={[
                { id: "individual", label: "Individual" },
                { id: "pairs", label: "Pairs", disabled: !four },
              ]}
              value={pairs && four ? "pairs" : "individual"}
              onChange={(v) => setPairs(v === "pairs")}
            />
            {pairs && four ? (
              <>
                <Text style={styles.hint}>Partners rotate so you play with everyone once. Better ball of each pair, hole by hole.</Text>
                {rotations.map(([a, b], i) => (
                  <View key={i} style={styles.mini}>
                    <Text style={styles.miniHoles}>{`${i * 6 + 1}–${i * 6 + 6}`}</Text>
                    <Text style={styles.miniText}>
                      <Text style={{ fontFamily: fonts.bodyBold }}>{`${nameOf(a[0])} & ${nameOf(a[1])}`}</Text>
                      {` v ${nameOf(b[0])} & ${nameOf(b[1])}`}
                    </Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.hint}>
                {four ? "Most points on holes 1–6, 7–12 and 13–18." : "Most points on holes 1–6, 7–12 and 13–18. Pairs needs exactly four players."}
              </Text>
            )}
          </>
        ) : null}
      </View>

      <View style={[styles.card, skinsOn && styles.cardGold]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.gameTitle}>Skins</Text>
            <Text style={styles.gameSub}>Win a hole outright on points and it&apos;s your skin</Text>
          </View>
          <Switch value={skinsOn} onValueChange={setSkinsOn} trackColor={{ true: colors.green700, false: "#cfc6b4" }} accessibilityLabel="Skins" />
        </View>
        {skinsOn ? (
          <>
            <Segment
              options={[
                { id: "carry", label: "Ties carry over" },
                { id: "void", label: "Ties void" },
              ]}
              value={skinsMode}
              onChange={(v) => setSkinsMode(v === "void" ? "void" : "carry")}
            />
            <Text style={styles.hint}>{skinsMode === "carry" ? "A tied hole's skin goes on to the next — they can build up." : "A tied hole's skin is lost."}</Text>
          </>
        ) : null}
      </View>

      <View style={[styles.card, wolfOnGame && four && styles.cardGold]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.gameTitle}>Wolf</Text>
            <Text style={styles.gameSub}>{four ? "Each hole's Wolf picks a partner after the drives — or goes it alone for double" : "Wolf needs exactly four players"}</Text>
          </View>
          <Switch value={wolfOnGame && four} onValueChange={setWolfOnGame} disabled={!four} trackColor={{ true: colors.green700, false: "#cfc6b4" }} accessibilityLabel="Wolf" />
        </View>
        {wolfOnGame && four ? <Text style={styles.hint}>{`Wolf order: ${playerIds.map((id) => nameOf(id)).join(", ")} — round and round. Better ball, two v two; Lone Wolf is one v three.`}</Text> : null}
      </View>

      <View style={[styles.card, nassauOn && styles.cardGold]}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.gameTitle}>Nassau</Text>
            <Text style={styles.gameSub}>{playerIds.length > 2 ? "Each of you against each other: front 9, back 9 and the 18" : "Front 9, back 9 and the 18 — three bets"}</Text>
          </View>
          <Switch value={nassauOn} onValueChange={setNassauOn} trackColor={{ true: colors.green700, false: "#cfc6b4" }} accessibilityLabel="Nassau" />
        </View>
        {nassauOn ? <Text style={styles.hint}>Go two down in a bet and a press starts by itself — a new bet to the end of that nine.</Text> : null}
      </View>

      <Text style={styles.label}>PLAYING FOR</Text>
      <Segment
        options={[
          { id: "pride", label: "Bragging" },
          { id: "points", label: "Points" },
          ...(allowMoney ? [{ id: "money", label: "Money" }] : []),
        ]}
        value={mode}
        onChange={(v) => setMode(v as SideMode)}
      />

      {mode === "money" ? (
        <View style={styles.card}>
          {oldOn ? <Text style={styles.gameTitle}>Amount per game</Text> : null}
          {!oldOn ? null : !perGame ? (
            <>
              <View style={styles.stepper}>
                <Pressable onPress={() => step(-100)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="Less">
                  <Ionicons name="remove" size={24} color={colors.navy900} />
                </Pressable>
                <View style={styles.amountBox}>
                  <Text style={styles.euro}>€</Text>
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    style={styles.amountInput}
                    accessibilityLabel="Amount per game in euro"
                    maxLength={6}
                    selectTextOnFocus
                  />
                </View>
                <Pressable onPress={() => step(100)} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel="More">
                  <Ionicons name="add" size={24} color={colors.navy900} />
                </Pressable>
              </View>
              <View style={styles.picks}>
                {STAKE_PICKS.map((c) => {
                  const on = one === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setAmount(euros(c).replace("€", ""))}
                      style={[styles.pick, on && styles.pickOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.pickText, on && { color: colors.cream50 }]}>{euros(c)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {one == null ? <Text style={styles.warn}>Type an amount up to €500, like 5 or 2.50.</Text> : null}
            </>
          ) : (
            <View style={{ gap: 8 }}>
              {([
                ["front", "Best Front 9", front],
                ["back", "Best Back 9", back],
                ["overall", "Best Overall", overall],
                ["sixes", pairs && four ? "Sixes · each match" : "Sixes · each six", sixesOn],
              ] as const)
                .filter(([, , on]) => on)
                .map(([k, label]) => (
                  <View key={k} style={styles.eachRow}>
                    <Text style={styles.eachLabel}>{label}</Text>
                    <View style={styles.eachBox}>
                      <Text style={styles.eachEuro}>€</Text>
                      <TextInput
                        value={each[k]}
                        onChangeText={(t) => setEach((prev) => ({ ...prev, [k]: t }))}
                        keyboardType="decimal-pad"
                        style={styles.eachInput}
                        accessibilityLabel={`${label} amount in euro`}
                        maxLength={6}
                        selectTextOnFocus
                      />
                    </View>
                  </View>
                ))}
            </View>
          )}
          {oldOn ? (
            <Pressable onPress={() => setPerGame((v) => !v)} accessibilityRole="button" style={{ paddingVertical: 6 }}>
              <Text style={styles.link}>{perGame ? "Same amount for every game" : "Set a different amount per game"}</Text>
            </Pressable>
          ) : null}
          {skinsOn || (wolfOnGame && four) || nassauOn ? (
            <View style={{ gap: 8 }}>
              {([
                ["skins", "A skin", skinsOn],
                ["wolf", "A Wolf point", wolfOnGame && four],
                ["nassau", "A Nassau bet", nassauOn],
              ] as const)
                .filter(([, , on]) => on)
                .map(([k, label]) => (
                  <View key={k} style={styles.eachRow}>
                    <Text style={styles.eachLabel}>{label}</Text>
                    <View style={styles.eachBox}>
                      <Text style={styles.eachEuro}>€</Text>
                      <TextInput
                        value={xAmounts[k]}
                        onChangeText={(t) => setXAmounts((prev) => ({ ...prev, [k]: t }))}
                        keyboardType="decimal-pad"
                        style={styles.eachInput}
                        accessibilityLabel={`${label} in euro`}
                        maxLength={6}
                        selectTextOnFocus
                      />
                    </View>
                  </View>
                ))}
              {!xOk ? <Text style={styles.warn}>Type each amount up to €500, like 1 or 0.50.</Text> : null}
            </View>
          ) : null}
          {stakesOk ? (
            <View style={styles.risk}>
              <Text style={styles.riskText}>
                Most you can lose today: <Text style={{ fontFamily: fonts.bodyBold }}>{euros(risk.maxLoss)}</Text> · most you can win:{" "}
                <Text style={{ fontFamily: fonts.bodyBold }}>{euros(risk.maxWin)}</Text>
              </Text>
            </View>
          ) : null}
          <Text style={styles.hint}>Everyone on PinPals in the round says &quot;I&apos;m in&quot; on their own phone. PinPals only keeps the tally — you settle by Revolut or cash.</Text>
        </View>
      ) : null}

      <GoldButton label={initial ? "Save changes" : "Start side games"} onPress={() => void save()} busy={busy} disabled={!anyGame} />
      {onCancel ? (
        <Pressable onPress={onCancel} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      ) : null}
      {initial ? (
        <Pressable onPress={turnOff} style={styles.secondary} accessibilityRole="button">
          <Text style={[styles.secondaryText, { color: colors.red600 }]}>Turn off side games</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function GameSwitch({ title, sub, value, onChange }: { title: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={[styles.card, styles.switchRow]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.gameTitle}>{title}</Text>
        <Text style={styles.gameSub}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.green700, false: "#cfc6b4" }} accessibilityLabel={title} />
    </View>
  );
}

function Segment({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string; disabled?: boolean }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => !o.disabled && onChange(o.id)}
            disabled={o.disabled}
            style={[styles.segBtn, on && styles.segOn, o.disabled && { opacity: 0.4 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!o.disabled }}
          >
            <Text style={[styles.segText, on && { color: colors.cream50 }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Where they stand, and settling up
// ---------------------------------------------------------------------------

function Standings({
  data,
  side,
  me,
  starter,
  minor,
  onEdit,
  reload,
}: {
  data: LiveRoundData;
  side: SideGamesState;
  me: string | null;
  starter: boolean;
  minor: boolean;
  onEdit: (() => void) | null;
  reload: () => void;
}) {
  const config = side.config!;
  const { round } = data;
  const live = round.status === "live";
  const players = useMemo(() => [...data.players].sort((a, b) => a.position - b.position), [data.players]);
  const ids = players.map((p) => p.id);
  const summaryNow = useMemo(() => sideSummary(config, data.card, players, data.scores, side.wolfPicks, true), [config, data.card, players, data.scores, side.wolfPicks]);
  const games = summaryNow.games;
  const nameOf = (id: number) => {
    const p = players.find((x) => x.id === id);
    if (!p) return "";
    return p.memberId != null && p.memberId === me ? "You" : p.name.split(" ")[0]!;
  };
  const mine = players.find((p) => p.memberId != null && p.memberId === me) ?? null;
  const money = config.mode === "money";
  const waiting = money ? waitingToAgree(players.map((p) => p.memberId), side.agreed) : [];
  const allIn = waiting.length === 0;
  const iNeedToAgree = money && me != null && waiting.includes(me);
  const [busy, setBusy] = useState<string | null>(null);

  const allFinal = summaryNow.allFinal;
  const settled = !live || allFinal;
  const final = sideSummary(config, data.card, players, data.scores, side.wolfPicks, false);
  const bal = settled ? final.money : summaryNow.money;
  const payments = settle(final.money);
  const pts = summaryNow.points;
  const [picking, setPicking] = useState(false);
  const pick = async (hole: number, partner: number | null) => {
    setPicking(true);
    try {
      await pickForWolf(round.id, hole, partner);
      reload();
    } catch (e) {
      Alert.alert("Couldn't save the Wolf's pick", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPicking(false);
    }
  };

  const agree = async (yes: boolean) => {
    setBusy("agree");
    try {
      await agreeToSideGames(round.id, yes);
      reload();
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const tick = async (from: number, to: number, cents: number, paid: boolean) => {
    setBusy(paidKey(from, to));
    try {
      await markSidePaid(round.id, from, to, cents, paid);
      reload();
    } catch (e) {
      Alert.alert("Couldn't save that", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const remind = (from: number, to: number, cents: number) => {
    const payer = players.find((p) => p.id === from);
    const toName = nameOf(to) === "You" ? "me" : nameOf(to);
    void Share.share({
      message: `${payer?.name.split(" ")[0] ?? "Hi"}, side games at ${round.courseName}: ${euros(cents)} to ${toName}. Revolut or cash at the club — whatever suits. Settled up on PinPals.`,
    });
  };

  const shareResults = () => {
    const lines = [...games.map((g) => `${g.label}: ${winnerLine(g, nameOf)}`), ...extraLines(summaryNow, nameOf)];
    const totals = money
      ? players.map((p) => `${p.name.split(" ")[0]} ${euros(bal.get(p.id) ?? 0, true)}`).join(" · ")
      : config.mode === "points"
        ? players.map((p) => `${p.name.split(" ")[0]} ${pointsLabel(pts.get(p.id) ?? 0)}`).join(" · ")
        : "";
    void Share.share({ message: [`Side games at ${round.courseName}`, ...lines, totals].filter(Boolean).join("\n") });
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.banner}>
        <Text style={styles.bannerEyebrow}>{settled ? "ROUND FINISHED" : "SIDE GAMES · LIVE"}</Text>
        <Text style={styles.bannerTitle}>{settled ? "Settle up" : round.courseName}</Text>
        <Text style={styles.bannerBody}>{modeLine(config)}</Text>
        {onEdit ? (
          <Pressable onPress={onEdit} style={styles.edit} accessibilityRole="button" accessibilityLabel="Change the side games">
            <Ionicons name="create-outline" size={16} color={colors.gold400} />
            <Text style={styles.editText}>Change</Text>
          </Pressable>
        ) : null}
      </View>

      {money && !allIn ? (
        <View style={[styles.card, styles.cardGold]}>
          <Text style={styles.gameTitle}>{iNeedToAgree ? `Are you in for ${stakeLine(config)}?` : "Waiting for everyone to say they're in"}</Text>
          <Text style={styles.gameSub}>
            {iNeedToAgree
              ? `Most you can lose: ${euros(exposure(config, players.length).maxLoss + extraExposure({ skins: config.extra?.skins != null, wolf: !!config.extra?.wolf, nassau: !!config.extra?.nassau, stakes: (config.extra ?? NO_EXTRA).stakes }, players.length).maxLoss)}. Until everyone's in, the games are played for bragging rights.`
              : `Still to say: ${players.filter((p) => p.memberId && waiting.includes(p.memberId)).map((p) => p.name.split(" ")[0]).join(", ")}. Until then it's for bragging rights.`}
          </Text>
          {iNeedToAgree && !minor ? (
            <GoldButton label="I'm in" onPress={() => void agree(true)} busy={busy === "agree"} />
          ) : null}
        </View>
      ) : null}

      {money && allIn && mine && !settled ? (
        <View style={styles.youNow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.youEyebrow}>YOU RIGHT NOW</Text>
            <Text style={styles.youLine}>{games.length ? leadLine(games, mine.id) : "Skins, Wolf and Nassau as they stand"}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.youAmount}>{euros(bal.get(mine.id) ?? 0, true)}</Text>
            <Text style={styles.youSub}>if it ended now</Text>
          </View>
        </View>
      ) : null}

      {!settled && summaryNow.wolf ? (
        <WolfPickCard
          summary={summaryNow}
          ids={ids}
          nameOf={nameOf}
          busy={picking}
          canPick={starter || mine != null}
          onPick={(hole, partner) => void pick(hole, partner)}
        />
      ) : null}

      {!settled ? (
        <>
          {games.map((g) => (
            <GameCard key={g.id} game={g} nameOf={nameOf} mine={mine?.id ?? null} />
          ))}
          <ExtraCards summary={summaryNow} players={ids} nameOf={nameOf} mine={mine?.id ?? null} />
        </>
      ) : (
        <>
          <Text style={styles.label}>WHO WON WHAT</Text>
          <View style={styles.card}>
            {[...games.map((g) => ({ id: g.id, label: g.label, who: winnerLine(g, nameOf) })), ...extraResults(final, nameOf)].map((row, i, all) => (
              <View key={row.id} style={[styles.resultRow, i < all.length - 1 && styles.rowLine]}>
                <Text style={styles.resultGame}>{row.label}</Text>
                <Text style={styles.resultWho}>{row.who}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {money && allIn ? (
        <>
          <Text style={styles.label}>{settled ? "THE DAY'S TOTALS" : "AS IT STANDS"}</Text>
          <View style={styles.totals}>
            {players.map((p) => {
              const c = bal.get(p.id) ?? 0;
              return (
                <View key={p.id} style={[styles.total, c > 0 ? styles.totalUp : c < 0 ? styles.totalDown : null, p.id === mine?.id && styles.totalMine]}>
                  <Text style={styles.totalName} numberOfLines={1}>
                    {nameOf(p.id)}
                  </Text>
                  <Text style={styles.totalAmount}>{euros(c, true)}</Text>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {config.mode === "points" ? (
        <>
          <Text style={styles.label}>SIDE GAME POINTS</Text>
          <View style={styles.totals}>
            {[...players]
              .sort((a, b) => (pts.get(b.id) ?? 0) - (pts.get(a.id) ?? 0))
              .map((p) => (
                <View key={p.id} style={[styles.total, p.id === mine?.id && styles.totalMine]}>
                  <Text style={styles.totalName} numberOfLines={1}>
                    {nameOf(p.id)}
                  </Text>
                  <Text style={styles.totalAmount}>{pointsLabel(pts.get(p.id) ?? 0)}</Text>
                </View>
              ))}
          </View>
        </>
      ) : null}

      {money && allIn && settled ? (
        payments.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.gameTitle}>Nobody owes anybody</Text>
            <Text style={styles.gameSub}>Everyone finished level across the side games.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>{`${payments.length} PAYMENT${payments.length === 1 ? "" : "S"} SQUARE${payments.length === 1 ? "S" : ""} EVERYONE`}</Text>
            {payments.map((pay) => {
              const key = paidKey(pay.from, pay.to);
              const paid = side.paid.get(key) === pay.cents;
              const fromP = players.find((p) => p.id === pay.from);
              const toP = players.find((p) => p.id === pay.to);
              const canTick = starter || (me != null && (fromP?.memberId === me || toP?.memberId === me));
              const iReceive = toP?.memberId != null && toP.memberId === me;
              return (
                <View key={key} style={[styles.card, paid ? styles.cardPaid : styles.cardGold]}>
                  <View style={styles.payRow}>
                    <Text style={styles.payWho}>
                      <Text style={{ fontFamily: fonts.bodyBold }}>{nameOf(pay.from)}</Text>
                      {nameOf(pay.from) === "You" ? " pay " : " pays "}
                      <Text style={{ fontFamily: fonts.bodyBold }}>{nameOf(pay.to) === "You" ? "you" : nameOf(pay.to)}</Text>
                    </Text>
                    <Text style={styles.payAmount}>{euros(pay.cents)}</Text>
                  </View>
                  {paid ? (
                    <View style={styles.paidRow}>
                      <Ionicons name="checkmark-circle" size={20} color={colors.green700} />
                      <Text style={styles.paidText}>Paid</Text>
                      {canTick ? (
                        <Pressable onPress={() => void tick(pay.from, pay.to, pay.cents, false)} accessibilityRole="button" style={{ marginLeft: "auto" }}>
                          <Text style={styles.link}>Undo</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.payButtons}>
                      {iReceive && fromP?.memberId !== me ? (
                        <Pressable onPress={() => remind(pay.from, pay.to, pay.cents)} style={styles.navyBtn} accessibilityRole="button">
                          <Text style={styles.navyBtnText}>Send a reminder</Text>
                        </Pressable>
                      ) : null}
                      {canTick ? (
                        <Pressable
                          onPress={() => void tick(pay.from, pay.to, pay.cents, true)}
                          style={styles.outlineBtn}
                          disabled={busy === key}
                          accessibilityRole="button"
                        >
                          {busy === key ? <ActivityIndicator color={colors.navy900} /> : <Text style={styles.outlineBtnText}>Mark as paid</Text>}
                        </Pressable>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )
      ) : null}

      {money ? <Text style={styles.footnote}>Pay by Revolut or cash. PinPals never holds the money.</Text> : null}

      {settled ? <GoldButton label="Share results" onPress={shareResults} /> : null}
      {money && !iNeedToAgree && me && side.agreed.has(me) && !settled && players.some((p) => p.memberId === me) && round.createdBy !== me ? (
        <Pressable onPress={() => void agree(false)} style={styles.secondary} accessibilityRole="button">
          <Text style={styles.secondaryText}>I&apos;m out of the money games</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function GameCard({ game, nameOf, mine }: { game: SideGame; nameOf: (id: number) => string; mine: number | null }) {
  const chip =
    game.status === "final" ? (
      <Text style={[styles.chip, styles.chipFinal]}>FINAL</Text>
    ) : game.status === "live" ? (
      <Text style={[styles.chip, styles.chipLive]}>{game.match ? "LIVE" : `LIVE · THRU ${Math.max(0, ...game.standings.map((s) => s.thru)) + game.from - 1}`}</Text>
    ) : (
      <Text style={[styles.chip, styles.chipFinal]}>{`HOLES ${game.from}–${game.to}`}</Text>
    );
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={[styles.gameTitle, { flex: 1 }]}>{game.label}</Text>
        {chip}
      </View>
      {game.match ? (
        <View style={[styles.mini, game.status === "live" && styles.miniLive]}>
          <Text style={styles.miniText}>
            <Text style={{ fontFamily: fonts.bodyBold }}>{`${nameOf(game.match.sideA[0])} & ${nameOf(game.match.sideA[1])}`}</Text>
            {` v ${nameOf(game.match.sideB[0])} & ${nameOf(game.match.sideB[1])}`}
          </Text>
          <Text style={styles.miniResult}>{matchSummary(game, nameOf)}</Text>
        </View>
      ) : (
        game.standings.map((s, i) => {
          const leads = game.winners.includes(s.playerId);
          return (
            <View key={s.playerId} style={styles.standRow}>
              <View style={[styles.dot, { backgroundColor: leads ? colors.gold500 : "#cfc6b4" }]} />
              <Text style={[styles.standName, (leads || s.playerId === mine) && { fontFamily: fonts.bodyBold }]}>{nameOf(s.playerId)}</Text>
              <Text style={[styles.standPts, i > 0 && !leads && { fontFamily: fonts.bodySemi }]}>{`${s.points}${i === 0 ? " pts" : ""}`}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

/** Wolf (0201): whose turn it is, and their pick — a partner or Lone Wolf. */
function WolfPickCard({
  summary,
  ids,
  nameOf,
  busy,
  canPick,
  onPick,
}: {
  summary: SideSummary;
  ids: number[];
  nameOf: (id: number) => string;
  busy: boolean;
  canPick: boolean;
  onPick: (hole: number, partner: number | null) => void;
}) {
  const w = summary.wolf!;
  const next = wolfToPick(w.holes);
  if (!next) return null;
  const wolfName = nameOf(next.wolf);
  return (
    <View style={[styles.card, styles.cardGold]}>
      <Text style={styles.bannerEyebrowDark}>{`HOLE ${next.hole} · THE WOLF`}</Text>
      <Text style={styles.gameTitle}>{wolfName === "You" ? "You're the Wolf" : `${wolfName}'s the Wolf`}</Text>
      <Text style={styles.gameSub}>After the drives, take a partner — or go it alone for double.</Text>
      {canPick ? (
        <>
          {ids
            .filter((id) => id !== next.wolf)
            .map((id) => (
              <Pressable key={id} style={styles.outlineBtn} disabled={busy} onPress={() => onPick(next.hole, id)} accessibilityRole="button">
                <Text style={styles.outlineBtnText}>{`Take ${nameOf(id) === "You" ? "you" : nameOf(id)}`}</Text>
              </Pressable>
            ))}
          <Pressable style={styles.navyBtn} disabled={busy} onPress={() => onPick(next.hole, null)} accessibilityRole="button">
            {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.navyBtnText}>Lone Wolf — double or nothing</Text>}
          </Pressable>
        </>
      ) : null}
      <Text style={styles.hint}>{`Next Wolves: ${[1, 2, 3].map((k) => (next.hole + k <= 18 ? nameOf(wolfOn(next.hole + k, ids)) : null)).filter(Boolean).join(", ") || "that's the last"}`}</Text>
    </View>
  );
}

/** Skins, Wolf and Nassau while the round is on. */
function ExtraCards({ summary, players, nameOf, mine }: { summary: SideSummary; players: number[]; nameOf: (id: number) => string; mine: number | null }) {
  const { skins, wolf, nassau } = summary;
  const sorted = (m: ReadonlyMap<number, number>) => [...players].sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0));
  return (
    <>
      {skins ? (
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={[styles.gameTitle, { flex: 1 }]}>Skins</Text>
            {skins.riding > 1 ? <Text style={[styles.chip, styles.chipLive]}>{`${skins.riding} ON THE NEXT`}</Text> : null}
          </View>
          {sorted(skins.won).map((id) => (
            <View key={id} style={styles.standRow}>
              <View style={[styles.dot, { backgroundColor: (skins.won.get(id) ?? 0) > 0 ? colors.gold500 : "#cfc6b4" }]} />
              <Text style={[styles.standName, id === mine && { fontFamily: fonts.bodyBold }]}>{nameOf(id)}</Text>
              <Text style={styles.standPts}>{`${skins.won.get(id) ?? 0}`}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {wolf ? (
        <View style={styles.card}>
          <Text style={styles.gameTitle}>Wolf points</Text>
          {sorted(wolf.points).map((id) => (
            <View key={id} style={styles.standRow}>
              <View style={[styles.dot, { backgroundColor: (wolf.points.get(id) ?? 0) > 0 ? colors.gold500 : "#cfc6b4" }]} />
              <Text style={[styles.standName, id === mine && { fontFamily: fonts.bodyBold }]}>{nameOf(id)}</Text>
              <Text style={styles.standPts}>{signed(wolf.points.get(id) ?? 0)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {nassau ? (
        <View style={styles.card}>
          <Text style={styles.gameTitle}>Nassau</Text>
          {nassau.bets
            .filter((b) => mine == null || b.a === mine || b.b === mine)
            .map((b, i) => {
              const forA = mine == null || b.a === mine;
              const other = forA ? b.b : b.a;
              return (
                <View key={i} style={styles.mini}>
                  <Text style={styles.miniText}>
                    <Text style={{ fontFamily: fonts.bodyBold }}>{mine == null ? `${nameOf(b.a)} v ${nameOf(b.b)}` : `v ${nameOf(other)}`}</Text>
                    {` · ${b.label}`}
                  </Text>
                  <Text style={styles.miniResult}>{betLine(b, forA)}</Text>
                </View>
              );
            })}
        </View>
      ) : null}
    </>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

function extraResults(s: SideSummary, nameOf: (id: number) => string): { id: string; label: string; who: string }[] {
  const out: { id: string; label: string; who: string }[] = [];
  if (s.skins) {
    const won = [...s.skins.won].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    out.push({ id: "skins", label: "Skins", who: won.length ? won.map(([id, n]) => `${nameOf(id)} ${n}`).join(" · ") : "None won" });
  }
  if (s.wolf) {
    const top = [...s.wolf.points].sort((a, b) => b[1] - a[1])[0];
    out.push({ id: "wolf", label: "Wolf", who: top && top[1] > 0 ? `${nameOf(top[0])} ${signed(top[1])}` : "All square" });
  }
  if (s.nassau) {
    const won = new Map<number, number>();
    for (const b of s.nassau.bets) if (b.done && b.winner != null) won.set(b.winner, (won.get(b.winner) ?? 0) + 1);
    const top = [...won].sort((a, b) => b[1] - a[1])[0];
    out.push({ id: "nassau", label: "Nassau", who: top ? `${nameOf(top[0])} · ${top[1]} bet${top[1] === 1 ? "" : "s"}` : "All halved" });
  }
  return out;
}

function extraLines(s: SideSummary, nameOf: (id: number) => string): string[] {
  return extraResults(s, nameOf).map((r) => `${r.label}: ${r.who}`);
}

function matchSummary(g: SideGame, nameOf: (id: number) => string): string {
  const m = g.match!;
  if (m.result === "halved") return "Halved";
  if (m.played === 0) return "Not started";
  const lead = m.up > 0 ? m.sideA : m.up < 0 ? m.sideB : null;
  const line = matchLine(m);
  if (!lead) return line;
  return `${nameOf(lead[0])} & ${nameOf(lead[1])} ${line.toLowerCase()}`;
}

function winnerLine(g: SideGame, nameOf: (id: number) => string): string {
  if (g.match) {
    if (g.match.result === "halved" || (g.status === "final" && g.winners.length === 0)) return "Halved";
    if (g.winners.length === 0) return "All square";
    return `${nameOf(g.winners[0]!)} & ${nameOf(g.winners[1]!)}`;
  }
  if (g.winners.length === 0) return g.status === "not_started" ? "Not started" : "Tied";
  return g.winners.map(nameOf).join(" & ");
}

function leadLine(games: readonly SideGame[], me: number): string {
  const live = games.filter((g) => g.status === "live" && g.winners.includes(me)).length;
  const won = games.filter((g) => g.status === "final" && g.winners.includes(me)).length;
  if (live === 0 && won === 0) return "Nothing won yet — plenty to play for";
  const parts = [won ? `Won ${won}` : null, live ? `leading ${live} live` : null].filter(Boolean);
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function stakeLine(c: SideGamesConfig): string {
  const x = c.extra ?? NO_EXTRA;
  const on = [c.bestFront && c.stakes.front, c.bestBack && c.stakes.back, c.bestOverall && c.stakes.overall, c.sixes && c.stakes.sixes].filter(
    (v): v is number => typeof v === "number"
  );
  if (on.length === 0) {
    const parts = [x.skins ? `${euros(x.stakes.skins)} a skin` : null, x.wolf ? `${euros(x.stakes.wolf)} a Wolf point` : null, x.nassau ? `${euros(x.stakes.nassau)} a Nassau bet` : null].filter(Boolean);
    return parts.join(", ") || "the money games";
  }
  const same = new Set(on).size === 1;
  return same ? `${euros(on[0] ?? 0)} a game` : "the money games";
}

function modeLine(c: SideGamesConfig): string {
  const x = c.extra ?? NO_EXTRA;
  const names = [
    c.sixes ? (c.sixes === "pairs" ? "Sixes in pairs" : "Sixes") : null,
    c.bestFront ? "Front 9" : null,
    c.bestBack ? "Back 9" : null,
    c.bestOverall ? "Overall" : null,
    x.skins ? "Skins" : null,
    x.wolf ? "Wolf" : null,
    x.nassau ? "Nassau" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const mode = c.mode === "money" ? stakeLine(c) : c.mode === "points" ? "for points" : "for bragging rights";
  return `${names} · ${mode}`;
}

const shadow = {
  shadowColor: colors.navy900,
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const;

const styles = StyleSheet.create({
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: 12 },
  banner: { backgroundColor: colors.navy800, borderRadius: radii.lg, padding: spacing.md, gap: 4, borderWidth: 2, borderColor: "#c9a24a" },
  bannerEyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.8, color: colors.gold400 },
  bannerTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50 },
  bannerEyebrowDark: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.8, color: "#8a6a24" },
  bannerBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: "#d9d2c2" },
  edit: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: "rgba(232,196,107,0.5)" },
  editText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.gold400 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: spacing.md, gap: 10, borderWidth: 1.5, borderColor: "#e6dcc6", ...shadow },
  cardGold: { borderColor: "#c9a24a" },
  cardPaid: { borderColor: colors.green700, backgroundColor: "#f3f8f3" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  gameTitle: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.navy900 },
  gameSub: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.ink500, marginTop: 2 },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink500 },
  warn: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.red600 },
  label: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 2, color: colors.navy900, marginTop: 6 },
  segment: { flexDirection: "row", gap: 6, backgroundColor: "#f3ede1", borderRadius: 14, padding: 5, borderWidth: 1.5, borderColor: "#e6dcc6" },
  segBtn: { flex: 1, minHeight: 46, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: colors.navy900 },
  segText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink500 },
  mini: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.cream50, flexWrap: "wrap" },
  miniLive: { backgroundColor: "#e8f1ea", borderWidth: 1.5, borderColor: colors.green700 },
  miniHoles: { width: 52, fontFamily: fonts.bodyBold, fontSize: 13, color: "#8a6a24" },
  miniText: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.navy900 },
  miniResult: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.green700 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: "#cfc6b4", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  amountBox: { flex: 1, height: 60, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 16, borderWidth: 2, borderColor: "#c9a24a", backgroundColor: "#fbf3df" },
  euro: { fontFamily: fonts.bodyBold, fontSize: 28, color: "#8a6a24" },
  amountInput: { minWidth: 70, fontFamily: fonts.bodyBold, fontSize: 32, color: colors.navy900, textAlign: "center", padding: 0 },
  picks: { flexDirection: "row", gap: 6 },
  pick: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: "#e6dcc6", backgroundColor: colors.cream50, alignItems: "center", justifyContent: "center" },
  pickOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  pickText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  eachRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  eachLabel: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.navy900 },
  eachBox: { width: 110, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1.5, borderColor: "#c9a24a", backgroundColor: "#fbf3df" },
  eachEuro: { fontFamily: fonts.bodyBold, fontSize: 18, color: "#8a6a24" },
  eachInput: { minWidth: 56, fontFamily: fonts.bodyBold, fontSize: 20, color: colors.navy900, textAlign: "center", padding: 0 },
  link: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy800 },
  risk: { backgroundColor: colors.cream50, borderRadius: 12, padding: 12 },
  riskText: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 21, color: colors.navy900 },
  secondary: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy800 },
  youNow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.navy800, borderRadius: 20, padding: spacing.md, borderWidth: 2, borderColor: "#c9a24a" },
  youEyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, color: colors.gold400 },
  youLine: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.cream50, marginTop: 4 },
  youAmount: { fontFamily: fonts.bodyBold, fontSize: 30, color: colors.gold400 },
  youSub: { fontFamily: fonts.body, fontSize: 13, color: "#d9d2c2" },
  chip: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, overflow: "hidden" },
  chipLive: { backgroundColor: colors.green700, color: "#fff" },
  chipFinal: { backgroundColor: "#ece4d2", color: colors.ink500 },
  standRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  standName: { flex: 1, fontFamily: fonts.body, fontSize: 17, color: colors.navy900 },
  standPts: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.navy900 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: "#efe7d6" },
  resultGame: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink500 },
  resultWho: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  totals: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  total: { flexGrow: 1, flexBasis: "22%", minWidth: 76, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 6, alignItems: "center", gap: 8, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: "#e6dcc6" },
  totalUp: { backgroundColor: "#e3eee6", borderColor: "#b9d3bf" },
  totalDown: { backgroundColor: "#f6e3d6", borderColor: "#e8c6b1" },
  totalMine: { borderColor: colors.navy900, borderWidth: 2 },
  totalName: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.navy900 },
  totalAmount: { fontFamily: fonts.bodyBold, fontSize: 21, color: colors.navy900 },
  payRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  payWho: { flex: 1, fontFamily: fonts.body, fontSize: 17, color: colors.navy900 },
  payAmount: { fontFamily: fonts.bodyBold, fontSize: 24, color: colors.navy900 },
  payButtons: { flexDirection: "row", gap: 8 },
  navyBtn: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  navyBtnText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  outlineBtn: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderColor: "#cfc6b4", backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  outlineBtnText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  paidRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  paidText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.green700 },
  footnote: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500, textAlign: "center" },
});
