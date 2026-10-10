import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/avatar";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { useAuth } from "@/lib/auth";
import {
  dismissSuggestion,
  guestScorecardMessage,
  loadPlayedWith,
  loadSuggestions,
  shareVia,
  type PlayedWith,
  type Suggestion,
} from "@/lib/find-pinpals";
import { conversationWith, listMembers, requestConnection, type ConnectionState, type Member } from "@/lib/members";
import { suggestedPinPals, type Suggestion as NearbyRow } from "@/lib/onboarding";
import { loadMyProfile, type MyProfile } from "@/lib/profile";
import { listInvites, type Invite } from "@/lib/tee-times";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/**
 * Find PinPals (Oct 2026 redesign, approved mock-ups 1 and 2).
 *
 * FOR YOU (no search): who you've played with, people you may know (with
 * the reason — played together, mutual PinPals, your club, courses in
 * common: member_suggestions(), 0118), bring your fourball, and who has a
 * place in a game this week.
 *
 * MY CLUB / NEARBY / CONNECTED: one list each.
 *
 * SEARCHING: results grouped Your PinPals, At your club, Everyone, with
 * filters (similar handicap, my county, has a game free), and an invite for
 * when the person isn't on PinPals yet.
 *
 * /find-pinpals still forwards here.
 */

type Tab = "for-you" | "club" | "nearby" | "connected";
const TABS: { key: Tab; label: string }[] = [
  { key: "for-you", label: "For you" },
  { key: "club", label: "My club" },
  { key: "nearby", label: "Nearby" },
  { key: "connected", label: "Connected" },
];
type Filter = "handicap" | "county" | "free";

type Row = {
  id: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  club: string | null;
  handicap: number | null;
  reason: string | null;
};

const LIP = "#9c7a2c";
const SAND = "#f3ead2";

