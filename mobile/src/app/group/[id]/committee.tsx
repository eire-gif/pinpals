import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type AlertButton } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { Card, Chip, Kicker, type ChipTone } from "@/components/society-bits";
import { LoadError, StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { GROUP_OFFICES, GROUP_OFFICE_LABELS, isGroupOffice, officeAreas, type GroupOffice, type SocietyArea } from "@/lib/groups";
import { loadGroupPage, setMemberOffice, type GroupPage } from "@/lib/groups-data";
import { indicatorLabel } from "@/lib/handicap-indicator";
import {
  MEMBERSHIP_LABELS,
  billingSeason,
  loadMembershipSettings,
  loadSocietyMembers,
  markMembership,
  mySocietyAreas,
  remindMembership,
  seasonLabel,
  type MembershipSettings,
  type MembershipStatus,
  type SocietyMember,
} from "@/lib/society";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { myRoundRight } from "@/components/my-round-pill";

type Filter = "all" | MembershipStatus;

const FILTERS: { key: Filter; label: string; membership: boolean }[] = [
  { key: "all", label: "All", membership: false },
  { key: "paid", label: MEMBERSHIP_LABELS.paid, membership: true },
  { key: "unpaid", label: MEMBERSHIP_LABELS.unpaid, membership: true },
  { key: "claimed", label: MEMBERSHIP_LABELS.claimed, membership: true },
  { key: "honorary", label: MEMBERSHIP_LABELS.honorary, membership: true },
  { key: "lapsed", label: MEMBERSHIP_LABELS.lapsed, membership: true },
];

const MEMBERSHIP_TONE: Record<MembershipStatus, ChipTone> = {
  paid: "ok",
  honorary: "navy",
  lapsed: "grey",
  claimed: "asked",
  unpaid: "due",
};

const AREA_LABELS: Record<SocietyArea, string> = {
  events: "Events",
  people: "Members",
  money: "Money",
  handicaps: "Handicaps",
  messages: "Messages",
};

const isFilter = (v: unknown): v is Filter => typeof v === "string" && FILTERS.some((f) => f.key === v);

/**
 * A society's members (0144), for whoever has the people or money area:
 * the committee, the full list with each member's membership for the
 * billing season, and a menu per member to mark them paid, honorary or
 * lapsed, remind them, or (the owner) give them a role. What each office
 * may do is the database's (officeAreas mirrors it for the explainer).
 */
export default function SocietyCommitteeScreen() {
  const { id: rawId, filter: rawFilter } = useLocalSearchParams<{ id: string; filter?: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [areas, setAreas] = useState<SocietyArea[] | null>(null);
  const [page, setPage] = useState<GroupPage | null | undefined>(undefined);
  const [members, setMembers] = useState<SocietyMember[] | null>(null);
  const [settings, setSettings] = useState<MembershipSettings | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(isFilter(rawFilter) ? rawFilter : "all");
  const [showRoles, setShowRoles] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId || !Number.isInteger(groupId)) return;
    try {
      const a = await mySocietyAreas(groupId);
      setAreas(a);
      if (!a.includes("people") && !a.includes("money")) return;
      const [p, list, s, bs] = await Promise.all([loadGroupPage(groupId, userId), loadSocietyMembers(groupId), loadMembershipSettings(groupId), billingSeason(groupId)]);
      setPage(p);
      setMembers(list);
      setSettings(s);
      setSeason(bs);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const people = useMemo(() => new Map((page?.members ?? []).map((m) => [m.id, m])), [page]);
  const membershipOn = !!settings?.enabled;
  const canMoney = !!areas?.includes("money");
  const canPeople = !!areas?.includes("people");
  const isOwner = page?.myRole === "owner";

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, paid: 0, unpaid: 0, claimed: 0, honorary: 0, lapsed: 0 };
    for (const m of members ?? []) {
      c.all += 1;
      if (m.membership) c[m.membership] += 1;
    }
    return c;
  }, [members]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return [...(members ?? [])]
      .filter((m) => filter === "all" || m.membership === filter)
      .filter((m) => words.every((w) => m.name.toLowerCase().includes(w)))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IE"));
  }, [members, filter, query]);

  const committee = useMemo(
    () =>
      (members ?? [])
        .filter((m): m is SocietyMember & { office: GroupOffice } => isGroupOffice(m.office))
        .sort((a, b) => GROUP_OFFICES.indexOf(a.office) - GROUP_OFFICES.indexOf(b.office) || a.name.localeCompare(b.name, "en-IE")),
    [members]
  );

  async function act(key: string, fn: () => Promise<void>, done?: string) {
    setBusy(key);
    try {
      await fn();
      await load();
      if (done) Alert.alert(done);
    } catch (err) {
      Alert.alert("Couldn't do that", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function giveRole(m: SocietyMember) {
    const options: AlertButton[] = GROUP_OFFICES.map((office) => ({
      text: m.office === office ? `${GROUP_OFFICE_LABELS[office]} (now)` : GROUP_OFFICE_LABELS[office],
      onPress: () => void act(m.id, () => setMemberOffice(groupId, m.id, office)),
    }));
    options.push({ text: "No role", style: "destructive", onPress: () => void act(m.id, () => setMemberOffice(groupId, m.id, null)) });
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(`Give ${m.name} a role`, "Each role opens part of the society to them. See Roles & access.", options);
  }

  function openMember(m: SocietyMember) {
    const options: AlertButton[] = [];
    const s = season;
    if (membershipOn && s != null) {
      if (canMoney) {
        options.push({ text: "Mark paid — cash", onPress: () => void act(m.id, () => markMembership(groupId, m.id, s, "paid", "cash")) });
        options.push({ text: "Mark paid — transfer", onPress: () => void act(m.id, () => markMembership(groupId, m.id, s, "paid", "transfer")) });
      }
      if (canPeople || canMoney) {
        options.push({ text: "Honorary", onPress: () => void act(m.id, () => markMembership(groupId, m.id, s, "honorary")) });
        options.push({ text: "Lapsed", onPress: () => void act(m.id, () => markMembership(groupId, m.id, s, "lapsed")) });
        options.push({ text: "Clear", onPress: () => void act(m.id, () => markMembership(groupId, m.id, s, null)) });
        if (m.membership === "unpaid") {
          options.push({ text: "Remind to pay", onPress: () => void act(m.id, () => remindMembership(groupId, m.id), "Reminder sent") });
        }
      }
    }
    if (isOwner) options.push({ text: "Give a role…", onPress: () => giveRole(m) });
    options.push({ text: "View profile", onPress: () => router.push({ pathname: "/member/[id]", params: { id: m.id } }) });
    options.push({ text: "Cancel", style: "cancel" });
    const status = m.membership ? `${MEMBERSHIP_LABELS[m.membership]}${s != null && settings ? ` for ${seasonLabel(s, settings.seasonStartMonth)}` : ""}` : undefined;
    Alert.alert(m.name, status, options);
  }

  const header = (
    <Stack.Screen
      options={{
        title: "Members",
        headerBackTitle: "Back",
        ...myRoundRight(() =>
          areas && (canPeople || canMoney) ? (
            <Pressable onPress={() => router.push({ pathname: "/group/[id]/exports", params: { id: String(groupId) } } as never)} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Export members as CSV">
              <Ionicons name="download-outline" size={18} color={colors.navy900} />
              <Text style={styles.headerBtnText}>CSV</Text>
            </Pressable>
          ) : null),
      }}
    />
  );

  if (areas && !canPeople && !canMoney) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="lock-closed-outline" title="For the committee" body="The members list is for the captain, secretary and treasurer." size="screen" />
      </View>
    );
  }
  if (failed && !members) {
    return (
      <View style={styles.fill}>
        {header}
        <LoadError onRetry={() => void load()} what="the members" size="screen" />
      </View>
    );
  }
  if (!areas || page === undefined || !members) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  const filters = FILTERS.filter((f) => !f.membership || membershipOn);

  return (
    <View style={styles.fill}>
      {header}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {page ? <Text style={styles.title}>{page.group.name}</Text> : null}
        {membershipOn && season != null && settings ? (
          <Text style={styles.sub}>{`Membership for ${seasonLabel(season, settings.seasonStartMonth)} · ${counts.paid + counts.honorary} of ${counts.all} paid up or honorary`}</Text>
        ) : (
          <Text style={styles.sub}>{`${counts.all} ${counts.all === 1 ? "member" : "members"}`}</Text>
        )}

        <Card>
          <View style={styles.cardHead}>
            <Kicker>Committee</Kicker>
            <Pressable onPress={() => setShowRoles((v) => !v)} style={styles.inlineLink} accessibilityRole="button" accessibilityState={{ expanded: showRoles }} accessibilityLabel="Roles and access">
              <Text style={styles.inlineLinkText}>Roles & access</Text>
              <Ionicons name={showRoles ? "chevron-up" : "chevron-down"} size={16} color={colors.green700} />
            </Pressable>
          </View>
          {committee.length === 0 ? (
            <Text style={styles.small}>No roles given yet.{isOwner ? " Tap a member below to give them one." : ""}</Text>
          ) : (
            committee.map((m) => (
              <View key={m.id} style={styles.committeeRow}>
                <Avatar url={people.get(m.id)?.avatarUrl} color={people.get(m.id)?.avatarColor} name={m.name} size={30} />
                <Text style={styles.committeeName} numberOfLines={1}>
                  {m.id === userId ? `${m.name} (you)` : m.name}
                </Text>
                <Chip tone="navy">{GROUP_OFFICE_LABELS[m.office]}</Chip>
              </View>
            ))
          )}
          {showRoles ? (
            <View style={styles.roles}>
              <Text style={styles.small}>The owner can do everything and gives the roles. What each role opens:</Text>
              {GROUP_OFFICES.map((office) => {
                const role = office === "captain" || office === "secretary" ? "admin" : "member";
                const list = officeAreas(role, office);
                return (
                  <View key={office} style={styles.roleRow} accessible accessibilityLabel={`${GROUP_OFFICE_LABELS[office]}: ${list.map((a) => AREA_LABELS[a]).join(", ")}`}>
                    <Text style={styles.roleName}>{GROUP_OFFICE_LABELS[office]}</Text>
                    <Text style={styles.roleAreas}>{list.length === officeAreas("admin", null).length ? "Everything" : list.map((a) => AREA_LABELS[a]).join(" · ")}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </Card>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={17} color={colors.ink500} />
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Search members"
            placeholderTextColor={colors.ink500}
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Search members"
          />
        </View>

        {filters.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {filters.map((f) => {
              const on = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[styles.filter, on && styles.filterOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${f.label}, ${counts[f.key]}`}
                >
                  <Text style={[styles.filterText, on && styles.filterTextOn]}>{`${f.label} ${counts[f.key]}`}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {shown.length === 0 ? (
          <StateMessage icon="people-outline" body={query.trim() ? "No one matches that search." : "No one here."} />
        ) : (
          shown.map((m) => {
            const p = people.get(m.id);
            const year = m.joinedAt ? m.joinedAt.slice(0, 4) : null;
            const meta = [m.ownIndex != null ? `Index ${indicatorLabel(m.ownIndex)}` : null, year ? `joined ${year}` : null].filter(Boolean).join(" · ");
            const status = m.membership && membershipOn ? MEMBERSHIP_LABELS[m.membership] : null;
            return (
              <Pressable
                key={m.id}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                onPress={() => openMember(m)}
                disabled={busy === m.id}
                accessibilityRole="button"
                accessibilityLabel={[m.name, meta, status].filter(Boolean).join(", ")}
                accessibilityHint="Opens actions for this member"
              >
                <Avatar url={p?.avatarUrl} color={p?.avatarColor} name={m.name} size={38} />
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {m.id === userId ? `${m.name} (you)` : m.name}
                  </Text>
                  {meta ? (
                    <Text style={styles.meta} numberOfLines={1}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
                {busy === m.id ? <ActivityIndicator color={colors.green700} /> : m.membership && membershipOn ? <Chip tone={MEMBERSHIP_TONE[m.membership]}>{MEMBERSHIP_LABELS[m.membership]}</Chip> : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: type.title, color: colors.navy900 },
  sub: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, marginBottom: spacing.xs },
  headerBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 6, justifyContent: "center" },
  headerBtnText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.navy900 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inlineLink: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 4 },
  inlineLinkText: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700 },
  committeeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  committeeName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  roles: { gap: 6, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
  roleRow: { gap: 1 },
  roleName: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.ink900 },
  roleAreas: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500 },
  small: { fontFamily: fonts.body, fontSize: 13, color: colors.ink500, lineHeight: 19 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginTop: spacing.xs,
  },
  search: { flex: 1, height: 44, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  filters: { gap: 6, paddingVertical: 2 },
  filter: { minHeight: 44, paddingHorizontal: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, justifyContent: "center" },
  filterOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  filterText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  filterTextOn: { color: colors.cream50 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 10, minHeight: 60, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  rowBody: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
});
