import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GuideLink } from "@/components/guide-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { groupNoun, organisers, type GroupKind, officeAreas } from "@/lib/groups";
import { countdownLabel, tripBadge, tripRangeLabel } from "@/lib/itinerary-rules";
import { clock, closesLabel, entriesOpen, feeLabel, irishToday, outingDateLabel } from "@/lib/outing-rules";
import { listOutings, setOutingEntry, type OutingSummary } from "@/lib/outings";
import { loadGroupResults, type GroupResult } from "@/lib/competition-data";
import { Chip, PlaceChip } from "@/components/society-bits";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A group's Events (0125 for societies; crews and trips since 0129): its upcoming outings, soonest first. Members
 * join or cancel from here until midnight at the start of the day; the
 * captain and secretary also get "New event". Tap an outing for who's in,
 * the tee times and (for officers) the draw and payments.
 *
 * Overnight and abroad trips (0126) get the bigger navy card, with the way
 * into their itinerary.
 *
 * PAST (Oct 2026): a played day opens straight on its results, not the
 * entry page — the card says "Full results" once they're published, or
 * "Results to come". "Event details" under it still opens the outing
 * (payments, who played). A day never scored on PinPals has no results,
 * so it opens the outing as before.
 */
export default function SocietyEventsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [outings, setOutings] = useState<OutingSummary[] | null>(null);
  /** Published results by match day, for the Past tab's winner lines. */
  const [results, setResults] = useState<Map<number, GroupResult>>(new Map());
  const [past, setPast] = useState(false);
  const [officer, setOfficer] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [kind, setKind] = useState<GroupKind | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [page, list, published] = await Promise.all([
        loadGroupPage(groupId, userId),
        listOutings(groupId, userId, { fromDate: irishToday(), past }),
        past ? loadGroupResults(groupId).catch(() => [] as GroupResult[]) : Promise.resolve([] as GroupResult[]),
      ]);
      setResults(new Map(published.map((r) => [r.dayId, r])));
      // Whoever runs events: owner, captain, secretary, and since 0144 the
      // vice-captain and event organisers.
      setOfficer(officeAreas(page?.myRole ?? null, page?.myOffice ?? null).includes("events"));
      setGroupName(page?.group.name ?? "");
      setKind(page?.group.kind ?? null);
      setOutings(list);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId, past]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function toggle(o: OutingSummary) {
    // A request-only event, or one with meals to choose: the request screen.
    if (!o.mine && (o.entryMode === "request" || o.mealOptions.length > 0)) {
      router.push({ pathname: "/group/[id]/outing/request", params: { id: String(groupId), outingId: String(o.id) } });
      return;
    }
    const go = async () => {
      setBusy(o.id);
      try {
        await setOutingEntry(o.id, !o.mine);
        await load();
      } catch (err) {
        Alert.alert(o.mine ? "Couldn't cancel" : "Couldn't join", err instanceof Error ? err.message : "Please try again.");
      } finally {
        setBusy(null);
      }
    };
    if (o.mine) {
      Alert.alert(`Cancel your place at ${o.title}?`, "Your place goes to the next person on the waiting list, if there is one.", [
        { text: "Keep my place", style: "cancel" },
        { text: "Cancel my place", style: "destructive", onPress: () => void go() },
      ]);
    } else void go();
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Events", headerBackTitle: "Back" }} />
      <ScrollView
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
        {groupName ? <Text style={styles.kicker}>{groupName.toUpperCase()}</Text> : null}

        {officer ? (
          <Pressable style={styles.new} onPress={() => router.push({ pathname: "/group/[id]/outing/new", params: { id: String(groupId) } })} accessibilityRole="button">
            <Ionicons name="add" size={20} color={colors.cream50} />
            <Text style={styles.newText}>New event</Text>
          </Pressable>
        ) : null}

        {officer ? <GuideLink id="event" lead="Setting one up?" /> : null}

        <View style={styles.tabs} accessibilityRole="tablist">
          {[false, true].map((p) => (
            <Pressable key={String(p)} style={[styles.tab, past === p && styles.tabOn]} onPress={() => setPast(p)} accessibilityRole="tab" accessibilityState={{ selected: past === p }}>
              <Text style={[styles.tabText, past === p && styles.tabTextOn]}>{p ? "Past" : "Upcoming"}</Text>
            </Pressable>
          ))}
        </View>

        {failed && !outings ? (
          <LoadError onRetry={() => void load()} what="the outings" />
        ) : outings === null ? (
          <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.lg }} />
        ) : outings.length === 0 ? (
          <StateMessage
            icon="calendar-outline"
            title={past ? "No past outings" : "No outings yet"}
            body={
              past
                ? undefined
                : officer
                  ? `Set up the ${groupNoun(kind)}'s next day out or trip — everyone joins it here.`
                  : `When ${organisers(kind)} sets up a day out or trip, it shows here and you can join.`
            }
          />
        ) : (
          outings.map((o) => {
            if (o.kind !== "day" && o.endsOn) {
              const tripOpen = entriesOpen(o.playsOn) && o.status === "open";
              const cancelledTrip = o.status === "cancelled";
              return (
                <Pressable
                  key={o.id}
                  style={styles.trip}
                  onPress={() => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(o.id) } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.title}, ${tripRangeLabel(o.playsOn, o.endsOn)}${o.mine ? ", you're going" : ""}`}
                >
                  <View style={styles.tripTop}>
                    <Text style={styles.tripBadge}>{tripBadge(o.kind, o.playsOn, o.endsOn)}</Text>
                    {o.mine ? <Text style={styles.tripGoing}>You&apos;re going</Text> : null}
                  </View>
                  <Text style={[styles.tripTitle, cancelledTrip && styles.struck]}>{o.title}</Text>
                  <Text style={styles.tripMeta}>{[tripRangeLabel(o.playsOn, o.endsOn), o.location].filter(Boolean).join(" · ")}</Text>
                  <Text style={styles.tripMeta}>
                    {cancelledTrip
                      ? "Cancelled"
                      : [`${o.entered}${o.maxEntries ? ` of ${o.maxEntries}` : ""} going`, feeLabel(o.entryFeeCents), past ? null : countdownLabel(o.playsOn, o.endsOn, irishToday())].filter(Boolean).join(" · ")}
                  </Text>
                  {!cancelledTrip ? (
                    <View style={styles.tripActions}>
                      <Pressable
                        style={styles.tripOpen}
                        onPress={() => router.push({ pathname: "/group/[id]/itinerary/[outingId]", params: { id: String(groupId), outingId: String(o.id) } })}
                        accessibilityRole="button"
                        accessibilityLabel={`Open the itinerary for ${o.title}`}
                      >
                        <Ionicons name="map-outline" size={17} color={colors.navy900} />
                        <Text style={styles.tripOpenText}>Itinerary</Text>
                      </Pressable>
                      {!past && tripOpen ? (
                        <Pressable
                          style={[styles.tripJoin, o.mine && styles.tripJoinMine]}
                          onPress={() => void toggle(o)}
                          disabled={busy !== null}
                          accessibilityRole="button"
                          accessibilityLabel={o.mine ? `Cancel your place on ${o.title}` : `Join ${o.title}`}
                        >
                          {busy === o.id ? <ActivityIndicator size="small" color={colors.cream50} /> : <Text style={styles.tripJoinText}>{o.mine ? "Going · Cancel" : "Join"}</Text>}
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </Pressable>
              );
            }
            const open = (o.entriesCloseAt ? Date.now() < new Date(o.entriesCloseAt).getTime() : entriesOpen(o.playsOn)) && o.status === "open" && o.matchDayId == null;
            const queued = !o.mine && o.myPlace != null;
            const full = o.maxEntries != null && o.entered >= o.maxEntries;
            const cancelled = o.status === "cancelled";
            const facts = [o.courseName, o.firstTee ? `First tee ${clock(o.firstTee)}` : null, feeLabel(o.entryFeeCents)].filter(Boolean).join(" · ");
            // Played and scored on PinPals: the card is the way into the results.
            const toResults = past && !cancelled && o.matchDayId != null;
            const result = toResults ? results.get(o.matchDayId!) : undefined;
            const openOuting = () => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(o.id) } });
            return (
              <Pressable
                key={o.id}
                style={[styles.card, o.mine && styles.cardMine]}
                onPress={() =>
                  toResults ? router.push({ pathname: "/live/day/results/[id]", params: { id: String(o.matchDayId) } }) : openOuting()
                }
                accessibilityRole="button"
                accessibilityLabel={`${o.title}, ${outingDateLabel(o.playsOn)}${toResults ? (result ? ", see the results" : ", results to come") : o.mine ? ", you're in" : ""}`}
              >
                <View style={styles.date}>
                  <Text style={styles.dateDay}>{outingDateLabel(o.playsOn).split(" ")[1]}</Text>
                  <Text style={styles.dateMonth}>{outingDateLabel(o.playsOn).split(" ")[2].toUpperCase()}</Text>
                  <Text style={styles.dateWeek}>{outingDateLabel(o.playsOn).split(" ")[0]}</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.title, cancelled && styles.struck]} numberOfLines={2}>
                    {o.title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={2}>
                    {facts}
                  </Text>
                  <Text style={styles.meta}>
                    {cancelled
                      ? "Cancelled"
                      : `${o.entered}${o.maxEntries ? ` of ${o.maxEntries}` : ""} in${o.mine && o.myTeeGroup ? ` · ${o.myStart ? `shotgun ${clock(o.myTeeTime) ?? ""}, tee ${o.myStart.hole}${o.myStart.letter ?? ""}` : `your tee time ${clock(o.myTeeTime) ?? `group ${o.myTeeGroup}`}`}` : ""}`}
                  </Text>
                  {!cancelled && (o.myPlace || o.myPaymentDue) ? (
                    <View style={styles.chips}>
                      {o.myPlace ? <PlaceChip status={o.myPlace} linePosition={o.myLinePosition} /> : null}
                      {o.myPaymentDue && !past ? <Chip tone="due">Payment due</Chip> : null}
                    </View>
                  ) : null}
                  {!cancelled && !past ? (
                    <Text style={[styles.closes, !open && styles.closed]}>
                      {o.matchDayId
                        ? "Round under way"
                        : o.entriesCloseAt
                          ? open
                            ? `Entries close ${new Date(o.entriesCloseAt).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Europe/Dublin" })}`
                            : "Entries closed"
                          : closesLabel(o.playsOn)}
                    </Text>
                  ) : null}
                  {!cancelled && !past && queued ? (
                    <Pressable
                      style={[styles.join, styles.joinMine]}
                      onPress={() => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(groupId), outingId: String(o.id) } })}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.joinText, styles.joinTextMine]}>{o.myPlace === "offered" ? "A place is yours — answer" : "See my place"}</Text>
                    </Pressable>
                  ) : !cancelled && !past && open ? (
                    <Pressable
                      style={[styles.join, o.mine && styles.joinMine]}
                      onPress={() => void toggle(o)}
                      disabled={busy !== null}
                      accessibilityRole="button"
                      accessibilityLabel={o.mine ? `Cancel your place at ${o.title}` : `Join ${o.title}`}
                    >
                      {busy === o.id ? (
                        <ActivityIndicator size="small" color={o.mine ? colors.navy900 : colors.cream50} />
                      ) : (
                        <>
                          <Ionicons name={o.mine ? "checkmark-circle" : "add-circle-outline"} size={18} color={o.mine ? colors.green700 : colors.cream50} />
                          <Text style={[styles.joinText, o.mine && styles.joinTextMine]}>
                            {o.mine ? "You're in · Cancel" : o.entryMode === "request" ? "Request a place" : full ? "Join the waiting list" : "Join"}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ) : toResults ? (
                    <View style={{ gap: 4, marginTop: 4 }}>
                      <View style={styles.resultsRow}>
                        <Text style={[styles.resultsLink, !result && styles.resultsPending]}>
                          {result ? (result.amended ? "Full results · Amended" : "Full results") : "Results to come"}
                        </Text>
                        {result ? <Ionicons name="arrow-forward" size={15} color={colors.green700} /> : null}
                        <View style={{ flex: 1 }} />
                        <Pressable onPress={openOuting} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Event details for ${o.title}`}>
                          <Text style={styles.detailsLink}>Event details</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : o.mine && !cancelled ? (
                    <View style={styles.inBadge}>
                      <Ionicons name="checkmark-circle" size={16} color={colors.green700} />
                      <Text style={styles.inText}>{past ? "You played · no results on PinPals" : "You\u2019re in"}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.ink500 },
  new: { flexDirection: "row", gap: 6, height: 48, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  newText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  tabs: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.xs },
  tab: { paddingHorizontal: 16, height: 36, borderRadius: radii.pill, justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  tabText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink900 },
  tabTextOn: { color: colors.cream50 },
  trip: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  tripTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tripBadge: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: colors.navy900, backgroundColor: colors.gold400, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  tripGoing: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.gold400 },
  tripTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50, marginTop: 4 },
  tripMeta: { fontFamily: fonts.body, fontSize: 13.5, color: colors.cream100 },
  tripActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  tripOpen: { flex: 1, flexDirection: "row", gap: 6, height: 44, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream50 },
  tripOpenText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
  tripJoin: { flex: 1, height: 44, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  tripJoinMine: { backgroundColor: colors.navy800, borderWidth: 1, borderColor: colors.gold400 },
  tripJoinText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  card: { flexDirection: "row", gap: spacing.sm + 4, padding: 12, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardMine: { borderColor: colors.green600 },
  date: { width: 56, alignItems: "center", paddingVertical: 6, borderRadius: radii.md, backgroundColor: colors.navy900, alignSelf: "flex-start" },
  dateDay: { fontFamily: fonts.display, fontSize: 24, color: colors.cream50, lineHeight: 28 },
  dateMonth: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1, color: colors.gold400 },
  dateWeek: { fontFamily: fonts.body, fontSize: 11, color: colors.cream100 },
  cardBody: { flex: 1, gap: 3 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  struck: { textDecorationLine: "line-through", color: colors.ink500 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  closes: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.green700 },
  closed: { color: colors.ink500 },
  join: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 14, height: 38, borderRadius: radii.pill, backgroundColor: colors.green700 },
  joinMine: { backgroundColor: colors.green100, borderWidth: 1, borderColor: colors.green600 },
  joinText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.cream50 },
  joinTextMine: { color: colors.green800 },
  inBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  inText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700 },
  resultsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  resultsLink: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },
  resultsPending: { fontFamily: fonts.bodySemi, color: colors.ink500 },
  detailsLink: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.ink500, textDecorationLine: "underline" },
});
