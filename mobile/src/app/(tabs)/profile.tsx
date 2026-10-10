import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";

import { Avatar } from "@/components/avatar";
import { PhotoHero } from "@/components/photo-hero";
import { PHOTO_PICKER_OPTIONS, preparePhotoForUpload } from "@/lib/photo-picking";
import { removeCover, uploadCover } from "@/lib/profile";

import { useAuth } from "@/lib/auth";
import { inviteFriends } from "@/lib/invite-friends";
import { isSuperAdmin } from "@/lib/admin";
import { supabase } from "@/lib/supabase";
import {
  deletionDateLabel,
  getDeletionState,
  requestDeletion,
  type DeletionState,
} from "@/lib/account";
import { colors, creamAlpha, fonts, radii, spacing, type } from "@/lib/theme";

type Profile = {
  first_name: string | null;
  last_name: string | null;
  home_club: string | null;
  county: string | null;
  handicap: number | null;
  avatar_url: string | null;
  avatar_color: string | null;
  cover_url?: string | null;
};

/** The cover when a member hasn't chosen their own. */
const DEFAULT_COVER = require("../../../assets/images/scenes/links-sunset.jpg");

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [deletion, setDeletion] = useState<DeletionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [superAdmin, setSuperAdmin] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    // cover_url is 0112; a database without it still loads the rest.
    const base = "first_name, last_name, home_club, county, handicap, avatar_url, avatar_color";
    let { data, error } = await supabase.from("profiles").select(`${base}, cover_url`).eq("id", session.user.id).maybeSingle().overrideTypes<Profile>();
    if (error) ({ data } = await supabase.from("profiles").select(base).eq("id", session.user.id).maybeSingle().overrideTypes<Profile>());
    setProfile(data);

    // Failure here must not stop the profile rendering: the deletion row is
    // the least important thing on this screen right up until it is the only
    // thing that matters.
    try {
      setDeletion(await getDeletionState());
    } catch {
      setDeletion(null);
    }

    // Shows or hides the Admin row only. Not a security check: every admin
    // page is guarded on the server — see mobile/src/lib/admin.ts.
    setSuperAdmin(await isSuperAdmin());

    setLoading(false);
  }, [session?.user.id]);

  const confirmDelete = useCallback(() => {
    if (deletion?.blockedReason) {
      Alert.alert("You can't delete your account yet", deletion.blockedReason);
      return;
    }

    const days = deletion?.graceDays ?? 30;

    Alert.alert(
      "Delete your account?",
      `You'll be signed out straight away and won't be able to sign back in. ` +
        `Any tee times you're hosting are cancelled and anything you have for ` +
        `sale is taken down.\n\n` +
        `After ${days} days your profile, messages, connections and settings ` +
        `are deleted. If you've bought or sold, Irish tax law means we have to ` +
        `keep those transaction records for six years, with your name removed.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete account",
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            void requestDeletion()
              .then((scheduledFor) => {
                Alert.alert(
                  "Your account is being deleted",
                  `Everything we don't have to keep will be removed on ${deletionDateLabel(
                    scheduledFor
                  )}. Contact us before then if you change your mind.`,
                  // Signed out on dismissal rather than immediately, so the
                  // member actually reads the date before the app returns to
                  // the login screen. The session is already dead server-side.
                  [{ text: "OK", onPress: () => void signOut() }]
                );
              })
              .catch((error: unknown) => {
                Alert.alert(
                  "Couldn't delete your account",
                  error instanceof Error
                    ? error.message
                    : "Something went wrong. Please try again."
                );
              })
              .finally(() => setDeleting(false));
          },
        },
      ]
    );
  }, [deletion, signOut]);

  useEffect(() => {
    void load();
  }, [load]);
  // Back from Edit profile with a new photo or club: show it.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // ---- The cover photograph (0112) ----
  const pickCover = useCallback(async (source: "camera" | "library") => {
    const permission =
      source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(source === "camera" ? "Camera is off" : "Photos are off", "PinPals needs this to set your cover photo. You can turn it on in Settings.", [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync(PHOTO_PICKER_OPTIONS) : await ImagePicker.launchImageLibraryAsync(PHOTO_PICKER_OPTIONS);
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setCoverBusy(true);
    try {
      const file = await preparePhotoForUpload({
        uri: asset.uri,
        name: asset.fileName ?? "cover.jpg",
        type: asset.mimeType ?? "image/jpeg",
        width: asset.width,
        height: asset.height,
      });
      const url = await uploadCover(file);
      setProfile((p) => (p ? { ...p, cover_url: url } : p));
    } catch (err) {
      Alert.alert("Couldn't set that cover", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setCoverBusy(false);
    }
  }, []);

  const coverMenu = () =>
    Alert.alert("Cover photo", "The picture across the top of your profile — your home course, a favourite hole.", [
      { text: "Take a photo", onPress: () => void pickCover("camera") },
      { text: "Choose from library", onPress: () => void pickCover("library") },
      ...(profile?.cover_url
        ? [
            {
              text: "Use the PinPals photo",
              style: "destructive" as const,
              onPress: () => {
                setCoverBusy(true);
                void removeCover()
                  .then(() => setProfile((p) => (p ? { ...p, cover_url: null } : p)))
                  .catch(() => Alert.alert("Couldn't change that", "Please try again."))
                  .finally(() => setCoverBusy(false));
              },
            },
          ]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ]);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" color={colors.green700} />
      </View>
    );
  }

  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    "Your profile";

  const handicap = profile?.handicap !== null && profile?.handicap !== undefined ? String(profile.handicap) : null;
  const where = [profile?.home_club, profile?.county].filter(Boolean).join(" · ");

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.scroll}>
      <StatusBar style="light" />
      <PhotoHero
        source={profile?.cover_url ? { uri: profile.cover_url } : DEFAULT_COVER}
        title={name}
        subtitle={where || undefined}
        extra={36}
        overlap={44}
        topRight={
          <Pressable
            onPress={coverMenu}
            disabled={coverBusy}
            style={({ pressed }) => [styles.coverButton, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Change cover photo"
          >
            {coverBusy ? <ActivityIndicator size="small" color={colors.cream50} /> : <Ionicons name="camera" size={16} color={colors.cream50} />}
            <Text style={styles.coverLabel}>{coverBusy ? "Saving" : "Cover"}</Text>
          </Pressable>
        }
      >
        {/* The member, overlapping the photograph: face, handicap, the two
            things you do with your own profile. */}
        <View style={styles.card}>
          <Pressable
            onPress={() => router.push("/edit-profile")}
            style={styles.avatarRing}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            <Avatar url={profile?.avatar_url ?? null} color={profile?.avatar_color ?? null} name={name} size={64} />
          </Pressable>
          <View style={styles.hcpBlock}>
            <Text style={styles.hcpValue}>{handicap ?? "—"}</Text>
            <Text style={styles.hcpLabel}>HANDICAP</Text>
          </View>
          <View style={styles.cardButtons}>
            {session?.user.id ? (
              <Pressable
                onPress={() => router.push({ pathname: "/member/[id]", params: { id: session.user.id } })}
                style={({ pressed }) => [styles.cardButton, styles.cardButtonPrimary, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Text style={[styles.cardButtonText, styles.cardButtonTextPrimary]}>My profile</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => router.push("/edit-profile")} style={({ pressed }) => [styles.cardButton, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <Text style={styles.cardButtonText}>Edit</Text>
            </Pressable>
          </View>
        </View>
      </PhotoHero>

      <View style={styles.content}>
        <GroupTitle text="Golf" />
        <View style={styles.group}>
          <NativeLink icon="add-circle-outline" label="Post a tee time" to="/post-tee-time" />
          <NativeLink icon="golf-outline" label="My tee times" to="/my-rounds" />
          <NativeLink icon="people-outline" label="Requests to join" to="/tee-time-requests" />
          <NativeLink icon="document-text-outline" label="My scorecards" to="/scorecards" />
          <NativeLink icon="flag-outline" label="Courses & favourites" to="/courses" last />
        </View>

        <GroupTitle text="People" />
        <View style={styles.group}>
          <NativeLink icon="people-circle-outline" label="My connections" to="/connections" />
          <NativeLink icon="chatbubbles-outline" label="Messages" to="/inbox" />
          <Pressable style={[styles.link, styles.linkLast]} onPress={inviteFriends} accessibilityRole="button">
            <View style={styles.linkIcon}>
              <Ionicons name="person-add-outline" size={18} color={colors.green700} />
            </View>
            <Text style={styles.linkLabel}>Invite friends to PinPals</Text>
            <Ionicons name="share-outline" size={18} color={colors.ink500} />
          </Pressable>
        </View>

        <GroupTitle text="Marketplace" />
        <View style={styles.group}>
          <NativeLink icon="cart-outline" label="Buying" to="/buying" />
          <NativeLink icon="pricetags-outline" label="Selling" to="/selling" last />
        </View>

        <GroupTitle text="Account" />
        <View style={styles.group}>
          <NativeLink icon="person-circle-outline" label="Edit profile" to="/edit-profile" />
          <NativeLink icon="options-outline" label="Notification settings" to="/notification-settings" last />
        </View>

      {superAdmin ? (
        <View style={styles.group}>
          <NativeLink icon="shield-half-outline" label="Admin" to="/admin" last />
        </View>
      ) : null}

      <Pressable
        style={styles.signOut}
        onPress={() => {
          Alert.alert("Log out of PinPals?", undefined, [
            { text: "Cancel", style: "cancel" },
            {
              text: "Log out",
              style: "destructive",
              onPress: () => void signOut(),
            },
          ]);
        }}
      >
        <Text style={styles.signOutLabel}>Log out</Text>
      </Pressable>

      {/* App Store Guideline 5.1.1(v): deletion happens here, in the app, not
          behind a link to the website — Guideline 4 rules that out. It posts
          to /api/app/account/delete, which runs the same operation the site's
          own settings page runs. */}
      {deletion?.scheduledFor ? (
        <View style={styles.pending}>
          <Text style={styles.pendingTitle}>
            Your account is being deleted
          </Text>
          <Text style={styles.pendingBody}>
            Everything we don&apos;t have to keep will be removed on{" "}
            {deletionDateLabel(deletion.scheduledFor)}.
          </Text>
        </View>
      ) : (
        <Pressable
          style={[styles.delete, deleting && styles.deleting]}
          disabled={deleting}
          onPress={confirmDelete}
        >
          {deleting ? (
            <ActivityIndicator color={colors.red600} />
          ) : (
            <Text style={styles.deleteLabel}>Delete account</Text>
          )}
        </Pressable>
      )}

      <Text style={styles.version}>
        PinPals {Constants.expoConfig?.version ?? "0.1.0"}
      </Text>
      </View>
    </ScrollView>
  );
}

/** A row that opens a screen in the app rather than a page on the site. */
function GroupTitle({ text }: { text: string }) {
  return <Text style={styles.groupTitle}>{text.toUpperCase()}</Text>;
}

function NativeLink({
  icon,
  label,
  to,
  last = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  to: Href;
  last?: boolean;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.link, last && styles.linkLast, pressed && { backgroundColor: colors.surfaceTint }]} onPress={() => router.push(to)} accessibilityRole="button">
      <View style={styles.linkIcon}>
        <Ionicons name={icon} size={18} color={colors.green700} />
      </View>
      <Text style={styles.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  scroll: { paddingBottom: spacing.xl },
  content: { padding: spacing.md, gap: spacing.sm + 2 },
  coverButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 34, borderRadius: radii.pill, backgroundColor: "rgba(12,32,56,0.6)", borderWidth: 1, borderColor: creamAlpha(0.35) },
  coverLabel: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.cream50 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 12,
    padding: 12,
    borderRadius: 26,
    backgroundColor: colors.surface,
    shadowColor: "#0c2038",
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  avatarRing: { padding: 3, borderRadius: 40, backgroundColor: colors.gold400 },
  hcpBlock: { alignItems: "flex-start" },
  hcpValue: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, color: colors.navy900 },
  hcpLabel: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.2, color: colors.ink500 },
  cardButtons: { flex: 1, flexDirection: "row", justifyContent: "flex-end", gap: 6 },
  cardButton: { paddingHorizontal: 12, height: 36, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  cardButtonPrimary: { backgroundColor: colors.green700, borderColor: colors.green700 },
  cardButtonText: { fontFamily: fonts.bodyBold, fontSize: 13.5, color: colors.ink900 },
  cardButtonTextPrimary: { color: colors.cream50 },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: 11.5, letterSpacing: 1.6, color: colors.ink500, marginTop: spacing.sm, marginLeft: 4 },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream50,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
    shadowColor: colors.navy900,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  linkLast: { borderBottomWidth: 0 },
  linkIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.green100, alignItems: "center", justifyContent: "center" },
  linkLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: type.body, color: colors.ink900 },
  signOut: {
    marginTop: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radii.pill,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutLabel: { fontSize: type.body, fontWeight: "700", color: colors.red600 },
  delete: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: -spacing.sm,
  },
  deleting: { opacity: 0.6 },
  deleteLabel: {
    fontSize: type.small,
    fontWeight: "600",
    color: colors.ink500,
    textDecorationLine: "underline",
  },
  pending: {
    backgroundColor: colors.red100,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 4,
    marginTop: -spacing.sm,
  },
  pendingTitle: {
    fontSize: type.body,
    fontWeight: "700",
    color: colors.red600,
  },
  pendingBody: { fontSize: type.small, color: colors.red600, lineHeight: 20 },
  version: {
    textAlign: "center",
    fontSize: 12.5,
    color: colors.ink500,
  },
});
