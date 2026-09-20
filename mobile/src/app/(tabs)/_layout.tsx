import { Pressable } from "react-native";
import { Tabs, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors, fonts, spacing } from "@/lib/theme";
import { useUnreadCount } from "@/lib/unread";

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
export default function TabsLayout() {
  const unread = useUnreadCount();

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
