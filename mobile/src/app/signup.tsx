import { useEffect, useRef, useState } from "react";
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
import { cleanCode, confirmWithCode, isCompleteCode, resendSignupCode } from "@/lib/signup-code";
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
 * Email confirmation is on, so sign-up ends at the code screen below: the
 * email carries a code as well as a link, and typing the code here signs the
 * member in without leaving the app (lib/signup-code.ts). The link still
 * works too — on this phone it opens the app (auth-confirm.tsx) when the mail
 * app and iOS cooperate, and the website otherwise.
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
    return <ConfirmCode email={sentTo} onBack={() => setSentTo(null)} />;
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

/** How long before "Send a new code" can be tapped again — Supabase's own
 *  minimum gap between emails to one address is 60 seconds. */
const RESEND_WAIT_SECONDS = 60;

/**
 * "Enter the code we emailed you." Shown straight after sign-up. iOS offers
 * the code from Mail above the keyboard (textContentType oneTimeCode); the
 * account is confirmed as soon as a full code is typed or pasted.
 */
function ConfirmCode({ email, onBack }: { email: string; onBack: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [wait, setWait] = useState(RESEND_WAIT_SECONDS);
  const lastTried = useRef<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const check = async (value: string) => {
    if (checking || !isCompleteCode(value)) return;
    lastTried.current = value;
    setChecking(true);
    setError(null);
    setNotice(null);
    const result = await confirmWithCode(email, value);
    if (result.ok) {
      router.replace(result.next);
      return;
    }
    setError(result.error);
    setChecking(false);
  };

  const onChange = (text: string) => {
    const next = cleanCode(text);
    const arrivedWhole = next.length - code.length > 1;
    setCode(next);
    setError(null);
    // A code pasted or filled in by iOS confirms by itself. A typed one waits
    // for the button: the project's code length is a dashboard setting (6 by
    // default, up to 10), so the app can't know when typing is finished.
    // Never retried automatically once turned down.
    if (arrivedWhole && isCompleteCode(next) && next !== lastTried.current) void check(next);
  };

  const resend = async () => {
    if (wait > 0) return;
    setError(null);
    setNotice(null);
    const result = await resendSignupCode(email);
    if (result.ok) {
      setNotice("New code sent. Use the one in the latest email.");
      setCode("");
      lastTried.current = null;
    } else {
      setError(result.error);
    }
    setWait(RESEND_WAIT_SECONDS);
  };

  return (
    <SafeAreaView style={styles.fill}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.doneIcon}>
              <Ionicons name="mail-open-outline" size={30} color={colors.green700} />
            </View>
            <Text style={styles.doneTitle}>Enter your code</Text>
            <Text style={styles.doneBody}>
              We&apos;ve emailed a code to <Text style={styles.doneEmail}>{email}</Text>. Type it in below to
              confirm your account.
            </Text>

            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={onChange}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              autoFocus
              maxLength={12}
              placeholder="000000"
              placeholderTextColor={colors.line}
              returnKeyType="done"
              onSubmitEditing={() => void check(code)}
              accessibilityLabel="Confirmation code"
              editable={!checking}
            />

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Pressable
              style={[styles.primary, (checking || !isCompleteCode(code)) && styles.primaryDisabled]}
              onPress={() => void check(code)}
              disabled={checking || !isCompleteCode(code)}
              accessibilityRole="button"
            >
              {checking ? (
                <ActivityIndicator color={colors.cream50} />
              ) : (
                <Text style={styles.primaryLabel}>Confirm my account</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.linkRow}
              onPress={resend}
              disabled={wait > 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: wait > 0 }}
            >
              <Text style={styles.linkMuted}>
                No email?{" "}
                <Text style={wait > 0 ? styles.linkWaiting : styles.link}>
                  {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
                </Text>
              </Text>
            </Pressable>
            <Text style={[styles.hint, styles.centred]}>
              Check your spam folder too. You can also tap the button in the email instead.
            </Text>

            <View style={styles.footerLinks}>
              <Pressable style={styles.linkRow} onPress={onBack} accessibilityRole="button">
                <Text style={styles.link}>Wrong email?</Text>
              </Pressable>
              <Pressable style={styles.linkRow} onPress={() => router.replace("/login")} accessibilityRole="link">
                <Text style={styles.link}>Log in</Text>
              </Pressable>
            </View>
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
  codeInput: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.sm,
    paddingVertical: 14,
    fontFamily: fonts.bodyBold,
    fontSize: 28,
    letterSpacing: 8,
    textAlign: "center",
    color: colors.ink900,
    backgroundColor: colors.surface,
  },
  notice: { fontFamily: fonts.body, fontSize: type.small, color: colors.green700, textAlign: "center" },
  centred: { textAlign: "center" },
  linkWaiting: { fontFamily: fonts.bodySemi, color: colors.ink500 },
  footerLinks: { flexDirection: "row", justifyContent: "space-between" },
});
