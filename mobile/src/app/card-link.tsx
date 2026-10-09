import { useEffect, type ForwardRefExoticComponent } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import RNWebView, { type WebViewProps } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { scorecardIdFromShareToken } from "@/lib/share-links";
import { colors, fonts, radii, spacing } from "@/lib/theme";

/** See web-shell.tsx: react-native-webview 14's root types collapse to never. */
const WebView = RNWebView as unknown as ForwardRefExoticComponent<WebViewProps>;

const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Where a shared scorecard link (pinpals.ie/c/<token>) lands in the app
 * (lib/incoming-links.ts). One of the few screens a signed-out visitor may
 * see (app/_layout.tsx), because the link must work for them too:
 *
 *   signed in   → the scorecard screen, which shows the public card itself
 *                 if the member can't see this one in the app;
 *   signed out  → the public card, as a friend without the app sees it,
 *                 with a way to log in.
 */
export default function CardLinkScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { session, loading } = useAuth();
  const insets = useSafeAreaInsets();
  const ok = typeof token === "string" && TOKEN.test(token);
  const id = ok ? scorecardIdFromShareToken(token) : null;

  useEffect(() => {
    if (loading) return;
    if (session && id) router.replace({ pathname: "/scorecards/[id]", params: { id: String(id), token: token! } });
    else if (session) router.replace("/(tabs)");
  }, [loading, session, id, token]);

  if (loading || session || !ok) {
    return <ActivityIndicator color={colors.green700} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: "Scorecard", headerShown: true }} />
      <WebView source={{ uri: `${SITE_URL}/c/${token}` }} style={styles.screen} originWhitelist={["https://*"]} setSupportMultipleWindows={false} />
      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Pressable onPress={() => router.replace("/login")} style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]} accessibilityRole="button">
          <Text style={styles.buttonText}>Log in to PinPals</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream50 },
  bar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.cream50, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  button: { minHeight: 48, borderRadius: radii.pill, backgroundColor: colors.navy900, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.cream50 },
});
