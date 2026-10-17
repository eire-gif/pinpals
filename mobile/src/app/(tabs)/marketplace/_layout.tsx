import { useState } from "react";
import { Text, View } from "react-native";
import { Tabs, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppMenu, MenuButton } from "@/components/app-menu";
import { useAgeAccess } from "@/lib/age";
import { useAuth } from "@/lib/auth";
import { colors, contentColumn, fonts, headerTitleStyle } from "@/lib/theme";
import { useMarketplaceUnread } from "@/lib/marketplace-chats";

/**
 * The marketplace has its own bottom menu (Oct 2026, approved mock-up 8),
 * the way Adverts and DoneDeal do: Home · Browse · Sell · Chats · My ads.
 *
 * The app's main tab bar is hidden while you're in here (the parent's
 * Marketplace tab sets `tabBarStyle: none`), and Home — first, where people
 * look for a way out — goes back to it. Sell is the raised button in the
 * middle and opens the sell screen over everything; neither is a screen of
 * its own, so both stop the tab change and navigate instead.
 */
/**
 * Open on Browse. Without this the navigator opens on its first screen —
 * Home, which only redirects back to the app's Home — so every way in
 * (the Home screen's Marketplace card, the main tab, a link) bounced
 * straight back out.
 */
export const unstable_settings = { initialRouteName: "index" };

export default function MarketplaceLayout() {
  const { session } = useAuth();
  const unread = useMarketplaceUnread(session?.user?.id ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Junior members (0159): browse only — no selling, no chats.
  const { allows } = useAgeAccess();
  const sell = allows("sell");
  const chat = allows("chat");

  return (
    <>
      <Tabs
        initialRouteName="index"
        backBehavior="history"
        screenOptions={{
          headerStyle: { backgroundColor: colors.cream50 },
          headerTintColor: colors.ink900,
          headerTitleStyle,
          headerShadowVisible: false,
          tabBarActiveTintColor: colors.navy900,
          tabBarInactiveTintColor: colors.ink500,
          tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11 },
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 88, paddingTop: 6 },
          sceneStyle: { backgroundColor: colors.cream50, ...contentColumn },
          headerLeft: () => <MenuButton onPress={() => setMenuOpen(true)} />,
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: "Home",
            tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
          }}
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              router.navigate("/");
            },
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: "Browse",
            headerTitle: "",
            tabBarIcon: ({ color, size, focused }) => <Ionicons name={focused ? "search" : "search-outline"} size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="sell"
          options={{
            title: "Sell",
            href: sell ? undefined : null,
            tabBarActiveTintColor: colors.green700,
            tabBarInactiveTintColor: colors.green700,
            tabBarLabelStyle: { fontFamily: fonts.bodyBold, fontSize: 11 },
            tabBarAccessibilityLabel: "Sell an item",
            tabBarIcon: () => (
              <View
                style={{
                  width: 54,
                  height: 54,
                  marginTop: -24,
                  borderRadius: 27,
                  backgroundColor: colors.green700,
                  borderWidth: 4,
                  borderColor: colors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: colors.navy900,
                  shadowOpacity: 0.2,
                  shadowRadius: 6,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 3,
                }}
              >
                <Ionicons name="add" size={28} color={colors.cream50} />
              </View>
            ),
          }}
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              router.push("/new-listing");
            },
          }}
        />
        <Tabs.Screen
          name="chats"
          options={{
            // Oct 2026: marketplace chats live in the main Messages section —
            // this opens it on the Marketplace filter, rather than a second
            // inbox of its own.
            title: "Messages",
            href: chat ? undefined : null,
            tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.red600 },
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={size} color={color} />
            ),
          }}
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              router.navigate({ pathname: "/inbox", params: { filter: "marketplace", at: String(Date.now()) } });
            },
          }}
        />
        <Tabs.Screen
          name="my-ads"
          options={{
            title: "My ads",
            href: sell ? undefined : null,
            headerTitle: () => <Text style={[headerTitleStyle, { color: colors.ink900 }]}>My ads</Text>,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "pricetag" : "pricetag-outline"} size={size} color={color} />
            ),
          }}
        />
      </Tabs>
      <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
