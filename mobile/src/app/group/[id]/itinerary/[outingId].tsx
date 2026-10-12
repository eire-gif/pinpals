import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadGroupPage } from "@/lib/groups-data";
import { loadItinerary, type ItineraryItem } from "@/lib/itinerary";
import {
  bySlot,
  countdownLabel,
  dayHeading,
  dayTab,
  FORMAT_LABELS,
  ITEM_INFO,
  itemKindsFor,
  myLineFor,
  routeLabel,
  sortItems,
  teeTimeFor,
  tripBadge,
  tripDays,
  tripRangeLabel,
  type ItemKind,
} from "@/lib/itinerary-rules";
import { clock, irishToday } from "@/lib/outing-rules";
import { loadOuting, type OutingPage } from "@/lib/outings";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A trip's itinerary (0126) — one screen for everyone in the society.
 *
 * Members: the trip at a glance, their own flight, room and tee times, then
 * each day of the trip on a tab, in time order. Tap anything for who's on it.
 *
 * The captain, secretary and owner also get "Add to <day>" (round, flight —
 * abroad only — hotel, transfer, dinner, note) and tap any item to change it.
 */
export default function ItineraryScreen() {
  const { id: rawId, outingId: rawOuting, day: rawDay } = useLocalSearchParams<{ id: string; outingId: string; day?: string }>();
  const groupId = Number(rawId);
  const outingId = Number(rawOuting);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [page, setPage] = useState<OutingPage | null | undefined>(undefined);
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [officer, setOfficer] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [day, setDay] = useState<string | null>(rawDay ?? null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [o, list, g] = await Promise.all([loadOuting(outingId), loadItinerary(outingId), loadGroupPage(groupId, userId)]);
      setPage(o);
      setItems(sortItems(list));
      setOfficer(g?.myRole === "owner" || g?.myRole === "admin");
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, outingId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const outing = page?.outing ?? null;
  const days = useMemo(() => (outing?.endsOn ? tripDays(outing.playsOn, outing.endsOn) : outing ? [outing.playsOn] : []), [outing]);
  const today = irishToday();
  // Open on today during the trip, else the first day.
  const shown = day && days.includes(day) ? day : days.includes(today) ? today : (days[0] ?? null);

  const mine = useMemo(() => {
    if (!userId) return { flights: [] as ItineraryItem[], stay: null as ItineraryItem | null, rounds: [] as { item: ItineraryItem; time: string | null; slot: number }[] };
    const on = (i: ItineraryItem) => i.people.find((p) => p.memberId === userId);
    return {
      flights: items.filter((i) => i.kind === "flight" && on(i)),
      stay: items.find((i) => i.kind === "stay" && on(i)) ?? null,
      rounds: items
        .filter((i) => i.kind === "round" && on(i)?.slot != null)
        .map((i) => ({ item: i, slot: on(i)!.slot!, time: teeTimeFor(i.startsAt, i.teeInterval, on(i)!.slot!) })),
    };
  }, [items, userId]);

  const header = <Stack.Screen options={{ title: outing?.title ?? "Itinerary", headerBackTitle: "Back" }} />;

  if (page === undefined && !failed) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (failed && !page) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="the itinerary" size="screen" />
      </View>
    );
  }
  if (!page || !outing || outing.kind === "day" || !outing.endsOn) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="map-outline" title="No itinerary here" body="Only overnight and abroad trips have an itinerary." size="screen" />
      </View>
    );
  }

  const endsOn = outing.endsOn;
  const amIn = page.entries.some((e) => e.memberId === userId);
  const rounds = items.filter((i) => i.kind === "round").length;
  const nights = days.length - 1;
  const dayItems = items.filter((i) => i.onDate === shown);
  const cancelled = outing.status === "cancelled";

  const openItem = (i: ItineraryItem) => router.push({ pathname: "/group/[id]/itinerary/item", params: { id: String(groupId), outingId: String(outingId), itemId: String(i.id) } });
  const addItem = (kind: ItemKind) =>
    router.push({ pathname: "/group/[id]/itinerary/item", params: { id: String(groupId), outingId: String(outingId), kind, day: shown ?? outing.playsOn } });

  return (
    <View style={styles.fill}>
      {header}
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
        {/* The trip */}
        <View style={styles.hero}>
          <Text style={styles.badge}>{tripBadge(outing.kind, outing.playsOn, endsOn)}</Text>
          <Text style={[styles.heroTitle, cancelled && styles.struck]}>{outing.title}</Text>
          <Text style={styles.heroMeta}>{[tripRangeLabel(outing.playsOn, endsOn), outing.location].filter(Boolean).join(" · ")}</Text>
          <Text style={styles.countdown}>{cancelled ? "Cancelled" : countdownLabel(outing.playsOn, endsOn, today)}</Text>
          <View style={styles.stats}>
            {[
              { n: rounds, label: rounds === 1 ? "Round" : "Rounds" },
              { n: page.entries.length, label: "Going" },
              { n: nights, label: nights === 1 ? "Night" : "Nights" },
            ].map((s) => (
              <View key={s.label} style={styles.stat}>
                <Text style={styles.statN}>{s.n}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* You */}
        {amIn && (mine.flights.length > 0 || mine.stay || mine.rounds.length > 0) ? (
          <View style={styles.you}>
            <Text style={styles.sectionKicker}>YOUR TRIP</Text>
            <View style={styles.youRow}>
              {mine.flights.slice(0, 2).map((f) => (
                <Pressable key={f.id} style={styles.youTile} onPress={() => openItem(f)} accessibilityRole="button">
                  <Text style={[styles.youKicker, { color: ITEM_INFO.flight.ink }]}>{f.onDate === outing.playsOn ? "OUT" : f.onDate === endsOn ? "HOME" : "FLIGHT"}</Text>
                  <Text style={styles.youTitle} numberOfLines={1}>
                    {routeLabel(f.fromPlace, f.toPlace)}
                  </Text>
                  <Text style={styles.youMeta} numberOfLines={1}>{`${dayTab(f.onDate).week} ${dayTab(f.onDate).day}${f.startsAt ? ` · ${clock(f.startsAt)}` : ""}`}</Text>
                </Pressable>
              ))}
              {mine.stay ? (
                <Pressable style={styles.youTile} onPress={() => openItem(mine.stay!)} accessibilityRole="button">
                  <Text style={[styles.youKicker, { color: ITEM_INFO.stay.ink }]}>YOUR ROOM</Text>
                  <Text style={styles.youTitle} numberOfLines={1}>
                    {mine.stay.title}
                  </Text>
                  <Text style={styles.youMeta} numberOfLines={1}>
                    {(() => {
                      const me = mine.stay!.people.find((p) => p.memberId === userId);
                      const with_ = mine.stay!.people.filter((p) => p.slot === me?.slot && p.memberId !== userId).map((p) => p.firstName);
                      return with_.length ? `With ${with_.join(", ")}` : `Room ${me?.slot ?? ""}`;
                    })()}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {mine.rounds.length > 0 ? (
              <View style={styles.teeStrip}>
                <Text style={styles.teeStripKicker}>YOUR TEE TIMES</Text>
                <View style={styles.teeRow}>
                  {mine.rounds.map((r) => (
                    <Pressable key={r.item.id} style={styles.teeTile} onPress={() => setDay(r.item.onDate)} accessibilityRole="button" accessibilityLabel={`${dayTab(r.item.onDate).week} ${r.time ?? `group ${r.slot}`}`}>
                      <Text style={styles.teeDay}>{dayTab(r.item.onDate).week}</Text>
                      <Text style={styles.teeTime}>{r.time ?? `Gp ${r.slot}`}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Day by day */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
          {days.map((d) => {
            const on = d === shown;
            const t = dayTab(d);
            const count = items.filter((i) => i.onDate === d).length;
            return (
              <Pressable key={d} style={[styles.tab, on && styles.tabOn]} onPress={() => setDay(d)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${t.week} ${t.day}, ${count} things`}>
                <Text style={[styles.tabWeek, on && styles.tabTextOn]}>{t.week}</Text>
                <Text style={[styles.tabDay, on && styles.tabTextOn]}>{t.day}</Text>
                <View style={[styles.tabDot, count === 0 && styles.tabDotEmpty, on && styles.tabDotOn]} />
              </Pressable>
            );
          })}
        </ScrollView>

        {shown ? <Text style={styles.dayHeading}>{dayHeading(outing.playsOn, shown)}</Text> : null}

        {dayItems.length === 0 ? (
          <Text style={styles.empty}>{officer ? "Nothing on this day yet — add a round, travel or a dinner below." : "Nothing planned for this day yet."}</Text>
        ) : (
          dayItems.map((i) => <ItemCard key={i.id} item={i} userId={userId} onPress={() => openItem(i)} />)
        )}

        {officer && !cancelled && shown ? (
          <View style={styles.add}>
            <Text style={styles.addTitle}>{`Add to ${dayHeading(outing.playsOn, shown).split(" · ")[1].split(" ")[0]}`}</Text>
            <View style={styles.addGrid}>
              {itemKindsFor(outing.kind).map((k) => (
                <Pressable key={k} style={[styles.addChip, k === "round" && styles.addChipMain]} onPress={() => addItem(k)} accessibilityRole="button" accessibilityLabel={`Add a ${ITEM_INFO[k].label.toLowerCase()}`}>
                  <Ionicons name={ITEM_INFO[k].icon as keyof typeof Ionicons.glyphMap} size={16} color={k === "round" ? colors.cream50 : colors.navy900} />
                  <Text style={[styles.addChipText, k === "round" && styles.addChipTextMain]}>{ITEM_INFO[k].label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {outing.details ? (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>{officer ? "Trip notes · every day" : "From the organiser"}</Text>
            <Text style={styles.notesBody}>{outing.details}</Text>
          </View>
        ) : null}

        {!amIn && !cancelled ? <Text style={styles.empty}>You&apos;re not on this trip. Join it from the trip&apos;s page to be put on flights, rooms and groups.</Text> : null}
      </ScrollView>
    </View>
  );
}

/** One thing on a day: kind, time, title, the useful line, and your place. */
function ItemCard({ item, userId, onPress }: { item: ItineraryItem; userId: string | null; onPress: () => void }) {
  const info = ITEM_INFO[item.kind];
  const me = item.people.find((p) => p.memberId === userId) ?? null;
  const partners = me ? item.people.filter((p) => p.memberId !== userId && (item.kind === "round" || item.kind === "stay" ? p.slot === me.slot : false)).map((p) => p.firstName) : [];
  const mineLine = myLineFor(item, me, partners);
  const round = item.kind === "round";

  const time = clock(item.startsAt);
  const kicker = `${info.kicker}${time ? ` · ${round ? "FIRST TEE " : ""}${time}` : ""}`;
  const sub =
    item.kind === "flight"
      ? [item.carrier, item.endsAt ? `lands ${clock(item.endsAt)}` : null].filter(Boolean).join(" · ")
      : item.kind === "stay"
        ? `${item.nights ?? 1} ${item.nights === 1 ? "night" : "nights"}${item.people.length ? ` · ${new Set(item.people.map((p) => p.slot)).size} rooms` : ""}`
        : item.kind === "transfer"
          ? [routeLabel(item.fromPlace, item.toPlace), item.carrier].filter(Boolean).join(" · ")
          : round
            ? [item.playFormat ? FORMAT_LABELS[item.playFormat] : null, `${item.teeInterval ?? 10} min apart`].filter(Boolean).join(" · ")
            : null;
  const groups = round ? bySlot(item.people) : [];
  const count = item.people.length;

  return (
    <Pressable style={[styles.card, round && styles.cardRound]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${info.label}: ${item.title}${time ? ` at ${time}` : ""}`}>
      <View style={styles.cardTop}>
        <View style={[styles.icon, { backgroundColor: round ? colors.gold400 : info.tint }]}>
          <Ionicons name={info.icon as keyof typeof Ionicons.glyphMap} size={20} color={round ? colors.navy900 : info.ink} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={styles.kickerRow}>
            <Text style={[styles.kicker, { color: round ? colors.gold400 : info.ink }]}>{kicker}</Text>
            {(item.kind === "flight" || item.kind === "transfer") && count > 0 ? <Text style={[styles.count, round && styles.onNavyMuted]}>{`${count} on it`}</Text> : null}
          </View>
          <Text style={[styles.cardTitle, round && styles.onNavy]}>{item.kind === "flight" ? routeLabel(item.fromPlace, item.toPlace) || item.title : item.title}</Text>
          {item.kind === "flight" && item.title && routeLabel(item.fromPlace, item.toPlace) ? <Text style={styles.cardSub}>{item.title}</Text> : null}
          {sub ? <Text style={[styles.cardSub, round && styles.onNavyMuted]}>{sub}</Text> : null}
        </View>
      </View>
      {round && groups.length > 0 ? (
        <View style={styles.groupGrid}>
          {groups.map(([slot, list]) => (
            <View key={slot} style={[styles.groupTile, me?.slot === slot && styles.groupTileMine]}>
              <Text style={styles.groupTime}>{teeTimeFor(item.startsAt, item.teeInterval, slot) ?? `Group ${slot}`}</Text>
              <Text style={styles.groupMeta}>{`Group ${slot} · ${list.length}`}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {mineLine ? <Text style={[styles.mine, round && styles.mineOnNavy]}>{mineLine}</Text> : null}
      {item.details ? (
        <Text style={[styles.cardSub, round && styles.onNavyMuted]} numberOfLines={2}>
          {item.details}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  hero: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.navy900 },
  badge: { alignSelf: "flex-start", fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.2, color: colors.navy900, backgroundColor: colors.gold400, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
  heroTitle: { fontFamily: fonts.display, fontSize: 30, color: colors.cream50, marginTop: 4 },
  struck: { textDecorationLine: "line-through" },
  heroMeta: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.cream100 },
  countdown: { fontFamily: fonts.display, fontSize: 22, color: colors.gold400, marginTop: 6 },
  stats: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: radii.md, backgroundColor: colors.navy800 },
  statN: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.gold400 },
  statLabel: { fontFamily: fonts.body, fontSize: 11.5, color: colors.cream100 },
  you: { gap: spacing.sm },
  sectionKicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, color: colors.ink500, marginTop: spacing.xs },
  youRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  youTile: { flexGrow: 1, flexBasis: "45%", gap: 2, padding: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  youKicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2 },
  youTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  youMeta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  teeStrip: { gap: 8, padding: 12, borderRadius: radii.md, backgroundColor: colors.navy900 },
  teeStripKicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2, color: colors.gold400 },
  teeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  teeTile: { minWidth: 64, flexGrow: 1, alignItems: "center", paddingVertical: 8, borderRadius: radii.sm, backgroundColor: colors.navy800 },
  teeDay: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.cream100 },
  teeTime: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  tabs: { gap: spacing.sm, paddingVertical: spacing.xs },
  tab: { width: 58, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 1, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  tabWeek: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink500 },
  tabDay: { fontFamily: fonts.bodyBold, fontSize: 19, color: colors.ink900 },
  tabTextOn: { color: colors.gold400 },
  tabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green600, marginTop: 2 },
  tabDotEmpty: { backgroundColor: "transparent" },
  tabDotOn: { backgroundColor: colors.gold400 },
  dayHeading: { fontFamily: fonts.display, fontSize: 21, color: colors.navy900, marginTop: spacing.xs },
  empty: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", paddingVertical: spacing.sm },
  card: { gap: 10, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardRound: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  cardTop: { flexDirection: "row", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  kickerRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2 },
  count: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  cardSub: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  onNavy: { color: colors.cream50 },
  onNavyMuted: { color: colors.cream100 },
  groupGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  groupTile: { minWidth: 92, flexGrow: 1, paddingVertical: 8, paddingHorizontal: 10, borderRadius: radii.sm, backgroundColor: colors.navy800 },
  groupTileMine: { borderWidth: 1, borderColor: colors.gold400 },
  groupTime: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
  groupMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.cream100 },
  mine: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.green700 },
  mineOnNavy: { color: colors.gold400 },
  add: { gap: 10, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, backgroundColor: colors.surface },
  addTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  addGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  addChip: { flexGrow: 1, flexBasis: "30%", flexDirection: "row", gap: 6, minHeight: 44, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.cream100 },
  addChipMain: { backgroundColor: colors.navy900 },
  addChipText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  addChipTextMain: { color: colors.cream50 },
  notes: { gap: 6, padding: 14, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.gold400, backgroundColor: "#fbf3df" },
  notesTitle: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  notesBody: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink900, lineHeight: 21 },
});
