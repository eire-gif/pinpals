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
  NO_STAKES,
  STAKE_PICKS,
  balances,
  euros,
  exposure,
  matchLine,
  parseEuros,
  pointsLabel,
  settle,
  sideGames,
  sideGamesBlocked,
  sidePoints,
  sixesPairs,
  waitingToAgree,
  type SideGame,
  type SideGamesConfig,
  type SideMode,
} from "@/lib/side-games";
import { agreeToSideGames, loadSideGames, markSidePaid, paidKey, saveSideGames, type SideGamesState } from "@/lib/side-games-data";
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

  useEffect(() => {
    if (!four) setPairs(false);
  }, [four]);

  const one = parseEuros(amount);
  const stakes = perGame
    ? { front: parseEuros(each.front), back: parseEuros(each.back), overall: parseEuros(each.overall), sixes: parseEuros(each.sixes) }
    : { front: one, back: one, overall: one, sixes: one };
  const stakesOk = mode !== "money" || Object.values(stakes).every((v) => v != null);
  const config: SideGamesConfig = {
    bestFront: front,
    bestBack: back,
    bestOverall: overall,
    sixes: sixesOn ? (pairs && four ? "pairs" : "individual") : null,
    mode,
    stakes: mode === "money" && stakesOk ? (stakes as SideGamesConfig["stakes"]) : { ...NO_STAKES },
  };
  const anyGame = front || back || overall || sixesOn;
  const risk = exposure(config, playerIds.length);
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
    if (mode === "money" && (!stakesOk || Object.values(config.stakes).every((v) => v === 0))) {
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
          <Text style={styles.gameTitle}>Amount per game</Text>
          {!perGame ? (
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
          <Pressable onPress={() => setPerGame((v) => !v)} accessibilityRole="button" style={{ paddingVertical: 6 }}>
            <Text style={styles.link}>{perGame ? "Same amount for every game" : "Set a different amount per game"}</Text>
          </Pressable>
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
  const games = useMemo(() => sideGames(config, data.card, players, data.scores), [config, data.card, players, data.scores]);
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

  const allFinal = games.every((g) => g.status === "final");
  const settled = !live || allFinal;
  const bal = balances(games, ids, !settled);
  const payments = settle(balances(games, ids));
  const pts = sidePoints(games, ids);

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
    const lines = games.map((g) => `${g.label}: ${winnerLine(g, nameOf)}`);
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
              ? `Most you can lose: ${euros(exposure(config, players.length).maxLoss)}. Until everyone's in, the games are played for bragging rights.`
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
            <Text style={styles.youLine}>{leadLine(games, mine.id)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.youAmount}>{euros(bal.get(mine.id) ?? 0, true)}</Text>
            <Text style={styles.youSub}>if it ended now</Text>
          </View>
        </View>
      ) : null}

      {!settled ? (
        games.map((g) => <GameCard key={g.id} game={g} nameOf={nameOf} mine={mine?.id ?? null} />)
      ) : (
        <>
          <Text style={styles.label}>WHO WON WHAT</Text>
          <View style={styles.card}>
            {games.map((g, i) => (
              <View key={g.id} style={[styles.resultRow, i < games.length - 1 && styles.rowLine]}>
                <Text style={styles.resultGame}>{g.label}</Text>
                <Text style={styles.resultWho}>{winnerLine(g, nameOf)}</Text>
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
  const on = [c.bestFront && c.stakes.front, c.bestBack && c.stakes.back, c.bestOverall && c.stakes.overall, c.sixes && c.stakes.sixes].filter(
    (x): x is number => typeof x === "number"
  );
  const same = new Set(on).size === 1;
  return same ? `${euros(on[0] ?? 0)} a game` : "the money games";
}

function modeLine(c: SideGamesConfig): string {
  const names = [c.sixes ? (c.sixes === "pairs" ? "Sixes in pairs" : "Sixes") : null, c.bestFront ? "Front 9" : null, c.bestBack ? "Back 9" : null, c.bestOverall ? "Overall" : null]
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
