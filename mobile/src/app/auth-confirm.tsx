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
 *
 * Already signed in? Ask first (security review, Oct 2026). Otherwise anyone
 * could send a member a sign-in link to their OWN account and the app would
 * silently switch to it — whatever the member did next would land in the
 * sender's account. Same rule as the website's /auth/switch.
 */
export default function AuthConfirmScreen() {
  const router = useRouter();
  const { token_hash: tokenHash, type } = useLocalSearchParams<{ token_hash?: string; type?: string }>();
  const [failed, setFailed] = useState(false);
  // Email of the account this phone is already signed in to, when there is one.
  const [askAs, setAskAs] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    if (!confirmed) {
      // First pass: is somebody signed in already? Then ask before redeeming.
      void (async () => {
        const { data: current } = await supabase.auth.getSession();
        if (current.session) setAskAs(current.session.user.email ?? "your current account");
        else setConfirmed(true);
      })();
      return;
    }
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
  }, [tokenHash, type, router, confirmed]);

  return (
    <SafeAreaView style={styles.fill}>
      <View style={styles.centre}>
        {askAs && !confirmed ? (
          <View style={styles.card}>
            <Text style={styles.title}>You&apos;re already signed in</Text>
            <Text style={styles.body}>
              This phone is signed in as {askAs}. The link you opened signs in to an account from an email. If you
              didn&apos;t ask for it yourself just now, stay where you are — someone may be trying to get you to use
              their account.
            </Text>
            <Pressable style={styles.primary} onPress={() => router.replace("/(tabs)")} accessibilityRole="button">
              <Text style={styles.primaryLabel}>Stay signed in</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={() => setConfirmed(true)} accessibilityRole="button">
              <Text style={styles.secondaryLabel}>I asked for this link — continue</Text>
            </Pressable>
          </View>
        ) : failed ? (
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
  card: { backgroundColor: colors.cream50, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, alignSelf: "stretch", width: "100%", maxWidth: 520 },
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
  secondary: {
    borderWidth: 2,
    borderColor: colors.green700,
    borderRadius: radii.pill,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: { fontFamily: fonts.bodyBold, color: colors.green700, fontSize: type.body },
});
