import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { MatchRow, Pills, SectionTitle } from "@/components/compete-bits";
import { Button, Chip } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadMyGroups } from "@/lib/groups-data";
import { feeLabel } from "@/lib/matchplay";
import { loadCompeteHome, type CompeteHome, type League } from "@/lib/matchplay-data";
import { outingDateLabel } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

type Tab = "leagues" | "ladders";

const STATUS_LABEL: Record<League["status"], string> = {
  entries: "Entries open",
  running: "Groups under way",
  knockout: "Knockout",
  finished: "Finished",
  cancelled: "Cancelled",
};

/**
 * Compete (0148): your matches, your leagues and ladders, what's open to
 * enter, and the opens other clubs are running. Matchplay is played in
 * person and reported here; the tables work themselves out.
 */
export default function CompeteScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [home, setHome] = useState<CompeteHome | null>(null);
  const [canStart, setCanStart] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("leagues");

  const load = useCallback(async () => {
    if (!me) return;
    try {
      const [h, groups] = await Promise.all([loadCompeteHome(me), loadMyGroups(me).catch(() => null)]);
      setHome(h);
      setCanStart(h.staff || !!groups?.groups.some((g) => g.role === "owner" || g.role === "admin"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [me]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const header = <Stack.Screen options={{ title: "Compete", headerBackTitle: "Back" }} />;

  if (!isOn("competitions")) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="trophy-outline" title="Competitions are on their way" size="screen" />
      </View>
    );
  }
  if (failed && !home) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="competitions" size="screen" />
      </View>
    );
  }
  if (!home) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  const kind = tab === "leagues" ? "league" : "ladder";
  const mine = home.mine.filter((l) => l.kind === kind);
  const enterable = home.enterable.filter((l) => l.kind === kind);
  const nameOf = (id: string | null) => (id ? home.names[id] ?? "A member" : "To be decided");

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.body}
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
      {header}
      <View style={styles.intro}>
        <Text style={styles.introKicker}>PINPALS · COMPETE</Text>
        <Text style={styles.introTitle}>Play for something</Text>
        <Text style={styles.introBody}>Matchplay leagues and ladders, played at your clubs and reported here. And the opens worth entering.</Text>
      </View>

      {home.myMatches.length ? (
        <>
          <SectionTitle>Your matches</SectionTitle>
          {home.myMatches.map((m) => (
            <MatchRow key={m.id} match={m} nameOf={nameOf} me={me} onPress={() => router.push(`/compete/match/${m.id}`)} showStage />
          ))}
        </>
      ) : null}

      <Pills
        label="Competition type"
        value={tab}
        onChange={setTab}
        options={[
          { id: "leagues", label: "Leagues" },
          { id: "ladders", label: "Ladders" },
        ]}
        style={{ marginTop: spacing.sm }}
      />

      <SectionTitle>{tab === "leagues" ? "Your leagues" : "Your ladders"}</SectionTitle>
      {mine.length ? (
        mine.map((l) => <LeagueCard key={l.id} league={l} onPress={() => router.push(`/compete/${l.id}`)} />)
      ) : (
        <Text style={styles.quiet}>{tab === "leagues" ? "You're not in a league yet." : "You're not on a ladder yet."}</Text>
      )}

      <SectionTitle>{tab === "leagues" ? "Open for entries" : "Ladders you can join"}</SectionTitle>
      {enterable.length ? (
        enterable.map((l) => <LeagueCard key={l.id} league={l} onPress={() => router.push(`/compete/${l.id}`)} cta={tab === "leagues" ? "Enter" : "Join"} />)
      ) : (
        <Text style={styles.quiet}>
          {tab === "leagues" ? "No leagues are taking entries just now. Your society can run one too." : "No ladders to join just now. Your society or club group can start one."}
        </Text>
      )}

      <Pressable style={styles.opens} onPress={() => router.push("/compete/opens")} accessibilityRole="button" accessibilityLabel="Open competitions. Find an open, find a partner, book with the club">
        <View style={styles.opensIcon}>
          <Ionicons name="flag-outline" size={22} color={colors.gold400} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.opensTitle}>Open competitions</Text>
          <Text style={styles.opensBody}>Find an open, find a partner, book with the club.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.cream100} />
      </Pressable>

      {canStart ? (
        <Button label="Start a league or ladder" icon="add-circle-outline" tone="line" onPress={() => router.push("/compete/new")} style={{ marginTop: spacing.sm }} />
      ) : null}
    </ScrollView>
  );
}

function LeagueCard({ league, onPress, cta }: { league: League; onPress: () => void; cta?: string }) {
  const fee = feeLabel(league.entryFeeCents);
  const where = league.groupName ?? (league.province ? `PinPals · ${league.province[0].toUpperCase()}${league.province.slice(1)}` : "PinPals");
  const detail = [
    where,
    league.status === "entries" && league.entriesCloseAt ? `Entries close ${outingDateLabel(league.entriesCloseAt.slice(0, 10))}` : null,
    fee ? `${fee} entry` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button" accessibilityLabel={[league.name, STATUS_LABEL[league.status], detail].join(", ")}>
      <View style={styles.cardIcon}>
        <Ionicons name={league.kind === "ladder" ? "podium-outline" : "trophy-outline"} size={22} color={colors.gold500} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={styles.cardTitle}>{league.name}</Text>
        <Text style={styles.cardDetail}>{detail}</Text>
        <Chip tone={league.status === "entries" ? "ok" : league.status === "finished" ? "grey" : "asked"}>{league.kind === "ladder" ? "Ladder" : STATUS_LABEL[league.status]}</Chip>
      </View>
      {cta ? <Text style={styles.cta}>{cta}</Text> : <Ionicons name="chevron-forward" size={18} color={colors.ink500} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  intro: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  introKicker: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.gold400 },
  introTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50 },
  introBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.cream100, lineHeight: 20 },
  quiet: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, lineHeight: 20 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardIcon: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  cardDetail: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  cta: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700, paddingHorizontal: 6 },
  opens: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 14, borderRadius: radii.lg, backgroundColor: colors.green800, marginTop: spacing.sm },
  opensIcon: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  opensTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.cream50 },
  opensBody: { fontFamily: fonts.body, fontSize: 13, color: colors.cream100 },
});
