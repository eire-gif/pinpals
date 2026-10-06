import { useRef, useState } from "react";
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

import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { SITE_URL } from "@/lib/config";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

const MIN_PASSWORD = 6;

/**
 * Create an account — in the app (Oct 2026). It used to open the website's
 * sign-up page in Safari, which left a new member on the website, signed in
 * there and not here. Apple's review guidelines expect sign-up in the app too.
 *
 * Same fields and rules as the website's form; the account is created by
 * POST /api/app/signup, which runs the website's own sign-up function
 * (src/lib/signup.ts) — one set of rules, one rate limit.
 *
 * Email confirmation is on, so this ends at "check your inbox". Tapping the
 * link on this phone opens the app (the website's apple-app-site-association
 * claims /auth/confirm) and auth-confirm.tsx signs the member in.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const lastRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    if (pending) return;
    const address = email.trim();
    if (!first.trim() || !last.trim() || !address) {
      setError("Please fill in every field.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Your password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${SITE_URL}/api/app/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firstName: first.trim(), lastName: last.trim(), email: address, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Couldn't create your account. Please try again.");
        setPending(false);
        return;
      }
      setSentTo(address);
    } catch {
      setError("Couldn't reach PinPals. Check your connection and try again.");
    }
    setPending(false);
  };

  if (sentTo) {
    return (
      <SafeAreaView style={styles.fill}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <View style={styles.doneIcon}>
              <Ionicons name="mail-open-outline" size={30} color={colors.green700} />
            </View>
            <Text style={styles.doneTitle}>Check your inbox</Text>
            <Text style={styles.doneBody}>
              We&apos;ve sent a confirmation link to <Text style={styles.doneEmail}>{sentTo}</Text>.
            </Text>
            <Text style={styles.doneBody}>
              Open it on this phone and it brings you straight back here, signed in and ready to set up your
              home club.
            </Text>
            <Pressable style={styles.primary} onPress={() => router.replace("/login")} accessibilityRole="button">
              <Text style={styles.primaryLabel}>Back to log in</Text>
            </Pressable>
            <Text style={styles.hint}>No email after a few minutes? Check your spam folder.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.fill}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.eyebrowRow}>
            <View style={styles.rule} />
            <Text style={styles.eyebrow}>Join PinPals</Text>
          </View>
          <Text style={styles.title}>Tell us about your game.</Text>
          <Text style={styles.tagline}>
            Your name, email and a password is all it takes — add your home club and handicap right after.
          </Text>

          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.field, styles.half]}>
                <Text style={styles.label}>First name</Text>
                <TextInput
                  style={styles.input}
                  value={first}
                  onChangeText={setFirst}
                  autoComplete="given-name"
                  textContentType="givenName"
                  returnKeyType="next"
                  onSubmitEditing={() => lastRef.current?.focus()}
                  submitBehavior="submit"
                />
              </View>
              <View style={[styles.field, styles.half]}>
                <Text style={styles.label}>Last name</Text>
                <TextInput
                  ref={lastRef}
                  style={styles.input}
                  value={last}
                  onChangeText={setLast}
                  autoComplete="family-name"
                  textContentType="familyName"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  submitBehavior="submit"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                ref={emailRef}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                submitBehavior="submit"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
                <Pressable
                  style={styles.eye}
                  onPress={() => setShowPassword((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.ink500} />
                </Pressable>
              </View>
              <Text style={styles.hint}>At least {MIN_PASSWORD} characters.</Text>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={[styles.primary, pending && styles.primaryDisabled]}
              onPress={submit}
              disabled={pending}
              accessibilityRole="button"
            >
              {pending ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryLabel}>Create my account</Text>}
            </Pressable>

            <Pressable style={styles.linkRow} onPress={() => router.replace("/login")} accessibilityRole="link">
              <Text style={styles.linkMuted}>
                Already on PinPals? <Text style={styles.link}>Log in</Text>
              </Text>
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
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 20, height: 2, backgroundColor: colors.gold400 },
  eyebrow: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.gold400,
  },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50, marginTop: spacing.sm },
  tagline: {
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 22,
    color: colors.cream100,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  card: { backgroundColor: colors.cream50, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm },
  half: { flex: 1, minWidth: 0 },
  field: { gap: 6 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, color: colors.ink900 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  passwordWrap: { justifyContent: "center" },
  passwordInput: { paddingRight: 48 },
  eye: { position: "absolute", right: 4, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hint: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500 },
  errorBox: { backgroundColor: colors.red100, borderRadius: radii.sm, paddingHorizontal: 14, paddingVertical: 10 },
  errorText: { fontFamily: fonts.body, color: colors.red600, fontSize: type.small },
  primary: {
    backgroundColor: colors.green700,
    borderRadius: radii.pill,
    paddingVertical: 15,
    alignItems: "center",
    minHeight: 50,
    justifyContent: "center",
  },
  primaryDisabled: { opacity: 0.6 },
  primaryLabel: { fontFamily: fonts.bodyBold, color: colors.cream50, fontSize: type.body },
  linkRow: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  linkMuted: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500 },
  link: { fontFamily: fonts.bodyBold, color: colors.green700 },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.green100,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  doneTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.ink900, textAlign: "center" },
  doneBody: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink500, textAlign: "center" },
  doneEmail: { fontFamily: fonts.bodyBold, color: colors.ink900 },
});
