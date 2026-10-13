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
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

import { useAuth } from "@/lib/auth";
import { SITE_URL } from "@/lib/config";
import { sendSignInCode, verifySignInCode } from "@/lib/mobile-number";
import { cleanCode, maskPhone, normalisePhone } from "@/lib/phone";
import { colors, radii, spacing, type } from "@/lib/theme";
import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Sign in with a text code (0134) — for a member who has verified a mobile.
  const [mode, setMode] = useState<"password" | "code">("password");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const switchMode = (next: "password" | "code") => {
    setMode(next);
    setError(null);
    setSentTo(null);
    setCode("");
  };

  const sendCode = async () => {
    if (pending) return;
    const parsed = normalisePhone(phone);
    if (!parsed.ok) return setError(parsed.error);
    setPending(true);
    setError(null);
    const problem = await sendSignInCode(parsed.e164);
    setPending(false);
    if (problem) return setError(problem);
    setSentTo(parsed.e164);
  };

  const verifyCode = async () => {
    if (pending || !sentTo) return;
    const token = cleanCode(code);
    if (!token) return setError("Type the six-digit code from the text.");
    setPending(true);
    setError(null);
    const problem = await verifySignInCode(sentTo, token);
    // On success the auth gate redirects, as with a password.
    if (problem) {
      setError(problem);
      setPending(false);
    }
  };

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
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.wordmark}>PinPals</Text>
          <Text style={styles.tagline}>
            Golf partners, tee times and gear — all in one place.
          </Text>

          <View style={styles.card}>
            {mode === "password" ? (
              <>
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
              </>
            ) : !sentTo ? (
              <View style={styles.field}>
                <Text style={styles.label}>Your mobile</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="087 123 4567"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  returnKeyType="go"
                  onSubmitEditing={sendCode}
                  placeholderTextColor={colors.ink500}
                />
                <Text style={styles.hint}>The number you verified in Privacy &amp; security. We&apos;ll text you a code.</Text>
              </View>
            ) : (
              <View style={styles.field}>
                <Text style={styles.label}>{`Code sent to ${maskPhone(sentTo)}`}</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={7}
                  returnKeyType="go"
                  onSubmitEditing={verifyCode}
                  placeholderTextColor={colors.ink500}
                />
                <Text style={styles.hint}>If this number is on a PinPals account, the code is on its way.</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.primary, pending && styles.primaryDisabled]}
              onPress={mode === "password" ? submit : sentTo ? verifyCode : sendCode}
              disabled={pending}
              accessibilityRole="button"
            >
              {pending ? (
                <ActivityIndicator color={colors.cream50} />
              ) : (
                <Text style={styles.primaryLabel}>{mode === "password" ? "Log in" : sentTo ? "Log in" : "Text me a code"}</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.linkRow}
              onPress={() => switchMode(mode === "password" ? "code" : "password")}
              accessibilityRole="button"
            >
              <Text style={styles.link}>{mode === "password" ? "Sign in with a text code instead" : "Use my email and password"}</Text>
            </Pressable>

            {/* Resetting a password still happens on the website: the reset
                link in the email opens the site's form either way. Signing
                up is native (Oct 2026) — app/signup.tsx. */}
            <Pressable
              style={styles.linkRow}
              onPress={() => void Linking.openURL(`${SITE_URL}/forgot-password`)}
              accessibilityRole="link"
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
            <Pressable style={styles.linkRow} onPress={() => router.push("/signup")} accessibilityRole="link">
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
  linkRow: { minHeight: 44, justifyContent: "center" },
  hint: { fontSize: type.small, color: colors.ink500, lineHeight: 18 },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: "center" },
  link: {
    color: colors.green700,
    fontWeight: "700",
    fontSize: type.small,
    textAlign: "center",
    paddingVertical: 6,
  },
});
