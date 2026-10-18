import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useFocusEffect, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { GroupIcon, membersLabel } from "@/components/group-bits";
import { GroupsHero } from "@/components/groups-hero";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { isOn } from "@/lib/features";
import { GROUP_KIND_INFO, GROUP_OFFICE_LABELS, hasEvents, type GroupKind, type GroupOffice, type GroupRole } from "@/lib/groups";
import { loadMyGroups, loadNextOutings, respondToInvitation, withdrawRequest, type Group, type MyGroups, type NextOuting } from "@/lib/groups-data";
import { dateParts, shortDate } from "@/lib/group-dates";
import { clockTime, todayIso } from "@/lib/tee-times";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * My Groups & Societies (Oct 2026 redesign, canvas boards G1 and G2).
 *
 * Opened from the bronze button on Groups & societies. Invitations first,
 * then your groups, then the societies you've asked to join.
 *
 * Up to RICH_UP_TO groups get a big card each (G1): cover photograph, badge,
 * your role, the next event and quick links. More than that and the page
 * switches to a "Coming up" strip and compact rows (G2), so a long list
 * stays easy to scan.
 */
const RICH_UP_TO = 5;

type MyGroup = MyGroups["groups"][number];

/** The chip's plural for each kind ("Buddies" for crews since Oct 2026). */
const PLURAL: Record<GroupKind, string> = { crew: "Buddies", trip: "Trips", society: "Societies", area: "Local", club: "Clubs" };

/** Tint behind a group with no cover photograph. */
const BANNER: Record<GroupKind, string> = { crew: "#16305a", trip: "#4c1a26", society: "#1f4a2f", area: "#2a3a5f", club: "#3a2a0e" };

function roleChip(role: GroupRole, office: GroupOffice | null | undefined): string | null {
  if (office) return GROUP_OFFICE_LABELS[office];
  if (role === "owner") return "You run it";
  if (role === "admin") return "Admin";
  return null;
}

const open = (id: number) => router.push({ pathname: "/group/[id]", params: { id: String(id) } });

