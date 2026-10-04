import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";

import {
  BackButton,
  ErrorNote,
  Field,
  PrimaryButton,
  Sub,
  Tick,
  Title,
  joinStyles,
} from "@/components/join-ui";
import { SITE_URL } from "@/lib/config";
import { LEGAL, PASSWORD_MIN, createAccount } from "@/lib/signup";
import { colors, fonts, spacing } from "@/lib/theme";

/**
 * Create an account — inside the app.
 *
 * This used to be a link that opened pinpals.ie in Safari, which threw away
 * a member at the exact moment they had decided to join. Now it is four
 * fields and one tick, and the next screen asks for the code from the email
 * rather than a link that opens a browser.
 *
 * What is deliberately NOT here: club, handicap, photo, phone number. None is
 * needed to create an account, every extra field is a reason to stop, and
 * the profile builder straight after asks for them once the member has an
 * account to lose by leaving.
 *
 * ONE required tick, not three. Its wording names the Terms, the Marketplace
 * Rules, the Community Guidelines, the Privacy Policy and the age
 * declaration; the server records each as its own consent row with its own
 * version and hash, exactly as the website's three ticks do. The marketing
 * tick stays separate and unticked — bundling it would make that consent
 * invalid.
 */
export default function SignupScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [digest, setDigest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const lastRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const ready =
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    email.trim().includes("@") &&
    password.length >= PASSWORD_MIN &&
    agreed;

  const submit = async () => {
    if (pending) return;
    if (!ready) {
      setError(
        password.length > 0 && password.length < PASSWORD_MIN
          ? `Passwords need at least ${PASSWORD_MIN} characters.`
          : !agreed
            ? "Please tick the box to agree to the terms."
            : "Please fill in every field."
      );
      return;
    }
    setPending(true);
    setError(null);
    const { error: message } = await createAccount({
      firstName,
      lastName,
      email,
      password,
      agreeTerms: agreed,
      confirmAge: agreed,
      marketingEmail: digest,
    });
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    router.push({ pathname: "/verify", params: { email: email.trim() } });
  };

  const open = (path: string) => void Linking.openURL(`${SITE_URL}${path}`);

  return (
    <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.top}>
          <BackButton onPress={() => router.back()} />
          <Text style={styles.haveAccount}>
            Have an account?{" "}
            <Text style={joinStyles.link} onPress={() => router.replace("/login")}>
              Log in
            </Text>
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Title>Create your account</Title>
          <Sub>Thirty seconds. Your golfing profile comes next.</Sub>

          <View style={styles.form}>
            <View style={styles.row}>
              <Field
                label="First name"
                value={firstName}
                onChangeText={setFirstName}
                autoComplete="given-name"
                textContentType="givenName"
                returnKeyType="next"
                onSubmitEditing={() => lastRef.current?.focus()}
              />
              <Field
                ref={lastRef}
                label="Last name"
                value={lastName}
                onChangeText={setLastName}
                autoComplete="family-name"
                textContentType="familyName"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
              />
            </View>
            <Field
              ref={emailRef}
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label="Password"
              hint={`${PASSWORD_MIN}+ characters`}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules={`minlength: ${PASSWORD_MIN};`}
              returnKeyType="done"
            />
          </View>

          <View style={styles.ticks}>
            <Tick checked={agreed} onToggle={() => setAgreed((v) => !v)}>
              <Text style={joinStyles.body}>
                I&apos;m 18 or over and agree to the{" "}
                <Text style={joinStyles.link} onPress={() => open(LEGAL.terms)}>Terms</Text>,{" "}
                <Text style={joinStyles.link} onPress={() => open(LEGAL.marketplace)}>Marketplace Rules</Text>{" "}
                and{" "}
                <Text style={joinStyles.link} onPress={() => open(LEGAL.community)}>Community Guidelines</Text>,
                and I&apos;ve read the{" "}
                <Text style={joinStyles.link} onPress={() => open(LEGAL.privacy)}>Privacy Policy</Text>.
              </Text>
            </Tick>
            <Tick checked={digest} onToggle={() => setDigest((v) => !v)}>
              <Text style={[joinStyles.body, styles.muted]}>
                Send me the weekly golf digest.{" "}
                <Text style={styles.faint}>Optional — unsubscribe any time.</Text>
              </Text>
            </Tick>
          </View>

          <ErrorNote message={error} />
        </ScrollView>

        <View style={joinStyles.footer}>
          <PrimaryButton label="Create account" onPress={submit} pending={pending} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 8,
    paddingRight: 20,
    paddingTop: 4,
  },
  haveAccount: { fontFamily: fonts.body, fontSize: 14, color: "#4c5667" },
  scroll: { paddingHorizontal: 20, paddingBottom: spacing.lg, gap: 0 },
  form: { gap: 12, marginTop: 20 },
  row: { flexDirection: "row", gap: 10 },
  ticks: { gap: 14, marginTop: 18, marginBottom: 14 },
  muted: { color: "#4c5667" },
  faint: { color: colors.ink500 },
});
