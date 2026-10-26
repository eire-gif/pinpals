import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";

import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { colors, radii, spacing, type } from "@/lib/theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const { error: message } = await signIn(email, password);
    // On success the auth gate in _layout.tsx redirects; this screen unmounts,
    // so there is nothing to set.
    if (message) {
      setError(message);
      setPending(false);
    }
  };

  return (
    <SafeAreaView style={styles.fill}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={26} color={colors.cream50} />
      </Pressable>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.wordmark}>PinPals</Text>
          <Text style={styles.tagline}>
            Golf partners, tee times and gear — all in one place.
          </Text>

          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                returnKeyType="next"
                placeholderTextColor={colors.ink500}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                placeholderTextColor={colors.ink500}
              />
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.primary, pending && styles.primaryDisabled]}
              onPress={submit}
              disabled={pending}
              accessibilityRole="button"
            >
              {pending ? (
                <ActivityIndicator color={colors.cream50} />
              ) : (
                <Text style={styles.primaryLabel}>Log in</Text>
              )}
            </Pressable>

            {/* Resetting a password still happens on the site: it is rare,
                and the reset link lands in a browser anyway. Joining is in
                the app (signup.tsx) — that one is not rare. */}
            <Pressable
              onPress={() => void Linking.openURL(`${SITE_URL}/forgot-password`)}
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
            <Pressable onPress={() => router.replace("/signup")}>
              <Text style={styles.link}>New here? Create an account</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  back: {
    position: "absolute",
    top: 56,
    left: 8,
    zIndex: 1,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  wordmark: {
    fontSize: 40,
    fontWeight: "800",
    color: colors.cream50,
    textAlign: "center",
  },
  tagline: {
    fontSize: type.body,
    color: colors.cream100,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.cream50,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  field: { gap: 6 },
  label: { fontSize: type.label, fontWeight: "700", color: colors.ink900 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  errorBox: {
    backgroundColor: colors.red100,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { color: colors.red600, fontSize: type.small },
  primary: {
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 15,
    alignItems: "center",
    minHeight: 50,
    justifyContent: "center",
  },
  primaryDisabled: { opacity: 0.6 },
  primaryLabel: {
    color: colors.cream50,
    fontWeight: "700",
    fontSize: type.body,
  },
  link: {
    color: colors.green700,
    fontWeight: "700",
    fontSize: type.small,
    textAlign: "center",
    paddingVertical: 6,
  },
});