export default function MembersScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("for-you");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [me, setMe] = useState<MyProfile | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [played, setPlayed] = useState<PlayedWith[]>([]);
  const [games, setGames] = useState<Invite[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Member[]>([]);
  const [connections, setConnections] = useState<Map<string, ConnectionState>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const searching = query.trim() !== "";
  const token = useRef(0);

  useEffect(() => {
    if (userId) void loadMyProfile(userId).then(setMe);
  }, [userId]);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const mine = ++token.current;
    try {
      if (searching) {
        const [dir, open] = await Promise.all([listMembers(userId, "everyone", query), games.length ? Promise.resolve(games) : listInvites(60)]);
        if (mine !== token.current) return;
        setResults(dir.members);
        setConnections(dir.connections);
        if (!games.length) setGames(open);
        return;
      }
      if (tab === "for-you") {
        const [s, p, open, dir] = await Promise.all([loadSuggestions(12), loadPlayedWith(), listInvites(60), listMembers(userId, "connections", "")]);
        if (mine !== token.current) return;
        setSuggestions(s);
        setPlayed(p.filter((x) => x.connection !== "accepted").slice(0, 8));
        setGames(open);
        setConnections(dir.connections);
        return;
      }
      if (tab === "nearby") {
        const near = await suggestedPinPals(40, 40);
        if (mine !== token.current) return;
        setRows(
          near
            .filter((n) => n.distance_km != null)
            .sort((a, b) => (a.distance_km ?? 0) - (b.distance_km ?? 0))
            .map((n: NearbyRow) => ({
              id: n.id,
              name: [n.first_name, n.last_name].filter(Boolean).join(" "),
              avatarUrl: n.avatar_url,
              avatarColor: n.avatar_color,
              club: n.home_club,
              handicap: n.handicap,
              reason: n.same_club ? "At your club" : `${Math.round(n.distance_km ?? 0)} km away`,
            }))
        );
        setConnections(new Map());
        return;
      }
      const dir = await listMembers(userId, tab === "club" ? "club" : "connections", "");
      if (mine !== token.current) return;
      setRows(dir.members.map((m) => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, avatarColor: m.avatarColor, club: m.homeClub, handicap: m.handicap, reason: null })));
      setConnections(dir.connections);
    } finally {
      if (mine === token.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // games is read as a cache, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tab, query, searching]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => void load(), searching ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, searching]);

  // Back from a member's page: you may have connected there.
  const focused = useRef(false);
  const latest = useRef(load);
  latest.current = load;
  useFocusEffect(
    useCallback(() => {
      if (!focused.current) {
        focused.current = true;
        return;
      }
      void latest.current();
    }, [])
  );

  const hosts = useMemo(() => new Set(games.map((g) => g.member_id)), [games]);

  async function connect(id: string) {
    if (!userId) return;
    setBusyId(id);
    try {
      await requestConnection(userId, id);
      setConnections((prev) => new Map(prev).set(id, { connectionId: -1, status: "pending", theirsToAnswer: false }));
    } catch (err) {
      Alert.alert("Couldn't send that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function message(id: string) {
    setBusyId(id);
    try {
      router.push(`/conversation/${await conversationWith(id)}`);
    } catch (err) {
      Alert.alert("Can't start that conversation", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function notNow(id: string) {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    void dismissSuggestion(id);
  }

  function inviteGuest(p: PlayedWith) {
    const send = async (channel: "whatsapp" | "sms" | "more") => {
      try {
        await shareVia(channel, await guestScorecardMessage(p.playerId, p.name, p.courseName));
        setPlayed((prev) => prev.map((x) => (x.playerId === p.playerId ? { ...x, invited: true } : x)));
      } catch (err) {
        Alert.alert("Couldn't make the link", err instanceof Error ? err.message : "Please try again.");
      }
    };
    Alert.alert(`Send ${p.name.split(" ")[0]} the scorecard`, `From ${p.courseName}. Joining PinPals saves the round to their profile and connects you.`, [
      { text: "WhatsApp", onPress: () => void send("whatsapp") },
      { text: "Text message", onPress: () => void send("sms") },
      { text: "Other…", onPress: () => void send("more") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  const statusOf = (id: string) => connections.get(id);
  const toggleFilter = (f: Filter) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  // ---- searching: filter and group ----
  const grouped = useMemo(() => {
    if (!searching) return [];
    const myHcp = me?.handicap ?? null;
    const filtered = results.filter((m) => {
      if (filters.has("handicap") && (myHcp == null || m.handicap == null || Math.abs(m.handicap - myHcp) > 5)) return false;
      if (filters.has("county") && (!me?.county || m.county !== me.county)) return false;
      if (filters.has("free") && !hosts.has(m.id)) return false;
      return true;
    });
    const toRow = (m: Member, reason: string | null): Row => ({ id: m.id, name: m.name, avatarUrl: m.avatarUrl, avatarColor: m.avatarColor, club: m.homeClub, handicap: m.handicap, reason });
    const pals = filtered.filter((m) => statusOf(m.id)?.status === "accepted");
    const club = filtered.filter((m) => !pals.includes(m) && me?.homeClub && m.homeClub === me.homeClub);
    const rest = filtered.filter((m) => !pals.includes(m) && !club.includes(m));
    return [
      { title: "Your PinPals", rows: pals.map((m) => toRow(m, hosts.has(m.id) ? "Has a place in a game" : null)) },
      { title: me?.homeClub ? `At ${me.homeClub}` : "At your club", rows: club.map((m) => toRow(m, hosts.has(m.id) ? "Has a place in a game" : null)) },
      { title: "Everyone", rows: rest.map((m) => toRow(m, hosts.has(m.id) ? "Has a place in a game" : m.county)) },
    ].filter((g) => g.rows.length > 0);
    // statusOf reads connections
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, results, filters, me, hosts, connections]);

  const thisWeek = useMemo(() => {
    const limit = new Date();
    limit.setDate(limit.getDate() + 7);
    const end = limit.toISOString().slice(0, 10);
    const seen = new Set<string>();
    return games
      .filter((g) => g.member_id !== userId && g.play_date <= end && !seen.has(g.member_id) && seen.add(g.member_id))
      .slice(0, 3);
  }, [games, userId]);

  const rowAction = (r: Row) => (
    <RowAction status={statusOf(r.id)} busy={busyId === r.id} onConnect={() => void connect(r.id)} onMessage={() => void message(r.id)} />
  );

  return (
    <>
      <Stack.Screen options={{ headerTitle: "", headerBackTitle: "Back" }} />
      <View style={styles.fill}>
        <View style={[styles.band, { paddingTop: spacing.md }]}>
          {!searching ? (
            <View style={styles.bandTop}>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={styles.rule} />
                <Text style={styles.title}>Find PinPals</Text>
                <Text style={styles.subtitle}>Golfers you know — and golfers like you</Text>
              </View>
              <Pressable onPress={() => router.push("/invite-friends")} style={styles.qr} accessibilityRole="button" accessibilityLabel="Your PinPals code">
                <Ionicons name="qr-code-outline" size={20} color={colors.gold400} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.searchRow}>
            <View style={[styles.search, searching && styles.searchOn]}>
              <Ionicons name="search" size={18} color={colors.ink500} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or club"
                placeholderTextColor={colors.ink500}
                autoCorrect={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            {searching ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button">
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {searching
              ? ([
                  ["handicap", me?.handicap != null ? `Handicap ${Math.max(0, Math.round(me.handicap - 5))}–${Math.round(me.handicap + 5)}` : "Similar handicap"],
                  ["county", me?.county ? `Co. ${me.county}` : "My county"],
                  ["free", "Has a game free"],
                ] as [Filter, string][]).map(([key, label]) => (
                  <Chip key={key} label={label} on={filters.has(key)} onPress={() => toggleFilter(key)} />
                ))
              : TABS.map((t) => <Chip key={t.key} label={t.label} on={tab === t.key} onPress={() => setTab(t.key)} />)}
          </ScrollView>
        </View>

        <ScrollView
          keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.navy900}
            />
          }
        >
          {loading ? (
            <ActivityIndicator color={colors.navy900} style={{ marginTop: spacing.xl }} />
          ) : searching ? (
            <>
              {grouped.map((g) => (
                <View key={g.title} style={{ gap: 8 }}>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  <View style={styles.listCard}>
                    {g.rows.map((r, i) => (
                      <MemberRow key={r.id} row={r} last={i === g.rows.length - 1} action={rowAction(r)} />
                    ))}
                  </View>
                </View>
              ))}
              {grouped.length === 0 ? <Text style={styles.empty}>Nobody matched that.</Text> : null}
              <Pressable onPress={() => router.push("/invite-friends")} style={styles.cantFind} accessibilityRole="button">
                <Ionicons name="paper-plane-outline" size={22} color="#7a6a3e" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cantFindTitle}>Can&apos;t find {query.trim().split(" ")[0]}?</Text>
                  <Text style={styles.cantFindBody}>Send them a link by WhatsApp or text</Text>
                </View>
                <Text style={styles.cantFindLink}>Invite</Text>
              </Pressable>
            </>
          ) : tab === "for-you" ? (
            <>
              {played.length > 0 ? (
                <View style={[styles.card, { marginHorizontal: spacing.md }]}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>You&apos;ve played with</Text>
                    <Text style={styles.cardNote}>From your rounds</Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
                    {played.map((p) => {
                      const guest = !p.memberId;
                      const pending = p.connection === "pending" || statusOf(p.memberId ?? "")?.status === "pending";
                      return (
                        <Pressable
                          key={p.playerId}
                          onPress={() => (guest ? inviteGuest(p) : router.push({ pathname: "/member/[id]", params: { id: p.memberId! } }))}
                          style={styles.played}
                          accessibilityRole="button"
                          accessibilityLabel={guest ? `Invite ${p.name}` : p.name}
                        >
                          {guest ? (
                            <View style={styles.guestCircle}>
                              <Text style={styles.guestInitials}>{initials(p.name)}</Text>
                            </View>
                          ) : (
                            <View>
                              <Avatar url={p.avatarUrl} color={p.avatarColor} name={p.name} size={52} />
                              {!pending ? (
                                <Pressable onPress={() => void connect(p.memberId!)} style={styles.plus} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Connect with ${p.name}`}>
                                  <Text style={styles.plusText}>+</Text>
                                </Pressable>
                              ) : null}
                            </View>
                          )}
                          <Text style={[styles.playedName, guest && { color: "#7a6a3e" }]} numberOfLines={1}>
                            {guest ? (p.invited ? "Sent ✓" : `Invite ${p.name.split(" ")[0]}`) : pending ? "Requested" : p.name.split(" ")[0]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              {suggestions.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <Text style={[styles.section, { paddingHorizontal: spacing.md }]}>People you may know</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: spacing.md, paddingBottom: 6 }}>
                    {suggestions.map((s) => {
                      const st = statusOf(s.id);
                      return (
                        <View key={s.id} style={styles.suggest}>
                          <Pressable onPress={() => notNow(s.id)} style={styles.dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Not now, ${s.name}`}>
                            <Ionicons name="close" size={16} color={colors.ink500} />
                          </Pressable>
                          <Pressable onPress={() => router.push({ pathname: "/member/[id]", params: { id: s.id } })} style={{ alignItems: "center", gap: 6 }} accessibilityRole="link">
                            <Avatar url={s.avatarUrl} color={s.avatarColor} name={s.name} size={64} />
                            <Text style={styles.suggestName} numberOfLines={1}>{s.name}</Text>
                            <Text style={styles.suggestClub} numberOfLines={1}>{s.homeClub ?? " "}</Text>
                          </Pressable>
                          <Text style={styles.reason} numberOfLines={1}>{s.reason}</Text>
                          {st?.status === "pending" ? (
                            <View style={[styles.smallBtn, styles.smallBtnQuiet]}>
                              <Text style={styles.smallBtnQuietText}>Requested</Text>
                            </View>
                          ) : (
                            <Pressable onPress={() => void connect(s.id)} disabled={busyId === s.id} accessibilityRole="button" style={{ alignSelf: "stretch" }}>
                              {({ pressed }) => (
                                <View style={[styles.goldLip, pressed && styles.goldLipPressed]}>
                                  <View style={styles.smallBtn}>
                                    {busyId === s.id ? <ActivityIndicator color={colors.navy900} size="small" /> : <Text style={styles.smallBtnText}>Connect</Text>}
                                  </View>
                                </View>
                              )}
                            </Pressable>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              <Pressable onPress={() => router.push("/invite-friends")} style={styles.invite} accessibilityRole="button">
                <View style={styles.inviteIcon}>
                  <Ionicons name="person-add" size={19} color={colors.navy900} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inviteTitle}>Bring your fourball</Text>
                  <Text style={styles.inviteBody}>Your link and QR code — they join, you&apos;re connected</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.gold400} />
              </Pressable>

              {thisWeek.length > 0 ? (
                <View style={{ gap: 8, paddingHorizontal: spacing.md }}>
                  <Text style={styles.section}>Looking for a game this week</Text>
                  {thisWeek.map((g) => {
                    const name = [g.host?.first_name, g.host?.last_name].filter(Boolean).join(" ") || "A member";
                    const hcp = g.host?.handicap_visible && g.host.handicap != null ? ` · ${g.host.handicap}` : "";
                    return (
                      <Pressable key={g.id} onPress={() => router.push(`/invite/${g.id}`)} style={[styles.card, styles.gameRow]} accessibilityRole="button">
                        <Avatar url={g.host?.avatar_url} color={g.host?.avatar_color} name={name} size={46} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowName}>
                            {name}
                            <Text style={styles.rowHcp}>{hcp}</Text>
                          </Text>
                          <Text style={styles.free} numberOfLines={1}>
                            {g.spaces_available} {g.spaces_available === 1 ? "place" : "places"} · {dayLabel(g.play_date)} · {g.club?.name ?? g.club_name ?? ""}
                          </Text>
                        </View>
                        <View style={styles.hello}>
                          <Text style={styles.helloText}>Ask to join</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {played.length === 0 && suggestions.length === 0 && thisWeek.length === 0 ? (
                <Text style={styles.empty}>Set your home club in your profile and we&apos;ll suggest golfers you&apos;ll know.</Text>
              ) : null}
            </>
          ) : (
            <View style={{ paddingHorizontal: spacing.md, gap: 8 }}>
              {rows.length === 0 ? (
                <Text style={styles.empty}>
                  {tab === "club"
                    ? me?.homeClub
                      ? "Nobody else from your club yet — invite them."
                      : "Add your home club to your profile to see who plays there."
                    : tab === "connected"
                      ? "No connections yet. Connect with a few golfers and they'll show up here."
                      : "No golfers near your club yet."}
                </Text>
              ) : (
                <View style={[styles.listCard, { marginHorizontal: 0 }]}>
                  {rows.map((r, i) => (
                    <MemberRow key={r.id} row={r} last={i === rows.length - 1} action={rowAction(r)} />
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function MemberRow({ row, last, action }: { row: Row; last: boolean; action: React.ReactNode }) {
  return (
    <View style={[styles.row, !last && styles.rowLine]}>
      <Pressable onPress={() => router.push({ pathname: "/member/[id]", params: { id: row.id } })} style={styles.rowMain} accessibilityRole="link" accessibilityLabel={row.name}>
        <Avatar url={row.avatarUrl} color={row.avatarColor} name={row.name} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowName} numberOfLines={1}>
            {row.name}
            {row.handicap != null ? <Text style={styles.rowHcp}> · {row.handicap}</Text> : null}
          </Text>
          <Text style={styles.rowClub} numberOfLines={1}>{row.club ?? "No club set yet"}</Text>
          {row.reason ? <Text style={styles.rowReason} numberOfLines={1}>{row.reason}</Text> : null}
        </View>
      </Pressable>
      {action}
    </View>
  );
}

function RowAction({ status, busy, onConnect, onMessage }: { status: ConnectionState | undefined; busy: boolean; onConnect: () => void; onMessage: () => void }) {
  if (busy) return <ActivityIndicator color={colors.navy900} />;
  if (status?.status === "accepted") {
    return (
      <Pressable onPress={onMessage} style={styles.msg} accessibilityRole="button" accessibilityLabel="Message">
        <Ionicons name="chatbubble-outline" size={18} color={colors.navy900} />
      </Pressable>
    );
  }
  if (status?.status === "pending") {
    return <Text style={styles.pending}>{status.theirsToAnswer ? "Asked you" : "Requested"}</Text>;
  }
  return (
    <Pressable onPress={onConnect} accessibilityRole="button">
      {({ pressed }) => (
        <View style={[styles.goldLip, pressed && styles.goldLipPressed]}>
          <View style={styles.rowBtn}>
            <Text style={styles.smallBtnText}>Connect</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

const shadow = {
  shadowColor: colors.navy900,
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },

  band: { backgroundColor: colors.navy900, paddingHorizontal: spacing.md, paddingBottom: 14, gap: 12 },
  bandTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 34, height: 3, borderRadius: 2, backgroundColor: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.cream50 },
  subtitle: { fontFamily: fonts.body, fontSize: 14, color: "#c9d2de" },
  qr: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.gold400, alignItems: "center", justifyContent: "center" },

  searchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  search: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, height: 48, borderRadius: 24, paddingHorizontal: 16, backgroundColor: colors.cream50, borderWidth: 2, borderColor: "transparent" },
  searchOn: { borderColor: colors.gold400 },
  searchInput: { flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.ink900 },
  cancel: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.gold400 },

  chips: { gap: 8 },
  chip: { height: 36, paddingHorizontal: 15, borderRadius: 18, borderWidth: 1.5, borderColor: "#3a4f6b", justifyContent: "center" },
  chipOn: { backgroundColor: colors.gold400, borderColor: colors.gold400 },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.cream50 },
  chipTextOn: { fontFamily: fonts.bodyBold, color: colors.navy900 },

  body: { paddingTop: spacing.md, gap: 18 },
  section: { fontSize: 18, fontWeight: "800", color: colors.navy900 },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: colors.ink500, paddingHorizontal: spacing.md },
  empty: { fontFamily: fonts.body, fontSize: 15, color: colors.ink500, textAlign: "center", paddingHorizontal: spacing.lg, marginTop: spacing.md },

  card: { backgroundColor: colors.surface, borderRadius: 18, padding: 14, gap: 10, ...shadow },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  cardTitle: { fontSize: 16, fontWeight: "800", color: colors.navy900 },
  cardNote: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500 },

  played: { width: 64, alignItems: "center", gap: 5 },
  plus: { position: "absolute", right: -3, bottom: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.gold400, borderWidth: 2, borderColor: colors.surface, alignItems: "center", justifyContent: "center" },
  plusText: { fontSize: 15, fontWeight: "800", color: colors.navy900, lineHeight: 17 },
  guestCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderStyle: "dashed", borderColor: "#b9a777", alignItems: "center", justifyContent: "center" },
  guestInitials: { fontFamily: fonts.bodyBold, fontSize: 17, color: "#7a6a3e" },
  playedName: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.ink900, textAlign: "center" },

  suggest: { width: 158, backgroundColor: colors.surface, borderRadius: 18, paddingTop: 16, paddingHorizontal: 12, paddingBottom: 12, alignItems: "center", gap: 6, ...shadow },
  dismiss: { position: "absolute", top: 6, right: 6, width: 28, height: 28, alignItems: "center", justifyContent: "center", zIndex: 1 },
  suggestName: { fontSize: 15, fontWeight: "800", color: colors.navy900, maxWidth: 134 },
  suggestClub: { fontFamily: fonts.body, fontSize: 12, color: colors.ink500, maxWidth: 134 },
  reason: { fontFamily: fonts.bodyBold, fontSize: 11.5, color: colors.green700, backgroundColor: colors.green100, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, overflow: "hidden", maxWidth: 134 },

  goldLip: { borderRadius: 20, backgroundColor: LIP, paddingBottom: 3 },
  goldLipPressed: { paddingBottom: 0, marginTop: 3 },
  smallBtn: { height: 38, borderRadius: 20, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  smallBtnText: { fontSize: 14, fontWeight: "800", color: colors.navy900 },
  smallBtnQuiet: { backgroundColor: SAND, alignSelf: "stretch", marginTop: 4 },
  smallBtnQuietText: { fontFamily: fonts.bodyBold, fontSize: 13, color: "#7a6a3e" },

  invite: { marginHorizontal: spacing.md, backgroundColor: colors.navy900, borderRadius: 18, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  inviteIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  inviteTitle: { fontSize: 15, fontWeight: "800", color: colors.gold400 },
  inviteBody: { fontFamily: fonts.body, fontSize: 12.5, color: "#c9d2de" },

  gameRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  free: { fontFamily: fonts.bodySemi, fontSize: 12.5, color: colors.green700 },
  hello: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1.5, borderColor: colors.navy900, justifyContent: "center" },
  helloText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.navy900 },

  listCard: { marginHorizontal: spacing.md, backgroundColor: colors.surface, borderRadius: 16, ...shadow },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: "#eee7d6" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: "800", color: colors.navy900 },
  rowHcp: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  rowClub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  rowReason: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.green700 },
  rowBtn: { height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: colors.gold400, alignItems: "center", justifyContent: "center" },
  msg: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  pending: { fontFamily: fonts.bodyBold, fontSize: 12.5, color: "#7a6a3e" },

  cantFind: { marginHorizontal: spacing.md, backgroundColor: "#fbf3dd", borderRadius: 16, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  cantFindTitle: { fontSize: 14, fontWeight: "800", color: colors.navy900 },
  cantFindBody: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  cantFindLink: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.navy900 },
});
