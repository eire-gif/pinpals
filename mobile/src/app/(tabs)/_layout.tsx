import { Pressable, View } from "react-native";
import { Tabs, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { useAuth } from "@/lib/auth";
import { colors, fonts, spacing } from "@/lib/theme";
import { useUnreadCount, useUnreadMessages } from "@/lib/unread";

/**
 * Five tabs. Home is the landing screen and carries the website's hero, so
 * the app and the site read as one product — but where that page pitches
 * signing up, this one answers "what have I got on, and who is waiting on
 * me", which is the only question a signed-in member opens an app to ask.
 *
 * Tee Times, Notifications and Profile are native screens reading Supabase
 * directly. Marketplace is a web view (see §4 of the build spec): it is the
 * largest surface, it changes most often, and keeping it as web means shipping
 * changes to it through Vercel without an App Store review.
 */
/** A dot, not a number. The count is on the screen the envelope opens; out
 *  here the only question is "is anyone waiting", and a 2 is no more useful
 *  than a dot at 24pt. */
const dot = {
  position: "absolute" as const,
  top: -1,
  right: spacing.md - 3,
  width: 10,
  height: 10,
  borderRadius: 5,
  backgroundColor: colors.red600,
  borderWidth: 1.5,
  borderColor: colors.cream50,
};

export default function TabsLayout() {
  const unread = useUnreadCount();
  const { session } = useAuth();
  const unreadMessages = useUnreadMessages(session?.user?.id ?? null);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.cream50 },
        headerTintColor: colors.ink900,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 19 },
        tabBarActiveTintColor: colors.green700,
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11 },
        tabBarInactiveTintColor: colors.ink500,
        tabBarStyle: {
          backgroundColor: colors.cream50,
          borderTopColor: colors.line,
        },
        sceneStyle: { backgroundColor: colors.cream50 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
          // The tab bar is full at five, and messages are not a sixth
          // destination anyone would go hunting for — they are something you
          // notice. An envelope that only wears a dot when someone is
          // actually waiting says that better than a tab would.
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/messages")}
              hitSlop={12}
              style={{ paddingHorizontal: spacing.md }}
              accessibilityLabel={
                unreadMessages > 0
                  ? `Messages, ${unreadMessages} unread`
                  : "Messages"
              }
            >
              <Ionicons
                name={unreadMessages > 0 ? "mail" : "mail-outline"}
                size={24}
                color={colors.green700}
              />
              {unreadMessages > 0 ? <View style={dot} /> : null}
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="tee-times"
        options={{
          title: "Tee Times",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="golf-outline" size={size} color={color} />
          ),
          // Offering a round is the thing the app most wants members to do,
          // and burying it two taps down in the Profile tab would say the
          // opposite. In the header it is visible from launch.
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/post-tee-time")}
              hitSlop={12}
              style={{ paddingHorizontal: spacing.md }}
              accessibilityLabel="Post a tee time"
            >
              <Ionicons name="add-circle" size={27} color={colors.green700} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{
          title: "Marketplace",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pricetags-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alerts",
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.red600 },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
