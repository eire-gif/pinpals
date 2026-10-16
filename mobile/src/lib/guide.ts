import type Ionicons from "@expo/vector-icons/Ionicons";
import type { Href } from "expo-router";

/**
 * The in-app how-to guides (Menu → Help → How-to guides).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  KEEP THIS IN STEP WITH THE APP.
 *
 *  Every guide below describes real screens, using the exact words on their
 *  buttons. When a change touches any of these flows, update the matching
 *  steps here in the same change, and add a line to GUIDE_CHANGES at the
 *  bottom. A guide that names a button which no longer exists is worse than
 *  no guide.
 *
 *  Screens each guide follows:
 *    start    → app/groups/index.tsx, app/groups/new.tsx, app/group/[id]/index.tsx,
 *               app/group/[id]/invite.tsx
 *    run      → app/group/[id]/index.tsx, app/group/[id]/settings.tsx,
 *               app/group/[id]/handicaps.tsx, app/group/[id]/contacts.tsx,
 *               app/group/[id]/committee.tsx, app/group/[id]/money.tsx,
 *               app/group/[id]/membership-settings.tsx, app/group/[id]/noticeboard.tsx,
 *               app/group/[id]/message.tsx, app/group/[id]/exports.tsx, app/group/[id]/merit.tsx
 *    enter    → app/group/[id]/events.tsx, app/group/[id]/outing/[outingId].tsx,
 *               app/group/[id]/outing/request.tsx, app/group/[id]/membership.tsx,
 *               app/group/[id]/noticeboard.tsx
 *    join     → app/groups/find.tsx, app/groups/index.tsx, app/group/[id]/index.tsx
 *    event    → app/group/[id]/events.tsx, app/group/[id]/outing/new.tsx,
 *               app/group/[id]/outing/[outingId].tsx, components/outing-pay-card.tsx,
 *               app/group/[id]/itinerary/*
 *    round    → app/(tabs)/live/day/group.tsx, app/(tabs)/live/round/[id].tsx,
 *               app/scorecards/certify/[id].tsx
 *    results  → app/(tabs)/live/day/[id].tsx, components/results-entry.tsx,
 *               app/(tabs)/live/day/results/[id].tsx, components/group-past-results.tsx,
 *               app/group/[id]/index.tsx
 *    teePost  → app/post-tee-time.tsx, app/tee-time-requests.tsx
 *    teeJoin  → app/(tabs)/tee-times.tsx, app/invite/[id].tsx, app/my-requests.tsx
 *    fill     → app/invite/[id].tsx, app/round-invite.tsx, app/tee-link.tsx
 *    live     → app/(tabs)/live/index.tsx, app/(tabs)/live/new.tsx, app/(tabs)/live/round/[id].tsx,
 *               components/voice-scores-sheet.tsx (Say scores), targets/widget (lock screen card),
 *               targets/watch (Apple Watch app),
 *               app/invite/[id].tsx (Start live scoring), app/(tabs)/live/tv.tsx,
 *               app/(tabs)/live/day/[id].tsx (Show on TV)
 *    compete  → app/compete/index.tsx, app/compete/[id].tsx, app/compete/match/[id].tsx,
 *               app/compete/new.tsx, app/compete/opens.tsx, app/compete/share-open.tsx
 *    holeMap  → app/hole-map.tsx, components/hole-map-page.ts, components/hole-map-extras.tsx,
 *               app/my-bag.tsx, app/course/[id].tsx
 *    messages → app/(tabs)/inbox.tsx, app/new-chat.tsx, app/new-group.tsx,
 *               app/conversation/[id].tsx
 *    connect  → app/members.tsx, app/connections.tsx, app/invite-friends.tsx
 *    mobile   → app/privacy.tsx, app/group/[id]/contacts.tsx
 *    sell     → app/new-listing.tsx, app/listing/[id].tsx, app/selling.tsx,
 *               app/payouts.tsx, components/handover-panel.tsx
 *    buy      → app/(tabs)/marketplace.tsx, app/listing/[id].tsx, app/checkout.tsx,
 *               app/order/[id].tsx
 *    social   → app/(tabs)/feed.tsx, app/compose.tsx, app/new-post.tsx,
 *               app/comments/[id].tsx, app/share/[id].tsx, app/rate-course.tsx
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHO A GUIDE IS FOR. The group guides are written three ways — for a crew
 * of friends, a golf trip, or a society — because two friends setting up a
 * Saturday fourball don't need a captain, a secretary and join requests. The
 * guides page asks which, once. A guide or step with `audiences`/`only` is
 * shown just for those; `as` swaps in that audience's wording.
 *
 * It is data, not JSX, for the same reason lib/menu.ts is: one place to
 * edit, and the screens (app/guide/*) only draw it.
 */

type Icon = keyof typeof Ionicons.glyphMap;

export type Audience = "friends" | "trip" | "society";

export const AUDIENCES: { id: Audience; label: string; blurb: string; icon: Icon; group: string }[] = [
  { id: "friends", label: "Friends", blurb: "Your regular fourball and the friends who fill in", icon: "people", group: "crew" },
  { id: "trip", label: "Golf trip", blurb: "Everyone going away together", icon: "airplane", group: "trip" },
  { id: "society", label: "Society", blurb: "A golf society, big or small", icon: "trophy", group: "society" },
];

/** One stop on the way to a screen: "☰ Menu › Groups & societies". */
export type GuideCrumb = { icon: Icon; label: string };

/**
 * What to look for on the screen, drawn the way the app draws it:
 *   primary — the green pill button   outline — the white button
 *   tile    — a square tile           link    — green text link
 *   field   — a box to type in
 *   raised  — the big navy-and-gold card (Home's Live Scoring, Start a Game…)
 *   banner  — the gold bar on a group's page (Start a round)
 */
export type GuideControl = {
  style: "primary" | "outline" | "tile" | "link" | "field" | "raised" | "banner";
  label: string;
  icon?: Icon;
  /** The second line on a raised card or a banner. */
  subtitle?: string;
};

/** Options laid out as cards; the first is drawn as picked. */
export type GuideChoice = { icon: Icon; label: string; blurb: string };

/** A drawing of the hole map (components/guide-art.tsx). */
export type GuideArt = "holeOverview" | "holeNumbers" | "holeDrag" | "holeAim" | "holeHazards" | "holeShots";

type StepText = {
  title: string;
  body: string;
  /** How to get there, when it isn't the screen the last step left you on. */
  path?: GuideCrumb[];
  /** The buttons or boxes to look for on this screen. */
  look?: GuideControl[];
  choices?: GuideChoice[];
  /** Who can do this, when it isn't everyone. */
  who?: string;
  tip?: string;
  art?: GuideArt;
  /** "Take me there" — only for screens that don't need a group picked first. */
  go?: { label: string; to: Href };
};

export type GuideStep = StepText & {
  /** Shown only for these audiences. */
  only?: Audience[];
  /** That audience's wording, over the default. */
  as?: Partial<Record<Audience, Partial<StepText>>>;
};

export type GuideSection = "groups" | "play" | "people" | "market" | "social";

export const SECTIONS: { id: GuideSection; title: string }[] = [
  { id: "groups", title: "Your group" },
  { id: "play", title: "Playing golf" },
  { id: "people", title: "Messages & friends" },
  { id: "market", title: "Marketplace" },
  { id: "social", title: "Social" },
];

export type Guide = {
  id: string;
  section: GuideSection;
  title: string;
  blurb: string;
  icon: Icon;
  tone: "green" | "navy" | "gold";
  /** Who it's for, shown as a badge. */
  audience: string;
  /** Shown only for these audiences (group guides). Absent: everyone. */
  audiences?: Audience[];
  /** That audience's title, blurb and badge. */
  as?: Partial<Record<Audience, { title?: string; blurb?: string; audience?: string }>>;
  steps: GuideStep[];
  /** Guide to suggest when this one is finished. */
  next?: string;
};

/** A guide as one audience reads it. */
export type ResolvedGuide = Omit<Guide, "steps" | "as" | "audiences"> & { steps: StepText[] };

const MENU: GuideCrumb = { icon: "menu", label: "Menu" };
const GROUPS: GuideCrumb = { icon: "people-outline", label: "Groups & societies" };
const YOUR_GROUP: GuideCrumb = { icon: "shield-outline", label: "Your group" };
const EVENTS: GuideCrumb = { icon: "calendar-outline", label: "Events" };

const KIND = {
  crew: { icon: "people", label: "Crew", blurb: "Your regular fourball and friends. Up to 20, invite only, with a chat." },
  trip: { icon: "airplane", label: "Trip", blurb: "Everyone on a golf trip. Up to 20, invite only, with a chat." },
  society: { icon: "trophy", label: "Society", blurb: "Up to 500. Golfers can find it and ask to join; you approve them." },
} satisfies Record<string, GuideChoice>;

const OUTING = {
  day: { icon: "flag", label: "Day out", blurb: "One course, one day. Entries, the draw and who has paid." },
  overnight: { icon: "bed", label: "Overnight in Ireland", blurb: "Two or more days: rounds, where you're staying, travel and notes." },
  abroad: { icon: "airplane", label: "Abroad", blurb: "Everything overnight has, plus flights and transfers." },
} satisfies Record<string, GuideChoice>;

