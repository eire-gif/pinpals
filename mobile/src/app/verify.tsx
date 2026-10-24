import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PHOTO_PICKER_OPTIONS, preparePhotoForUpload, type UploadablePhoto } from "@/lib/photo-picking";
import { myVerification, submitVerification, type Verification } from "@/lib/trust";
import { VERIFIED_LABEL } from "@/lib/reliability";
import { colors, fonts, radii, spacing, type } from "@/lib/theme";

/**
 * Get verified (Oct 2026, 0188, claude/trust-and-safety.md).
 *
 * The member snaps their Golf Ireland card (or the card screen in the Golf
 * Ireland app), with their number and club. The website has Claude read the
 * card and compares it with their profile; a clear match is verified in
 * seconds. Anything unclear goes to a person, and the photo is deleted once
 * they've looked. Opened from Profile and from a member's own page.
 */
export default function VerifyScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [state, setState] = useState<Verification | null>(null);
  const [number, setNumber] = useState("");
  const [club, setClub] = useState("");
  const [clubId, setClubId] = useState<number | null>(null);
  const [photo, setPhoto] = useState<UploadablePhoto | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const [v, profile, priv] = await Promise.all([
      myVerification(userId).catch(() => null),
      supabase.from("profiles").select("home_club, home_club_id").eq("id", userId).maybeSingle<{ home_club: string | null; home_club_id: number | null }>(),
      supabase.from("member_private").select("gui_membership_number").eq("member_id", userId).maybeSingle<{ gui_membership_number: string | null }>(),
    ]);
    setState(v ?? { status: "none", clubName: null, number: null, reason: null });
    setNumber((n) => n || v?.number || priv.data?.gui_membership_number || "");
    setClub((c) => c || v?.clubName || profile.data?.home_club || "");
    setClubId((id) => id ?? profile.data?.home_club_id ?? null);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function pick(source: "camera" | "library") {
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(source === "camera" ? "Camera is off" : "Photos are off", "PinPals needs this to see your card. You can turn it on in Settings.", [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync(PHOTO_PICKER_OPTIONS) : await ImagePicker.launchImageLibraryAsync(PHOTO_PICKER_OPTIONS);
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setPhoto(
      await preparePhotoForUpload({
        uri: asset.uri,
        name: asset.fileName ?? "card.jpg",
        type: asset.mimeType ?? "image/jpeg",
        width: asset.width,
        height: asset.height,
      })
    );
    setError(null);
  }

  async function send() {
    if (!photo) {
      setError("Add a photo of your card first.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const result = await submitVerification({ photo, number: number.trim(), clubName: club.trim(), clubId });
      setState(result);
      if (result.status === "rejected") setPhoto(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const header = <Stack.Screen options={{ title: "Get verified", headerBackTitle: "Back" }} />;

  if (!state) {
    return (
      <View style={[styles.fill, styles.centre]}>
        {header}
        <ActivityIndicator size="large" color={colors.green700} />
      </View>
    );
  }

  if (state.status === "verified") {
    return (
      <View style={styles.fill}>
        {header}
        <View style={styles.done}>
          <View style={styles.doneIcon}>
            <Ionicons name="shield-checkmark" size={40} color={colors.gold400} />
          </View>
          <Text style={styles.doneKicker}>{VERIFIED_LABEL.toUpperCase()}</Text>
          <Text style={styles.doneTitle}>You're verified{state.clubName ? ` · ${state.clubName}` : ""}</Text>
          <Text style={styles.doneBody}>The badge is on your profile, your tee-time requests and your adverts.</Text>
          <Pressable style={styles.doneButton} onPress={() => (router.canGoBack() ? router.back() : router.replace("/profile"))} accessibilityRole="button">
            <Text style={styles.doneButtonLabel}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.status === "needs_review") {
    return (
      <View style={styles.fill}>
        {header}
        <View style={[styles.done, styles.waitWrap]}>
          <View style={[styles.doneIcon, styles.waitIcon]}>
            <Ionicons name="hourglass-outline" size={36} color={colors.navy900} />
          </View>
          <Text style={[styles.doneTitle, styles.waitTitle]}>Nearly there</Text>
          <Text style={[styles.doneBody, styles.waitBody]}>{state.reason ?? "A person will check your card shortly."}</Text>
          <Text style={[styles.doneBody, styles.waitBody]}>You'll get an alert when it's done. Your photo is deleted once it's been checked.</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {header}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Ionicons name="shield-checkmark" size={28} color={colors.gold400} />
          <Text style={styles.heroTitle}>Show you're a real club golfer</Text>
          <Text style={styles.heroBody}>
            Hosts and sellers trust a Verified golfer more. It takes a photo of your card and a few seconds.
          </Text>
        </View>

        {state.status === "rejected" && state.reason ? (
          <View style={styles.notice}>
            <Ionicons name="alert-circle" size={18} color={colors.red600} />
            <Text style={styles.noticeText}>{state.reason}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Golf Ireland membership number</Text>
        <TextInput
          value={number}
          onChangeText={setNumber}
          placeholder="e.g. 12345678"
          placeholderTextColor={colors.ink500}
          keyboardType="number-pad"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Golf Ireland membership number"
        />

        <Text style={styles.label}>Your club</Text>
        <TextInput
          value={club}
          onChangeText={(t) => {
            setClub(t);
            setClubId(null);
          }}
          placeholder="e.g. Portmarnock Golf Club"
          placeholderTextColor={colors.ink500}
          style={styles.input}
          accessibilityLabel="Your club"
        />

        <Text style={styles.label}>Photo of your card</Text>
        <Text style={styles.hint}>Your Golf Ireland card, or the card screen in the Golf Ireland app. Flat, in good light, the whole card in view.</Text>
        {photo ? (
          <View style={styles.preview}>
            <Image source={{ uri: photo.uri }} style={styles.previewImage} resizeMode="contain" accessibilityLabel="Your card" />
            <Pressable onPress={() => setPhoto(null)} style={styles.retake} accessibilityRole="button">
              <Text style={styles.retakeLabel}>Retake</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.pickRow}>
            <Pressable style={styles.pick} onPress={() => void pick("camera")} accessibilityRole="button">
              <Ionicons name="camera" size={22} color={colors.green700} />
              <Text style={styles.pickLabel}>Take a photo</Text>
            </Pressable>
            <Pressable style={styles.pick} onPress={() => void pick("library")} accessibilityRole="button">
              <Ionicons name="images" size={22} color={colors.green700} />
              <Text style={styles.pickLabel}>Choose a photo</Text>
            </Pressable>
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.send, (sending || !photo) && styles.sendDim]}
          onPress={() => void send()}
          disabled={sending}
          accessibilityRole="button"
        >
          {sending ? <ActivityIndicator color={colors.cream50} /> : <Text style={styles.sendLabel}>Check my card</Text>}
        </Pressable>
        {sending ? <Text style={styles.hintCentre}>Checking your card — this takes a few seconds.</Text> : null}

        <Text style={styles.privacy}>
          Your photo is read automatically to confirm your name, club and number match your profile, then deleted. If it can't be
          confirmed automatically, a PinPals team member looks at it first and deletes it once they have. Other members only see the
          badge and your club.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  centre: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2, width: "100%", maxWidth: 680, alignSelf: "center" },
  hero: { backgroundColor: colors.navy900, borderRadius: radii.lg, padding: spacing.md, gap: 6, marginBottom: spacing.md },
  heroTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.cream50 },
  heroBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.cream100 },
  notice: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.red100,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600 },
  label: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink900, marginTop: spacing.md, marginBottom: 6 },
  hint: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, marginBottom: 8 },
  hintCentre: { fontFamily: fonts.body, fontSize: type.small, color: colors.ink500, textAlign: "center", marginTop: 8 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    minHeight: 50,
    fontFamily: fonts.body,
    fontSize: type.body,
    color: colors.ink900,
  },
  pickRow: { flexDirection: "row", gap: 10 },
  pick: {
    flex: 1,
    minHeight: 92,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.green700,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  pickLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },
  preview: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, padding: 8 },
  previewImage: { width: "100%", height: 200, borderRadius: radii.md },
  retake: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 16 },
  retakeLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.green700 },
  error: { fontFamily: fonts.bodySemi, fontSize: type.small, color: colors.red600, marginTop: spacing.md },
  send: {
    marginTop: spacing.lg,
    minHeight: 54,
    borderRadius: radii.pill,
    backgroundColor: colors.navy900,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDim: { opacity: 0.6 },
  sendLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.cream50 },
  privacy: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink500, marginTop: spacing.lg, lineHeight: 18 },
  done: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: 10, backgroundColor: colors.navy900 },
  doneIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.navy800, alignItems: "center", justifyContent: "center" },
  doneKicker: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.5, color: colors.gold400, marginTop: 6 },
  doneTitle: { fontFamily: fonts.display, fontSize: 26, color: colors.cream50, textAlign: "center" },
  doneBody: { fontFamily: fonts.body, fontSize: type.body, color: colors.cream100, textAlign: "center", maxWidth: 420 },
  doneButton: { marginTop: spacing.md, minHeight: 50, paddingHorizontal: 40, borderRadius: radii.pill, backgroundColor: colors.gold400, justifyContent: "center" },
  doneButtonLabel: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.navy900 },
  waitWrap: { backgroundColor: colors.cream50 },
  waitIcon: { backgroundColor: colors.cream100 },
  waitTitle: { color: colors.ink900 },
  waitBody: { color: colors.ink500 },
});
