import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router, useFocusEffect, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { GROUP_ABOUT_MAX, GROUP_NAME_MAX, groupNameProblem } from "@/lib/groups";
import { deleteGroup, loadGroupPage, updateGroup, type GroupPage } from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A group's settings (0120): owner and admins. Name, description, whether
 * ordinary members can invite, a society's home club — and, for the owner,
 * deleting the group. update_group() and delete_group() decide who may.
 */
export default function GroupSettingsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const groupId = Number(rawId);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [page, setPage] = useState<GroupPage | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [membersCanInvite, setMembersCanInvite] = useState(true);
  const [club, setClub] = useState<{ id: number; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    const p = await loadGroupPage(groupId, userId).catch(() => null);
    setPage(p);
    if (p) {
      setName(p.group.name);
      setAbout(p.group.about ?? "");
      setMembersCanInvite(p.group.membersCanInvite);
      setClub(p.group.clubId ? { id: p.group.clubId, name: p.group.clubName ?? "Home club" } : null);
    }
  }, [groupId, userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (page === undefined) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Settings", headerBackTitle: "Back" }} />
        <ActivityIndicator color={colors.green700} style={styles.spinner} />
      </View>
    );
  }
  if (!page || (page.myRole !== "owner" && page.myRole !== "admin")) {
    return (
      <View style={styles.fill}>
        <Stack.Screen options={{ title: "Settings", headerBackTitle: "Back" }} />
        <StateMessage icon="lock-closed-outline" title="Only whoever runs the group can change it" size="screen" />
      </View>
    );
  }

  const g = page.group;
  const problem = groupNameProblem(name);

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      await updateGroup(groupId, {
        name: name.trim(),
        about: about.trim() || null,
        membersCanInvite,
        clubId: g.kind === "society" ? (club?.id ?? null) : g.clubId,
        startsOn: g.startsOn,
        endsOn: g.endsOn,
      });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't save", err instanceof Error ? err.message : "Please try again.");
      setSaving(false);
    }
  }

  function remove() {
    Alert.alert(`Delete ${g.name}?`, "The group and its member list are deleted for everyone. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void deleteGroup(groupId)
            .then(() => router.dismissTo("/groups"))
            .catch((err: unknown) => Alert.alert("Couldn't delete", err instanceof Error ? err.message : "Please try again.")),
      },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Settings", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={GROUP_NAME_MAX} accessibilityLabel="Group name" />
        {problem && name.length > 0 ? <Text style={styles.error}>{problem}</Text> : null}

        <Text style={styles.label}>About</Text>
        <TextInput
          style={[styles.input, styles.multi]}
          value={about}
          onChangeText={setAbout}
          maxLength={GROUP_ABOUT_MAX}
          multiline
          placeholder="What the group is for"
          placeholderTextColor={colors.ink500}
          accessibilityLabel="About the group"
        />

        {g.kind === "society" ? (
          <>
            <Text style={styles.label}>Home club</Text>
            {club ? (
              <View style={styles.card}>
                <Ionicons name="flag" size={18} color={colors.green700} />
                <Text style={styles.cardText} numberOfLines={1}>
                  {club.name}
                </Text>
                <Pressable onPress={() => setClub(null)} accessibilityRole="button" accessibilityLabel="Remove home club" hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={colors.ink500} />
                </Pressable>
              </View>
            ) : (
              <CourseSearch placeholder="Search for the club" onPick={(c) => setClub({ id: c.id, name: c.name })} />
            )}
          </>
        ) : null}

        <View style={[styles.card, styles.switchCard]}>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Members can invite</Text>
            <Text style={styles.cardHint}>Off: only you{page.myRole === "owner" ? " and your admins" : " and the other admins"} can invite and share the link.</Text>
          </View>
          <Switch value={membersCanInvite} onValueChange={setMembersCanInvite} accessibilityLabel="Members can invite" />
        </View>

        <Pressable style={[styles.cta, (problem || saving) && styles.ctaOff]} onPress={() => void save()} disabled={!!problem || saving} accessibilityRole="button">
          <Text style={styles.ctaLabel}>{saving ? "Saving…" : "Save changes"}</Text>
        </Pressable>

        {page.myRole === "owner" ? (
          <Pressable style={styles.delete} onPress={remove} accessibilityRole="button">
            <Text style={styles.deleteText}>Delete group</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  spinner: { marginTop: spacing.xl },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl * 2 },
  label: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, marginTop: spacing.sm },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  multi: { minHeight: 96, textAlignVertical: "top" },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  switchCard: { marginTop: spacing.md },
  cardText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  cardHint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  cta: { height: 50, marginTop: spacing.md, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  ctaOff: { backgroundColor: colors.ink500, opacity: 0.4 },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  delete: { alignItems: "center", paddingVertical: spacing.lg },
  deleteText: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.red600 },
});
