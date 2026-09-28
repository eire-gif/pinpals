import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppMenu, MenuButton } from "@/components/app-menu";
import { useAuth } from "@/lib/auth";
import { colors, fonts, spacing } from "@/lib/theme";
import { useInboxUnread } from "@/lib/unread";

/**
 * Five tabs. Home is the landing screen and carries the website's hero, so
 * the app and the site read as one product — but where that page pitches
 * signing up, this one answers "what have I got on, and who is waiting on
 * me", which is the only question a signed-in member opens an app to ask.
 *
 * Every tab is native now. Marketplace was the last web view: browsing and
 * the listing page are native, and buying, offers and bids open the site
 * inside the app because Stripe Checkout needs a real browser and the offer
 * and auction state machines have no business being implemented twice.
 */
/** A number, not a dot.
 *
 *  It was a dot because nothing in the app could say what the total was:
 *  messages were counted one way and alerts another, and neither knew about
 *  the other. inbox_unread_counts() (0083) answers that in one call, and
 *  "how many" is the question people actually ask of an envelope. */
const badge = {
  position: "absolute" as const,
  top: -4,
  right: spacing.md - 9,
  minWidth: 17,
  height: 17,
  paddingHorizontal: 4,
  borderRadius: 8.5,
  backgroundColor: colors.red600,
  borderWidth: 1.5,
  borderColor: colors.cream50,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

const badgeLabel = {
  fontFamily: fonts.bodyBold,
  fontSize: 10,
  lineHeight: 13,
  color: colors.cream50,
};

export default function TabsLayout() {
  const { session } = useAuth();
  const unread = useInboxUnread(session?.user?.id ?? null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
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
        // On every tab, not just Home. A menu that is only on one screen is
        // a menu people have to navigate to in order to navigate, which is
        // the problem it exists to solve.
        headerLeft: () => <MenuButton onPress={() => setMenuOpen(true)} />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
          // The envelope on Home and the Inbox tab are the same destination
          // reached two ways, and they now carry the same number. Someone
          // who opens the app to "has anything happened" gets the answer on
          // the first screen, without learning where the tab is.
          headerRight: () => (
            <Pressable
              onPress={() => router.push("/inbox")}
              hitSlop={12}
              style={{ paddingHorizontal: spacing.md }}
              accessibilityLabel={
                unread.total > 0
                  ? `Messages and alerts, ${unread.total} unread`
                  : "Messages and alerts"
              }
            >
              <Ionicons
                name={unread.total > 0 ? "mail" : "mail-outline"}
                size={24}
                color={colors.green700}
              />
              {unread.total > 0 ? (
                <View style={badge}>
                  <Text style={badgeLabel}>
                    {unread.total > 99 ? "99+" : unread.total}
                  </Text>
                </View>
              ) : null}
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
          // Native since the marketplace stopped being a web view. The
          // header carries the menu button; browsing, filtering and the
          // listing page are all native, and only the money actions open the
          // site.
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="pricetags-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarBadge:
            unread.total > 0 ? (unread.total > 99 ? "99+" : unread.total) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.red600 },
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="mail-outline" size={size} color={color} />
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

    <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
