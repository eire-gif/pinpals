import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";

import { GoldButton } from "@/components/gold-button";
import { GroupIcon, membersLabel } from "@/components/group-bits";
import { useAuth } from "@/lib/auth";
import { GROUP_KIND_INFO, isGroupInviteCode } from "@/lib/groups";
import {
  claimEmailInvite,
  isEmailInviteToken,
  joinGroupByCode,
  previewEmailInvite,
  previewGroupInvite,
  rememberPendingEmailInvite,
  rememberPendingGroupInvite,
  type EmailInvitePreview,
  type InvitePreview,
} from "@/lib/groups-data";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * A group's invite link opened in the app (pinpals.ie/join/g/<code> —
 * lib/incoming-links.ts). Shows the group's front page and joins straight
 * in: holding the link is the approval. Signed out, the code is kept until
 * they've signed up or logged in, then app/_layout.tsx joins them.
 *
 * Also a society's emailed invitation (pinpals.ie/join/s/<token>, 0170):
 * the same screen, addressed to whoever it was sent to.
 */
export default function JoinGroupScreen() {
  const { code: raw, token: rawToken } = useLocalSearchParams<{ code?: string; token?: string }>();
  const code = typeof raw === "string" && isGroupInviteCode(raw.toLowerCase()) ? raw.toLowerCase() : null;
  const token = !code && typeof rawToken === "string" && isEmailInviteToken(rawToken.toLowerCase()) ? rawToken.toLowerCase() : null;
  const { session } = useAuth();
  const [group, setGroup] = useState<InvitePreview | EmailInvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const emailed = group && "email" in group ? group : null;

  useEffect(() => {
    if (code) void previewGroupInvite(code).then(setGroup);
    else if (token) void previewEmailInvite(token).then((p) => setGroup(p && p.status !== "cancelled" ? p : null));
    else setGroup(null);
  }, [code, token]);

  async function join() {
    if (!code && !token) return;
    setBusy(true);
    try {
      const id = token ? await claimEmailInvite(token) : await joinGroupByCode(code!);
      router.replace({ pathname: "/group/[id]", params: { id: String(id) } });
    } catch (err) {
      Alert.alert("Couldn't join", err instanceof Error ? err.message : "Please try again.");
      setBusy(false);
    }
  }

  async function signUp(to: "/signup" | "/login") {
    if (code) await rememberPendingGroupInvite(code);
    else if (token) await rememberPendingEmailInvite(token);
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
          <Text style={styles.kicker}>{emailed?.firstName ? `${emailed.firstName}, you're invited` : "You're invited"}</Text>
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
                {emailed ? <Text style={styles.small}>Sent to {emailed.email}</Text> : null}
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
