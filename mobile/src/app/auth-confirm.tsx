import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { routeAfterSignIn } from "@/lib/signup-code";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Where a sign-up confirmation (or magic-link) email lands on a phone with
 * the app (Oct 2026). The link is pinpals.ie/auth/confirm?token_hash=…&type=email;
 * the website's apple-app-site-association hands it to the app and
 * +native-intent.tsx (lib/incoming-links.ts) brings it here.
 *
 * verifyOtp() is exactly what the website's /auth/confirm route does — the
 * token is single-use, so whichever of the two redeems it first signs the
 * member in, and the app is the one that gets the tap. A new member goes on
 * to the profile builder; anyone already set up goes Home.
 *
 * Reachable signed out: the auth gate in _layout.tsx lets this screen through.
 */
export default function AuthConfirmScreen() {
  const router = useRouter();
  const { token_hash: tokenHash, type } = useLocalSearchParams<{ token_hash?: string; type?: string }>();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      if (!tokenHash || type !== "email") {
        setFailed(true);
        return;
      }
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
      const userId = data.user?.id ?? data.session?.user?.id;
      if (error || !userId) {
        // Already used (the website got it first, or a second tap) or
        // expired. If a session exists anyway, the member is signed in.
        const { data: current } = await supabase.auth.getSession();
        if (current.session) {
          router.replace("/(tabs)");
          return;
        }
        setFailed(true);
        return;
      }
      router.replace(await routeAfterSignIn(userId));
    })();
  }, [tokenHash, type, router]);

  return (
    <SafeAreaView style={styles.fill}>
      <View style={styles.centre}>
        {failed ? (
          <View style={styles.card}>
            <Text style={styles.title}>That link has expired</Text>
            <Text style={styles.body}>
              Confirmation links work once and only for a while. If you&apos;ve already confirmed, just log in —
              otherwise log in and we&apos;ll tell you if your email still needs confirming.
            </Text>
            <Pressable style={styles.primary} onPress={() => router.replace("/login")} accessibilityRole="button">
              <Text style={styles.primaryLabel}>Go to log in</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.gold400} />
            <Text style={styles.waiting}>Signing you in…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  waiting: { fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.cream100 },
  card: { backgroundColor: colors.cream50, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, alignSelf: "stretch" },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink900 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink500 },
  primary: {
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryLabel: { fontFamily: fonts.bodyBold, color: colors.cream50, fontSize: type.body },
});
