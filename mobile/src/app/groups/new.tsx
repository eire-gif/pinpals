import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { CourseSearch } from "@/components/course-search";
import { GroupIcon } from "@/components/group-bits";
import { CREATABLE_GROUP_KINDS, GROUP_ABOUT_MAX, GROUP_KIND_INFO, GROUP_NAME_MAX, groupNameProblem, isCreatableGroupKind, type CreatableGroupKind } from "@/lib/groups";
import { createGroup } from "@/lib/groups-data";
import type { Club } from "@/lib/courses";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";
import { AgeGateLoading, NotForUnder18, useAgeGate } from "@/components/not-for-under-18";

/** What each kind is for, in the words a golfer would use. */
const BLURB: Record<CreatableGroupKind, string> = {
  crew: "Your golf buddies — your regular fourball and the friends who fill in. Invite only, with a group chat.",
  trip: "Everyone on a golf trip. Invite only, with a group chat.",
  society: "A golf society. Golfers can find it and ask to join; you approve them.",
};

/**
 * Starting a group (0120). Pick a kind, name it, and (for a society) its
 * home club. Inviting people comes next, on the group's own page, where the
 * invite link lives too.
 *
 * The rules are the database's: create_group() checks the kind, the name and
 * the description, and its messages are shown as they come.
 */
function NewGroupScreenInner() {
  // Groups & societies' three start buttons pass the kind (Oct 2026); it can
  // still be changed here.
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<CreatableGroupKind>(isCreatableGroupKind(params.kind) ? params.kind : "crew");
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [club, setClub] = useState<Club | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = name.trim() ? groupNameProblem(name) : null;
  const ready = name.trim().length > 0 && !problem && !busy;

  async function create() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createGroup({ kind, name: name.trim(), about: about.trim() || null, clubId: kind === "society" ? (club?.id ?? null) : null });
      // replace: Back from the new group goes to Your groups, not this form.
      router.replace({ pathname: "/group/[id]", params: { id: String(id), fresh: "1" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the group.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ title: "Start a group", headerBackTitle: "Back" }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>What kind of group?</Text>
        <View style={styles.kinds}>
          {CREATABLE_GROUP_KINDS.map((k) => {
            const on = k === kind;
            return (
              <Pressable
                key={k}
                style={[styles.kind, on && styles.kindOn]}
                onPress={() => setKind(k)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={GROUP_KIND_INFO[k].label}
              >
                <GroupIcon kind={k} size={38} />
                <View style={styles.kindBody}>
                  <Text style={styles.kindName}>{GROUP_KIND_INFO[k].label}</Text>
                  <Text style={styles.kindBlurb}>{BLURB[k]}</Text>
                </View>
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? colors.green700 : colors.line} />
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={GROUP_KIND_INFO[kind].example}
          placeholderTextColor={colors.ink500}
          maxLength={GROUP_NAME_MAX}
          accessibilityLabel="Group name"
        />
        {problem ? <Text style={styles.error}>{problem}</Text> : null}

        <Text style={styles.label}>About (optional)</Text>
        <TextInput
          style={[styles.input, styles.multi]}
          value={about}
          onChangeText={setAbout}
          placeholder={kind === "society" ? "Who you are, when you play, how to join" : "What the group is for"}
          placeholderTextColor={colors.ink500}
          maxLength={GROUP_ABOUT_MAX}
          multiline
          accessibilityLabel="About the group"
        />

        {kind === "society" ? (
          <>
            <Text style={styles.label}>Home club (optional)</Text>
            {club ? (
              <View style={styles.club}>
                <Ionicons name="flag" size={18} color={colors.green700} />
                <Text style={styles.clubName} numberOfLines={1}>
                  {club.name}
                </Text>
                <Pressable onPress={() => setClub(null)} accessibilityRole="button" accessibilityLabel="Remove home club" hitSlop={8}>
                  <Ionicons name="close-circle" size={22} color={colors.ink500} />
                </Pressable>
              </View>
            ) : (
              <CourseSearch placeholder="Search for the club" onPick={setClub} />
            )}
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.cta, !ready && styles.ctaOff]} onPress={() => void create()} disabled={!ready} accessibilityRole="button">
          <Text style={styles.ctaLabel}>{busy ? "Creating…" : `Create ${kind === "crew" ? "group" : GROUP_KIND_INFO[kind].label.toLowerCase()}`}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  label: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, marginTop: spacing.sm },
  kinds: { gap: spacing.sm },
  kind: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 4,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  kindOn: { borderColor: colors.green600, backgroundColor: colors.green100, borderWidth: 2 },
  kindBody: { flex: 1, gap: 2 },
  kindName: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  kindBlurb: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  // 16pt floor: iOS zooms the screen when a smaller input takes focus.
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
  club: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: 12,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  clubName: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.cream50 },
  cta: { height: 50, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700 },
  ctaOff: { backgroundColor: colors.ink500, opacity: 0.4 },
  ctaLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
});

/** Junior members (0159): new group aren't for every age — a deep link gets the panel, not a form the database would refuse. */
export default function NewGroupScreen() {
  const gate = useAgeGate("createGroups");
  if (gate === "loading") return <AgeGateLoading />;
  if (gate === "blocked") return <NotForUnder18 feature="createGroups" title="New group" />;
  return <NewGroupScreenInner />;
}
