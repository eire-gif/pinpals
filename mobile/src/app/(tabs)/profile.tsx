import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import Constants from "expo-constants";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  deletionDateLabel,
  getDeletionState,
  requestDeletion,
  type DeletionState,
} from "@/lib/account";
import { colors, radii, spacing, type } from "@/lib/theme";

type Profile = {
  first_name: string | null;
  last_name: string | null;
  home_club: string | null;
  county: string | null;
  handicap: number | null;
};

export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [deletion, setDeletion] = useState<DeletionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    const { data } = await supabase
      .from("profiles")
      .select("first_name, last_name, home_club, county, handicap")
      .eq("id", session.user.id)
      .maybeSingle()
      .overrideTypes<Profile>();
    setProfile(data);

    // Failure here must not stop the profile rendering: the deletion row is
    // the least important thing on this screen right up until it is the only
    // thing that matters.
    try {
      setDeletion(await getDeletionState());
    } catch {
      setDeletion(null);
    }

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

  return (
    <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.name}>{name}</Text>
        {profile?.home_club && (
          <Text style={styles.meta}>{profile.home_club}</Text>
        )}
        <Text style={styles.meta}>
          {[
            profile?.county,
            profile?.handicap !== null && profile?.handicap !== undefined
              ? `Handicap ${profile.handicap}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </View>

      <View style={styles.group}>
        {/* Native first. Sending these through a web view for something the
            app can do itself would be slower and would lose the back
            gesture. */}
        <NativeLink
          icon="add-circle-outline"
          label="Post a tee time"
          to="/post-tee-time"
        />
        <NativeLink
          icon="people-outline"
          label="Requests to join"
          to="/tee-time-requests"
        />
        <NativeLink
          icon="chatbubbles-outline"
          label="Messages"
          to="/messages"
        />
        <Link
          icon="person-circle-outline"
          label="Edit profile"
          href="/profile/edit"
        />
        <Link
          icon="golf-outline"
          label="My tee times"
          href="/dashboard/availability"
        />
        <Link icon="cart-outline" label="Buying" href="/dashboard/buying" />
        <Link icon="pricetags-outline" label="Selling" href="/dashboard/selling" />
        <Link
          icon="options-outline"
          label="Notification settings"
          href="/dashboard/notifications"
        />
      </View>

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
    </ScrollView>
  );
}

/** A row that opens a screen in the app rather than a page on the site. */
function NativeLink({
  icon,
  label,
  to,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  to: "/post-tee-time" | "/tee-time-requests" | "/messages";
}) {
  return (
    <Pressable style={styles.link} onPress={() => router.push(to)}>
      <Ionicons name={icon} size={20} color={colors.green700} />
      <Text style={styles.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

function Link({
  icon,
  label,
  href,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  href: string;
}) {
  return (
    <Pressable
      style={styles.link}
      // Pushed as a screen rather than opened in Safari, so the member stays
      // in the app and stays signed in — WebShell hands the session over.
      onPress={() =>
        router.push({ pathname: "/web", params: { path: href, title: label } })
      }
    >
      <Ionicons name={icon} size={20} color={colors.green700} />
      <Text style={styles.linkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.ink500} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream50 },
  content: { padding: spacing.md, gap: spacing.lg },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.cream50,
  },
  header: { gap: 2, paddingVertical: spacing.sm },
  name: { fontSize: 26, fontWeight: "800", color: colors.ink900 },
  meta: { fontSize: type.body, color: colors.ink500 },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 15,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  linkLabel: { flex: 1, fontSize: type.body, color: colors.ink900 },
  signOut: {
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
