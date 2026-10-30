import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Stack, router } from "expo-router";
import * as Linking from "expo-linking";
import Ionicons from "@expo/vector-icons/Ionicons";

import { SignInMethods } from "@/components/sign-in-methods";
import { useAgeAccess } from "@/lib/age";
import { isUnder16, maskEmail, parentStatusLine } from "@/lib/age-rules";
import { useAuth } from "@/lib/auth";
import { loadBoardsHidden, setBoardsHidden } from "@/lib/course-boards";
import { isOn } from "@/lib/features";
import { loadMyGroups } from "@/lib/groups-data";
import { loadMyMobile, loadMyShares, removeMyMobile, saveMyMobile, setShare, type MyMobile } from "@/lib/mobile-number";
import { formatPhone, normalisePhone } from "@/lib/phone";
import { signedInUrl } from "@/lib/web-session";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Privacy & security (Profile → Account).
 *
 *   - Your mobile: add it, then share it with the people who run your
 *     groups — group by group, off until you turn it on. (No text-message
 *     check: texts cost money per message.)
 *   - Ways to sign in: email, Apple, Google — connect Apple or Google to
 *     this account (components/sign-in-methods.tsx).
 *   - Download my data: everything PinPals holds about you, as a file
 *     (opens the website signed in, which downloads it).
 *
 * Who sees a shared number is decided in the database (group_contacts, 0134):
 * the owner and admins (a society's captain and secretary) see members'
 * numbers; members see only theirs.
 */

type GroupRow = { id: number; name: string; kind: string; role: string };

export default function PrivacyScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  // Junior members (0159): a 13–15 year old sees who looks after their account.
  const { access } = useAgeAccess();

  const [mobile, setMobile] = useState<MyMobile | undefined>(undefined);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [shares, setShares] = useState<Set<number>>(new Set());

  // Adding or changing the number.
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Course leaderboards (0197): on unless switched off.
  const [onBoards, setOnBoards] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId || !isOn("courseBoards")) return;
    loadBoardsHidden(userId)
      .then((hidden) => setOnBoards(!hidden))
      .catch(() => setOnBoards(null));
  }, [userId]);

  const toggleBoards = async (on: boolean) => {
    const before = onBoards;
    setOnBoards(on);
    try {
      await setBoardsHidden(!on);
    } catch {
      setOnBoards(before);
      Alert.alert("Couldn't save that", "Please try again.");
    }
  };

  const load = useCallback(async () => {
    if (!userId) return;
    const [m, mine, s] = await Promise.all([
      loadMyMobile(userId),
      loadMyGroups(userId).catch(() => null),
      loadMyShares(userId).catch(() => new Set<number>()),
    ]);
    setMobile(m);
    setGroups((mine?.groups ?? []).map((g) => ({ id: g.id, name: g.name, kind: g.kind, role: g.role })));
    setShares(s);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetAdd = () => {
    setAdding(false);
    setNumber("");
    setError(null);
  };

  const save = async () => {
    if (!userId) return;
    const parsed = normalisePhone(number);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    setError(null);
    try {
      await saveMyMobile(userId, parsed.e164);
      await load();
      resetAdd();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your number.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    Alert.alert("Remove your mobile?", "No group will see it any more.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await removeMyMobile();
            await load();
          } catch (err) {
            Alert.alert("Couldn't remove it", err instanceof Error ? err.message : "Try again.");
          }
        },
      },
    ]);
  };

  const toggleShare = async (groupId: number, on: boolean) => {
    if (!userId) return;
    const before = shares;
    const next = new Set(shares);
    if (on) next.add(groupId);
    else next.delete(groupId);
    setShares(next);
    try {
      await setShare(userId, groupId, on);
    } catch (err) {
      setShares(before);
      Alert.alert("Couldn't save that", err instanceof Error ? err.message : "Try again.");
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      await Linking.openURL(await signedInUrl("/profile/data/download"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Privacy & security", headerBackTitle: "Back" }} />
      <ScrollView style={styles.fill} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* ============ My parent (13–15) ============ */}
        {isUnder16(access) ? (
          <>
            <Text style={styles.heading}>My parent</Text>
            <View style={styles.card}>
              <View style={styles.numberRow}>
                <Ionicons name="shield-checkmark" size={20} color={colors.green700} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.number}>{access.parent ? maskEmail(access.parent.email) : "Not added yet"}</Text>
                  <Text style={styles.small}>{parentStatusLine(access.parent)}</Text>
                </View>
              </View>
              <Text style={styles.small}>
                Your parent or guardian approves your account and picks the PinPals you can play with, from the Parent
                dashboard on the PinPals website. Your profile is seen only by them, your approved contacts and the
                people you play with.
              </Text>
              {access.parent?.status !== "approved" ? (
                <Pressable style={styles.secondary} onPress={() => router.push("/age/waiting")} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Send it again or change email</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}

        {/* ============ Mobile ============ */}
        <Text style={styles.heading}>Your mobile</Text>
        <View style={styles.card}>
          {mobile === undefined ? (
            <ActivityIndicator color={colors.green700} />
          ) : mobile && !adding ? (
            <>
              <View style={styles.numberRow}>
                <Ionicons name="call" size={20} color={colors.green700} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.number}>{formatPhone(mobile.phone)}</Text>
                  <Text style={styles.small}>Only you can see it unless you share it below</Text>
                </View>
              </View>
              <View style={styles.buttons}>
                <Pressable
                  style={styles.secondary}
                  onPress={() => {
                    setNumber(formatPhone(mobile.phone));
                    setAdding(true);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryText}>Change number</Text>
                </Pressable>
                <Pressable style={styles.secondary} onPress={remove} accessibilityRole="button">
                  <Text style={[styles.secondaryText, { color: colors.red600 }]}>Remove</Text>
                </Pressable>
              </View>
            </>
          ) : !adding ? (
            <>
              <Text style={styles.body1}>Add your mobile so the captain or secretary of your society can reach you — only if you choose to share it.</Text>
              <Pressable style={styles.primary} onPress={() => setAdding(true)} accessibilityRole="button">
                <Text style={styles.primaryText}>Add my mobile</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>Mobile number</Text>
              <TextInput
                style={styles.input}
                value={number}
                onChangeText={setNumber}
                placeholder="087 123 4567"
                placeholderTextColor={colors.ink500}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                returnKeyType="done"
                onSubmitEditing={() => void save()}
                autoFocus
              />
              <Text style={styles.small}>Outside Ireland, start with your country code (+44…).</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={styles.buttons}>
                <Pressable style={styles.secondary} onPress={resetAdd} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.primary, styles.grow, busy && styles.off]} onPress={() => void save()} disabled={busy} accessibilityRole="button">
                  {busy ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.primaryText}>Save</Text>}
                </Pressable>
              </View>
            </>
          )}
        </View>

        {/* ============ Sharing ============ */}
        {mobile ? (
          <>
            <Text style={styles.heading}>Share it with a group</Text>
            <Text style={styles.small}>
              The people who run the group — the owner and admins, or a society&apos;s captain and secretary — can see your number to call or message you.
              If you run the group yourself, its members can see it too. Off until you turn it on.
            </Text>
            <View style={styles.card}>
              {groups.length === 0 ? (
                <Text style={styles.small}>You&apos;re not in any groups yet.</Text>
              ) : (
                groups.map((g, i) => (
                  <View key={g.id} style={[styles.shareRow, i > 0 && styles.divider]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupName}>{g.name}</Text>
                      <Text style={styles.small}>{g.role === "member" ? "Seen by the people who run it" : "You run this — its members will see it"}</Text>
                    </View>
                    <Switch
                      value={shares.has(g.id)}
                      onValueChange={(v) => void toggleShare(g.id, v)}
                      trackColor={{ true: colors.green600, false: colors.line }}
                      accessibilityLabel={`Share my mobile with ${g.name}`}
                    />
                  </View>
                ))
              )}
            </View>
          </>
        ) : null}

        {/* ============ Course leaderboards (0197) ============ */}
        {isOn("courseBoards") && onBoards != null ? (
          <>
            <Text style={styles.heading}>Course leaderboards</Text>
            <View style={styles.card}>
              <View style={styles.shareRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupName}>Show my rounds on course leaderboards</Text>
                  <Text style={styles.small}>
                    Your best round each week, the Course Legend and hole champions: your name, score and the day — never the card. Cards set to Only me never show.
                  </Text>
                </View>
                <Switch
                  value={onBoards}
                  onValueChange={(v) => void toggleBoards(v)}
                  trackColor={{ true: colors.green600, false: colors.line }}
                  accessibilityLabel="Show my rounds on course leaderboards"
                />
              </View>
            </View>
          </>
        ) : null}

        {/* ============ Ways to sign in (Oct 2026): connect Apple / Google ============ */}
        <SignInMethods />

        {/* ============ Your data ============ */}
        <Text style={styles.heading}>Your data</Text>
        <View style={styles.card}>
          <Text style={styles.body1}>A copy of everything PinPals holds about you — profile, posts, messages you sent, listings, orders, rounds, groups — as a file.</Text>
          <Pressable style={[styles.secondary, downloading && styles.off]} onPress={download} disabled={downloading} accessibilityRole="button">
            <Ionicons name="download-outline" size={18} color={colors.green700} />
            <Text style={styles.secondaryText}>Download my data</Text>
          </Pressable>
          <Text style={styles.small}>Opens in your browser. Correct anything in Edit profile; to delete your account, see the bottom of your profile.</Text>
        </View>

        <Pressable onPress={() => router.push("/edit-profile")} style={styles.linkRow} accessibilityRole="link">
          <Text style={styles.link}>Who sees my handicap? Edit profile →</Text>
        </Pressable>
        <Text style={styles.foot}>Your handicap shows only while you switch it on; your Golf Ireland number never shows. Which course ratings you play off (men's or women's), if you say, is used only to place you on the right tees in a draw — it's never shown on your profile. Questions: privacy@pinpals.ie</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  body: { padding: spacing.md, gap: spacing.sm + 2, paddingBottom: spacing.xl * 2 },
  heading: { fontFamily: fonts.display, fontSize: type.heading + 2, color: colors.navy900, marginTop: spacing.sm },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  numberRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  number: { fontFamily: fonts.bodyBold, fontSize: type.body + 2, color: colors.ink900 },
  body1: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22, color: colors.ink900 },
  small: { fontFamily: fonts.body, fontSize: type.small, lineHeight: 19, color: colors.ink500 },
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
    backgroundColor: colors.cream50,
  },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  buttons: { flexDirection: "row", gap: spacing.sm },
  grow: { flex: 1 },
  primary: { minHeight: 48, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.green700, paddingHorizontal: spacing.md },
  primaryText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.cream50 },
  secondary: {
    minHeight: 46,
    flexDirection: "row",
    gap: 6,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.green700,
    paddingHorizontal: spacing.md,
  },
  secondaryText: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.green700 },
  off: { opacity: 0.6 },
  shareRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm },
  groupName: { fontFamily: fonts.bodyBold, fontSize: type.body, color: colors.ink900 },
  linkRow: { minHeight: 44, justifyContent: "center" },
  link: { fontFamily: fonts.bodyBold, fontSize: type.small, color: colors.green700, textAlign: "center" },
  foot: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink500, textAlign: "center" },
});
