import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { KEYBOARD_DISMISS_MODE } from "@/components/keyboard";
import { sendParentLink, useAgeAccess } from "@/lib/age";
import { gateFor, looksLikeEmail, maskEmail, parentStatusLine } from "@/lib/age-rules";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, creamAlpha, fonts, radii, spacing, type, AUTH_COLUMN } from "@/lib/theme";

/**
 * "Waiting for your parent" (junior members, 0159).
 *
 * A 13–15 year old's account does nothing until a parent or guardian with
 * their own PinPals account (18+) approves it from the email we send them.
 * The root layout (app/_layout.tsx) keeps a member in the junior_pending
 * band here; from here they can still read the Rules of Golf, browse the
 * course directory and the how-to guides, check again, send the email
 * again (or to someone else), or log out.
 *
 * The parent's address is shown masked: it's the junior's own data, but a
 * phone gets handed around.
 */
export default function WaitingForParentScreen() {
  const { signOut } = useAuth();
  const { access, refresh } = useAgeAccess();
  const parent = access.parent;

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // No parent added yet (a member who entered a date of birth that makes
  // them 13–15): straight to the form.
  const showForm = editing || !parent;

  // Approved (or a birthday moved them on): out of here.
  useEffect(() => {
    if (gateFor(access) !== "waiting" && access.band !== "unknown") router.replace("/(tabs)");
  }, [access]);

  const check = async () => {
    setRefreshing(true);
    setNotice(null);
    const next = await refresh();
    setRefreshing(false);
    if (gateFor(next) === "waiting") setNotice("Not yet — we'll let you know as soon as they say yes.");
  };

  const send = async (to: string) => {
    if (sending) return;
    if (!looksLikeEmail(to)) {
      setError("Please enter your parent or guardian's email address.");
      return;
    }
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await sendParentLink(to);
      setEditing(false);
      setEmail("");
      setNotice("Sent. Ask them to check their email (and their spam folder).");
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Couldn't send that. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const go = (to: Href) => router.push(to);

  return (
    <SafeAreaView style={styles.fill}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardDismissMode={KEYBOARD_DISMISS_MODE}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void check()} tintColor={colors.gold400} />}
        >
          <View style={styles.eyebrowRow}>
            <View style={styles.rule} />
            <Text style={styles.eyebrow}>Nearly there</Text>
          </View>
          <Text style={styles.title} accessibilityRole="header">
            Waiting for your parent
          </Text>
          <Text style={styles.tagline}>
            Golfers under 16 need a parent or guardian to say yes before they can use PinPals. We&apos;ve emailed them
            a link — once they approve, live scoring, scorecards and the hole map switch on.
          </Text>

          <View style={styles.card}>
            {parent ? (
              <View style={styles.statusRow}>
                <View style={styles.statusIcon}>
                  <Ionicons name={parent.status === "pending" ? "hourglass-outline" : "alert-circle-outline"} size={22} color={colors.green700} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.statusEmail}>{maskEmail(parent.email)}</Text>
                  <Text style={styles.statusLine}>{parentStatusLine(parent)}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.body}>Add the email address of a parent or guardian. They&apos;ll need their own PinPals account to approve yours — the email shows them how.</Text>
            )}

            {showForm ? (
              <View style={styles.field}>
                <Text style={styles.label}>Parent or guardian&apos;s email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  onSubmitEditing={() => void send(email)}
                  autoFocus={editing}
                />
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            {showForm ? (
              <View style={styles.buttons}>
                {parent ? (
                  <Pressable style={styles.secondary} onPress={() => setEditing(false)} accessibilityRole="button">
                    <Text style={styles.secondaryLabel}>Cancel</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.primary, styles.grow, sending && styles.disabled]}
                  onPress={() => void send(email)}
                  disabled={sending}
                  accessibilityRole="button"
                >
                  {sending ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryLabel}>Send to my parent</Text>}
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable
                  style={[styles.primary, refreshing && styles.disabled]}
                  onPress={() => void check()}
                  disabled={refreshing}
                  accessibilityRole="button"
                >
                  {refreshing ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryLabel}>Check again</Text>}
                </Pressable>
                <View style={styles.buttons}>
                  <Pressable
                    style={[styles.secondary, styles.grow, sending && styles.disabled]}
                    onPress={() => parent && void send(parent.email)}
                    disabled={sending}
                    accessibilityRole="button"
                  >
                    <Text style={styles.secondaryLabel}>Send again</Text>
                  </Pressable>
                  <Pressable style={[styles.secondary, styles.grow]} onPress={() => setEditing(true)} accessibilityRole="button">
                    <Text style={styles.secondaryLabel}>Change email</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          <Text style={styles.meanwhile}>In the meantime</Text>
          <View style={styles.links}>
            <LinkRow icon="reader-outline" label="Rules of Golf" onPress={() => go("/rules")} />
            <LinkRow icon="flag-outline" label="Course directory" onPress={() => go("/courses")} />
            <LinkRow icon="book-outline" label="How parent approval works" onPress={() => go("/guide/parentApproval" as Href)} />
            <LinkRow icon="log-out-outline" label="Log out" onPress={() => void signOut()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LinkRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.8 }]} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={colors.gold400} />
      <Text style={styles.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.cream100} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.navy900 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.sm, ...AUTH_COLUMN },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rule: { width: 20, height: 2, backgroundColor: colors.gold400 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400 },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.cream50 },
  tagline: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.cream100, marginBottom: spacing.md },
  card: { backgroundColor: colors.cream50, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  statusRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  statusIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  statusEmail: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  statusLine: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink900 },
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
  errorBox: { backgroundColor: colors.red100, borderRadius: radii.sm, paddingHorizontal: 14, paddingVertical: 10 },
  errorText: { fontFamily: fonts.body, color: colors.red600, fontSize: type.small },
  notice: { fontFamily: fonts.body, fontSize: type.small, color: colors.green700, textAlign: "center" },
  buttons: { flexDirection: "row", gap: spacing.sm },
  grow: { flex: 1 },
  primary: { backgroundColor: colors.green700, borderRadius: radii.pill, paddingVertical: 14, alignItems: "center", minHeight: 50, justifyContent: "center", paddingHorizontal: spacing.md },
  primaryLabel: { fontFamily: fonts.bodyBold, color: colors.cream50, fontSize: type.body },
  secondary: { minHeight: 46, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.green700, paddingHorizontal: spacing.md },
  secondaryLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
  disabled: { opacity: 0.6 },
  meanwhile: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: colors.gold400, marginTop: spacing.lg },
  links: { borderRadius: radii.lg, borderWidth: 1, borderColor: creamAlpha(0.18), overflow: "hidden" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: creamAlpha(0.18) },
  linkLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.cream50 },
});
