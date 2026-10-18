import Ionicons from "@expo/vector-icons/Ionicons";
import type { Href } from "expo-router";

import { canUse, type AgeAccess, type AgeFeature } from "./age-rules";
import { isOn, type Feature } from "./features";

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
  | {
      kind: "native";
      label: string;
      icon: keyof typeof Ionicons.glyphMap;
      to: Href;
      /** Behind a feature flag: shown only while it's on. */
      feature?: Feature;
      /** Junior members (0159): shown only to members old enough for it. */
      age?: AgeFeature;
      /** Cash marketplace (0160): "on" only while the marketplace takes
       *  payments, "off" only while it doesn't. */
      payments?: "on" | "off";
    }
  /** A site page, opened inside the app's web view as the signed-in member —
   *  never handed to Safari, where they would be a stranger again. */
  | { kind: "web"; label: string; icon: keyof typeof Ionicons.glyphMap; path: string; title: string; age?: AgeFeature }
  | { kind: "contact"; label: string; icon: keyof typeof Ionicons.glyphMap }
  | { kind: "invite"; label: string; icon: keyof typeof Ionicons.glyphMap; age?: AgeFeature }
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
      { kind: "native", label: "Post a tee time", icon: "add-circle-outline", to: "/post-tee-time", age: "teeTimes" },
      { kind: "native", label: "Browse tee times", icon: "golf-outline", to: "/tee-times", age: "teeTimes" },
      // Second in Play: it's for the day you're on the course, when "where
      // do I put my score" is the question, not "find me a game".
      { kind: "native", label: "Live scoring", icon: "podium-outline", to: "/live", feature: "liveScoring" },
      { kind: "native", label: "My scorecards", icon: "document-text-outline", to: "/scorecards", feature: "scorecards" },
      // Competitions (0148): matchplay leagues, ladders and opens.
      { kind: "native", label: "Competitions", icon: "trophy-outline", to: "/compete", feature: "competitions" },
      // Game formats (Oct 2026): every way to play, explained — offline,
      // from lib/game-formats.ts (shared with the website's /formats).
      { kind: "native", label: "Game formats", icon: "library-outline", to: "/formats" },
      // Training (Oct 2026, claude/training.md): lie guides, the Putting
      // Lab, practice plans and a warm-up — offline, from lib/training.ts.
      { kind: "native", label: "Training", icon: "barbell-outline", to: "/train" },
      // One entry for what used to be four (Oct 2026): rounds you host, play
      // in, have asked to join or been offered — all on My rounds.
      {
        kind: "native",
        label: "My rounds",
        icon: "calendar-outline",
        to: "/my-rounds",
        age: "teeTimes",
      },
    ],
  },
  {
    title: "Members",
    items: [
      // The feed (0088) has its own tab; it is here too because the menu is
      // the one place that lists everything, and "where do I see what
      // people posted" should have an answer in it.
      { kind: "native", label: "Social", icon: "images-outline", to: "/feed", age: "social" },
      { kind: "native", label: "Saved posts", icon: "bookmark-outline", to: "/saved", age: "social" },
      // Groups (0120): crews, trips and societies.
      { kind: "native", label: "Groups & societies", icon: "people-outline", to: "/groups", feature: "groups" },
      {
        kind: "native",
        label: "Browse all members",
        icon: "search-outline",
        to: "/members",
        age: "connections",
      },
      {
        kind: "native",
        label: "My connections",
        icon: "people-circle-outline",
        to: "/connections",
        age: "connections",
      },
      // The share sheet, with a link to join (lib/invite-friends.ts).
      // Its link connects you to whoever joins, so not for under 16s (0159).
      { kind: "invite", label: "Invite friends to PinPals", icon: "person-add-outline", age: "connections" },
    ],
  },
  {
    title: "Marketplace",
    items: [
      { kind: "native", label: "Browse the marketplace", icon: "pricetags-outline", to: "/marketplace" },
      { kind: "native", label: "List an item", icon: "camera-outline", to: "/new-listing", age: "sell" },
      // Cash marketplace: My ads is listings, sold, saved and feedback in one.
      { kind: "native", label: "My ads", icon: "pricetag-outline", to: "/marketplace/my-ads", age: "sell", payments: "off" },
      {
        kind: "native",
        label: "My listings",
        icon: "list-outline",
        to: "/my-listings",
        age: "sell",
        payments: "on",
      },
      { kind: "native", label: "Selling", icon: "cash-outline", to: "/selling", age: "sell", payments: "on" },
      { kind: "native", label: "Buying & orders", icon: "cart-outline", to: "/buying", age: "buy", payments: "on" },
      { kind: "native", label: "Payouts", icon: "card-outline", to: "/payouts", age: "sell", payments: "on" },
    ],
  },
  {
    title: "Courses, news & rules",
    items: [
      { kind: "native", label: "Course directory", icon: "flag-outline", to: "/courses" },
      // Native, not web: the search runs on the phone, so it works on the
      // course with no signal (lib/rules-of-golf.ts, shared with /rules).
      { kind: "native", label: "Rules of Golf", icon: "reader-outline", to: "/rules" },
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
      { kind: "native", label: "Edit your profile", icon: "create-outline", to: "/edit-profile" },
      { kind: "native", label: "Blocked members", icon: "hand-left-outline", to: "/blocked-members" },
      { kind: "native", label: "Notification settings", icon: "options-outline", to: "/notification-settings" },
      { kind: "native", label: "Privacy & security", icon: "lock-closed-outline", to: "/privacy" },
      // Junior members (0159): a parent approves their child's account,
      // chooses who they play with and adds them to groups on the website's
      // /parent page. Adults only; for an adult with no child on PinPals
      // the page says what it's for.
      { kind: "web", label: "Parent dashboard", icon: "shield-checkmark-outline", path: "/parent", title: "Parent dashboard", age: "parentDashboard" },
    ],
  },
  {
    title: "Help",
    items: [
      // Step-by-step guides with pictures (app/guide, content in lib/guide.ts).
      { kind: "native", label: "How-to guides", icon: "book-outline", to: "/guide" },
      { kind: "contact", label: "Contact us", icon: "chatbox-ellipses-outline" },
      { kind: "signout", label: "Log out", icon: "log-out-outline" },
    ],
  },
];

/**
 * The menu as it should draw right now: flagged-off entries left out, and —
 * given the member's age access (lib/age.ts) — anything they're too young
 * for. Without one, nothing is left out by age. `payments` (whether the
 * marketplace takes them, lib/marketplace-cash.ts) picks between the checkout
 * entries and My ads; unknown counts as on, as before 0160.
 */
export const visibleMenu = (access?: AgeAccess, payments: boolean = true): MenuSection[] =>
  MENU.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        (item.kind !== "native" || !item.feature || isOn(item.feature)) &&
        (!access || !("age" in item) || !item.age || canUse(access, item.age)) &&
        (item.kind !== "native" || !item.payments || item.payments === (payments ? "on" : "off"))
    ),
  })).filter((section) => section.items.length > 0);

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
