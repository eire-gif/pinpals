import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { TintedHeader } from "@/components/tinted-header";
import { GuideLink } from "@/components/guide-bits";
import { RaisedCard, TONES } from "@/components/live-scoring-card";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAgeAccess } from "@/lib/age";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { loadMyGroups, loadNextOutings, type MyGroups } from "@/lib/groups-data";
import { shortDate } from "@/lib/group-dates";
import { todayIso } from "@/lib/tee-times";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Groups & societies (Oct 2026 redesign, canvas board G5).
 *
 * Four big buttons in the live hub's raised style: My Groups & Societies
 * (your groups, on their own page — app/groups/mine.tsx), then one to start
 * each kind of group — Golf Buddies, a golf trip, a society — and Find a
 * society underneath. A member in no groups yet sees just the three start
 * buttons (board G3).
 *
 * Reached from Home's Groups & Societies button and the menu.
 */
export default function GroupsScreen() {
  const { session } = useAuth();
  // Junior members (0159): under 18s join groups but can't start one; under
  // 16s join only their parent's, by invitation — so no "Find a society".
  const { access, allows } = useAgeAccess();
  const canStart = allows("createGroups");
  const canFind = access.can.joinGroups === "all";
  const userId = session?.user?.id ?? null;
  const [data, setData] = useState<MyGroups | null>(null);
  const [nextOut, setNextOut] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !isOn("groups")) return;
    try {
      const mine = await loadMyGroups(userId);
      setData(mine);
      setFailed(false);
      const next = await loadNextOutings(
        mine.groups.map((g) => g.id),
        userId,
        todayIso()
      );
      const soonest = [...next.values()].map((o) => o.playsOn).sort()[0] ?? null;
      setNextOut(soonest);
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const groups = data?.groups.length ?? 0;
  const invites = data?.invitations.length ?? 0;
  const waiting = data?.requested.length ?? 0;
  const hasAny = groups + invites + waiting > 0;
  const members = data?.groups.reduce((n, g) => n + g.memberCount, 0) ?? 0;

  // Short enough for the bar's gold line (Oct 2026: the title moved up
  // into the bar) — so two facts, not three: when you're next out beats
  // the member count when there is a date.
  const line = !data || groups === 0
    ? "Buddies, trips & societies"
    : [`${groups} ${groups === 1 ? "group" : "groups"}`, nextOut ? `next out ${shortDate(nextOut)}` : `${members} members`].join(" · ");

  const header = (
    <>
      {/* Oct 2026: the name up in the bar, on Home's Groups green, instead
          of a photograph below it — the four buttons start higher. */}
      <TintedHeader color={TONES.green.card} title="Groups &" accent="Societies" subtitle={line} />
    </>
  );

  if (!isOn("groups")) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="people-outline" title="Groups are on their way" body="Golf buddies, trips and societies are coming to PinPals soon." size="screen" />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      {data === null && !failed ? (
        <>
          {header}
          <ActivityIndicator color={colors.green700} style={styles.spinner} />
        </>
      ) : failed && data === null ? (
        <>
          {header}
          <LoadError onRetry={() => void load()} what="your groups" size="screen" />
        </>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
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
          <View style={styles.body}>
            {/* Only once you're in something — a first visit starts with the
                three start buttons (board G3). */}
            {hasAny ? (
              <RaisedCard
                inset={false}
                marginTop={0}
                tone="bronze"
                icon="grid"
                kicker={groups === 1 ? "Your group" : `Your ${groups} groups`}
                title="My Groups & Societies"
                subtitle={invites > 0 ? `${invites === 1 ? "An invitation" : `${invites} invitations`} waiting · events, results and chat` : "Events, results and chat"}
                badge={invites > 0 ? (invites === 1 ? "1 new" : `${invites} new`) : undefined}
                wrapTitle
                onPress={() => router.push("/groups/mine")}
              />
            ) : null}

            {canStart ? (
              <>
                <Text style={styles.eyebrow}>{hasAny ? "Start a new group" : "Start your first group"}</Text>
                <RaisedCard
                  inset={false}
                  marginTop={0}
                  icon="people"
                  kicker="Friends"
                  title="Golf Buddies"
                  subtitle="Your regular group of friends — one chat, your rounds"
                  wrapTitle
                  onPress={() => router.push({ pathname: "/groups/new", params: { kind: "crew" } })}
                />
                <RaisedCard
                  inset={false}
                  marginTop={0}
                  tone="claret"
                  icon="airplane"
                  kicker="Away"
                  title="Plan a Golf Trip"
                  subtitle="Courses, flights and the itinerary in one place"
                  wrapTitle
                  onPress={() => router.push({ pathname: "/groups/new", params: { kind: "trip" } })}
                />
                <RaisedCard
                  inset={false}
                  marginTop={0}
                  tone="green"
                  icon="trophy"
                  kicker="Societies & outings"
                  title="Run a Society"
                  subtitle="Outings, entries, the draw and results"
                  wrapTitle
                  onPress={() => router.push({ pathname: "/groups/new", params: { kind: "society" } })}
                />
              </>
            ) : (
              <Text style={styles.ageNote}>Your parent can add you to their groups and societies from their Parent dashboard.</Text>
            )}

            {canFind ? (
              <>
                {canStart ? (
                  <View style={styles.or}>
                    <View style={styles.orLine} />
                    <Text style={styles.orText}>or</Text>
                    <View style={styles.orLine} />
                  </View>
                ) : null}
                <Pressable
                  onPress={() => router.push("/groups/find")}
                  style={({ pressed }) => [styles.find, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Find a society to join"
                >
                  <View style={styles.findDisc}>
                    <Ionicons name="search" size={20} color={colors.gold400} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.findTitle}>Find a society to join</Text>
                    <Text style={styles.findSub}>Search by name, club or area</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
                </Pressable>
              </>
            ) : null}

            <GuideLink title="How groups work — for buddies, trips or societies" />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, paddingTop: spacing.lg, gap: 18 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: "#8a6a1f", marginBottom: -4, marginLeft: 4 },
  ageNote: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
  or: { flexDirection: "row", alignItems: "center", gap: 12, marginHorizontal: 6 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  find: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.gold500,
    shadowColor: colors.navy900,
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  pressed: { opacity: 0.85 },
  findDisc: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  findTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.ink900 },
  findSub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
});
