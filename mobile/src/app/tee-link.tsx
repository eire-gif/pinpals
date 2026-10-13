import { useEffect, useState, type ForwardRefExoticComponent } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import RNWebView, { type WebViewProps } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StateMessage } from "@/components/state-message";
import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { claimTeeTimeLink, isTeeTimeToken, rememberPendingTeeLink } from "@/lib/tee-time-sharing";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/** See web-shell.tsx: react-native-webview 14's root types collapse to never. */
const WebView = RNWebView as unknown as ForwardRefExoticComponent<WebViewProps>;

/**
 * Where a shared tee time link (pinpals.ie/t/<token>, 0132) lands in the app
 * (lib/incoming-links.ts). A signed-out visitor may see it (app/_layout.tsx):
 *
 *   signed in   → the link adds you to the round, then the round opens as
 *                 usual, where you ask for the place;
 *   signed out  → the website's page for the round, with Log in — and the
 *                 link is remembered, so once you're in, the round opens.
 */
export default function TeeLinkScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { session, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const ok = isTeeTimeToken(token);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !ok) return;
    if (!session) {
      void rememberPendingTeeLink(token);
      return;
    }
    let live = true;
    claimTeeTimeLink(token)
      .then((id) => {
        if (live) router.replace({ pathname: "/invite/[id]", params: { id: String(id) } });
      })
      .catch((err: unknown) => {
        if (live) setFailed(err instanceof Error ? err.message : "This round isn't available any more.");
      });
    return () => {
      live = false;
    };
  }, [loading, session, ok, token]);

  if (!ok || failed) {
    return (
      <>
        <Stack.Screen options={{ title: "Tee time", headerShown: true }} />
        <StateMessage
          size="screen"
          icon="golf-outline"
          title="This round has filled up"
          body={failed ?? "Or the link isn't quite right. There are more games looking for golfers under Tee Times."}
          action={{ label: "Find a game", onPress: () => router.replace("/(tabs)/tee-times") }}
        />
      </>
    );
  }

  if (loading || session) {
    return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Tee time", headerShown: true }} />
      <WebView source={{ uri: `${SITE_URL}/t/${token}` }} style={styles.screen} originWhitelist={["https://*"]} setSupportMultipleWindows={false} />
      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Pressable onPress={() => router.replace("/signup")} style={({ pressed }) => [styles.button, styles.buttonMain, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Text style={styles.buttonText}>Join PinPals — it&apos;s free</Text>
        </Pressable>
        <Pressable onPress={() => router.replace("/login")} style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Text style={styles.buttonText}>Log in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream50 },
  bar: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.cream50, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  button: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  buttonMain: { backgroundColor: colors.green700 },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
});