export const GUIDES: Guide[] = [
  // =========================================================================
  // Your group — written three ways
  // =========================================================================
  {
    id: "start",
    section: "groups",
    title: "Set up a society",
    blurb: "Start a society and bring your golfers in.",
    icon: "people",
    tone: "green",
    audience: "Anyone",
    as: {
      friends: { title: "Start a crew", blurb: "A home for your fourball: one chat, your rounds, your days out." },
      trip: { title: "Set up your golf trip", blurb: "Everyone going, one chat, and the trip's plan in one place." },
    },
    next: "event",
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
        as: {
          friends: { look: [{ style: "primary", label: "Start a group", icon: "add" }] },
          trip: { look: [{ style: "primary", label: "Start a group", icon: "add" }] },
        },
      },
      {
        title: "Choose Society",
        body: "Pick Society. Golfers can find it by name and ask to join, and you decide who gets in.",
        choices: [KIND.society, KIND.crew, KIND.trip],
        as: {
          friends: { title: "Choose Crew", body: "Pick Crew. It's invite only — just the friends you bring in.", choices: [KIND.crew, KIND.trip, KIND.society] },
          trip: { title: "Choose Trip", body: "Pick Trip. It's invite only — just the people going.", choices: [KIND.trip, KIND.crew, KIND.society] },
        },
      },
      {
        title: "Name it and add your home club",
        body: "Give it a name, and a line about who you are and when you play. Search for your home club. Then tap Create society.",
        look: [
          { style: "field", label: "Malahide Golf Society", icon: "create-outline" },
          { style: "field", label: "Home club (optional)", icon: "flag-outline" },
          { style: "primary", label: "Create society" },
        ],
        tip: "You can change the name, description and home club later in Settings.",
        as: {
          friends: {
            title: "Name your crew",
            tip: "You can change the name and description later in Settings.",
            body: "Give it a name your friends will recognise, and a line about it if you like. Tap Create crew.",
            look: [
              { style: "field", label: "Saturday Golf Crew", icon: "create-outline" },
              { style: "primary", label: "Create crew" },
            ],
          },
          trip: {
            title: "Name the trip",
            tip: "You can change the name and description later in Settings.",
            body: "Name it after the trip — where and when — and add a line about it. Tap Create trip.",
            look: [
              { style: "field", label: "Algarve 2027", icon: "create-outline" },
              { style: "primary", label: "Create trip" },
            ],
          },
        },
      },
      {
        title: "Add a cover photo and logo",
        body: "On the group's page, tap Add a cover photo — your home course, a day out. Tap the small camera on the badge to set a logo.",
        look: [{ style: "outline", label: "Add a cover photo", icon: "image-outline" }],
        who: "Owner, captain or secretary",
        as: { friends: { who: "Whoever started it" }, trip: { who: "Whoever started it" } },
      },
      {
        title: "Invite your golfers",
        body: "Tap Invite. Share the link on WhatsApp or by text — anyone who taps it joins. Or tick people you're connected with, or search every member under Find PinPals, then send the invitations.",
        look: [
          { style: "primary", label: "Invite", icon: "person-add" },
          { style: "outline", label: "Find PinPals", icon: "search" },
        ],
        tip: "The group chat starts as soon as three of you are in.",
        as: {
          friends: {
            title: "Bring your friends in",
            body: "Tap Invite and send the link to your fourball's WhatsApp — anyone who taps it joins straight in. Friends already on PinPals can be ticked instead.",
            look: [
              { style: "primary", label: "Invite", icon: "person-add" },
              { style: "primary", label: "WhatsApp", icon: "logo-whatsapp" },
            ],
          },
          trip: {
            title: "Bring everyone going",
            body: "Tap Invite and drop the link in the trip's WhatsApp — everyone who taps it is in. Anyone already on PinPals can be ticked instead.",
            look: [
              { style: "primary", label: "Invite", icon: "person-add" },
              { style: "primary", label: "WhatsApp", icon: "logo-whatsapp" },
            ],
          },
        },
      },
    ],
  },

  {
    id: "run",
    section: "groups",
    audiences: ["society"],
    title: "Run your society",
    blurb: "Your committee, join requests, membership, money, messages and handicaps.",
    icon: "ribbon",
    tone: "navy",
    audience: "Owner, captain, secretary",
    next: "event",
    steps: [
      {
        title: "Appoint your committee",
        body: "On the society's page, tap a member's name under Members and choose Make captain, Make secretary, Make vice-captain, Make treasurer, Make handicap secretary or Make event organiser. There's one of each, except event organisers — have as many as you like.",
        path: [MENU, GROUPS, YOUR_GROUP],
        look: [
          { style: "link", label: "Make captain" },
          { style: "link", label: "Make treasurer" },
          { style: "link", label: "Make event organiser" },
        ],
        who: "The owner (whoever started the society)",
        tip: "Captain and secretary run everything. The vice-captain and event organisers run events, the treasurer the money, the handicap secretary the handicaps. Only the owner, captain and secretary invite people.",
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
        who: "Captain, secretary or handicap secretary",
        tip: "Pick a course and tees to see everyone's course handicap for that day. Members see the figure the society plays them off on its page.",
      },
      {
        title: "Annual membership",
        body: "Under Run the society, tap Membership. Switch on Annual membership, set the fee, the month the season starts and when it's due, and how members pay you. Choose whether someone who hasn't paid can still enter events.",
        look: [
          { style: "tile", label: "Membership", icon: "card-outline" },
          { style: "outline", label: "Annual membership", icon: "toggle-outline" },
        ],
        who: "Captain or secretary",
        tip: "Leave it off if your society charges per event only. Members get reminders before it's due.",
      },
      {
        title: "Members, money and exports",
        body: "Members shows everyone's membership — Paid up, Unpaid, Says paid, Honorary, Lapsed — and tap a name to mark it or remind them. Money shows the season: collected, outstanding and refunded, event by event, with everyone who says they've paid to confirm. Export gives you CSV files: members, a course booking sheet, attendance, accounts and results.",
        look: [
          { style: "tile", label: "Members", icon: "people-outline" },
          { style: "tile", label: "Money", icon: "cash-outline" },
          { style: "tile", label: "Export", icon: "download-outline" },
        ],
        who: "Captain, secretary or treasurer",
        tip: "Every export is recorded, and mobile numbers appear only where you can already see them.",
      },
      {
        title: "Noticeboard and messages",
        body: "Post on the Noticeboard — a change, a reminder, the AGM — and pin the one that matters. To reach just some people, tap Message: everyone, an event's entrants or waiting list, those who owe a fee or membership, or the committee.",
        look: [
          { style: "tile", label: "Noticeboard", icon: "megaphone-outline" },
          { style: "tile", label: "Message", icon: "paper-plane-outline" },
        ],
        who: "The committee",
        tip: "A message about money goes only to the people it's for — never on the noticeboard.",
      },
      {
        title: "Order of merit",
        body: "Tap Order of merit for the season's table, built from the results you publish to the society's page. Tap Rules to set the points for each place, points for playing, and whether only the best few events count.",
        look: [
          { style: "tile", label: "Order of merit", icon: "podium-outline" },
          { style: "outline", label: "Rules" },
        ],
        who: "Captain or secretary set the rules; everyone sees the table",
      },
      {
        title: "Phone your members",
        body: "Tap Phone numbers on the society's page to call, text or WhatsApp members who have shared their mobile with the society. Members choose this themselves, in Privacy & security — ask them to turn it on.",
        look: [
          { style: "outline", label: "Phone numbers", icon: "call-outline" },
          { style: "outline", label: "WhatsApp", icon: "logo-whatsapp" },
        ],
        who: "Owner, captain or secretary",
        tip: "Share your own number too: members then see the captain's and secretary's numbers on the same screen.",
      },
      {
        title: "Change the settings",
        body: "Tap Settings to change the name, description and home club, and to decide who brings people in and whether members can invite.",
        look: [{ style: "outline", label: "Settings", icon: "settings-outline" }],
        who: "Owner, captain or secretary",
      },
      {
        title: "Run it from a computer",
        body: "Everything here is also on the website: go to pinpals.ie/society, sign in with your PinPals email and password, and pick your society. Events and entries, the waiting list, the draw, payments, membership, handicaps, the noticeboard and the committee — on a big screen.",
        look: [{ style: "outline", label: "Society admin", icon: "desktop-outline" }],
        who: "The committee — each sees only their own areas",
        tip: "It's the same society and the same rules as the app: a change on one shows on the other straight away.",
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

  {
    id: "join",
    section: "groups",
    title: "Join a society",
    blurb: "Find a society, ask to join, or accept an invitation.",
    icon: "enter",
    tone: "gold",
    audience: "Members",
    as: {
      friends: { title: "Join a friend's crew", blurb: "Accept the invitation or tap the link they sent." },
      trip: { title: "Join the trip", blurb: "Accept the invitation or tap the link the organiser sent." },
    },
    next: "round",
    steps: [
      {
        title: "Find a society",
        body: "In Groups & societies, tap Find a society and search by name.",
        only: ["society"],
        path: [MENU, GROUPS],
        look: [{ style: "outline", label: "Find a society", icon: "search" }],
        go: { label: "Find a society", to: "/groups/find" },
      },
      {
        title: "Ask to join",
        body: "Open the society and tap Ask to join. Its captain or secretary is told, and you'll get a notification when you're in.",
        only: ["society"],
        look: [{ style: "primary", label: "Ask to join" }],
        tip: "Changed your mind? Tap Withdraw on the same page.",
      },
      {
        title: "Or accept an invitation",
        body: "Invitations appear at the top of Groups & societies, and as a notification. Tap Join — or tap the link you were sent.",
        look: [
          { style: "primary", label: "Join" },
          { style: "outline", label: "Decline" },
        ],
        go: { label: "Groups & societies", to: "/groups" },
        as: {
          friends: { title: "Accept the invitation", body: "When a friend adds you, it's at the top of Groups & societies and in your alerts. Tap Join. If they sent a link instead, just tap it — you're straight in." },
          trip: { title: "Accept the invitation", body: "When the organiser adds you, it's at the top of Groups & societies and in your alerts. Tap Join. If they sent a link, tap it — you're straight in." },
        },
      },
      {
        title: "Find your way around",
        body: "Open the group from Groups & societies. Chat opens the group chat once three of you are in, Events shows what's planned, and Start a round draws you into groups on the day.",
        only: ["friends", "trip"],
        look: [
          { style: "outline", label: "Chat", icon: "chatbubbles-outline" },
          { style: "tile", label: "Events", icon: "calendar-outline" },
          { style: "banner", label: "Start a round", icon: "shuffle", subtitle: "Draw into groups or teams, scored live" },
        ],
        as: { trip: { body: "Open the trip from Groups & societies. Chat opens the trip's chat, Events has the trip with its itinerary — your flights, room and tee times — and Start a round draws everyone on the day." } },
      },
    ],
  },

  {
    id: "event",
    section: "groups",
    title: "Create an event",
    blurb: "A society day out, an overnight, or a trip abroad.",
    icon: "calendar",
    tone: "navy",
    audience: "Captain, secretary",
    as: {
      friends: { title: "Plan a day out", blurb: "Pick a course and date, see who's in, collect the green fees.", audience: "Whoever started the crew" },
      trip: { title: "Plan the trip", blurb: "Dates, rounds, rooms, flights and who's paid — day by day.", audience: "The trip's organiser" },
    },
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
        who: "Captain or secretary",
        as: { friends: { who: "Whoever started the crew" }, trip: { who: "The trip's organiser" } },
      },
      {
        title: "Choose what kind of outing",
        body: "Name it — Captain's Day, say — and pick the kind.",
        choices: [OUTING.day, OUTING.overnight, OUTING.abroad],
        as: {
          friends: { body: "Name it — Saturday at The Island, say — and pick Day out. Going away for a night? Pick Overnight in Ireland." },
          trip: { body: "Name it — Algarve 2027 — and pick Abroad or Overnight in Ireland. Both open a full itinerary.", choices: [OUTING.abroad, OUTING.overnight, OUTING.day] },
        },
      },
      {
        title: "Date, course and first tee",
        body: "Scroll the wheels to pick the date. Search for the course and set the first tee. Add an entry fee and a limit on places if you want them.",
        look: [
          { style: "field", label: "Date", icon: "calendar-outline" },
          { style: "field", label: "Course", icon: "flag-outline" },
          { style: "field", label: "First tee", icon: "time-outline" },
          { style: "field", label: "Entry fee", icon: "cash-outline" },
        ],
        as: {
          trip: {
            title: "First day, last day and cost",
            body: "Scroll the wheels to the first and last day, and add where you're based. The courses go on the itinerary, one round per day. Add the cost per person if you're collecting it.",
            look: [
              { style: "field", label: "First day", icon: "calendar-outline" },
              { style: "field", label: "Last day", icon: "calendar-outline" },
              { style: "field", label: "Cost per person", icon: "cash-outline" },
            ],
          },
        },
      },
      {
        title: "Choose how members get a place",
        body: "Under How members get a place, pick Join straight away (first come, first served) or Request a place (you approve each one). Keep a waiting list for when it's full, choose whether members can bring guests and what guests pay, and when entries close.",
        only: ["society"],
        look: [
          { style: "outline", label: "Join straight away", icon: "radio-button-off" },
          { style: "outline", label: "Request a place", icon: "radio-button-on" },
          { style: "outline", label: "Waiting list when it's full", icon: "toggle-outline" },
        ],
        tip: "With Offer freed places automatically on, a place someone gives up goes to the first on the waiting list, who has 24 hours to take it.",
      },
      {
        title: "On the day",
        body: "Add the arrive-by time, the format, the dress code and the meal choices. Members see them on the event with a Directions button, and pick their meal when they get a place.",
        only: ["society"],
        look: [
          { style: "field", label: "Arrive by", icon: "time-outline" },
          { style: "field", label: "Dress code", icon: "shirt-outline" },
          { style: "field", label: "Meal choices", icon: "restaurant-outline" },
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
        body: "Tap Create the outing. It appears under Events for everyone in the group, and they can join straight away.",
        look: [{ style: "primary", label: "Create the outing" }],
        as: { trip: { body: "Tap Build the itinerary. The trip appears under Events and everyone can join it straight away.", look: [{ style: "primary", label: "Build the itinerary" }] } },
      },
      {
        title: "Build the trip itinerary",
        body: "Open the trip and tap Itinerary. Add each day's course and tee times, where you're staying and who's in which room, flights and transfers, and notes. Everyone sees their own flights, room and tee times.",
        only: ["trip", "society"],
        look: [{ style: "outline", label: "Itinerary · build and edit", icon: "map-outline" }],
        tip: "Skip this for a day out.",
        as: { trip: { tip: "Each round on the itinerary has its own groups and tee times." } },
      },
      {
        title: "Add guests",
        body: "Bringing someone who isn't on PinPals? Open the event and tap Add a guest. Type their name and handicap index, then Add guest. They take a place, go in the draw with everyone else, and you can mark them paid.",
        look: [
          { style: "outline", label: "Add a guest", icon: "person-outline" },
          { style: "field", label: "Guest's name", icon: "create-outline" },
          { style: "primary", label: "Add guest" },
        ],
        tip: "You can also add a guest on the draw screen — they're put on the event when you publish the tee times.",
      },
      {
        title: "Answer requests and the waiting list",
        body: "Open the event: Asking for a place lists each request with their guest, meal and note — tap a name to give them a place, put them on the waiting list or decline. On the Waiting list, tap Promote to give someone a place now.",
        only: ["society"],
        look: [
          { style: "outline", label: "Requested" },
          { style: "primary", label: "Promote" },
        ],
        tip: "Everyone hears straight away — confirmed, declined, or that a place has opened for them.",
      },
      {
        title: "Track who's in and who's paid",
        body: "Open the event to see Who's in. When someone taps I've paid, they show as Says paid — tap their name to confirm it, mark them paid by cash or transfer, or waive the fee.",
        look: [
          { style: "outline", label: "Says paid" },
          { style: "link", label: "Paid cash" },
          { style: "link", label: "Waive the fee" },
        ],
        tip: "Entries close at midnight before the day, unless you chose earlier. Someone who withdraws after paying shows under Withdrew — tap Mark refunded once you've paid them back.",
      },
      {
        title: "Make the draw",
        body: "Tap Make the draw on the event. Draw the field into groups, then Publish tee times — everyone sees their tee time and who they're playing with straight away. On the day, tap Draw and start the round.",
        only: ["friends", "society"],
        look: [
          { style: "primary", label: "Make the draw" },
          { style: "primary", label: "Publish tee times" },
        ],
        tip: "The next guide, Play a round together, walks through the draw.",
      },
    ],
  },

  {
    id: "enter",
    section: "groups",
    audiences: ["society"],
    title: "Get a place on an event",
    blurb: "Join or request a place, the waiting list, guests, paying, and alerts.",
    icon: "golf",
    tone: "green",
    audience: "Every member",
    steps: [
      {
        title: "Find the fixtures",
        body: "On the society's page, tap Events for the season's fixtures. Each shows where you stand: Confirmed, Requested, Waiting list, or Payment due.",
        path: [MENU, GROUPS, YOUR_GROUP, EVENTS],
        look: [
          { style: "tile", label: "Events", icon: "calendar-outline" },
          { style: "outline", label: "Confirmed" },
          { style: "outline", label: "Waiting list" },
        ],
      },
      {
        title: "Join, or request a place",
        body: "Tap Join to get a place straight away, or Request a place where the captain gives them out. Choose your meal, bring a guest, ask to play with someone or for an early or late tee, and leave a note.",
        look: [
          { style: "primary", label: "Join" },
          { style: "primary", label: "Request a place" },
          { style: "outline", label: "Bring a guest", icon: "person-add-outline" },
        ],
        tip: "Nothing to pay until you're confirmed.",
      },
      {
        title: "The waiting list",
        body: "If it's full you go on the waiting list, and see where you are in the line. When a place opens you get a notification and 24 hours to Take the place — or Let it go to the next person.",
        look: [
          { style: "primary", label: "Take the place" },
          { style: "outline", label: "Let it go" },
        ],
      },
      {
        title: "Pay and keep up",
        body: "What you owe is at the top of the society's page — membership and any event fees. Tap it to see how to pay, then tap I've paid. The Noticeboard has the society's news; switch alerts on or off there.",
        look: [
          { style: "outline", label: "What you owe" },
          { style: "primary", label: "I've paid" },
          { style: "tile", label: "Noticeboard", icon: "megaphone-outline" },
        ],
        tip: "You'll always hear when your place is confirmed, a place opens, or an event changes.",
      },
    ],
  },

  {
    id: "round",
    section: "groups",
    title: "Play a round together",
    blurb: "Draw your group into fourballs and score it live.",
    icon: "golf",
    tone: "green",
    audience: "Anyone in a group",
    as: { friends: { blurb: "Pick who's playing, pick the game, and score it live." } },
    steps: [
      {
        title: "Start a round from your group",
        body: "On your group's page, tap the gold Start a round bar. It's also in Live scoring as From a Group.",
        path: [MENU, GROUPS, YOUR_GROUP],
        look: [
          { style: "banner", label: "Start a round", icon: "shuffle", subtitle: "Draw into groups or teams, scored live" },
          { style: "raised", label: "From a Group", icon: "shuffle", subtitle: "Draw your crew or society into groups or teams" },
        ],
        go: { label: "Live scoring", to: "/live" },
      },
      {
        title: "Tick who's playing",
        body: "Tick each player, or Tick everyone. Check every handicap index — a society handicap is used where the captain or secretary set one. Tap Add a guest for anyone not on PinPals — guests can go on published tee times too.",
        look: [
          { style: "link", label: "Tick everyone" },
          { style: "link", label: "Add a guest" },
          { style: "field", label: "Index", icon: "speedometer-outline" },
        ],
        as: {
          friends: { body: "Everyone in the crew starts ticked — untick anyone not playing. Check each handicap index, and tap Add a guest for a friend who isn't on PinPals." },
          trip: { body: "Everyone on the trip starts ticked — untick anyone sitting it out. Check each handicap index, and tap Add a guest for anyone not on PinPals." },
        },
      },
      {
        title: "Choose the format",
        body: "Pick how you're playing. Matchplay formats can keep a team score, Ryder Cup style.",
        choices: [
          { icon: "stats-chart", label: "Stableford", blurb: "Everyone on one points leaderboard." },
          { icon: "list", label: "Stroke play", blurb: "Ranked by net score." },
          { icon: "people", label: "Scramble 4s or 2s", blurb: "Teams, one ball per team." },
          { icon: "swap-horizontal", label: "Foursomes Stableford or stroke play", blurb: "Scotch foursomes: pairs share a ball and take alternate shots. Two pairs to a tee group." },
          { icon: "git-compare", label: "Matchplay", blurb: "Singles, fourball, foursomes, greensomes." },
        ],
        tip: "Foursomes and Scotch foursomes are the same game. Each pair plays off half its combined course handicaps — worked out for you.",
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
        tip: "Tap Yardage & shot map under the hole number for distances to the green and to track your shots — see the hole map guide.",
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
      {
        title: "Foursomes and scrambles: the pair's card",
        body: "Playing foursomes or a scramble, it's your pair's (or team's) card — one ball. After the last hole, tap Choose who and pick someone from the OTHER pair in your group to certify it with Face ID. Your partner can't mark your own card.",
        look: [
          { style: "link", label: "Save our pair's card", icon: "document-text-outline" },
          { style: "link", label: "Choose who", icon: "finger-print" },
        ],
        tip: "A pair's or team's card isn't used for your handicap — the World Handicap System only counts individual rounds.",
      },
    ],
    next: "results",
  },

  {
    id: "results",
    section: "groups",
    title: "Publish the results",
    blurb: "1st, 2nd and 3rd with countbacks, worked out from the cards — check, publish, share.",
    icon: "trophy",
    tone: "gold",
    audience: "Whoever started the day",
    as: { friends: { blurb: "Who won, with the countback worked out — share it to the group chat." } },
    steps: [
      {
        title: "Open the day's board",
        body: "Open the day from Live scoring, under Society days, matches & scrambles. On its board, the Results card shows how many cards are in. Tap Prepare results — you can do it while the last groups are still out.",
        path: [{ icon: "podium-outline", label: "Live scoring" }, { icon: "people-outline", label: "Society days, matches & scrambles" }],
        look: [{ style: "primary", label: "Prepare results" }],
        who: "Whoever started the day. Everyone else sees the results once you publish them.",
        go: { label: "Live scoring", to: "/live" },
        tip: "Results are for Stableford and stroke-play days, scrambles and foursomes. A match day's result is its team score, already on its board.",
      },
      {
        title: "How the winners are decided",
        body: "Ties are broken the way Golf Ireland clubs do it — the R&A's countback: the last 9 holes, then the last 6, the last 3 and the 18th, then the last 6, 3 and 9th of the front nine. Holes go by their number on the card, so a group that started on the 10th is judged on the same holes as everyone else.",
        choices: [
          { icon: "shuffle", label: "Random draw", blurb: "Still level after every step: PinPals draws, the same way every time." },
          { icon: "people", label: "Share the place", blurb: "Still level after every step: both show as =2nd." },
        ],
        tip: "In stroke play each step takes ½, ⅓, ⅙ or 1⁄18 of the handicap off, never rounded. In Stableford it's simply the points on those holes.",
      },
      {
        title: "Divisions and prizes",
        body: "Pick One, Two or Three divisions — the field is split evenly by playing handicap, and − and + move the cut. Then switch on Best gross, One prize per player and Guests can win as your society plays it.",
        look: [
          { style: "outline", label: "Two" },
          { style: "outline", label: "Best gross" },
          { style: "outline", label: "One prize per player" },
        ],
        only: ["society", "trip"],
        tip: "With One prize per player, someone placed in their division doesn't also take best gross — it goes to the next best.",
      },
      {
        title: "Check the podium and every tie",
        body: "The top three stand on the podium and everyone is listed below. Wherever players are level, tap one to see the countback step by step — the step that separated them is highlighted.",
        look: [{ style: "link", label: "Won on countback · last 6: 14 v 12" }],
        tip: "B9 beside each score is the points (or net) on holes 10–18 — the first countback step.",
      },
      {
        title: "Before you publish",
        body: "PinPals lists anything that could change the result: a card still out, a card missing stroke indexes, or a placed card a playing partner hasn't certified yet. Under Prizes you enter, add nearest the pin and longest drive winners.",
        look: [
          { style: "link", label: "Nearest the pin", icon: "add" },
          { style: "link", label: "Longest drive", icon: "add" },
        ],
        tip: "In stroke play a picked-up hole is a no return (NR) and can't place — the Rules of Golf. In Stableford it's just no points.",
      },
      {
        title: "Amend a card, if you must",
        body: "A wrong score signed for, or a breach of the rules? Under Amend a card, pick the player or pair, tap the hole and set the right score — or tap Disqualify — and give the reason. The players' card isn't touched: the results show the card as Amended, with what was submitted, what it became and why.",
        look: [
          { style: "link", label: "Amend a card", icon: "create-outline" },
          { style: "outline", label: "Save the correction" },
        ],
        tip: "Everyone sees an Amended label on the card, on the results and on the shared link — nothing changes quietly.",
      },
      {
        title: "Show it on your group's page",
        body: "Under Show on a group's page, pick the society, trip or crew. Its members can look back at the results under Past results on the group's page — tap it to open the list, or See all results for every one — even those who didn't play. A day from an event is set to that society already.",
        look: [{ style: "outline", label: "North Dublin Golf Society" }],
        as: {
          friends: { body: "Under Show on a group's page, pick your crew. Everyone in it can look back at the results under Past results on the crew's page." },
          trip: { body: "Under Show on a group's page, pick the trip. Everyone on it can look back at every round's results under Past results on the trip's page." },
        },
      },
      {
        title: "Publish",
        body: "Tap Publish results. Every card is closed so no score can change, and everyone in the day gets a notification with the winners and where they finished.",
        look: [{ style: "primary", label: "Publish results" }],
        tip: "Spotted a mistake? Tap Correct, fix it, and Publish the update — everyone sees Updated. Take the results down hides them again. Your settings and corrections save as you go, so Back to Home at the bottom never loses anything — the panel there shows when it's saved.",
      },
      {
        title: "Share it",
        body: "Tap Share results to send them to WhatsApp, the society chat or anywhere else. The link shows a results card with each division's top three, and opens the full results — countbacks included.",
        look: [{ style: "primary", label: "Share results", icon: "share-outline" }],
        tip: "Anyone who played can share the results too, from their own results page.",
      },
    ],
  },

  // =========================================================================
  // Playing golf
  // =========================================================================
  {
    id: "teePost",
    section: "play",
    title: "Post a tee time",
    blurb: "Got a spare place? Offer it and choose who joins you.",
    icon: "flag",
    tone: "green",
    audience: "Everyone",
    next: "fill",
    steps: [
      {
        title: "Open Post a tee time",
        body: "Tap Post a tee time on Home, or the round green + at the top of the Tee Times tab.",
        look: [
          { style: "tile", label: "Post a tee time", icon: "flag" },
          { style: "primary", label: "+", icon: "add" },
        ],
        go: { label: "Post a tee time", to: "/post-tee-time" },
      },
      {
        title: "Choose the course and day",
        body: "Type a few letters in Search golf clubs and tap the club. Then tap Choose a day — Today, Tomorrow, or any day in the next six weeks.",
        look: [
          { style: "field", label: "Search golf clubs", icon: "search" },
          { style: "field", label: "Choose a day", icon: "calendar-outline" },
        ],
      },
      {
        title: "Set the time",
        body: "Already booked? Switch on I've already booked a tee time and pick it. If not, give a window: From and, if you like, Until — morning, afternoon or evening.",
        look: [
          { style: "outline", label: "I've already booked a tee time", icon: "toggle" },
          { style: "field", label: "From", icon: "time-outline" },
          { style: "field", label: "Until", icon: "time-outline" },
        ],
      },
      {
        title: "Spaces, and who can see it",
        body: "Pick 1, 2 or 3 spaces. Choose All members, or My connections only for just the golfers you know.",
        look: [
          { style: "outline", label: "2 spaces" },
          { style: "outline", label: "All members" },
          { style: "outline", label: "My connections only" },
        ],
      },
      {
        title: "Add the extras and post",
        body: "Optional: Ladies only, a Handicap limit, and Notes — buggies booked, a few euro on it. Then tap Post tee time.",
        look: [
          { style: "field", label: "Notes", icon: "create-outline" },
          { style: "primary", label: "Post tee time" },
        ],
        tip: "Your connections are told straight away, and the app offers to put it in your calendar.",
      },
      {
        title: "Answer who wants to play",
        body: "When someone asks to join, you get an alert. Tap it and you go straight to the requests for that round — or open Golfers interested in mine from the menu, or tap Manage who's coming on the round — and tap Offer a place or Decline.",
        path: [MENU, { icon: "people-outline", label: "Golfers interested in mine" }],
        look: [
          { style: "primary", label: "Offer a place" },
          { style: "outline", label: "Decline" },
        ],
        tip: "Nothing's final until they tap Confirm my place. You always choose who plays.",
        go: { label: "Requests to join", to: "/tee-time-requests" },
      },
    ],
  },

  {
    id: "teeJoin",
    section: "play",
    title: "Find a game",
    blurb: "Join a fourball with a spare place, near you or further afield.",
    icon: "search",
    tone: "navy",
    audience: "Everyone",
    next: "holeMap",
    steps: [
      {
        title: "Open Tee Times",
        body: "Tap the Tee Times tab. All tee times shows every round looking for players; Near me shows those within 50 km.",
        look: [
          { style: "outline", label: "All tee times" },
          { style: "outline", label: "Near me", icon: "navigate" },
          { style: "outline", label: "Filters", icon: "options-outline" },
        ],
        go: { label: "Tee Times", to: "/tee-times" },
      },
      {
        title: "Narrow it down",
        body: "Tap Filters to pick This week or This weekend, how many spaces, Tee time already booked, or Ladies only. The button shows how many rounds match.",
        look: [
          { style: "outline", label: "This weekend" },
          { style: "primary", label: "Show 6 rounds" },
        ],
      },
      {
        title: "Ask to play",
        body: "Tap a round to see who's playing and the host's notes. Tap I'm interested — the host is told and you'll hear back here.",
        look: [{ style: "primary", label: "I'm interested", icon: "hand-right" }],
      },
      {
        title: "Confirm your place",
        body: "When the host offers you a place, you get an alert. Tap it and that tee time opens — tap Confirm my place, or I can't make it so it goes to someone else. You stay on the round once you've answered.",
        look: [
          { style: "primary", label: "Confirm my place" },
          { style: "outline", label: "I can't make it" },
        ],
        tip: "Tap Add to my calendar so the day's kept free.",
      },
      {
        title: "If plans change",
        body: "Until the day, you can tap Cancel my place on the round. The host is told and the space reopens. Everything you've asked for is under Rounds I've asked to join in the menu.",
        look: [{ style: "outline", label: "Cancel my place", icon: "exit-outline" }],
        go: { label: "Rounds I've asked to join", to: "/my-requests" },
      },
    ],
  },

  {
    id: "fill",
    section: "play",
    title: "Fill a place in your round",
    blurb: "Invite a PinPal or send a link to an open place.",
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

  {
    id: "live",
    section: "play",
    title: "Score a game live",
    blurb: "Stableford, stroke play, foursomes, a match or a scramble — shots worked out for you.",
    icon: "podium",
    tone: "navy",
    audience: "Everyone",
    next: "holeMap",
    steps: [
      {
        title: "Open Live scoring",
        body: "On Home, tap the big Live Scoring card. It's in the menu too.",
        look: [{ style: "raised", label: "Live Scoring", subtitle: "Score with your group, watch the leaderboard move" }],
        go: { label: "Live scoring", to: "/live" },
        tip: "Playing a tee time? Open it and tap Start live scoring — everyone on it is added for you. Untick anyone who isn't scoring with you.",
      },
      {
        title: "Choose how you're playing",
        body: "Running the society's day? Tap From a Group to draw your members into tee groups or teams. Match Day runs several matches at once with a team score, Ryder Cup style. Just your own fourball? Tap Start a Game.",
        look: [{ style: "raised", label: "From a Group", icon: "shuffle", subtitle: "Draw your crew or society into groups or teams" }, { style: "raised", label: "Match Day", icon: "people", subtitle: "Societies, fourballs, foursomes and competitions" }, { style: "raised", label: "Start a Game", icon: "flag", subtitle: "Stableford, stroke play, foursomes, a match or a scramble" }],
        tip: "From a Group is covered step by step in Play a round together. The rest of this guide is Start a Game.",
        as: {
          friends: {
            body: "Just your fourball? Tap Start a Game — that's the rest of this guide. Got a crew set up? From a Group ticks everyone in it and draws you into groups.",
            look: [{ style: "raised", label: "Start a Game", icon: "flag", subtitle: "Stableford, stroke play, foursomes, a match or a scramble" }, { style: "raised", label: "From a Group", icon: "shuffle", subtitle: "Draw your crew or society into groups or teams" }],
            tip: "From a Group is covered step by step in Play a round together.",
          },
          trip: {
            body: "On the trip, tap From a Group to draw everyone into fourballs for the day, or Match Day for a team competition. Start a Game is for a quick game in your own fourball.",
            look: [{ style: "raised", label: "From a Group", icon: "shuffle", subtitle: "Draw your crew or society into groups or teams" }, { style: "raised", label: "Match Day", icon: "people", subtitle: "Societies, fourballs, foursomes and competitions" }, { style: "raised", label: "Start a Game", icon: "flag", subtitle: "Stableford, stroke play, foursomes, a match or a scramble" }],
          },
        },
      },
      {
        title: "Course, tees and format",
        body: "After Start a Game: search for the course and check the tees — if the course has a saved card, a tee is already picked so every stroke index is filled in. Choose 18 or 9 holes, then the format.",
        choices: [
          { icon: "stats-chart", label: "Stableford", blurb: "Points per hole." },
          { icon: "list", label: "Stroke play", blurb: "Gross and net." },
          { icon: "git-compare", label: "Singles", blurb: "One v one, hole by hole." },
          { icon: "swap-horizontal", label: "Foursomes", blurb: "Scotch foursomes: pairs, alternate shot. Then pick Stableford, Stroke play or Matchplay." },
          { icon: "people", label: "Scramble", blurb: "Teams of 2 or 4, one ball." },
        ],
        tip: "Foursomes: add two players for one pair, or four for two pairs — 1 & 2 play 3 & 4. The card shows who tees off on each hole.",
      },
      {
        title: "Add the players and tee off",
        body: "You're in already. Tap Add a PinPal for friends on PinPals, or Add a guest for anyone else, and check each handicap index — plays-off is worked out for the course. Tap Tee off.",
        look: [
          { style: "link", label: "Add a PinPal" },
          { style: "link", label: "Add a guest" },
          { style: "primary", label: "Tee off" },
        ],
        tip: "PinPals you add get the card and leaderboard on their own phone.",
      },
      {
        title: "Score each hole",
        body: "Each player's score starts at par plus their shots. Use − and + to set it, tap the number to confirm, and tap Next hole. Hold a number to clear it.",
        look: [
          { style: "outline", label: "−" },
          { style: "primary", label: "5" },
          { style: "outline", label: "+" },
          { style: "primary", label: "Next hole" },
        ],
        tip: "Tap the gold Yardage & shot map button under the hole number for front, centre and back of the green, and to mark each shot.",
      },
      {
        title: "Or say the scores",
        body: "Tap Say scores under the players and say everyone's, the way you'd tell the group: “Niamh bogey, I had par, Dec a five”. Then check each one — fix any with − and +, and tap Yes on any it wasn't sure of — and tap Save & go to the next hole.",
        look: [
          { style: "primary", label: "Say scores", icon: "mic" },
          { style: "primary", label: "Save & go to hole 8", icon: "checkmark" },
        ],
        tip: "Birdie, par, bogey, double, picked up, “the same” and “the rest of us par” all work. It listens on your phone, so it works with no signal on most iPhones. Nothing saves until you tap Save.",
      },
      {
        title: "Score from your lock screen",
        body: "On an iPhone, your round appears on the lock screen once you open it. Lift the phone, use − and + if you need to, and tap Save — no need to unlock. It moves on to the next hole by itself. Picked up is underneath, and Undo takes you back to the hole you just saved. The gold mic opens the round listening, to say the group's scores, and the yardage is your distance to the centre of the green — tap it for the hole map.",
        look: [
          { style: "outline", label: "−" },
          { style: "primary", label: "5" },
          { style: "outline", label: "+" },
          { style: "primary", label: "Save", icon: "checkmark" },
        ],
        tip: "It's your own score only, and not for scrambles or foursomes. No signal? It's kept and sent when there is. The yardage needs location: PinPals asks once, and it stops when the round ends (a flag means it's the hole's length from the tee). The card goes when you tap Finish round. Not showing? Settings → PinPals → Live Activities.",
      },
      {
        title: "Score from your Apple Watch",
        body: "With PinPals on your Apple Watch, the round you open on your iPhone is on your wrist too. It shows the hole, par and your distance to the centre of the green. Turn the Digital Crown or use − and +, then tap Save — it moves on to the next hole. Swipe left for your card: your total, Undo, Picked up, and any hole to change.",
        look: [
          { style: "outline", label: "−" },
          { style: "primary", label: "4" },
          { style: "outline", label: "+" },
          { style: "primary", label: "Save", icon: "watch-outline" },
        ],
        tip: "Your own score only, as on the lock screen. Scores go through your iPhone, or straight from the watch on Wi-Fi or mobile data, and are kept on the watch until there's signal. Get it from the Watch app on your iPhone → PinPals → Install.",
      },
      {
        title: "Leaderboard, finish and share",
        body: "The Leaderboard tab updates as everyone scores. After the last hole, tap Finish round, then get your card certified and Share scorecard to WhatsApp. For a picture of your card, choose My card as a photo, then Save Image — it goes into your Photos, ready for Instagram.",
        look: [
          { style: "outline", label: "Leaderboard" },
          { style: "primary", label: "Finish round" },
          { style: "outline", label: "Share scorecard", icon: "share-outline" },
          { style: "outline", label: "My card as a photo", icon: "image-outline" },
        ],
        tip: "Any card in Menu → My scorecards does the same: tap Send, then Photo of the card. On Android, use that one — the picture opens as a download and lands in your gallery.",
      },
      {
        title: "Put the leaderboard on a TV",
        body: "In the clubhouse or the bar, open pinpals.ie/tv on the TV. It shows a code. In your round, tap Show the leaderboard on TV, type the code and tap Connect the TV. The board updates as you score, and birdies flash up on the screen.",
        look: [
          { style: "outline", label: "Show the leaderboard on TV", icon: "tv-outline" },
          { style: "field", label: "Code on the TV" },
          { style: "primary", label: "Connect the TV" },
        ],
        go: { label: "Show on TV", to: "/live/tv" },
        tip: "A society day or match day has Show on TV on its leaderboard too. No TV browser? Tap Share the TV link instead and open it on a laptop, or an iPad with AirPlay.",
        as: {
          society: { tip: "On the day's leaderboard, tap Show on TV — every group is on one board. No TV browser? Tap Share the TV link instead and open it on a laptop, or an iPad with AirPlay." },
        },
      },
    ],
  },

  {
    id: "compete",
    section: "play",
    title: "Play in a league, ladder or open",
    blurb: "Matchplay leagues and ladders played at your clubs and reported here, and opens with a partner.",
    icon: "trophy",
    tone: "gold",
    audience: "Everyone",
    steps: [
      {
        title: "Find a competition",
        body: "Open Competitions. Leagues and Ladders show what you're in and what's open to enter — PinPals leagues for everyone, and any your society or group runs. Tap one, then Enter (or Join at the bottom for a ladder).",
        path: [MENU, { icon: "trophy-outline", label: "Competitions" }],
        look: [
          { style: "outline", label: "Leagues" },
          { style: "outline", label: "Ladders" },
          { style: "primary", label: "Enter" },
        ],
        go: { label: "Competitions", to: "/compete" },
        tip: "Your handicap index comes from your profile; type a different one if it has changed. Shots in every match come from it.",
      },
      {
        title: "Your group and the table",
        body: "When entries close the organiser publishes the draw and you're told your group. Everyone in it plays everyone once, each round by its Play by date. The table counts Win 3, Half 1, then holes up or down. Above the gold line goes through to the knockout.",
        tip: "A * next to a name means a result in their line is reported but not confirmed yet.",
      },
      {
        title: "Arrange your match",
        body: "Your matches sit at the top of Competitions. Open one: it shows about how many shots one of you gives — the full difference, as Golf Ireland plays singles matchplay. Message your opponent, agree a day and a course, then Set a time so you both have it.",
        look: [
          { style: "outline", label: "Message" },
          { style: "primary", label: "Set a time" },
        ],
      },
      {
        title: "Report the result",
        body: "After you play, either of you taps Report the result, picks who won and by how much (3&2, 1 up, or Halved in the groups) and sends it. The other gets Confirm result or Dispute. If nobody disputes it, it stands after 48 hours.",
        look: [
          { style: "primary", label: "Report the result" },
          { style: "outline", label: "Confirm result" },
        ],
        tip: "If you both report and the results don't match, it goes to the organiser to settle.",
      },
      {
        title: "The knockout",
        body: "When every group match is settled, the organiser starts the knockout: group winners are seeded so they don't meet their own runner-up first. Knockout matches can't be halved — if you're level after 18, play on and report 19th, 20th and so on.",
      },
      {
        title: "Ladders",
        body: "On a ladder you join at the bottom. Tap Challenge next to anyone up to a few places above you. Win and you take their place, and everyone between moves down one; lose or halve and nothing changes.",
        look: [{ style: "outline", label: "Challenge" }],
      },
      {
        title: "Opens, and a partner",
        body: "Open competitions lists club opens by date and province. Tap Need a partner and others see you're looking; tap the partner count to see who else is, and message them. Book with club opens the club's own booking page — you enter and pay there.",
        look: [
          { style: "outline", label: "Need a partner" },
          { style: "primary", label: "Book with club" },
        ],
        tip: "Spotted an open on a club's site? Share it from the top of Open competitions so others can find it.",
      },
      {
        title: "Run one for your group",
        body: "If you run a society or group, tap Start a league or ladder at the bottom of Competitions and choose your group. Once entries close, open the league and tap Make the draw: check the groups, Reshuffle if you like, then Publish the draw. Tap an entrant to mark their fee paid, and open any match to Settle this match — a dispute, a walkover or a void.",
        look: [
          { style: "outline", label: "Start a league or ladder" },
          { style: "primary", label: "Make the draw" },
          { style: "primary", label: "Start the knockout" },
        ],
        who: "A group's owner or admins. PinPals runs the leagues open to everyone.",
      },
    ],
  },

  {
    id: "holeMap",
    section: "play",
    title: "Use the hole map",
    blurb: "Satellite view of every hole: yardages, hazards, the pin and your shots.",
    icon: "map",
    tone: "green",
    audience: "Everyone",
    steps: [
      {
        title: "Open the hole map",
        body: "On a course's page, tap a hole number under Hole by hole. In a live round, tap the gold Yardage & shot map button under the hole number. The satellite view turns so the tee is at the bottom and the green at the top.",
        look: [
          { style: "outline", label: "1" },
          { style: "outline", label: "2" },
          { style: "primary", label: "Yardage & shot map", icon: "navigate" },
        ],
        art: "holeOverview",
      },
      {
        title: "Read your numbers",
        body: "The panel at the bottom gives the distance to the Front, Centre and Back of the green. Within 750 m of the green they're measured from you, using your phone's GPS; further away, from the tee. Standing at your ball, the line under the numbers also says how far you are from the tee — your drive. Distances on the map stay on screen as you zoom in.",
        art: "holeNumbers",
        tip: "Drag the panel down to see more of the map — the hole and the three numbers stay. Drag it up, or tap the handle, to bring the rest back. Tap yds to switch to metres.",
      },
      {
        title: "Set today's pin and your tee",
        body: "Drag the flag to where the pin is today — it turns red, yellow or white for the front, middle or back of the green. Drag the T to the tee box you're playing. Every number re-measures.",
        art: "holeDrag",
        look: [{ style: "outline", label: "Put the tee, flag and aim back", icon: "refresh" }],
      },
      {
        title: "Plan with the aim circle",
        body: "On longer holes a white circle sits about 230 yards out. Drag it — or tap anywhere — to where you want to lay up. It shows how far it is from you, and the big gold number is what's left to the green.",
        art: "holeAim",
        tip: "Tap Reset to put it back.",
      },
      {
        title: "Check the wind",
        body: "Top left, the arrow shows which way the wind is blowing on this hole, with its speed and gusts — \"Into you, left to right\". Tap it to see the wind blowing across the map: one chevron for light, two for moderate, three for strong. Under the numbers, Plays like is how far the shot really plays with that wind.",
        look: [{ style: "outline", label: "Plays like 149" }],
        tip: "A rule of thumb: into the wind adds about 1% per mph, downwind takes off about half that.",
      },
      {
        title: "Get a club for the shot",
        body: "Beside Plays like, PinPals suggests the club from My bag nearest that distance. Set up My bag once — the clubs you carry and how far you hit them — from the menu, or tap the club.",
        path: [MENU, { icon: "briefcase-outline", label: "My bag" }],
        look: [{ style: "outline", label: "8 iron" }],
        go: { label: "My bag", to: "/my-bag" },
      },
      {
        title: "Show distance arcs",
        body: "Tap the circle button on the right for rings every 50 yards across the hole, again for rings at your own clubs' distances, and again to hide them.",
        look: [{ style: "outline", label: "Distance arcs", icon: "radio-button-on" }],
      },
      {
        title: "See what's in play",
        body: "Bunkers, water and trees are marked, with the distance to each one still ahead of you. Tap Hazards and more for the list — and Local knowledge: tips from members who know the hole. Add your own, and tap Useful on the good ones.",
        art: "holeHazards",
        look: [
          { style: "outline", label: "Hazards and more", icon: "list" },
          { style: "outline", label: "Add a tip for this hole", icon: "add" },
        ],
      },
      {
        title: "Mark your shots",
        body: "In a live round, walk to your ball and tap Mark shot. The map draws each shot and how far it went. Under Which club?, tap the club you hit — it's saved to your round, and My bag learns your real distances from these. Your longest shot with each club shows under the round's scorecard and in My bag. The undo arrow takes back the last shot.",
        art: "holeShots",
        look: [{ style: "primary", label: "Mark shot 2", icon: "locate" }],
        tip: "Distances are GPS estimates — check the course's own markers before an important shot.",
      },
    ],
  },

  // =========================================================================
  // Messages & friends
  // =========================================================================
  {
    id: "connect",
    section: "people",
    title: "Find your golf friends",
    blurb: "Connect with people you play with — and invite the ones not on PinPals.",
    icon: "people-circle",
    tone: "gold",
    audience: "Everyone",
    next: "messages",
    steps: [
      {
        title: "Open Find PinPals",
        body: "In the menu, tap Browse all members. For you suggests golfers you've played with and people at your club; search by name or club at the top.",
        path: [MENU, { icon: "search-outline", label: "Browse all members" }],
        look: [
          { style: "outline", label: "For you" },
          { style: "outline", label: "My club" },
          { style: "outline", label: "Nearby" },
        ],
        go: { label: "Find PinPals", to: "/members" },
      },
      {
        title: "Connect",
        body: "Tap Connect on someone's card or profile. When they accept, you can message each other and see each other's connections-only tee times.",
        look: [{ style: "primary", label: "Connect" }],
      },
      {
        title: "Answer requests",
        body: "Requests from others are at the top of My connections. Tap Accept or Decline.",
        path: [MENU, { icon: "people-circle-outline", label: "My connections" }],
        look: [
          { style: "primary", label: "Accept" },
          { style: "outline", label: "Decline" },
        ],
        go: { label: "My connections", to: "/connections" },
      },
      {
        title: "Bring your fourball",
        body: "Tap the QR button beside Find your next fourball on Home, or Invite friends to PinPals in the menu. Send your link on WhatsApp or by text, or show your QR code in the clubhouse — when they join, you're connected straight away.",
        look: [
          { style: "primary", label: "WhatsApp", icon: "logo-whatsapp" },
          { style: "outline", label: "Show full screen", icon: "qr-code-outline" },
        ],
        go: { label: "Invite friends", to: "/invite-friends" },
      },
    ],
  },

  {
    id: "mobile",
    section: "people",
    title: "Your mobile and privacy",
    blurb: "Add your mobile, share it with your society, download your data.",
    icon: "lock-closed",
    tone: "navy",
    audience: "Everyone",
    next: "messages",
    steps: [
      {
        title: "Open Privacy & security",
        body: "In the menu, tap Privacy & security. It's also on your Profile, under Account.",
        path: [MENU, { icon: "lock-closed-outline", label: "Privacy & security" }],
        go: { label: "Privacy & security", to: "/privacy" },
      },
      {
        title: "Add your mobile",
        body: "Tap Add my mobile, type your number and tap Save.",
        look: [
          { style: "primary", label: "Add my mobile" },
          { style: "field", label: "087 123 4567" },
          { style: "primary", label: "Save" },
        ],
        tip: "Only you can see your number until you choose to share it.",
      },
      {
        title: "Share it with your group",
        body: "Under Share it with a group, turn on the groups you want. The people who run each one — a society's captain and secretary — can then call or message you. If you run the group, its members see your number too.",
        look: [{ style: "outline", label: "Share it with a group" }],
        tip: "Turn a switch off and your number disappears from that group straight away.",
      },
      {
        title: "See a group's numbers",
        body: "On a group's page, tap Phone numbers. Call, Text or WhatsApp anyone listed.",
        path: [MENU, GROUPS, YOUR_GROUP],
        look: [
          { style: "outline", label: "Phone numbers", icon: "call-outline" },
          { style: "outline", label: "Call", icon: "call" },
          { style: "outline", label: "WhatsApp", icon: "logo-whatsapp" },
        ],
      },
      {
        title: "Download your data",
        body: "Tap Download my data for a file of everything PinPals holds about you — profile, posts, messages you sent, listings, orders, rounds and groups.",
        path: [MENU, { icon: "lock-closed-outline", label: "Privacy & security" }],
        look: [{ style: "outline", label: "Download my data", icon: "download-outline" }],
        tip: "Your handicap shows only while you switch it on in Edit profile. Your Golf Ireland number never shows.",
      },
    ],
  },

  {
    id: "messages",
    section: "people",
    title: "Chat with your PinPals",
    blurb: "Messages, group chats, photos, reactions and replies.",
    icon: "chatbubbles",
    tone: "navy",
    audience: "Everyone",
    steps: [
      {
        title: "Open your Inbox",
        body: "Tap the Inbox tab. Chats and Alerts sit at the top — tap either to see just that.",
        look: [
          { style: "tile", label: "Chats", icon: "chatbubbles-outline" },
          { style: "tile", label: "Alerts", icon: "notifications-outline" },
        ],
        go: { label: "Inbox", to: "/inbox" },
      },
      {
        title: "Start a chat",
        body: "Tap the pencil at the top of the Inbox and pick someone. If you've chatted before, it opens that chat.",
        look: [{ style: "outline", label: "New message", icon: "create-outline" }],
        tip: "You can message your connections. Chats about a listing or a tee time start from that listing or round.",
      },
      {
        title: "Start a group chat",
        body: "Tap the pencil, then New group. Name it, pick at least two people, and tap Start group. Up to 20 can be in it.",
        look: [
          { style: "outline", label: "New group", icon: "people-outline" },
          { style: "primary", label: "Start group" },
        ],
      },
      {
        title: "React and reply",
        body: "Press and hold a message for a quick reaction — 👍 ❤️ 😂 ⛳ 🔥 👏 — and Reply. Or swipe a message right to reply to it. In a group, Reply privately starts a one-to-one chat about it.",
        look: [
          { style: "outline", label: "⛳" },
          { style: "link", label: "Reply" },
          { style: "link", label: "Reply privately" },
        ],
      },
      {
        title: "Photos, emoji and ticks",
        body: "Tap the camera to send a photo, or the smiley for emoji — there's a golf set. One tick means sent; two green ticks mean everyone's read it.",
        look: [
          { style: "outline", label: "Send a photo", icon: "camera-outline" },
          { style: "outline", label: "Add an emoji", icon: "happy-outline" },
        ],
      },
      {
        title: "Delete or tidy up",
        body: "Hold a message and tap Delete. For 48 hours you can Delete for everyone; after that, Delete for me. To clear a chat from your Inbox, swipe it left and tap Hide — it comes back if they write again.",
        look: [
          { style: "link", label: "Delete for everyone" },
          { style: "outline", label: "Hide" },
        ],
      },
    ],
  },

  // =========================================================================
  // Marketplace
  // =========================================================================
  {
    id: "sell",
    section: "market",
    title: "Sell your gear",
    blurb: "List clubs and kit in a minute, answer offers, and get paid safely.",
    icon: "pricetag",
    tone: "gold",
    audience: "Everyone",
    next: "buy",
    steps: [
      {
        title: "Set up payouts first",
        body: "In the menu, tap Payouts, then Set up payouts. You give your details and bank account to Stripe directly — never in a PinPals form. When it says Ready to sell, buyers can pay you.",
        path: [MENU, { icon: "card-outline", label: "Payouts" }],
        look: [{ style: "primary", label: "Set up payouts" }],
        go: { label: "Getting paid", to: "/payouts" },
        tip: "You can list and take offers before this, but nobody can pay you until it's done.",
      },
      {
        title: "Photograph it",
        body: "Tap Sell an item on Home, or List item on the Marketplace. Add up to 8 photos — the first is the cover.",
        look: [
          { style: "tile", label: "Sell an item", icon: "pricetag-outline" },
          { style: "outline", label: "Add photos", icon: "camera-outline" },
        ],
        go: { label: "List an item", to: "/new-listing" },
      },
      {
        title: "Describe it",
        body: "Say what it is, pick the category, the brand and the condition. The brand matters most — it's how buyers filter.",
        look: [
          { style: "field", label: "TaylorMade Stealth 2 driver, 10.5°", icon: "create-outline" },
          { style: "outline", label: "Drivers" },
          { style: "outline", label: "Excellent" },
        ],
      },
      {
        title: "Price and delivery",
        body: "Set your price and choose Fixed price or Open to offers. Choose Post it, Collection or both, and where it is. Tap Save and review.",
        look: [
          { style: "field", label: "€ 180", icon: "cash-outline" },
          { style: "outline", label: "Open to offers" },
          { style: "primary", label: "Save and review" },
        ],
      },
      {
        title: "Put it on sale",
        body: "It's saved as a draft only you can see. Check it over, then tap Put on sale.",
        look: [{ style: "primary", label: "Put on sale" }],
      },
      {
        title: "Answer offers",
        body: "Offers are under Selling › Offers. Accept, Decline, or Counter with a higher price. Accepting reserves the item while the buyer pays.",
        path: [MENU, { icon: "cash-outline", label: "Selling" }],
        look: [
          { style: "primary", label: "Accept" },
          { style: "outline", label: "Counter" },
          { style: "outline", label: "Decline" },
        ],
        go: { label: "Selling", to: "/selling" },
      },
      {
        title: "Hand it over and get paid",
        body: "Meeting up? Check they're happy, then ask for their 4-digit code and tap Confirm handover — you're paid. Posting it? Add the tracking number and tap Mark as posted; you're paid when it arrives.",
        look: [
          { style: "field", label: "0000", icon: "keypad-outline" },
          { style: "primary", label: "Confirm handover" },
          { style: "outline", label: "Mark as posted" },
        ],
        tip: "Meet at a golf club, in daylight.",
      },
    ],
  },

  {
    id: "buy",
    section: "market",
    title: "Buy gear safely",
    blurb: "Find second-hand clubs and kit, with your money held until you have it.",
    icon: "bag-handle",
    tone: "green",
    audience: "Everyone",
    steps: [
      {
        title: "Browse used gear",
        body: "Tap the Marketplace tab and Used Gear. Search, or tap Near me, At my club, Under €100 or Left-handed. Filters narrows by brand, condition and price.",
        look: [
          { style: "outline", label: "Used Gear" },
          { style: "outline", label: "At my club" },
          { style: "outline", label: "Filters", icon: "options-outline" },
        ],
        go: { label: "Marketplace", to: "/marketplace" },
      },
      {
        title: "Buy it or make an offer",
        body: "Tap Buy now — or, if the seller is open to offers, Make an offer. They have 48 hours to accept, decline or counter. Questions? Tap Message under the seller.",
        look: [
          { style: "primary", label: "Buy now · €180" },
          { style: "outline", label: "Make an offer" },
        ],
      },
      {
        title: "Check out",
        body: "Choose Meet at the club (free) or Tracked post, agree to the terms, and tap Reserve and pay. You pay by card with Stripe, and the item's held for you for 30 minutes.",
        look: [
          { style: "outline", label: "Meet at the club" },
          { style: "primary", label: "Reserve and pay €193.70" },
        ],
        tip: "Buyer Protection is added to the price and shown before you pay. Your money's held until you have the item.",
      },
      {
        title: "Get it",
        body: "Meeting up? Check the item, then read your 4-digit handover code from the order to the seller — that releases the payment. Posted? When it arrives, tap It arrived — all OK.",
        look: [
          { style: "tile", label: "4 8 2 7", icon: "keypad-outline" },
          { style: "primary", label: "It arrived — all OK" },
        ],
      },
      {
        title: "If something's wrong",
        body: "On the order, tap Problem with this item, say what's wrong, and tap Report and hold the payment. The seller isn't paid while it's looked at.",
        look: [
          { style: "link", label: "Problem with this item" },
          { style: "primary", label: "Report and hold the payment" },
        ],
      },
    ],
  },

  // =========================================================================
  // Social
  // =========================================================================
  {
    id: "social",
    section: "social",
    title: "Share on Social",
    blurb: "Rounds, holes, great shots and photos — plus course reviews.",
    icon: "images",
    tone: "navy",
    audience: "Everyone",
    steps: [
      {
        title: "Start a post",
        body: "On Home, tap How was golf today? — or Photo, My round or Review under it. On the Social tab, tap ⊕ at the top.",
        look: [
          { style: "field", label: "How was golf today?", icon: "chatbubble-outline" },
          { style: "outline", label: "Photo", icon: "camera-outline" },
          { style: "outline", label: "My round", icon: "trophy-outline" },
        ],
        go: { label: "Social", to: "/feed" },
      },
      {
        title: "Pick what you're sharing",
        body: "Choose a kind of post. A round, hole or shot has golf details to fill in — your score, the club, how it finished.",
        choices: [
          { icon: "chatbubble-ellipses", label: "General post", blurb: "Share a thought, photo or update." },
          { icon: "trophy", label: "Share a round", blurb: "Your score and stats, with photos." },
          { icon: "flag", label: "Share a hole", blurb: "A hole, a score, a moment." },
          { icon: "golf", label: "Share a shot", blurb: "A great (or unlucky) shot." },
        ],
      },
      {
        title: "Photos, words and who sees it",
        body: "Add up to 6 photos, or one video, and a caption. Under Who can see this, choose All PinPals members or My connections only. Tap Post.",
        look: [
          { style: "outline", label: "Photos", icon: "images-outline" },
          { style: "outline", label: "My connections only" },
          { style: "primary", label: "Post" },
        ],
      },
      {
        title: "React, comment and share",
        body: "Tap the flag on a post for Great Shot, or hold it for On Fire, Nice Round and more. Comment — type @ to mention someone. Share sends it to a chat or out to WhatsApp and Instagram.",
        look: [
          { style: "outline", label: "Great Shot", icon: "flag" },
          { style: "outline", label: "Comment", icon: "chatbubble-outline" },
          { style: "outline", label: "Share", icon: "share-outline" },
        ],
      },
      {
        title: "Rate a course",
        body: "Tap Review on Home, find the course, and give it stars. Tick what stood out — greens, views, value — add a line, and tap Post review.",
        look: [
          { style: "outline", label: "★★★★☆" },
          { style: "outline", label: "Greens" },
          { style: "primary", label: "Post review" },
        ],
        go: { label: "Rate a course", to: "/rate-course" },
      },
    ],
  },
];

/** The big picture on the guides page, for each kind of group. */
export const GUIDE_JOURNEY: Record<Audience, { guide: string; icon: Icon; label: string }[]> = {
  friends: [
    { guide: "start", icon: "people", label: "Start a crew" },
    { guide: "event", icon: "calendar", label: "Plan a day out" },
    { guide: "round", icon: "golf", label: "Play the round" },
  ],
  trip: [
    { guide: "start", icon: "airplane", label: "Set up the trip" },
    { guide: "event", icon: "map", label: "Plan the days" },
    { guide: "round", icon: "golf", label: "Play the rounds" },
  ],
  society: [
    { guide: "start", icon: "trophy", label: "Set up a society" },
    { guide: "event", icon: "calendar", label: "Create an event" },
    { guide: "round", icon: "golf", label: "Play the round" },
  ],
};

/**
 * What changed in the guides, newest first. Add a line whenever a guide is
 * updated, so members who read it before can see what's different.
 */
export const GUIDE_CHANGES: { on: string; text: string }[] = [
  { on: "2026-10-16", text: "Tee times: tapping an alert about a request or an offer now opens that one round — the tee time with Confirm my place on it, or the requests for that round — instead of the whole list." },
  { on: "2026-10-16", text: "Score a game live: new step, Score from your Apple Watch — your round on your wrist with the distance to the green; Digital Crown or − / +, then Save; swipe left for your card." },
  { on: "2026-10-16", text: "Score a game live: the scorecard photo is now inside Share scorecard (My card as a photo) and a card's Send (Photo of the card), instead of its own button." },
  { on: "2026-10-16", text: "Score a game live: Leaderboard, finish and share — new Save photo on a scorecard puts the whole card in your Photos as a picture, ready for Instagram or WhatsApp." },
  { on: "2026-10-16", text: "Score a game live: new step, Or say the scores — tap Say scores and say the group's scores, check them, Save. Score from your lock screen: the mic opens it listening, and the yardage to the green opens the hole map." },
  { on: "2026-10-16", text: "Score a game live: new step, Score from your lock screen — on an iPhone, save your own score with − / + and Save without unlocking; Picked up and Undo underneath." },
  { on: "2026-10-15", text: "Hole map: drag the bottom panel down to see more of the map; the wind now blows across the whole screen." },
  { on: "2026-10-15", text: "Hole map: tap the wind to see it blowing across the map (one to three chevrons for its strength); distance labels stay on screen when you zoom in; how far you are from the tee shows under the numbers." },
  { on: "2026-10-15", text: "Mark shot: the club you tap is saved to your round; longest shot with each club shows under the scorecard and in My bag." },
  { on: "2026-10-15", text: "Hole map: new steps — Check the wind (arrow, speed, Plays like), Get a club for the shot (My bag), Show distance arcs, Local knowledge tips in Hazards and more, and Which club? after Mark shot." },
  { on: "2026-10-15", text: "Hole map: no change to the member steps — the new Save for everyone button (cloud) shows only for super admins, to keep a corrected flag or tee." },
  { on: "2026-10-15", text: "New guide: Play in a league, ladder or open — enter, arrange and report matchplay, the knockout, ladder challenges, opens and finding a partner, and running one for your group." },
  { on: "2026-10-15", text: "Run your society: new step, Run it from a computer — society admin on the website at pinpals.ie/society, with your PinPals login." },
  { on: "2026-10-15", text: "Score a game live: new last step, Put the leaderboard on a TV — Show on TV, the code from pinpals.ie/tv, or share the TV link." },
  { on: "2026-10-14", text: "Score a game live: when a course has a saved card, a tee is now picked for you so the stroke indexes are filled in (choose Other tees for a blank card). In a society day, a stroke index entered on one card now fills in on every group's card." },
  { on: "2026-10-14", text: "New guide: Get a place on an event — join or request a place, the waiting list, guests and paying. Create an event: how members get a place, the day's details, answering requests. Run your society: committee roles, annual membership, money, exports, noticeboard and messages, order of merit." },
  { on: "2026-10-14", text: "Score a game live: start from a tee time with Start live scoring — your fourball is added, untick anyone not playing. The Hole map button is now Yardage & shot map. Find PinPals: your QR code is on Home too." },
  { on: "2026-10-13", text: "Publish the results: Past results on a group's page now folds away (tap to open, See all results for the full list), and the results page ends with a Saved panel and Back to Home / Back to the group." },
  { on: "2026-10-13", text: "Publish the results: amend a card (shown as Amended) and show results on your group's page under Past results. Play a round together: certify a foursomes or scramble pair's card." },
  { on: "2026-10-13", text: "New guide: Publish the results — 1st, 2nd and 3rd with R&A countbacks, divisions, prizes, publishing and sharing." },
  { on: "2026-10-13", text: "Foursomes (Scotch foursomes) as Stableford or stroke play: in Start a Game and From a Group — pairs on one leaderboard, half the pair's combined handicaps." },
  { on: "2026-10-13", text: "New guide: Your mobile and privacy — add your mobile, share it with your society, download your data." },
  { on: "2026-10-13", text: "Run your society: Phone numbers — call, text or WhatsApp members who share their mobile." },
  { on: "2026-10-13", text: "Score a game live: shows the real Live Scoring, Start a Game, Match Day and From a Group cards, and which to tap for friends, trips or societies." },
  { on: "2026-10-13", text: "Guides are now written for friends, golf trips or societies — pick yours at the top." },
  { on: "2026-10-13", text: "New guides: posting a tee time, finding a game, live scoring, the hole map, messages, finding friends, selling, buying and Social." },
  { on: "2026-10-13", text: "New guide: Fill a place in your round — invite a PinPal or send a link to an open place." },
  { on: "2026-10-13", text: "Groups is now called Groups & societies, in the menu and on Home." },
  { on: "2026-10-13", text: "Create an event: new step, Add guests. Guests now go on published tee times and can be marked paid." },
  { on: "2026-10-13", text: "Guides added: setting up and running a society, joining one, events and trips, and playing a round together." },
];

export const isAudience = (v: unknown): v is Audience => v === "friends" || v === "trip" || v === "society";

/** Older links used "society" for the set-up guide. */
const RENAMED: Record<string, string> = { society: "start" };

export function guideById(id: string): Guide | undefined {
  const key = RENAMED[id] ?? id;
  return GUIDES.find((g) => g.id === key);
}

export const guideShown = (g: Guide, a: Audience): boolean => !g.audiences || g.audiences.includes(a);

/** A guide as `a` reads it: their title, their steps, their wording. Null if it isn't for them. */
export function resolveGuide(g: Guide, a: Audience): ResolvedGuide | null {
  if (!guideShown(g, a)) return null;
  const head = g.as?.[a] ?? {};
  const steps = g.steps
    .filter((s) => !s.only || s.only.includes(a))
    .map(({ only: _only, as, ...base }) => ({ ...base, ...(as?.[a] ?? {}) }));
  const next = g.next ? guideById(g.next) : undefined;
  return {
    id: g.id,
    section: g.section,
    icon: g.icon,
    tone: g.tone,
    title: head.title ?? g.title,
    blurb: head.blurb ?? g.blurb,
    audience: head.audience ?? g.audience,
    next: next && guideShown(next, a) ? next.id : undefined,
    steps,
  };
}
