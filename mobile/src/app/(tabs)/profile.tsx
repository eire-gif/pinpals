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
import * as Linking from "expo-linking";
import Constants from "expo-constants";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { SITE_URL } from "@/lib/config";
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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    const { data } = await supabase
      .from("profiles")
      .select("first_name, last_name, home_club, county, handicap")
      .eq("id", session.user.id)
      .maybeSingle()
      .overrideTypes<Profile>();
    setProfile(data);
    setLoading(false);
  }, [session?.user.id]);

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
          icon="chatbubbles-outline"
          label="Messages"
          href="/conversations"
        />
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

      {/* TODO — App Store Guideline 5.1.1(v): an app with accounts must offer
          account deletion from inside the app. The website has no deletion flow
          at all today, so this cannot just be linked; it has to be built first,
          on the site, where it can reconcile with orders, payments and Stripe
          Connect. Submission is blocked on it. */}

      <Text style={styles.version}>
        PinPals {Constants.expoConfig?.version ?? "0.1.0"}
      </Text>
    </ScrollView>
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
      onPress={() => void Linking.openURL(`${SITE_URL}${href}`)}
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
  version: {
    textAlign: "center",
    fontSize: 12.5,
    color: colors.ink500,
  },
});
