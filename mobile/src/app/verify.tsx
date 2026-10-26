import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import Ionicons from "@expo/vector-icons/Ionicons";

import { BackButton, ErrorNote, PrimaryButton, Sub, Title, joinStyles } from "@/components/join-ui";
import { useAuth } from "@/lib/auth";
import { resendCode } from "@/lib/signup";
import { colors, fonts, radii } from "@/lib/theme";

const CODE_LENGTH = 6;
const RESEND_AFTER_S = 45;

/**
 * Type the code from the email.
 *
 * Why a code and not the usual link: a link opens a browser, the browser
 * signs the member in on the WEBSITE, and they are left holding a phone with
 * a confirmed account and a signed-out app. Every app that does it that way
 * loses people in the gap. The confirmation email carries both (see
 * supabase/templates/confirmation.html), so website sign-ups are unchanged.
 *
 * One hidden TextInput behind six drawn boxes, rather than six inputs. Six
 * inputs fight over focus, break paste, and break iOS's "From Messages/Mail"
 * one-time-code suggestion — which `textContentType="oneTimeCode"` on a single
 * field gives for free.
 */
export default function VerifyScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const address = String(email ?? "");
  const { verifySignUp } = useAuth();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [wait, setWait] = useState(RESEND_AFTER_S);
  const [resent, setResent] = useState(false);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (value = code) => {
    if (pending || value.length !== CODE_LENGTH) return;
    setPending(true);
    setError(null);
    const { error: message } = await verifySignUp(address, value);
    // On success the auth gate takes the member to the profile builder and
    // this screen unmounts; there is nothing to set.
    if (message) {
      setError(message);
      setPending(false);
    }
  };

  const onChange = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void submit(digits);
  };

  const resend = async () => {
    if (wait > 0) return;
    setWait(RESEND_AFTER_S);
    setError(null);
    const { error: message } = await resendCode(address);
    if (message) setError(message);
    else setResent(true);
  };

  return (
    <SafeAreaView style={styles.fill} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.top}>
          <BackButton onPress={() => router.back()} />
        </View>

        <View style={joinStyles.pad}>
          <View style={styles.badge}>
            <Ionicons name="mail-outline" size={30} color={colors.green700} />
          </View>
          <Title>Check your email</Title>
          <Sub>
            We&apos;ve sent a {CODE_LENGTH}-digit code to{" "}
            <Text style={styles.strong}>{address}</Text>. Type it here — no need
            to leave the app.
          </Sub>

          <Pressable style={styles.boxes} onPress={() => input.current?.focus()} accessibilityLabel="Code">
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <View
                key={i}
                style={[styles.box, i === code.length && styles.boxCurrent]}
              >
                <Text style={styles.digit}>{code[i] ?? ""}</Text>
              </View>
            ))}
          </Pressable>
          <TextInput
            ref={input}
            value={code}
            onChangeText={onChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            autoFocus
            style={styles.hidden}
            accessibilityLabel="Six-digit code"
          />

          <View style={styles.row}>
            {wait > 0 ? (
              <Text style={styles.muted}>
                {resent ? "Sent again. " : ""}Resend code in 0:{String(wait).padStart(2, "0")}
              </Text>
            ) : (
              <Text style={joinStyles.link} onPress={resend}>
                Send a new code
              </Text>
            )}
            <Text style={joinStyles.link} onPress={() => router.back()}>
              Wrong email?
            </Text>
          </View>

          <View style={styles.errorWrap}>
            <ErrorNote message={error} />
          </View>
        </View>

        <View style={styles.flex} />
        <View style={joinStyles.footer}>
          {Platform.OS === "ios" ? (
            <PrimaryButton
              tone="outline"
              label="Open Mail"
              onPress={() => void Linking.openURL("message://")}
            />
          ) : null}
          <PrimaryButton
            label="Verify and continue"
            onPress={() => void submit()}
            pending={pending}
            disabled={code.length !== CODE_LENGTH}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  flex: { flex: 1 },
  top: { paddingLeft: 8, paddingTop: 4 },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    backgroundColor: colors.green100,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    marginBottom: 14,
  },
  strong: { fontFamily: fonts.bodyBold, color: colors.ink900 },
  boxes: { flexDirection: "row", gap: 8, marginTop: 28 },
  box: {
    flex: 1,
    height: 60,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  boxCurrent: { borderColor: colors.green700, borderWidth: 2 },
  digit: { fontFamily: fonts.display, fontSize: 28, color: colors.ink900 },
  hidden: { position: "absolute", opacity: 0, width: 1, height: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  muted: { fontFamily: fonts.body, fontSize: 14, color: "#4c5667" },
  errorWrap: { marginTop: 14 },
});
