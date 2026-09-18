import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { colors } from "@/lib/theme";
import { useUnreadCount } from "@/lib/unread";

/**
 * Four tabs, chosen so the two things a member actually opens the app for —
 * "who can I play with" and "what's for sale" — are one tap from launch.
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
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: colors.green700,
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
          title: "Tee Times",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="golf-outline" size={size} color={color} />
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
