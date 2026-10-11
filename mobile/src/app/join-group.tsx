import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";

import { GoldButton } from "@/components/gold-button";
import { GroupIcon, membersLabel } from "@/components/group-bits";
import { useAuth } from "@/lib/auth";
import { GROUP_KIND_INFO, isGroupInviteCode } from "@/lib/groups";
import { joinGroupByCode, previewGroupInvite, rememberPendingGroupInvite, type InvitePreview } from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A group's invite link opened in the app (pinpals.ie/join/g/<code> —
 * lib/incoming-links.ts). Shows the group's front page and joins straight
 * in: holding the link is the approval. Signed out, the code is kept until
 * they've signed up or logged in, then app/_layout.tsx joins them.
 */
export default function JoinGroupScreen() {
  const { code: raw } = useLocalSearchParams<{ code?: string }>();
  const code = typeof raw === "string" && isGroupInviteCode(raw.toLowerCase()) ? raw.toLowerCase() : null;
  const { session } = useAuth();
  const [group, setGroup] = useState<InvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setGroup(null);
      return;
    }
    void previewGroupInvite(code).then(setGroup);
  }, [code]);

  async function join() {
    if (!code) return;
    setBusy(true);
    try {
      const id = await joinGroupByCode(code);
      router.replace({ pathname: "/group/[id]", params: { id: String(id) } });
    } catch (err) {
      Alert.alert("Couldn't join", err instanceof Error ? err.message : "Please try again.");
      setBusy(false);
    }
  }

  async function signUp(to: "/signup" | "/login") {
    if (code) await rememberPendingGroupInvite(code);
    router.replace(to);
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Invitation", headerBackTitle: "Back" }} />
      {group === undefined ? (
        <ActivityIndicator color={colors.navy900} />
      ) : group === null ? (
        <View style={styles.card}>
          <Text style={styles.title}>That invite link isn&apos;t valid</Text>
          <Text style={styles.body}>It may have been reset. Ask whoever sent it for a new one.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <GroupIcon kind={group.kind} size={64} />
          <Text style={styles.kicker}>You&apos;re invited</Text>
          <Text style={styles.title}>{group.name}</Text>
          <Text style={styles.detail}>{[GROUP_KIND_INFO[group.kind].label, membersLabel(group.memberCount), group.clubName].filter(Boolean).join(" · ")}</Text>
          {group.about ? <Text style={styles.body}>{group.about}</Text> : null}
          {group.ownerFirstName ? <Text style={styles.detail}>Run by {group.ownerFirstName}</Text> : null}
          <View style={styles.buttons}>
            {session ? (
              <GoldButton label={`Join ${group.name}`} onPress={() => void join()} busy={busy} />
            ) : (
              <>
                <GoldButton label="Join PinPals — it's free" onPress={() => void signUp("/signup")} />
                <Text style={styles.link} onPress={() => void signUp("/login")} accessibilityRole="button">
                  I already have an account
                </Text>
                <Text style={styles.small}>You&apos;ll be added to {group.name} as soon as you&apos;re in.</Text>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50, justifyContent: "center", padding: spacing.md },
  card: { alignItems: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface },
  kicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: "#9c7a2c", marginTop: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 26, color: colors.ink900, textAlign: "center" },
  detail: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.ink500, textAlign: "center" },
  body: { fontFamily: fonts.body, fontSize: type.body, color: colors.ink900, textAlign: "center", lineHeight: 22 },
  buttons: { alignSelf: "stretch", gap: spacing.sm, marginTop: spacing.md },
  link: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.navy900, textAlign: "center", paddingVertical: spacing.sm },
  small: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center" },
});
