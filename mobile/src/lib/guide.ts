import type Ionicons from "@expo/vector-icons/Ionicons";
import type { Href } from "expo-router";

/**
 * The in-app how-to guides (Menu → Help → How-to guides).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  KEEP THIS IN STEP WITH THE APP.
 *
 *  Every guide below describes real screens, using the exact words on their
 *  buttons. When a change touches any of these flows — starting or running a
 *  group, events and trips, payments, the draw, live scoring, certifying a
 *  card — update the matching steps here in the same change, and add a line
 *  to GUIDE_CHANGES at the bottom. A guide that names a button which no
 *  longer exists is worse than no guide.
 *
 *  Screens each guide follows:
 *    society  → app/groups/index.tsx, app/groups/new.tsx, app/group/[id]/index.tsx,
 *               app/group/[id]/invite.tsx
 *    run      → app/group/[id]/index.tsx, app/group/[id]/settings.tsx,
 *               app/group/[id]/handicaps.tsx
 *    join     → app/groups/find.tsx, app/groups/index.tsx, app/group/[id]/index.tsx
 *    event    → app/group/[id]/events.tsx, app/group/[id]/outing/new.tsx,
 *               app/group/[id]/outing/[outingId].tsx, components/outing-pay-card.tsx,
 *               app/group/[id]/itinerary/*
 *    fill     → app/invite/[id].tsx, app/round-invite.tsx, app/tee-link.tsx
 *    round    → app/(tabs)/live/day/group.tsx, app/(tabs)/live/round/[id].tsx,
 *               app/scorecards/certify/[id].tsx
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It is data, not JSX, for the same reason lib/menu.ts is: one place to
 * edit, and the screens (app/guide/*) only draw it.
 */

type Icon = keyof typeof Ionicons.glyphMap;

/** One stop on the way to a screen: "☰ Menu › Groups › Start a group". */
export type GuideCrumb = { icon: Icon; label: string };

/**
 * What to look for on the screen, drawn the way the app draws it so the
 * member recognises it when they get there:
 *   primary — the green pill button   outline — the white button
 *   tile    — a square tile (Events, Tee times on a group's page)
 *   link    — green text link         field   — a box to type in
 */
export type GuideControl = {
  style: "primary" | "outline" | "tile" | "link" | "field";
  label: string;
  icon?: Icon;
};

/** A row of options as the screen shows them (the kinds of group, the formats). */
export type GuideChoice = { icon: Icon; label: string; blurb: string };

export type GuideStep = {
  title: string;
  body: string;
  /** How to get there, when it isn't the screen the last step left you on. */
  path?: GuideCrumb[];
  /** The buttons or boxes to look for on this screen. */
  look?: GuideControl[];
  /** Options laid out as cards. */
  choices?: GuideChoice[];
  /** Who can do this, when it isn't everyone. */
  who?: string;
  tip?: string;
  /** "Take me there" — only for screens that don't need a group picked first. */
  go?: { label: string; to: Href };
};

export type Guide = {
  id: string;
  title: string;
  /** One line under the title on the guides page. */
  blurb: string;
  icon: Icon;
  /** Card colour on the guides page. */
  tone: "green" | "navy" | "gold";
  /** Who the guide is for, shown as a badge. */
  audience: string;
  steps: GuideStep[];
  /** Guide to suggest when this one is finished. */
  next?: string;
};

const MENU: GuideCrumb = { icon: "menu", label: "Menu" };
const GROUPS: GuideCrumb = { icon: "people-outline", label: "Groups & societies" };
const YOUR_GROUP: GuideCrumb = { icon: "shield-outline", label: "Your group" };
const EVENTS: GuideCrumb = { icon: "calendar-outline", label: "Events" };

