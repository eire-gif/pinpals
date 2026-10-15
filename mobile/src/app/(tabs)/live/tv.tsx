import { useCallback, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";

import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadMyMatchDays, type MatchDaySummary } from "@/lib/live-match-days";
import { loadMyLiveRounds, type LiveRoundSummary } from "@/lib/live-rounds";
import { formatInfo } from "@/lib/live-scoring";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { connectTv, normaliseTvCode, tidyTvCodeInput, tvLink, type TvTarget } from "@/lib/tv";

/**
 * Show on TV (Oct 2026, claude/clubhouse-tv.md): put a round or society
 * day's leaderboard on a clubhouse TV.
 *
 * Opened three ways: "Show on TV" on a day board or a round (day= / round=
 * set), the QR on the TV itself (code= set, via the /live/tv universal
 * link), or the guide. Whatever isn't set is asked for: which game (your
 * live ones), and the code the TV shows. A link is offered too, for a laptop,
 * a TV's own browser or an iPad on AirPlay.
 */
export default function ShowOnTv() {
  const params = useLocalSearchParams<{ code?: string; day?: string; round?: string }>();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const given: TvTarget | null = params.day ? { kind: "day", id: Number(params.day) } : params.round ? { kind: "round", id: Number(params.round) } : null;
  const [picked, setPicked] = useState<TvTarget | null>(given);
  const [days, setDays] = useState<MatchDaySummary[] | null>(null);
  const [rounds, setRounds] = useState<LiveRoundSummary[] | null>(null);
  const [code, setCode] = useState(tidyTvCodeInput(params.code ?? ""));
  const [busy, setBusy] = useState<"connect" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!userId || given) return;
      void Promise.all([loadMyMatchDays(), loadMyLiveRounds(userId)])
        .then(([d, r]) => {
          setDays(d.filter((x) => x.live));
          setRounds(r.filter((x) => x.status === "live"));
        })
        .catch(() => {
          setDays([]);
          setRounds([]);
        });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, params.day, params.round])
  );

  const games = useMemo(
    () => [
      ...(days ?? []).map((d) => ({ target: { kind: "day" as const, id: d.id }, title: d.title, sub: `${d.courseName} · ${d.kind === "match" ? `${d.matchCount} matches` : d.kind === "scramble" ? "Scramble" : "Society day"}` })),
      ...(rounds ?? []).map((r) => ({ target: { kind: "round" as const, id: r.id }, title: r.courseName, sub: `${formatInfo(r.format).label} · ${r.playerCount} ${r.playerCount === 1 ? "player" : "players"}` })),
    ],
    [days, rounds]
  );
  const target = picked ?? (games.length === 1 ? games[0].target : null);
  const valid = normaliseTvCode(code);

  if (!isOn("clubhouseTv")) {
    return <StateMessage size="screen" icon="tv-outline" title="Show on TV is on its way" body="Put your leaderboard on the clubhouse TV while the cards come in." />;
  }

  const connect = async () => {
    if (!target || !valid) return;
    setBusy("connect");
    setError(null);
    try {
      await connectTv(target, valid);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect the TV. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const shareLink = async () => {
    if (!target) return;
    setBusy("link");
    setError(null);
    try {
      const url = await tvLink(target);
      await Share.share({ message: `Live leaderboard for the TV: ${url}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get the TV link. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.hero}>
          <Ionicons name="checkmark-circle" size={44} color={colors.gold400} />
          <Text style={styles.heroTitle}>It&apos;s on the TV</Text>
          <Text style={styles.heroBody}>The leaderboard updates by itself as scores go in, and birdies flash up on the screen. The TV link lasts three days.</Text>
        </View>
        <Pressable
          onPress={() => {
            setDone(false);
            setCode("");
          }}
          style={styles.secondary}
          accessibilityRole="button"
        >
          <Ionicons name="tv-outline" size={18} color={colors.green700} />
          <Text style={styles.secondaryLabel}>Connect another TV</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Ionicons name="tv-outline" size={36} color={colors.gold400} />
        <Text style={styles.heroTitle}>Put the leaderboard on a TV</Text>
        <Text style={styles.heroBody}>On the TV, open pinpals.ie/tv in its web browser (or on a Chromecast or Fire Stick). It shows a six-character code.</Text>
      </View>

      {!given ? (
        <View style={styles.section}>
          <Text style={styles.label}>Which game?</Text>
          {days === null ? (
            <ActivityIndicator color={colors.green700} />
          ) : games.length === 0 ? (
            <Text style={styles.hint}>Nothing in play right now. Start a round or open your society day, then come back.</Text>
          ) : (
            games.map((g) => {
              const on = target?.kind === g.target.kind && target.id === g.target.id;
              return (
                <Pressable
                  key={`${g.target.kind}-${g.target.id}`}
                  onPress={() => setPicked(g.target)}
                  style={[styles.game, on && styles.gameOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? colors.green700 : colors.ink500} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.gameTitle}>{g.title}</Text>
                    <Text style={styles.hint}>{g.sub}</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.label}>Code on the TV</Text>
        <TextInput
          value={code}
          onChangeText={(t) => {
            setCode(tidyTvCodeInput(t));
            setError(null);
          }}
          placeholder="K7Q 4MP"
          placeholderTextColor={colors.line}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          maxLength={8}
          style={styles.code}
          accessibilityLabel="Code shown on the TV"
          returnKeyType="go"
          onSubmitEditing={() => void connect()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          onPress={() => void connect()}
          disabled={!target || !valid || busy !== null}
          style={({ pressed }) => [styles.primary, (!target || !valid) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          {busy === "connect" ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryLabel}>Connect the TV</Text>}
        </Pressable>
      </View>

      <Pressable onPress={() => void shareLink()} disabled={!target || busy !== null} style={[styles.secondary, !target && { opacity: 0.45 }]} accessibilityRole="button">
        {busy === "link" ? <ActivityIndicator color={colors.green700} /> : <Ionicons name="link-outline" size={18} color={colors.green700} />}
        <Text style={styles.secondaryLabel}>Share the TV link instead</Text>
      </Pressable>
      <Text style={[styles.hint, { textAlign: "center" }]}>For a laptop plugged into the TV, or an iPad mirrored with AirPlay. Anyone with the link can see this leaderboard for three days.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, alignItems: "flex-start" },
  heroTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50 },
  heroBody: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.cream100 },
  section: { gap: spacing.sm },
  label: { fontFamily: fonts.bodyBold, fontSize: type.small, letterSpacing: 1, textTransform: "uppercase", color: colors.ink500 },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  game: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  gameOn: { borderColor: colors.green700, backgroundColor: colors.green100 },
  gameTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  code: {
    fontFamily: fonts.bodyBold,
    fontSize: 34,
    letterSpacing: 8,
    textAlign: "center",
    color: colors.navy900,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
  },
  error: { fontFamily: fonts.body, fontSize: type.small, color: colors.red600 },
  primary: { minHeight: 52, borderRadius: radii.pill, backgroundColor: colors.green700, alignItems: "center", justifyContent: "center" },
  primaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 48, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.green700, backgroundColor: colors.surface },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
});
