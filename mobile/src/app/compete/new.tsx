import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Pills } from "@/components/compete-bits";
import { CourseSearch } from "@/components/course-search";
import { DateSheet, dateToIso, dayLabel } from "@/components/date-sheet";
import { Button, Card, Kicker } from "@/components/society-bits";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { loadMyGroups } from "@/lib/groups-data";
import { PROVINCES, type LeagueKind, type Province } from "@/lib/matchplay";
import { amCompetitionStaff, loadLeague, saveLeague } from "@/lib/matchplay-data";
import { parseFee } from "@/lib/outing-rules";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dateToIso(d);
};

/** End of a day in Irish time, as an instant: entries close at midnight. */
const endOfDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 0).toISOString();
};

/**
 * Start or edit a league or ladder (0148). PinPals staff can open one to
 * every member; a group's owner or admins can run one for their group. After
 * the draw only the name, description and timings can change — the
 * database enforces that, this screen just doesn't offer the rest.
 */
export default function NewCompetitionScreen() {
  const { id: rawId } = useLocalSearchParams<{ id?: string }>();
  const editId = rawId ? Number(rawId) : null;
  const router = useRouter();
  const { session } = useAuth();
  const me = session?.user?.id ?? null;

  const [ready, setReady] = useState(false);
  const [staff, setStaff] = useState(false);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [locked, setLocked] = useState(false);

  const [kind, setKind] = useState<LeagueKind>("league");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [province, setProvince] = useState<Province | null>(null);
  const [club, setClub] = useState<{ id: number; name: string } | null>(null);
  const [fee, setFee] = useState("");
  const [closes, setCloses] = useState(addDays(14));
  const [starts, setStarts] = useState(addDays(15));
  const [maxHcp, setMaxHcp] = useState("");
  const [qualifiers, setQualifiers] = useState(2);
  const [roundDays, setRoundDays] = useState(14);
  const [reach, setReach] = useState(3);
  const [challengeDays, setChallengeDays] = useState(14);
  const [dateOpen, setDateOpen] = useState<"closes" | "starts" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me) return;
    void (async () => {
      const [isStaff, mine] = await Promise.all([amCompetitionStaff(), loadMyGroups(me).catch(() => null)]);
      setStaff(isStaff);
      const runnable = (mine?.groups ?? []).filter((g) => g.role === "owner" || g.role === "admin").map((g) => ({ id: g.id, name: g.name }));
      setGroups(runnable);
      if (editId) {
        const page = await loadLeague(editId).catch(() => null);
        if (page) {
          const l = page.league;
          setKind(l.kind);
          setGroupId(l.groupId);
          setName(l.name);
          setAbout(l.about ?? "");
          setProvince(l.province);
          setClub(l.clubId && l.clubName ? { id: l.clubId, name: l.clubName } : null);
          setFee(l.entryFeeCents ? String(l.entryFeeCents / 100) : "");
          if (l.entriesCloseAt) setCloses(l.entriesCloseAt.slice(0, 10));
          if (l.startsOn) setStarts(l.startsOn);
          setMaxHcp(l.maxHandicap != null ? String(l.maxHandicap) : "");
          setQualifiers(l.qualifiersPerGroup);
          setRoundDays(l.roundDays);
          setReach(l.challengeReach);
          setChallengeDays(l.challengeDays);
          setLocked(l.status !== "entries");
        }
      } else if (!isStaff && runnable.length) {
        setGroupId(runnable[0].id);
      }
      setReady(true);
    })();
  }, [me, editId]);

  const feeCents = parseFee(fee);
  const max = maxHcp.trim() === "" ? null : Number(maxHcp.replace(",", "."));
  const problem =
    name.trim().length < 3
      ? "Give it a name."
      : feeCents === undefined
        ? "Enter the fee in euro, like 15 or 12.50."
        : max != null && (!Number.isFinite(max) || max < 0 || max > 54)
          ? "The handicap limit is between 0 and 54."
          : kind === "league" && !locked && starts < closes
            ? "The league starts on or after entries close."
            : !editId && groupId == null && !staff
              ? "Choose the group it's for."
              : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      const id = await saveLeague(editId, {
        kind,
        name: name.trim(),
        about: about.trim() || null,
        groupId,
        province: groupId == null ? province : null,
        clubId: club?.id ?? null,
        entryFeeCents: feeCents ?? null,
        entriesCloseAt: kind === "league" ? endOfDay(closes) : null,
        startsOn: kind === "league" ? starts : null,
        maxHandicap: max,
        qualifiersPerGroup: qualifiers,
        roundDays,
        challengeReach: reach,
        challengeDays,
      });
      router.replace(`/compete/${id}`);
    } catch (err) {
      Alert.alert("Couldn't save it", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const header = <Stack.Screen options={{ title: editId ? "Edit competition" : "New competition", headerBackTitle: "Back" }} />;

  if (!ready) {
    return (
      <View style={styles.fill}>
        {header}
        <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }
  if (!editId && !staff && groups.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        <StateMessage icon="people-outline" title="Run it through a group" body="Leagues and ladders are run by a society or group's owner or admins. Start a group, or ask whoever runs yours." size="screen" />
      </View>
    );
  }

  const choice = <T,>(options: { v: T; label: string }[], value: T, set: (v: T) => void, label: string, disabled = false) => (
    <View style={styles.chips} accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable key={String(o.v)} disabled={disabled} onPress={() => set(o.v)} style={[styles.pick, on && styles.pickOn, disabled && !on && { opacity: 0.4 }]} accessibilityRole="button" accessibilityState={{ selected: on, disabled }}>
            <Text style={[styles.pickText, on && styles.pickTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={90}>
      {header}
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {!editId ? (
          <Card>
            <Kicker>What kind</Kicker>
            <Pills
              label="Kind of competition"
              value={kind}
              onChange={setKind}
              options={[
                { id: "league", label: "League" },
                { id: "ladder", label: "Ladder" },
              ]}
            />
            <Text style={styles.small}>
              {kind === "league"
                ? "Entries, then groups that play each other once, then a knockout for the top of each group."
                : "A running ranking. Members join at the bottom and challenge their way up."}
            </Text>
          </Card>
        ) : null}

        {!editId ? (
          <Card>
            <Kicker>Who it's for</Kicker>
            {choice(
              [...(staff ? [{ v: null as number | null, label: "Every PinPals member" }] : []), ...groups.map((g) => ({ v: g.id as number | null, label: g.name }))],
              groupId,
              setGroupId,
              "Who it's for",
            )}
          </Card>
        ) : null}

        <Card>
          <Kicker>About it</Kicker>
          <Text style={styles.label}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder={kind === "league" ? "Winter matchplay 2026" : "Club ladder"} placeholderTextColor={colors.ink500} maxLength={80} accessibilityLabel="Name" />
          <Text style={styles.label}>Details (optional)</Text>
          <TextInput style={[styles.input, styles.multi]} value={about} onChangeText={setAbout} placeholder="Prizes, finals day, anything entrants should know" placeholderTextColor={colors.ink500} multiline maxLength={1000} accessibilityLabel="Details" />
          {groupId == null ? (
            <>
              <Text style={styles.label}>Province (optional)</Text>
              {choice([{ v: null as Province | null, label: "All Ireland" }, ...PROVINCES.map((p) => ({ v: p.id as Province | null, label: p.label }))], province, setProvince, "Province")}
            </>
          ) : null}
          <Text style={styles.label}>{kind === "ladder" ? "Club (optional)" : "Home club or finals venue (optional)"}</Text>
          {club ? (
            <Pressable style={styles.picker} onPress={() => setClub(null)} accessibilityRole="button" accessibilityLabel={`${club.name}. Remove`}>
              <Ionicons name="golf-outline" size={18} color={colors.navy900} />
              <Text style={[styles.pickerText, { flex: 1 }]}>{club.name}</Text>
              <Ionicons name="close" size={18} color={colors.ink500} />
            </Pressable>
          ) : (
            <CourseSearch placeholder="Search for a club" onPick={(c) => setClub({ id: c.id, name: c.name })} />
          )}
        </Card>

        <Card>
          <Kicker>Entry</Kicker>
          <View style={styles.row}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.label}>Fee (€, optional)</Text>
              <TextInput style={styles.input} value={fee} onChangeText={setFee} placeholder="Free" placeholderTextColor={colors.ink500} keyboardType="decimal-pad" editable={!locked} accessibilityLabel="Entry fee in euro" />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.label}>Handicaps up to</Text>
              <TextInput style={styles.input} value={maxHcp} onChangeText={setMaxHcp} placeholder="Any" placeholderTextColor={colors.ink500} keyboardType="decimal-pad" editable={!locked} accessibilityLabel="Highest handicap index allowed" />
            </View>
          </View>
          <Text style={styles.small}>The fee is collected by you, in cash or by transfer, and you mark who has paid. Card payments are coming.</Text>
          {kind === "league" ? (
            <>
              <Pressable style={styles.picker} disabled={locked} onPress={() => setDateOpen("closes")} accessibilityRole="button" accessibilityLabel={`Entries close, ${dayLabel(closes)}`}>
                <Ionicons name="calendar-outline" size={18} color={colors.navy900} />
                <Text style={styles.pickerText}>{`Entries close ${dayLabel(closes)}`}</Text>
              </Pressable>
              <Pressable style={styles.picker} disabled={locked} onPress={() => setDateOpen("starts")} accessibilityRole="button" accessibilityLabel={`First round starts, ${dayLabel(starts)}`}>
                <Ionicons name="flag-outline" size={18} color={colors.navy900} />
                <Text style={styles.pickerText}>{`First round starts ${dayLabel(starts)}`}</Text>
              </Pressable>
            </>
          ) : null}
        </Card>

        <Card>
          <Kicker>Format</Kicker>
          {kind === "league" ? (
            <>
              <Text style={styles.label}>Knockout places from each group</Text>
              {choice([1, 2].map((n) => ({ v: n, label: n === 1 ? "Winner only" : "Top 2" })), qualifiers, setQualifiers, "Knockout places", locked)}
              <Text style={styles.label}>Time for each round</Text>
              {choice([7, 10, 14, 21].map((n) => ({ v: n, label: n === 7 ? "1 week" : n === 14 ? "2 weeks" : n === 21 ? "3 weeks" : "10 days" })), roundDays, setRoundDays, "Time for each round")}
              <Text style={styles.small}>Singles matchplay off full handicap difference. Win 3, half 1.</Text>
            </>
          ) : (
            <>
              <Text style={styles.label}>Challenge up to</Text>
              {choice([1, 2, 3, 4, 5].map((n) => ({ v: n, label: `${n} ${n === 1 ? "place" : "places"} up` })), reach, setReach, "How far up a member can challenge")}
              <Text style={styles.label}>Time to play a challenge</Text>
              {choice([7, 14, 21].map((n) => ({ v: n, label: `${n / 7} ${n === 7 ? "week" : "weeks"}` })), challengeDays, setChallengeDays, "Time to play a challenge")}
            </>
          )}
        </Card>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Button label={editId ? "Save changes" : kind === "league" ? "Open for entries" : "Start the ladder"} busy={saving} disabled={!!problem} onPress={() => void save()} />
      </ScrollView>

      <DateSheet
        open={dateOpen != null}
        title={dateOpen === "starts" ? "First round starts" : "Entries close"}
        value={dateOpen === "starts" ? starts : closes}
        maxDaysAhead={365}
        onClose={() => setDateOpen(null)}
        onChange={(iso) => (dateOpen === "starts" ? setStarts(iso) : setCloses(iso))}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  page: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  label: { fontFamily: fonts.bodySemi, fontSize: type.label, color: colors.ink900 },
  small: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, lineHeight: 18 },
  input: { minHeight: 48, paddingHorizontal: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.line, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, backgroundColor: colors.cream50 },
  multi: { minHeight: 88, paddingTop: 10, textAlignVertical: "top" },
  row: { flexDirection: "row", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pick: { minHeight: 44, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  pickOn: { backgroundColor: colors.navy900, borderColor: colors.navy900 },
  pickText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.navy900 },
  pickTextOn: { color: colors.cream50 },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pickerText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  problem: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.red600 },
});