export const GUIDES: Guide[] = [
  // -------------------------------------------------------------------------
  {
    id: "society",
    title: "Set up a society",
    blurb: "Start a society, crew or trip and bring your golfers in.",
    icon: "people",
    tone: "green",
    audience: "Anyone",
    next: "run",
    steps: [
      {
        title: "Open Groups & societies",
        body: "Open the menu at the top left and tap Groups & societies. You can also tap Your groups & societies on the Home screen.",
        path: [MENU, GROUPS],
        go: { label: "Groups & societies", to: "/groups" },
      },
      {
        title: "Tap Start a group",
        body: "It's the green button at the top of Groups & societies.",
        look: [
          { style: "primary", label: "Start a group", icon: "add" },
          { style: "outline", label: "Find a society", icon: "search" },
        ],
        go: { label: "Start a group", to: "/groups/new" },
      },
      {
        title: "Pick the kind of group",
        body: "Choose Society for a golf society. Crew and Trip are for your regular fourball or a golf trip with friends.",
        choices: [
          { icon: "trophy", label: "Society", blurb: "Up to 500. Golfers can find it and ask to join; you approve them." },
          { icon: "people", label: "Crew", blurb: "Your regular fourball and friends. Up to 20, invite only, with a chat." },
          { icon: "airplane", label: "Trip", blurb: "Everyone on a golf trip. Up to 20, invite only, with a chat." },
        ],
      },
      {
        title: "Name it and add your home club",
        body: "Give it a name, and a line about who you are and when you play. For a society, search for your home club. Then tap Create society.",
        look: [
          { style: "field", label: "Name", icon: "create-outline" },
          { style: "field", label: "Home club (optional)", icon: "flag-outline" },
          { style: "primary", label: "Create society" },
        ],
        tip: "You can change the name, description and home club later in Settings.",
      },
      {
        title: "Add a cover photo and logo",
        body: "On your society's page, tap Add a cover photo — your home course or a day out. Tap the small camera on the badge to set a logo.",
        look: [{ style: "outline", label: "Add a cover photo", icon: "image-outline" }],
        who: "Owner, captain or secretary",
      },
      {
        title: "Invite your golfers",
        body: "Tap Invite. Share the society's link on WhatsApp or by text — anyone who taps it can join. Or tick people you're connected with, or search every member under Find PinPals, then send the invitations.",
        look: [
          { style: "primary", label: "Invite", icon: "person-add" },
          { style: "outline", label: "Find PinPals", icon: "search" },
        ],
        tip: "The group chat starts as soon as three of you are in.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "run",
    title: "Run your society",
    blurb: "Captain and secretary, join requests, handicaps and settings.",
    icon: "ribbon",
    tone: "navy",
    audience: "Owner, captain, secretary",
    next: "event",
    steps: [
      {
        title: "Appoint a captain and secretary",
        body: "On the society's page, tap a member's name under Members and choose Make captain or Make secretary. There is one of each.",
        path: [MENU, GROUPS, YOUR_GROUP],
        look: [
          { style: "link", label: "Make captain" },
          { style: "link", label: "Make secretary" },
        ],
        who: "The owner (whoever started the society)",
        tip: "Only the owner, captain and secretary can invite or add people. In a crew or trip you choose Make admin instead.",
      },
      {
        title: "Approve people who ask to join",
        body: "Golfers who find your society and ask to join appear under Asking to join. Tap a name to see their profile, then Approve or Decline.",
        look: [
          { style: "primary", label: "Approve" },
          { style: "outline", label: "Decline" },
        ],
        who: "Owner, captain or secretary",
      },
      {
        title: "Set society handicaps",
        body: "Tap Handicaps on the society's page. Enter a society handicap index for any member — it's used in your rounds instead of their own, which stays as it is.",
        look: [{ style: "outline", label: "Handicaps", icon: "stats-chart-outline" }],
        who: "Captain or secretary",
        tip: "Pick a course and tees to see everyone's course handicap for that day.",
      },
      {
        title: "Change the settings",
        body: "Tap Settings to change the name, description and home club, and to decide who brings people in and whether members can invite.",
        look: [{ style: "outline", label: "Settings", icon: "settings-outline" }],
        who: "Owner, captain or secretary",
      },
      {
        title: "Hand it over or step away",
        body: "To pass the society on, tap a member's name and choose Hand the group to them. You become an admin. Delete group is at the bottom of Settings.",
        look: [{ style: "link", label: "Hand the group to them" }],
        who: "The owner",
        tip: "The owner can't leave until someone else owns it — so there is always someone running it.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "join",
    title: "Join a society",
    blurb: "Find a society, ask to join, or accept an invitation.",
    icon: "enter",
    tone: "gold",
    audience: "Members",
    next: "round",
    steps: [
      {
        title: "Find a society",
        body: "In Groups & societies, tap Find a society and search by name.",
        path: [MENU, GROUPS],
        look: [{ style: "outline", label: "Find a society", icon: "search" }],
        go: { label: "Find a society", to: "/groups/find" },
      },
      {
        title: "Ask to join",
        body: "Open the society and tap Ask to join. Its captain or secretary is told, and you'll get a notification when you're in.",
        look: [{ style: "primary", label: "Ask to join" }],
        tip: "Changed your mind? Tap Withdraw on the same page.",
      },
      {
        title: "Or accept an invitation",
        body: "Invitations appear at the top of Groups & societies, and as a notification. Tap Join — or tap the link a friend sent you.",
        look: [
          { style: "primary", label: "Join" },
          { style: "outline", label: "Decline" },
        ],
        go: { label: "Groups & societies", to: "/groups" },
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "event",
    title: "Create an event",
    blurb: "A society day out, an overnight, or a trip abroad.",
    icon: "calendar",
    tone: "navy",
    audience: "Captain, secretary, organiser",
    next: "round",
    steps: [
      {
        title: "Open your group's Events",
        body: "On your group's page, tap the Events tile, then New event.",
        path: [MENU, GROUPS, YOUR_GROUP, EVENTS],
        look: [
          { style: "tile", label: "Events", icon: "calendar-outline" },
          { style: "primary", label: "New event", icon: "add" },
        ],
        who: "Captain or secretary (a crew or trip's organiser)",
      },
      {
        title: "Choose what kind of outing",
        body: "Name it — Captain's Day, Algarve 2027 — and pick the kind.",
        choices: [
          { icon: "flag", label: "Day out", blurb: "One course, one day. Entries, the draw and who has paid." },
          { icon: "bed", label: "Overnight in Ireland", blurb: "Two or more days: rounds, where you're staying, travel and notes." },
          { icon: "airplane", label: "Abroad", blurb: "Everything overnight has, plus flights and transfers." },
        ],
      },
      {
        title: "Date, course and first tee",
        body: "Scroll the wheels to pick the date (and the last day, for a trip). For a day out, search for the course and set the first tee. Add an entry fee and a limit on places if you want them.",
        look: [
          { style: "field", label: "Date", icon: "calendar-outline" },
          { style: "field", label: "Course", icon: "flag-outline" },
          { style: "field", label: "First tee", icon: "time-outline" },
          { style: "field", label: "Entry fee", icon: "cash-outline" },
        ],
      },
      {
        title: "Say how members pay you",
        body: "Under How members pay, add your Revolut @name, your IBAN and account name for a bank transfer, and tick Cash is fine. Members see these on the event, and Revolut opens with one tap.",
        look: [
          { style: "field", label: "Revolut username", icon: "logo-euro" },
          { style: "field", label: "Bank transfer", icon: "business-outline" },
          { style: "outline", label: "Cash is fine", icon: "checkbox-outline" },
        ],
        tip: "PinPals doesn't take this money — it goes straight to you.",
      },
      {
        title: "Create it",
        body: "Tap Create the outing — or Build the itinerary for a trip. It appears under Events for everyone in the group, and they can join straight away.",
        look: [
          { style: "primary", label: "Create the outing" },
          { style: "primary", label: "Build the itinerary" },
        ],
      },
      {
        title: "Build the trip itinerary",
        body: "For an overnight or abroad trip, open the event and tap Itinerary. Add each day's course and tee times, accommodation and rooms, flights and transfers, and notes. Members see their own flights, room and tee times.",
        look: [{ style: "outline", label: "Itinerary · build and edit", icon: "map-outline" }],
        tip: "Skip this step for a day out.",
      },
      {
        title: "Add guests",
        body: "Bringing someone who isn't on PinPals? Open the event and tap Add a guest. Type their name and handicap index, then Add guest. They take a place, go in the draw with everyone else, and you can mark them paid.",
        look: [
          { style: "outline", label: "Add a guest", icon: "person-outline" },
          { style: "field", label: "Guest's name", icon: "create-outline" },
          { style: "primary", label: "Add guest" },
        ],
        who: "Captain or secretary (a crew or trip's organiser)",
        tip: "You can also add a guest on the draw screen — they're put on the event when you publish the tee times.",
      },
      {
        title: "Track who's in and who's paid",
        body: "Open the event to see Who's in. When a member taps I've paid, they show as Says paid — tap their name to confirm it, mark them paid by cash or transfer, or waive the fee.",
        look: [
          { style: "outline", label: "Says paid" },
          { style: "link", label: "Paid cash" },
          { style: "link", label: "Waive the fee" },
        ],
        tip: "Entries close at midnight before the day.",
      },
      {
        title: "Make the draw",
        body: "Tap Make the draw on the event. Draw the field into groups, then Publish tee times — everyone sees their tee time and who they're playing with straight away. On the day, tap Draw and start the round.",
        look: [
          { style: "primary", label: "Make the draw" },
          { style: "primary", label: "Publish tee times" },
        ],
        tip: "The next guide, Play a round together, walks through the draw.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "round",
    title: "Play a round together",
    blurb: "Draw your group into fourballs and score it live.",
    icon: "golf",
    tone: "green",
    audience: "Anyone in a group",
    steps: [
      {
        title: "Start a round from your group",
        body: "On your group's page, tap Start a round. It's also in Live scoring as From a Group.",
        path: [MENU, GROUPS, YOUR_GROUP],
        look: [
          { style: "primary", label: "Start a round", icon: "shuffle" },
          { style: "outline", label: "From a Group", icon: "people-outline" },
        ],
        go: { label: "Open Live scoring", to: "/live" },
      },
      {
        title: "Tick who's playing",
        body: "Tick each player, or Tick everyone. Check every handicap index — a society handicap is used where the captain or secretary set one. Tap Add a guest for anyone not on PinPals — guests can go on published tee times too.",
        look: [
          { style: "link", label: "Tick everyone" },
          { style: "link", label: "Add a guest" },
          { style: "field", label: "Index", icon: "speedometer-outline" },
        ],
      },
      {
        title: "Choose the format",
        body: "Pick how you're playing. Matchplay formats can keep a team score, Ryder Cup style.",
        choices: [
          { icon: "stats-chart", label: "Stableford", blurb: "Everyone on one points leaderboard." },
          { icon: "list", label: "Stroke play", blurb: "Ranked by net score." },
          { icon: "people", label: "Scramble 4s or 2s", blurb: "Teams, one ball per team." },
          { icon: "git-compare", label: "Matchplay", blurb: "Singles, fourball, foursomes, greensomes." },
        ],
      },
      {
        title: "Name the day and pick when",
        body: "Give the day a name. Tap Date and scroll to a later day to set it up ahead, and tap First tee to set the start time. Choose Fourballs or Threeballs and the minutes between groups.",
        look: [
          { style: "field", label: "Date", icon: "calendar-outline" },
          { style: "field", label: "First tee", icon: "time-outline" },
        ],
        tip: "Only whoever runs the group can set a round up for a later date.",
      },
      {
        title: "Make the draw",
        body: "Tap Make the draw. Random mixes everyone up; Balanced by handicap spreads the low and high handicaps evenly. Tap one player, then another, to swap them.",
        look: [
          { style: "outline", label: "Random" },
          { style: "outline", label: "Balanced by handicap" },
          { style: "primary", label: "Make the draw" },
        ],
      },
      {
        title: "Tee off — or save it for the day",
        body: "Playing today? Tap Start the day. For a later date, tap Save for that day — everyone sees their tee time under the group's Events, and you start it there on the morning.",
        look: [
          { style: "primary", label: "Start the day" },
          { style: "outline", label: "Save for Sat 14 Nov" },
        ],
      },
      {
        title: "Score it live",
        body: "Everyone on PinPals gets their card and the leaderboard on their phone. Enter scores hole by hole — shots are worked out from the handicaps, and the leaderboard moves as you go. Guests are scored by their group.",
      },
      {
        title: "Finish and get your card certified",
        body: "After the last hole, tap Finish round. When it asks Get your card certified?, tap Choose who and pick someone you played with. They confirm your scores on their own phone with Face ID or a fingerprint, and your card shows who certified it.",
        look: [
          { style: "primary", label: "Finish round" },
          { style: "link", label: "Choose who", icon: "finger-print" },
        ],
        tip: "Scores can't be changed once the round is finished.",
      },
    ],
  },

  // -------------------------------------------------------------------------
  {
    id: "fill",
    title: "Fill a place in your round",
    blurb: "Invite a PinPal or send a link to fill an open place.",
    icon: "person-add",
    tone: "gold",
    audience: "Host or anyone playing",
    steps: [
      {
        title: "Open the round",
        body: "Open the tee time you're hosting or playing in — from Home, Rounds I've posted, or My confirmed tee times in the menu.",
        path: [MENU, { icon: "checkmark-circle-outline", label: "My confirmed tee times" }],
        go: { label: "My confirmed tee times", to: "/confirmed-rounds" },
      },
      {
        title: "Tap an open place",
        body: "Under Who's playing, each empty seat says Open place. Tap one.",
        look: [{ style: "outline", label: "Invite a PinPal or send a link", icon: "person-add" }],
        who: "The host, or anyone with a confirmed place",
      },
      {
        title: "Send a link or invite PinPals",
        body: "Send a link on WhatsApp or by text to anyone — on PinPals or not. Or tick people under Your PinPals or Find PinPals and tap Send invitations; they get a notification.",
        look: [
          { style: "primary", label: "WhatsApp", icon: "logo-whatsapp" },
          { style: "outline", label: "Find PinPals", icon: "search" },
          { style: "primary", label: "Send invitations" },
        ],
        tip: "They ask for the place and the host confirms it, just like any request — so the host always decides who plays.",
      },
    ],
  },
];

/**
 * The big picture on the guides page: group → event → round.
 * Each stop opens its guide.
 */
export const GUIDE_JOURNEY: { guide: string; icon: Icon; label: string }[] = [
  { guide: "society", icon: "people", label: "Start a group" },
  { guide: "event", icon: "calendar", label: "Create an event" },
  { guide: "round", icon: "golf", label: "Play the round" },
];

/**
 * What changed in the guides, newest first. Add a line whenever a guide is
 * updated, so members who read it before can see what's different.
 */
export const GUIDE_CHANGES: { on: string; text: string }[] = [
  { on: "2026-10-13", text: "New guide: Fill a place in your round — invite a PinPal or send a link to an open place." },
  { on: "2026-10-13", text: "Groups is now called Groups & societies, in the menu and on Home." },
  { on: "2026-10-13", text: "Create an event: new step, Add guests. Guests now go on published tee times and can be marked paid." },
  { on: "2026-10-13", text: "Guides added: setting up and running a society, joining one, events and trips, and playing a round together." },
];

export function guideById(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}