export default function MyGroupsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [data, setData] = useState<MyGroups | null>(null);
  const [next, setNext] = useState<Map<number, NextOuting>>(new Map());
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [filter, setFilter] = useState<GroupKind | "all">("all");

  const load = useCallback(async () => {
    if (!userId || !isOn("groups")) return;
    try {
      const mine = await loadMyGroups(userId);
      setData(mine);
      setFailed(false);
      setNext(await loadNextOutings(mine.groups.map((g) => g.id), userId, todayIso()));
    } catch {
      setFailed(true);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function answer(groupId: number, accept: boolean) {
    setBusy(groupId);
    try {
      await respondToInvitation(groupId, accept);
      if (accept) open(groupId);
      await load();
    } catch (err) {
      Alert.alert("Couldn't answer", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function withdraw(g: Group) {
    Alert.alert(`Withdraw your request to join ${g.name}?`, undefined, [
      { text: "Keep it", style: "cancel" },
      {
        text: "Withdraw",
        style: "destructive",
        onPress: async () => {
          setBusy(g.id);
          try {
            await withdrawRequest(g.id);
            await load();
          } catch (err) {
            Alert.alert("Couldn't withdraw", err instanceof Error ? err.message : "Please try again.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  const groups = data?.groups ?? [];
  const kinds = useMemo(() => {
    const counts = new Map<GroupKind, number>();
    for (const g of groups) counts.set(g.kind, (counts.get(g.kind) ?? 0) + 1);
    return [...counts.entries()];
  }, [groups]);
  const shown = filter === "all" ? groups : groups.filter((g) => g.kind === filter);
  const rich = groups.length <= RICH_UP_TO;
  const members = groups.reduce((n, g) => n + g.memberCount, 0);

  const coming = useMemo(
    () =>
      groups
        .map((g) => ({ g, o: next.get(g.id) }))
        .filter((x): x is { g: MyGroup; o: NextOuting } => !!x.o)
        .sort((a, b) => a.o.playsOn.localeCompare(b.o.playsOn)),
    [groups, next]
  );

  const header = (
    <>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <GroupsHero
        eyebrow="Your groups"
        title="My Groups &"
        accent="Societies."
        line={data ? `${groups.length} ${groups.length === 1 ? "group" : "groups"} · ${members} members` : null}
      />
    </>
  );

  if (data === null) {
    return (
      <View style={styles.fill}>
        {header}
        {failed ? <LoadError onRetry={() => void load()} what="your groups" size="screen" /> : <ActivityIndicator color={colors.green700} style={styles.spinner} />}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.fill}
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
        {/* Invitations */}
        {data.invitations.map((g) => (
          <View key={g.id} style={styles.invite}>
            <Pressable style={styles.inviteHead} onPress={() => open(g.id)} accessibilityRole="button">
              <GroupIcon kind={g.kind} size={48} logoUrl={g.logoUrl} />
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteKicker}>You're invited</Text>
                <Text style={styles.inviteName}>{g.name}</Text>
                <Text style={styles.meta}>
                  {g.invitedBy ? `From ${g.invitedBy} · ` : ""}
                  {GROUP_KIND_INFO[g.kind].label} · {membersLabel(g.memberCount)}
                </Text>
              </View>
            </Pressable>
            <View style={styles.inviteButtons}>
              <Pressable style={[styles.btn, styles.btnMain]} onPress={() => void answer(g.id, true)} disabled={busy === g.id} accessibilityRole="button" accessibilityLabel={`Join ${g.name}`}>
                {busy === g.id ? <ActivityIndicator size="small" color={colors.cream50} /> : <Text style={styles.btnMainText}>Join</Text>}
              </Pressable>
              <Pressable style={styles.btn} onPress={() => void answer(g.id, false)} disabled={busy === g.id} accessibilityRole="button" accessibilityLabel={`Decline ${g.name}`}>
                <Text style={styles.btnText}>Decline</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {groups.length === 0 ? (
          <StateMessage icon="people-outline" title="No groups yet" body="Start Golf Buddies, a trip or a society from Groups & societies, or find a society to join." />
        ) : (
          <>
            {/* G2: what's coming up across all your groups, when there are many. */}
            {!rich && coming.length > 0 ? (
              <>
                <Text style={styles.h2}>Coming up</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} style={styles.stripWrap}>
                  {coming.slice(0, 8).map(({ g, o }) => (
                    <Pressable
                      key={o.outingId}
                      style={({ pressed }) => [styles.ev, pressed && styles.pressed]}
                      onPress={() => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(g.id), outingId: String(o.outingId) } })}
                      accessibilityRole="button"
                    >
                      <View style={[styles.evBand, { backgroundColor: BANNER[g.kind] }]}>
                        {g.coverUrl ? <Image source={{ uri: g.coverUrl }} style={StyleSheet.absoluteFill} /> : null}
                        <View style={styles.evVeil} />
                        <Text style={styles.evDate}>
                          {shortDate(o.playsOn).toUpperCase()}
                          {clockTime(o.firstTee) ? ` · ${clockTime(o.firstTee)}` : ""}
                        </Text>
                      </View>
                      <View style={styles.evBody}>
                        <Text style={styles.evTitle} numberOfLines={1}>
                          {o.title}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {g.name} · {o.going} going
                        </Text>
                        <Text style={[styles.tag, o.mine ? styles.tagIn : styles.tagAsk]}>{o.mine ? "You're in" : "See the event"}</Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            <Text style={styles.h2}>{rich ? "Your groups" : "All your groups"}</Text>
            {kinds.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.stripWrap}>
                <Chip label="All" count={groups.length} on={filter === "all"} onPress={() => setFilter("all")} />
                {kinds.map(([k, n]) => (
                  <Chip key={k} label={PLURAL[k]} count={n} on={filter === k} onPress={() => setFilter(k)} />
                ))}
              </ScrollView>
            ) : null}

            {rich ? (
              <View style={styles.cards}>
                {shown.map((g, i) =>
                  // The first two get the full card; any others a smaller one.
                  i < 2 || shown.length <= 2 ? <RichCard key={g.id} g={g} next={next.get(g.id) ?? null} /> : <SmallCard key={g.id} g={g} next={next.get(g.id) ?? null} />
                )}
              </View>
            ) : (
              <View style={styles.listCard}>
                {shown.map((g, i) => (
                  <Row key={g.id} g={g} next={next.get(g.id) ?? null} first={i === 0} />
                ))}
              </View>
            )}
          </>
        )}

        {data.requested.length > 0 ? (
          <>
            <Text style={styles.eyebrow}>Waiting to hear back</Text>
            {data.requested.map((g) => (
              <View key={g.id} style={styles.waiting}>
                <Pressable style={styles.waitingMain} onPress={() => open(g.id)} accessibilityRole="button">
                  <View style={styles.clock}>
                    <Ionicons name="time-outline" size={22} color={colors.ink500} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{g.name}</Text>
                    <Text style={styles.meta}>You asked to join</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => withdraw(g)} disabled={busy === g.id} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Withdraw your request to join ${g.name}`}>
                  <Text style={styles.withdraw}>Withdraw</Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Chip({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>
        {label} <Text style={[styles.chipCount, on && styles.chipCountOn]}>{count}</Text>
      </Text>
    </Pressable>
  );
}

function NextLine({ g, next }: { g: MyGroup; next: NextOuting | null }) {
  if (!hasEvents(g.kind)) return null;
  const canPlan = g.role === "owner" || g.role === "admin" || g.kind !== "society";
  if (!next) {
    if (!canPlan) return null;
    return (
      <Pressable style={[styles.next, styles.nextEmpty]} onPress={() => router.push({ pathname: "/group/[id]/events", params: { id: String(g.id) } })} accessibilityRole="button">
        <View style={[styles.dateBlock, styles.dateBlockEmpty]}>
          <Ionicons name="add" size={20} color="#8a6a1f" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.nextTitle}>No events yet</Text>
          <Text style={styles.meta}>Plan the first {g.kind === "society" ? "outing" : "day out"}</Text>
        </View>
        <Text style={styles.planLink}>Plan one →</Text>
      </Pressable>
    );
  }
  const p = dateParts(next.playsOn);
  return (
    <Pressable
      style={styles.next}
      onPress={() => router.push({ pathname: "/group/[id]/outing/[outingId]", params: { id: String(g.id), outingId: String(next.outingId) } })}
      accessibilityRole="button"
      accessibilityLabel={`Next: ${next.title}, ${shortDate(next.playsOn)}`}
    >
      <View style={styles.dateBlock}>
        <Text style={styles.dateDay}>{p.day}</Text>
        <Text style={styles.dateNum}>{p.date}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.nextKicker}>{g.kind === "society" ? "Next outing" : "Next up"}</Text>
        <Text style={styles.nextTitle} numberOfLines={1}>
          {next.title}
          {next.course ? ` · ${next.course}` : ""}
        </Text>
        <Text style={styles.meta}>{next.going} going</Text>
      </View>
      {next.mine ? <Text style={[styles.tag, styles.tagIn]}>You're in</Text> : null}
    </Pressable>
  );
}

function RichCard({ g, next }: { g: MyGroup; next: NextOuting | null }) {
  const role = roleChip(g.role, g.office);
  const links: { icon: keyof typeof Ionicons.glyphMap; label: string; href: Href }[] = [];
  if (hasEvents(g.kind)) links.push({ icon: "calendar-outline", label: "Events", href: { pathname: "/group/[id]/events", params: { id: String(g.id) } } });
  if (g.kind === "society") links.push({ icon: "trophy-outline", label: "Results", href: { pathname: "/group/[id]/results", params: { id: String(g.id) } } });
  if (g.conversationId) links.push({ icon: "chatbubble-outline", label: "Chat", href: { pathname: "/conversation/[id]", params: { id: String(g.conversationId) } } });
  links.push({ icon: "people-outline", label: "Members", href: { pathname: "/group/[id]", params: { id: String(g.id) } } });

  return (
    <View style={styles.card}>
      <Pressable onPress={() => open(g.id)} accessibilityRole="button" accessibilityLabel={`${g.name}, ${GROUP_KIND_INFO[g.kind].label}, ${membersLabel(g.memberCount)}`}>
        <View style={[styles.banner, { backgroundColor: BANNER[g.kind] }]}>
          {g.coverUrl ? <Image source={{ uri: g.coverUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          <View style={styles.bannerVeil} />
          {role ? <Text style={[styles.roleChip, styles.roleOnPhoto]}>{role}</Text> : null}
        </View>
        <View style={styles.cardHead}>
          <View style={styles.logoRing}>
            <GroupIcon kind={g.kind} size={60} logoUrl={g.logoUrl} />
          </View>
          <View style={{ flex: 1, paddingBottom: 2 }}>
            <Text style={styles.cardName} numberOfLines={2}>
              {g.name}
            </Text>
            <Text style={styles.meta}>
              {GROUP_KIND_INFO[g.kind].label} · {membersLabel(g.memberCount)}
            </Text>
          </View>
        </View>
      </Pressable>
      <View style={styles.cardBody}>
        <NextLine g={g} next={next} />
      </View>
      <View style={styles.tabs}>
        {links.map((l) => (
          <Pressable key={l.label} style={({ pressed }) => [styles.tab, pressed && styles.pressed]} onPress={() => router.push(l.href)} accessibilityRole="button" accessibilityLabel={`${g.name}: ${l.label}`}>
            <Ionicons name={l.icon} size={20} color={colors.green700} />
            <Text style={styles.tabText}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SmallCard({ g, next }: { g: MyGroup; next: NextOuting | null }) {
  const role = roleChip(g.role, g.office);
  return (
    <Pressable style={({ pressed }) => [styles.small, pressed && styles.pressed]} onPress={() => open(g.id)} accessibilityRole="button">
      <GroupIcon kind={g.kind} size={52} logoUrl={g.logoUrl} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {g.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {GROUP_KIND_INFO[g.kind].label} · {membersLabel(g.memberCount)}
          {role ? <Text style={styles.roleText}>{` · ${role}`}</Text> : null}
        </Text>
        {next ? <Text style={styles.nextSmall} numberOfLines={1}>{`Next: ${shortDate(next.playsOn)} · ${next.title}`}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function Row({ g, next, first }: { g: MyGroup; next: NextOuting | null; first: boolean }) {
  const role = roleChip(g.role, g.office);
  return (
    <Pressable style={({ pressed }) => [styles.row, !first && styles.rowLine, pressed && styles.pressed]} onPress={() => open(g.id)} accessibilityRole="button">
      <GroupIcon kind={g.kind} size={50} logoUrl={g.logoUrl} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {g.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {membersLabel(g.memberCount)}
          {role ? <Text style={styles.roleText}>{` · ${role}`}</Text> : null}
        </Text>
        {next ? (
          <Text style={styles.nextSmall} numberOfLines={1}>{`Next: ${shortDate(next.playsOn)} · ${next.title}`}</Text>
        ) : hasEvents(g.kind) ? (
          <Text style={[styles.meta, { marginTop: 2 }]}>No events yet</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, paddingTop: spacing.lg, gap: 14 },
  pressed: { opacity: 0.85 },
  h2: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900, marginTop: 6 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: colors.ink500, marginTop: 10 },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },

  invite: { borderRadius: 22, backgroundColor: "#f8ecd0", borderWidth: 1.5, borderColor: colors.gold500, padding: 14, gap: 12 },
  inviteHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  inviteKicker: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: "#8a6a1f" },
  inviteName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  inviteButtons: { flexDirection: "row", gap: spacing.sm },
  btn: { flex: 1, height: 44, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  btnMain: { backgroundColor: colors.green700, borderColor: colors.green700 },
  btnText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },
  btnMainText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },

  stripWrap: { marginHorizontal: -spacing.md },
  strip: { gap: 12, paddingHorizontal: spacing.md, paddingBottom: 4 },
  ev: { width: 220, borderRadius: 20, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  evBand: { height: 92, justifyContent: "flex-end", padding: 10 },
  evVeil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,18,34,0.42)" },
  evDate: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, color: "#ffffff" },
  evBody: { padding: 12, gap: 2 },
  evTitle: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900 },

  chips: { gap: 8, paddingHorizontal: spacing.md },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  chipOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  chipTextOn: { color: "#ffffff" },
  chipCount: { color: "#8a6a1f" },
  chipCountOn: { color: colors.gold400 },

  cards: { gap: 16 },
  card: {
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
    shadowColor: colors.navy900,
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  banner: { height: 100 },
  bannerVeil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(10,18,34,0.22)" },
  roleChip: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden" },
  roleOnPhoto: { position: "absolute", top: 12, right: 12, backgroundColor: colors.gold400, color: colors.navy900 },
  cardHead: { flexDirection: "row", alignItems: "flex-end", gap: 12, paddingHorizontal: 14, marginTop: -28 },
  logoRing: {
    borderRadius: 18,
    borderWidth: 3,
    borderColor: colors.surface,
    backgroundColor: colors.surface,
    shadowColor: colors.navy900,
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardName: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink900 },
  cardBody: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, gap: 10 },

  next: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#fbf6ea", borderWidth: 1, borderColor: "#ede2c6", borderRadius: 14, padding: 10 },
  nextEmpty: { backgroundColor: colors.surface, borderStyle: "dashed" },
  dateBlock: { width: 44, height: 46, borderRadius: 10, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  dateBlockEmpty: { backgroundColor: colors.cream50, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.gold500 },
  dateDay: { fontFamily: fonts.bodyBold, fontSize: 9, letterSpacing: 0.8, color: colors.gold400 },
  dateNum: { fontSize: 17, fontWeight: "800", color: colors.gold400 },
  nextKicker: { fontFamily: fonts.bodyBold, fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: colors.green700 },
  nextTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink900 },
  planLink: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.green700 },
  tag: { fontFamily: fonts.bodyBold, fontSize: 11, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden", alignSelf: "flex-start" },
  tagIn: { backgroundColor: colors.green100, color: colors.green800 },
  tagAsk: { backgroundColor: "#fbf3dc", color: "#8a6a1f", marginTop: 6 },

  tabs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#eee6d4" },
  tab: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 10 },
  tabText: { fontFamily: fonts.bodyBold, fontSize: 12, color: "#3e4757" },

  small: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink900 },
  roleText: { color: "#8a6a1f", fontFamily: fonts.bodyBold },
  nextSmall: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green700, marginTop: 3 },

  listCard: { borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowLine: { borderTopWidth: 1, borderTopColor: "#eee6d4" },

  waiting: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 22, backgroundColor: colors.surfaceTint, borderWidth: 1, borderColor: colors.line },
  waitingMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  clock: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.cream100, alignItems: "center", justifyContent: "center" },
  withdraw: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.red600 },
});
