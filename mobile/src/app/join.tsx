import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";

import { Avatar } from "@/components/avatar";
import { GoldButton } from "@/components/gold-button";
import { useAuth } from "@/lib/auth";
import { connectByInvite, isInviteCode, rememberPendingInvite } from "@/lib/find-pinpals";
import { supabase } from "@/lib/supabase";
import { colors, fonts, spacing } from "@/lib/theme";

/**
 * A member's invite link or QR code, opened in the app
 * (pinpals.ie/join/<code> — lib/incoming-links.ts). Signed in: Connect.
 * Signed out: the code is kept until they've signed up or logged in, then
 * app/_layout.tsx connects them (consumePendingInvite()).
 */
export default function JoinScreen() {
  const { code: raw } = useLocalSearchParams<{ code?: string }>();
  const code = isInviteCode(raw) ? raw.toLowerCase() : null;
  const { session } = useAuth();
  const [inviter, setInviter] = useState<{ name: string; club: string | null; avatarUrl: string | null; avatarColor: string | null } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) {
      setInviter(null);
      return;
    }
    void supabase.rpc("invite_preview", { p_code: code }).then(({ data }) => {
      const row = (data as { first_name: string | null; last_initial: string; home_club: string | null; avatar_url: string | null; avatar_color: string | null }[] | null)?.[0];
      setInviter(row ? { name: `${row.first_name ?? "A golfer"}${row.last_initial ? ` ${row.last_initial}.` : ""}`, club: row.home_club, avatarUrl: row.avatar_url, avatarColor: row.avatar_color } : null);
    });
  }, [code]);

  async function connect() {
    if (!code) return;
    setBusy(true);
    try {
      const owner = await connectByInvite(code);
      router.replace({ pathname: "/member/[id]", params: { id: owner } });
    } catch (err) {
      Alert.alert("Couldn't connect", err instanceof Error ? err.message : "Please try again.");
      setBusy(false);
    }
  }

  async function join(to: "/signup" | "/login") {
    if (code) await rememberPendingInvite(code);
    router.replace(to);
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen options={{ title: "Invite", headerBackTitle: "Back" }} />
      {inviter === undefined ? (
        <ActivityIndicator color={colors.navy900} />
      ) : inviter === null ? (
        <View style={styles.card}>
          <Text style={styles.title}>That invite link isn&apos;t valid</Text>
          <Text style={styles.body}>Ask your friend to send it again.</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Avatar url={inviter.avatarUrl} color={inviter.avatarColor} name={inviter.name} size={84} />
          <Text style={styles.eyebrow}>YOU&apos;RE INVITED</Text>
          <Text style={styles.title}>{inviter.name} wants to connect on PinPals</Text>
          {inviter.club ? <Text style={styles.body}>{inviter.club}</Text> : null}
          <View style={{ alignSelf: "stretch", gap: 10, marginTop: spacing.md }}>
            {session ? (
              <GoldButton label={`Connect with ${inviter.name.split(" ")[0]}`} onPress={() => void connect()} busy={busy} />
            ) : (
              <>
                <GoldButton label="Join PinPals — it's free" onPress={() => void join("/signup")} />
                <Text style={styles.login} onPress={() => void join("/login")} accessibilityRole="link">
                  I already have an account
                </Text>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { alignSelf: "stretch", backgroundColor: colors.surface, borderRadius: 24, padding: 24, alignItems: "center", gap: 6 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.5, color: "#9c7a2c", marginTop: 10 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.navy900, textAlign: "center" },
  body: { fontFamily: fonts.body, fontSize: 14, color: colors.ink500, textAlign: "center" },
  login: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.navy900, textAlign: "center", paddingVertical: 10 },
});
