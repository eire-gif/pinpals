import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { Avatar } from "@/components/avatar";
import { inviteToGroup, listPendingInvites } from "@/lib/groups-data";
import { listConnections, memberPlace, type Member } from "@/lib/members";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Add members, on the group page itself (Oct 2026): a dropdown of your
 * PinPals — tick them and tap Send. Each gets an invitation to join (an
 * alert in the app and on their phone, through invite_to_group / the
 * group_invited notification), and joins when they accept. Anyone already
 * in is left out; anyone already invited shows "Invited".
 *
 * The same as the Invite screen's "Your PinPals" list, without leaving the
 * page. The Invite screen still has the link and Find PinPals.
 */
export function AddMembersDropdown({
  groupId,
  userId,
  memberIds,
  onSent,
}: {
  groupId: number;
  userId: string;
  memberIds: readonly string[];
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Member[] | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [{ accepted }, pending] = await Promise.all([listConnections(userId), listPendingInvites(groupId)]);
      const inGroup = new Set(memberIds);
      setPeople(accepted.filter((m) => !inGroup.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "en-IE")));
      setInvited(pending);
    } catch {
      setFailed(true);
    }
  }, [groupId, userId, memberIds]);

  const toggleOpen = () => {
    setNote(null);
    setOpen((o) => {
      if (!o) void load();
      return !o;
    });
  };

  const visible = useMemo(() => {
    if (!people) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return people;
    return people.filter((m) => {
      const haystack = [m.name, m.homeClub, m.county].filter(Boolean).join(" ").toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [people, query]);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 50) next.add(id);
      return next;
    });

  async function send() {
    if (chosen.size === 0) return;
    setSending(true);
    try {
      const ids = [...chosen];
      const sent = await inviteToGroup(groupId, ids);
      setInvited((prev) => new Set([...prev, ...ids]));
      setChosen(new Set());
      setQuery("");
      setOpen(false);
      setNote(sent === 0 ? "They'd already been invited, or can't be added." : sent === 1 ? "Invitation sent — they'll get an alert to join." : `${sent} invitations sent — they'll each get an alert to join.`);
      onSent();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't send the invitations. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed }) => [styles.head, open && styles.headOpen, pressed && { opacity: 0.9 }]}
        onPress={toggleOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Add members from your PinPals"
      >
        <View style={styles.headIcon}>
          <Ionicons name="person-add-outline" size={18} color={colors.green700} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headTitle}>Add members</Text>
          <Text style={styles.headHint}>{chosen.size > 0 ? `${chosen.size} ticked` : "Tick your PinPals — they get an alert to join"}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={colors.ink500} />
      </Pressable>

      {note && !open ? (
        <View style={styles.note} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={16} color={colors.green700} />
          <Text style={styles.noteText}>{note}</Text>
        </View>
      ) : null}

      {open ? (
        <View style={styles.body}>
          {people === null && !failed ? (
            <ActivityIndicator color={colors.green700} style={{ marginVertical: spacing.md }} />
          ) : failed ? (
            <Pressable onPress={() => void load()} accessibilityRole="button">
              <Text style={styles.empty}>Couldn&apos;t load your PinPals. Tap to try again.</Text>
            </Pressable>
          ) : (
            <>
              {people && people.length > 6 ? (
                <View style={styles.searchWrap}>
                  <Ionicons name="search" size={16} color={colors.ink500} />
                  <TextInput
                    style={styles.search}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search your PinPals"
                    placeholderTextColor={colors.ink500}
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="while-editing"
                    accessibilityLabel="Search your PinPals"
                  />
                </View>
              ) : null}
              {visible.length === 0 ? (
                <Text style={styles.empty}>
                  {query.trim() ? "Nobody by that name." : "Everyone you're connected with is already in. Use Invite to share the link, or Find PinPals to search every member."}
                </Text>
              ) : (
                visible.map((m) => {
                  const already = invited.has(m.id);
                  const on = chosen.has(m.id);
                  return (
                    <Pressable
                      key={m.id}
                      style={[styles.row, on && styles.rowOn]}
                      onPress={() => !already && toggle(m.id)}
                      disabled={already}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: already }}
                      accessibilityLabel={already ? `${m.name}, already invited` : m.name}
                    >
                      <Avatar url={m.avatarUrl} color={m.avatarColor} name={m.name} size={36} />
                      <View style={{ flex: 1, gap: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>
                          {m.name}
                        </Text>
                        <Text style={styles.place} numberOfLines={1}>
                          {memberPlace(m) || "PinPals member"}
                        </Text>
                      </View>
                      {already ? (
                        <Text style={styles.invited}>Invited</Text>
                      ) : (
                        <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={23} color={on ? colors.green700 : colors.line} />
                      )}
                    </Pressable>
                  );
                })
              )}
              {chosen.size > 0 ? (
                <Pressable style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]} onPress={() => void send()} disabled={sending} accessibilityRole="button">
                  {sending ? (
                    <ActivityIndicator color={colors.cream50} />
                  ) : (
                    <Text style={styles.ctaText}>{chosen.size === 1 ? "Send 1 invitation" : `Send ${chosen.size} invitations`}</Text>
                  )}
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  headOpen: { borderColor: colors.green600 },
  headIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  headTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  headHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  body: { gap: 6 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 12, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  search: { flex: 1, height: 42, fontFamily: fonts.body, fontSize: type.body, color: colors.ink900 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  rowOn: { borderColor: colors.green600, backgroundColor: colors.green100 },
  name: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  place: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  invited: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.ink500 },
  empty: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", padding: spacing.sm },
  cta: { height: 48, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700, marginTop: 4 },
  ctaText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  note: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  noteText: { flex: 1, fontFamily: fonts.body, fontSize: type.small, color: colors.green800 },
});
