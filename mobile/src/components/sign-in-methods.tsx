import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import {
  linkApple,
  linkGoogle,
  linkableProviders,
  loadLinkedProviders,
  type SocialProvider,
} from "@/lib/social-sign-in";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * "Ways to sign in" on Privacy & security (Oct 2026, claude/social-sign-in.md).
 *
 * Shows how this account can be signed in to — email, Apple, Google — and
 * offers "Connect" for Apple and Google. That's for members whose Apple
 * sign-in hid their email (so PinPals couldn't tell it was them) or who
 * joined with email and want one-tap sign-in from now on.
 *
 * Draws nothing until Apple or Google is switched on in Supabase and the app
 * binary can do it (lib/social-sign-in.ts).
 */
const ROWS: { provider: SocialProvider; label: string; icon: "logo-apple" | "logo-google" }[] = [
  { provider: "apple", label: "Apple", icon: "logo-apple" },
  { provider: "google", label: "Google", icon: "logo-google" },
];

export function SignInMethods() {
  const [linked, setLinked] = useState<Set<string> | null>(null);
  const [usable, setUsable] = useState<Record<SocialProvider, boolean>>({ apple: false, google: false });
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);

  const load = useCallback(async () => {
    const [l, u] = await Promise.all([loadLinkedProviders().catch(() => new Set<string>()), linkableProviders()]);
    setLinked(l);
    setUsable(u);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!linked) return null;
  const rows = ROWS.filter((r) => usable[r.provider] || linked.has(r.provider));
  if (rows.length === 0) return null;

  const connect = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(provider);
    setMessage(null);
    const result = provider === "apple" ? await linkApple() : await linkGoogle();
    setBusy(null);
    if (result.ok) {
      setMessage({ text: `${provider === "apple" ? "Apple" : "Google"} is connected — you can use it to sign in from now on.`, good: true });
      void load();
    } else if (!result.cancelled) {
      setMessage({ text: result.error, good: false });
    }
  };

  return (
    <>
      <Text style={styles.heading}>Ways to sign in</Text>
      <View style={styles.card}>
        {linked.has("email") ? (
          <Row icon="mail-outline" label="Email and password" connected />
        ) : null}
        {rows.map((r) => (
          <Row
            key={r.provider}
            icon={r.icon}
            label={r.label}
            connected={linked.has(r.provider)}
            busy={busy === r.provider}
            onConnect={usable[r.provider] ? () => void connect(r.provider) : undefined}
          />
        ))}
        {message ? <Text style={[styles.small, { color: message.good ? colors.green700 : colors.red600 }]}>{message.text}</Text> : null}
        <Text style={styles.small}>
          Connect Apple or Google to sign in with one tap. Each can only be connected to one PinPals account.
        </Text>
      </View>
    </>
  );
}

function Row({
  icon,
  label,
  connected,
  busy,
  onConnect,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  connected: boolean;
  busy?: boolean;
  onConnect?: () => void;
}) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.ink900} />
      <Text style={styles.label}>{label}</Text>
      {connected ? (
        <View style={styles.connected}>
          <Ionicons name="checkmark-circle" size={18} color={colors.green700} />
          <Text style={styles.connectedText}>Connected</Text>
        </View>
      ) : onConnect ? (
        <Pressable
          style={({ pressed }) => [styles.connect, pressed && { opacity: 0.85 }]}
          onPress={onConnect}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Connect ${label}`}
        >
          {busy ? <ActivityIndicator color={colors.green700} /> : <Text style={styles.connectText}>Connect</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: fonts.display, fontSize: type.heading + 2, color: colors.navy900, marginTop: spacing.sm },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 46 },
  label: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  connected: { flexDirection: "row", alignItems: "center", gap: 4 },
  connectedText: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.green700 },
  connect: {
    minHeight: 40,
    minWidth: 104,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.green700,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  connectText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
  small: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
});
