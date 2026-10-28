import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { routeAfterSignIn } from "@/lib/signup-code";
import {
  signInWithApple,
  signInWithGoogle,
  useSocialProviders,
  type SocialProvider,
  type SocialResult,
} from "@/lib/social-sign-in";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * "Continue with Apple" / "Continue with Google" (Oct 2026), above the email
 * form on Log in and Sign up. Draws nothing until a provider is switched on
 * in Supabase and the app binary can do it (lib/social-sign-in.ts), so the
 * screens look exactly as before until then.
 *
 * Apple's button is Apple's own (AppleAuthenticationButton) — its look is
 * set by Apple's guidelines, and App Review checks it. Google's follows
 * Google's: white, the G, "Continue with Google".
 *
 * On success the member goes on as from any other sign-in: the profile
 * builder if they haven't finished it, else Home. A brand-new account is
 * held at "Finish joining" (app/age/date-of-birth.tsx) by the root layout
 * first, for a date of birth.
 */
export function SocialSignInButtons({ onError }: { onError: (message: string | null) => void }) {
  const router = useRouter();
  const shown = useSocialProviders();
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  if (!shown.apple && !shown.google) return null;

  const run = async (provider: SocialProvider, go: () => Promise<SocialResult>) => {
    if (busy) return;
    setBusy(provider);
    onError(null);
    const result = await go();
    if (result.ok) {
      router.replace(await routeAfterSignIn(result.userId));
      return; // this screen unmounts
    }
    if (!result.cancelled) onError(result.error);
    setBusy(null);
  };

  return (
    <View style={styles.wrap}>
      {shown.apple ? <AppleButton disabled={busy !== null} onPress={() => void run("apple", signInWithApple)} /> : null}

      {shown.google ? (
        <Pressable
          style={({ pressed }) => [styles.google, pressed && styles.pressed, busy !== null && styles.dim]}
          onPress={() => void run("google", signInWithGoogle)}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
        >
          {busy === "google" ? (
            <ActivityIndicator color={colors.ink900} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={colors.ink900} />
              <Text style={styles.googleLabel}>Continue with Google</Text>
            </>
          )}
        </Pressable>
      ) : null}

      <View style={styles.orRow}>
        <View style={styles.orLine} />
        <Text style={styles.orText}>or use your email</Text>
        <View style={styles.orLine} />
      </View>
    </View>
  );
}

function AppleButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  // Required lazily: only binaries with the native module ever get here.
  const Apple = require("expo-apple-authentication") as typeof import("expo-apple-authentication");
  return (
    <View pointerEvents={disabled ? "none" : "auto"} style={disabled && styles.dim}>
      <Apple.AppleAuthenticationButton
        buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={Apple.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={25}
        style={styles.apple}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  apple: { height: 50, width: "100%" },
  google: {
    minHeight: 50,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.6 },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orText: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
});
