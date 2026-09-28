import Ionicons from "@expo/vector-icons/Ionicons";
import type { Href } from "expo-router";

/**
 * Every page in PinPals, written down once.
 *
 * The tab bar holds five things because a tab bar holds five things. Nothing
 * else in the app had a home: confirmed tee times, connections, orders,
 * payouts and the course directory were each reachable only if you happened
 * to know which screen they were buried under, and several were reachable
 * only from the Profile tab, which is not where anyone looks for "browse all
 * members".
 *
 * So this is the map. It is data rather than JSX so there is exactly one
 * place to add a page to, and so the grouping is obvious at a glance instead
 * of buried in markup.
 */

export const CONTACT_EMAIL = "info@pinpals.ie";

export type MenuItem =
  /** A native screen. Faster, keeps the back gesture, and never shows the
   *  site's own chrome. Preferred wherever the app has the screen. */
  | { kind: "native"; label: string; icon: keyof typeof Ionicons.glyphMap; to: Href }
  /** A site page, opened inside the app's web view as the signed-in member —
   *  never handed to Safari, where they would be a stranger again. */
  | { kind: "web"; label: string; icon: keyof typeof Ionicons.glyphMap; path: string; title: string }
  | { kind: "contact"; label: string; icon: keyof typeof Ionicons.glyphMap }
  | { kind: "signout"; label: string; icon: keyof typeof Ionicons.glyphMap };

export type MenuSection = {
  title: string;
  items: MenuItem[];
};

/**
 * Grouped, not nested.
 *
 * Sections with headings rather than tap-to-expand submenus: a drawer is
 * already one tap from wherever you were, and making half these entries two
 * further taps away would undo the point of writing the map down. The
 * headings do the job a submenu would — they tell you which part of the app
 * you are looking at — without hiding anything.
 */
export const MENU: MenuSection[] = [
  {
    title: "Play",
    items: [
      { kind: "native", label: "Post a tee time", icon: "add-circle-outline", to: "/post-tee-time" },
      { kind: "native", label: "Browse tee times", icon: "golf-outline", to: "/tee-times" },
      {
        kind: "web",
        label: "My confirmed tee times",
        icon: "checkmark-circle-outline",
        path: "/tee-times/confirmed",
        title: "Confirmed tee times",
      },
      {
        kind: "native",
        label: "Requests to join mine",
        icon: "people-outline",
        to: "/tee-time-requests",
      },
      {
        kind: "web",
        label: "Rounds I've asked to join",
        icon: "hand-right-outline",
        path: "/tee-times/requests",
        title: "My tee-time requests",
      },
      {
        kind: "web",
        label: "Golfers interested in mine",
        icon: "star-outline",
        path: "/tee-times/interested",
        title: "Interested golfers",
      },
    ],
  },
  {
    title: "Members",
    items: [
      {
        kind: "web",
        label: "Browse all members",
        icon: "search-outline",
        path: "/community",
        title: "Find golfers",
      },
      {
        kind: "web",
        label: "My connections",
        icon: "person-add-outline",
        path: "/dashboard/connections",
        title: "My connections",
      },
    ],
  },
  {
    title: "Marketplace",
    items: [
      { kind: "native", label: "Browse the marketplace", icon: "pricetags-outline", to: "/marketplace" },
      { kind: "native", label: "List an item", icon: "camera-outline", to: "/new-listing" },
      {
        kind: "web",
        label: "My listings",
        icon: "list-outline",
        path: "/dashboard/listings",
        title: "My listings",
      },
      { kind: "web", label: "Selling", icon: "cash-outline", path: "/dashboard/selling", title: "Selling" },
      { kind: "web", label: "Buying", icon: "cart-outline", path: "/dashboard/buying", title: "Buying" },
      { kind: "web", label: "Orders", icon: "receipt-outline", path: "/dashboard/orders", title: "Orders" },
      { kind: "web", label: "Payouts", icon: "card-outline", path: "/dashboard/payouts", title: "Payouts" },
    ],
  },
  {
    title: "Courses & news",
    items: [
      { kind: "native", label: "Course directory", icon: "flag-outline", to: "/courses" },
      // Web for now, and honestly so. The articles are on the site, the
      // pipeline that collects them is on the site, and a link tells us
      // whether anyone reads it before a native reader gets built.
      { kind: "web", label: "Golf news", icon: "newspaper-outline", path: "/news", title: "Golf news" },
    ],
  },
  {
    title: "Your account",
    items: [
      { kind: "native", label: "Messages & alerts", icon: "mail-outline", to: "/inbox" },
      { kind: "native", label: "Your profile", icon: "person-outline", to: "/profile" },
      {
        kind: "web",
        label: "Edit your profile",
        icon: "create-outline",
        path: "/profile/edit",
        title: "Edit profile",
      },
      {
        kind: "web",
        label: "Notification settings",
        icon: "options-outline",
        path: "/dashboard/notifications",
        title: "Notification settings",
      },
      { kind: "web", label: "Dashboard", icon: "grid-outline", path: "/dashboard", title: "Dashboard" },
    ],
  },
  {
    title: "Help",
    items: [
      { kind: "contact", label: "Contact us", icon: "chatbox-ellipses-outline" },
      { kind: "signout", label: "Log out", icon: "log-out-outline" },
    ],
  },
];

/**
 * The mailto behind "Contact us".
 *
 * The version and platform go in the body rather than being asked for,
 * because nobody knows what build they are on and the answer is the first
 * thing anyone needs in order to help. Everything after that is left blank
 * and the cursor sits in it.
 */
export function contactMailto(version: string, platform: string): string {
  const subject = "PinPals app — ";
  const body = [
    "",
    "",
    "———",
    `App version: ${version}`,
    `Device: ${platform}`,
  ].join("\n");

  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
