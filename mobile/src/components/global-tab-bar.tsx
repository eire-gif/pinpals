import { useEffect, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAgeAccess } from "@/lib/age";
import { useTabBadges } from "@/lib/tab-badges";
import { colors, fonts } from "@/lib/theme";

/**
 * The app's six tabs under every screen, not just the tabs themselves
 * (Oct 2026: "add the Home and other 5 buttons to every page except the
 * marketplace").
 *
 * A screen pushed over the tab group (Members, My connections, a group, a
 * course…) used to cover the tab bar, so the only way home was Back, Back,
 * Back. This bar is drawn by the root layout beneath the stack, so it
 * appears under every such screen without each one having to ask for it.
 * Pressing a tab closes everything stacked on top and opens that tab —
 * what a tab bar does everywhere else.
 *
 * Same tabs, icons, order and badges as app/(tabs)/_layout.tsx. Nothing is
 * highlighted: these screens belong to no single tab.
 */

type Tab = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: "/" | "/tee-times" | "/marketplace" | "/feed" | "/inbox" | "/profile";
};

const TABS: Tab[] = [
  { key: "home", label: "Home", icon: "home-outline", href: "/" },
  { key: "teeTimes", label: "Tee Times", icon: "golf-outline", href: "/tee-times" },
  { key: "marketplace", label: "Marketplace", icon: "pricetags-outline", href: "/marketplace" },
  { key: "social", label: "Social", icon: "images-outline", href: "/feed" },
  { key: "inbox", label: "Chats", icon: "chatbubbles-outline", href: "/inbox" },
  { key: "profile", label: "Profile", icon: "person-outline", href: "/profile" },
];

/**
 * Screens that keep the whole screen to themselves. Matched against the
 * route's path, by prefix ("listing" covers "listing/[id]").
 *
 * - signing in and the age stops: there is nowhere to go yet;
 * - the marketplace's own screens: the marketplace has its own bottom menu,
 *   and its listings, offers and checkout belong to that section;
 * - sheets (comments, share, reactions, review): they slide up over a
 *   screen that already has the bar;
 * - writing a message or a post: the keyboard is the bottom of the screen.
 */
const FULL_SCREEN = [
  "login",
  "signup",
  "auth-confirm",
  "onboarding",
  "age",
  "join",
  "join-group",
  "card-link",
  "tee-link",
  "+native-intent",
  // Social's full-screen live view (claude/social-live.md)
  "social-live",
  // PinPals Wrapped: full-screen story cards (claude/wrapped.md)
  "wrapped",
  // Marketplace
  "listing",
  "listing-offers",
  "new-listing",
  "marketplace-search",
  "mark-sold",
  "seller",
  "store",
  "my-listings",
  "selling",
  "buying",
  "checkout",
  "order",
  "payouts",
  // Sheets
  "comments",
  "share",
  "reactions",
  "share-to-feed",
  "course/review",
  // Hole maps: the satellite view runs edge to edge, yardage panel at the foot
  "hole-map",
  // Writing
  "conversation",
  "new-chat",
  "compose",
  "new-post",
];

/** Whether the bar belongs under the screen at this route. */
export function wantsGlobalTabBar(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  // The tab group draws its own bar (and hides it in the marketplace).
  if (segments[0] === "(tabs)") return false;
  const path = segments.join("/");
  return !FULL_SCREEN.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Height of the bar above the home indicator, as the tab group's. */
export const GLOBAL_TAB_BAR_HEIGHT = 50;

function openTab(href: Tab["href"]) {
  // Close every screen stacked over the tabs first, so Back from the tab
  // doesn't land on the screen you just left from.
  if (router.canDismiss()) router.dismissAll();
  router.navigate(href);
}

export function GlobalTabBar() {
  const insets = useSafeAreaInsets();
  const badges = useTabBadges();
  // Junior members (0159): the same tabs hidden as on the tab group.
  const { allows } = useAgeAccess();
  const hidden = new Set<string>();
  if (!allows("teeTimes")) hidden.add("teeTimes");
  if (!allows("social")) hidden.add("social");

  // Android lifts the whole window over the keyboard, bar and all; iOS
  // draws the keyboard over it. Step aside on Android, as the tab group does.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboard) return null;

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: GLOBAL_TAB_BAR_HEIGHT + insets.bottom }]} accessibilityRole="tablist">
      {TABS.filter((t) => !hidden.has(t.key)).map((t) => {
        const badge =
          t.key === "inbox" && badges.inbox > 0
            ? { text: badges.inbox > 99 ? "99+" : String(badges.inbox), style: styles.badgeRed, textStyle: styles.badgeTextLight }
            : t.key === "teeTimes" && badges.teeTimes > 0
              ? { text: String(badges.teeTimes), style: styles.badgeGold, textStyle: styles.badgeTextDark }
              : null;
        return (
          <Pressable
            key={t.key}
            onPress={() => openTab(t.href)}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            accessibilityRole="tab"
            accessibilityLabel={badge ? `${t.label}, ${badge.text}` : t.label}
          >
            <View>
              <Ionicons name={t.icon} size={24} color={colors.ink500} />
              {badge ? (
                <View style={[styles.badge, badge.style]}>
                  <Text style={[styles.badgeText, badge.textStyle]}>{badge.text}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.cream50,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, paddingTop: 4 },
  pressed: { opacity: 0.6 },
  label: { fontFamily: fonts.bodySemi, fontSize: 11, color: colors.ink500 },
  badge: {
    position: "absolute",
    top: -4,
    left: 15,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 8.5,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRed: { backgroundColor: colors.red600 },
  badgeGold: { backgroundColor: colors.gold400 },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 10, lineHeight: 13 },
  badgeTextLight: { color: colors.cream50 },
  badgeTextDark: { color: colors.ink900 },
});
