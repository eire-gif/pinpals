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
 *    start    → app/groups/index.tsx, app/groups/mine.tsx, app/groups/new.tsx, app/group/[id]/index.tsx,
 *               app/group/[id]/invite.tsx, components/group-chat-card.tsx
 *    run      → app/group/[id]/index.tsx, app/group/[id]/settings.tsx,
 *               app/group/[id]/handicaps.tsx, app/group/[id]/contacts.tsx,
 *               app/group/[id]/committee.tsx, app/group/[id]/money.tsx,
 *               app/group/[id]/membership-settings.tsx, app/group/[id]/noticeboard.tsx,
 *               app/group/[id]/message.tsx, app/group/[id]/exports.tsx, app/group/[id]/merit.tsx
 *    championship → app/group/[id]/championship/new.tsx, app/group/[id]/championship/[cid].tsx,
 *               app/group/[id]/events.tsx, app/group/[id]/outing/new.tsx,
 *               app/group/[id]/itinerary/[outingId].tsx (Run a leaderboard across the trip)
 *    cup      → app/group/[id]/itinerary/[outingId].tsx (Play it as a Ryder Cup / The Cup),
 *               app/group/[id]/cup/[outingId].tsx, app/group/[id]/cup/teams/[outingId].tsx,
 *               app/group/[id]/cup/sessions/[outingId].tsx, app/group/[id]/cup/session/[sessionId].tsx,
 *               app/(tabs)/live/day/group.tsx (Start the session)
 *    enter    → app/group/[id]/events.tsx, app/group/[id]/outing/[outingId].tsx,
 *               app/group/[id]/outing/request.tsx, app/group/[id]/membership.tsx,
 *               app/group/[id]/noticeboard.tsx
 *    join     → app/groups/find.tsx, app/groups/index.tsx, app/group/[id]/index.tsx
 *    event    → app/group/[id]/events.tsx, app/group/[id]/outing/new.tsx,
 *               app/group/[id]/outing/[outingId].tsx, components/outing-pay-card.tsx,
 *               app/group/[id]/itinerary/*, app/group/[id]/kitty/* (The kitty)
 *    round    → app/(tabs)/live/day/group.tsx, app/(tabs)/live/round/[id].tsx,
 *               app/scorecards/certify/[id].tsx
 *    results  → app/(tabs)/live/day/[id].tsx, components/results-entry.tsx,
 *               app/(tabs)/live/day/results/[id].tsx, components/group-past-results.tsx,
 *               app/group/[id]/index.tsx
 *    teePost  → app/post-tee-time.tsx, app/(tabs)/my-rounds.tsx
 *    teeJoin  → app/(tabs)/tee-times.tsx, app/invite/[id].tsx, app/(tabs)/my-rounds.tsx
 *    fill     → app/invite/[id].tsx, app/round-invite.tsx, app/tee-link.tsx
 *    live     → app/(tabs)/live/index.tsx, app/(tabs)/live/new.tsx, app/(tabs)/live/round/[id].tsx,
 *               components/voice-scores-sheet.tsx (Say scores), targets/widget (lock screen card),
 *               targets/watch (Apple Watch app),
 *               app/invite/[id].tsx (Start live scoring), app/(tabs)/live/tv.tsx,
 *               app/(tabs)/live/day/[id].tsx (Show on TV),
 *               app/(tabs)/live/share/[id].tsx, components/share-live-row.tsx,
 *               app/(tabs)/live/follow/[id].tsx (Share live / Following),
 *               app/(tabs)/live/side/[id].tsx, components/side-games-row.tsx (Side games: Skins, Wolf, Nassau too)
 *    passport → app/passport.tsx, app/passport-list.tsx, components/passport-map.tsx,
 *               app/course/board/[id].tsx, app/course/champions/[id].tsx, app/course/[id].tsx,
 *               app/privacy.tsx (Course leaderboards), app/wrapped.tsx, app/(tabs)/profile.tsx,
 *               components/fourball-connect.tsx (Send a guest their scorecard),
 *               app/rivals/index.tsx, app/rivals/[key].tsx (Your rivals)
 *    compete  → app/compete/index.tsx, app/compete/[id].tsx, app/compete/match/[id].tsx,
 *               app/compete/new.tsx, app/compete/opens.tsx, app/compete/share-open.tsx
 *    myGame   → app/my-game.tsx, app/scorecards/index.tsx, app/(tabs)/profile.tsx,
 *               app/scorecards/review/[id].tsx, app/scorecards/[id].tsx,
 *               components/stats-tap-row.tsx, components/live-stats-row.tsx (on the live round)
 *    handicap → app/handicap.tsx, components/handicap-breakdown.tsx,
 *               components/course-handicap-card.tsx (on app/course/[id].tsx),
 *               app/(tabs)/live/new.tsx (Handicap allowance, tap a plays-off figure)
 *    holeMap  → app/hole-map.tsx, components/hole-map-page.ts, components/hole-map-extras.tsx,
 *               app/my-bag.tsx, app/course/[id].tsx,
 *               app/(tabs)/live/preview.tsx, app/(tabs)/live/index.tsx (Preview a Course)
 *    messages → app/(tabs)/inbox.tsx, app/new-chat.tsx, app/new-group.tsx,
 *               app/conversation/[id].tsx, components/group-chat-bits.tsx,
 *               app/chat-settings/[id].tsx
 *    connect  → app/members.tsx, app/connections.tsx, app/invite-friends.tsx
 *    mobile   → app/privacy.tsx, app/group/[id]/contacts.tsx
 *    sell     → app/new-listing.tsx, app/listing/[id].tsx, app/mark-sold/[id].tsx,
 *               app/feedback/[id].tsx, app/(tabs)/marketplace/my-ads.tsx,
 *               app/(tabs)/marketplace/chats.tsx, app/(tabs)/marketplace/_layout.tsx,
 *               app/listing-offers/[id].tsx, app/(tabs)/inbox.tsx (Marketplace filter)
 *    buy      → app/(tabs)/marketplace/index.tsx, app/marketplace-search.tsx,
 *               app/listing/[id].tsx, app/listing-offers/[id].tsx,
 *               app/seller/[id].tsx, app/feedback/[id].tsx
 *    social   → app/(tabs)/feed.tsx, app/social-live/[id].tsx, components/live-circles.tsx, app/compose.tsx, app/new-post.tsx,
 *               app/comments/[id].tsx, app/share/[id].tsx, app/rate-course.tsx,
 *               app/reactions/[id].tsx, app/share-to-feed/[id].tsx
 *    parentApproval → app/signup.tsx, app/age/waiting.tsx, app/age/date-of-birth.tsx,
 *               app/privacy.tsx (My parent), app/listing/[id].tsx (Ask a parent)
 *
 *  UNDER 18s (junior members, 0159): tee times, Social, chat and selling are
 *  18+, PinPals (connections) 16+. Those guides say so in their badge and
 *  first step, and the app hides those screens from younger members.
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
 *   raised  — the big navy-and-gold card (Home's Live Scoring, Start a Round…)
 *   banner  — the gold bar on a group's page (Start a round)
 */
export type GuideControl = {
  style: "primary" | "outline" | "tile" | "link" | "field" | "raised" | "banner";
  label: string;
  icon?: Icon;
  /** The second line on a raised card or a banner. */
  subtitle?: string;
  /** A raised card's colour (the live hub's cards each have one). */
  tone?: "navy" | "green" | "claret";
  /** A raised card's small gold label above the title. */
  kicker?: string;
  /** A raised card's gold pill in place of the chevron ("Create"). */
  action?: string;
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
const MY_GROUPS: GuideCrumb = { icon: "grid-outline", label: "My Groups & Societies" };
const YOUR_GROUP: GuideCrumb = { icon: "shield-outline", label: "Your group" };
const EVENTS: GuideCrumb = { icon: "calendar-outline", label: "Events" };

const KIND = {
  crew: { icon: "people", label: "Golf Buddies", blurb: "Your regular fourball and friends. Up to 20, invite only, with a chat." },
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
      friends: { title: "Start Golf Buddies", blurb: "A home for your fourball: one chat, your rounds, your days out." },
      trip: { title: "Set up your golf trip", blurb: "Everyone going, one chat, and the trip's plan in one place." },
    },
    next: "event",
    steps: [
      {
        title: "Open Groups & societies",
        body: "Open the menu at the top left and tap Groups & societies. You can also tap the green Groups & Societies button on Home.",
        path: [MENU, GROUPS],
        go: { label: "Groups & societies", to: "/groups" },
      },
      {
        title: "Tap Run a Society",
        body: "In the white Start a new group panel, tap + Create on the green Run a Society button.",
        who: "Members 18 and over",
        look: [{ style: "raised", label: "Run a Society", icon: "trophy", tone: "green", subtitle: "Outings, entries, the draw and results", action: "Create" }],
        go: { label: "Run a Society", to: "/groups/new" },
        as: {
          friends: {
            title: "Tap Golf Buddies",
            body: "In the white Start a new group panel, tap + Create on the navy Golf Buddies button.",
            look: [{ style: "raised", label: "Golf Buddies", icon: "people", subtitle: "Your regular friends — one chat, your rounds", action: "Create" }],
            go: { label: "Golf Buddies", to: "/groups/new" },
          },
          trip: {
            title: "Tap Plan a Golf Trip",
            body: "In the white Start a new group panel, tap + Create on Plan a Golf Trip.",
            look: [{ style: "raised", label: "Plan a Golf Trip", icon: "airplane", tone: "claret", subtitle: "Courses, flights and itinerary in one place", action: "Create" }],
            go: { label: "Plan a Golf Trip", to: "/groups/new" },
          },
        },
      },
      {
        title: "Society is ticked",
        body: "Society is already picked — change it here if you need to. Golfers can find a society by name and ask to join, and you decide who gets in.",
        choices: [KIND.society, KIND.crew, KIND.trip],
        as: {
          friends: { title: "Golf Buddies is ticked", body: "Golf Buddies is already picked. It's invite only — just the friends you bring in.", choices: [KIND.crew, KIND.trip, KIND.society] },
          trip: { title: "Trip is ticked", body: "Trip is already picked. It's invite only — just the people going.", choices: [KIND.trip, KIND.crew, KIND.society] },
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
            title: "Name your group",
            tip: "You can change the name and description later in Settings.",
            body: "Give it a name your friends will recognise, and a line about it if you like. Tap Create group.",
            look: [
              { style: "field", label: "Saturday Golf Buddies", icon: "create-outline" },
              { style: "primary", label: "Create group" },
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
        body: "Under Run the society on the group's page, tap Invite. Share the link on WhatsApp or by text — anyone who taps it joins. Or open Add members under Members on the group's page, tick people you're connected with and send — they each get an alert to join. To search every member, use Find PinPals. Have the society's member list in a spreadsheet? Upload it on the website — pinpals.ie/society, Members, Import from spreadsheet — and everyone is emailed, joining as soon as they sign in to PinPals.",
        look: [
          { style: "primary", label: "Invite", icon: "person-add" },
          { style: "outline", label: "Find PinPals", icon: "search" },
        ],
        as: {
          friends: {
            tip: "Your group chat opens the moment you start the group. Everyone who joins is in it and sees everything said so far.",
            title: "Bring your friends in",
            body: "Tap Invite and send the link to your fourball's WhatsApp — anyone who taps it joins straight in. Friends already on PinPals: open Add members under Members, tick them and send — they get an alert to join.",
            look: [
              { style: "primary", label: "Invite", icon: "person-add" },
              { style: "primary", label: "WhatsApp", icon: "logo-whatsapp" },
            ],
          },
          trip: {
            tip: "The trip chat opens the moment you set up the trip. Everyone who joins is in it and sees everything said so far.",
            title: "Bring everyone going",
            body: "Tap Invite and drop the link in the trip's WhatsApp — everyone who taps it is in. Anyone already on PinPals: open Add members under Members, tick them and send — they get an alert to join.",
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
        path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP],
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
        body: "Under Run the society on the society's page, tap Handicaps. Enter a society handicap index for any member — it's used in your rounds instead of their own, which stays as it is.",
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
        body: "Under Run the society on the society's page, tap Phone numbers to call, text or WhatsApp members who have shared their mobile with the society. Members choose this themselves, in Privacy & security — ask them to turn it on.",
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
        body: "Everything here is also on the website: go to pinpals.ie/society, sign in with your PinPals email and password, and pick your society. Events and entries, the waiting list, the draw, payments, membership, handicaps, the noticeboard and the committee — on a big screen. Set the round up ahead in Live day (tees, card, format, start) and save it; on the day, Live day starts the round on every player's phone, shows the live scoreboard and which hole each group is on, and works out and publishes the results.",
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
      friends: { title: "Join a friend's group", blurb: "Accept the invitation or tap the link they sent." },
      trip: { title: "Join the trip", blurb: "Accept the invitation or tap the link the organiser sent." },
    },
    next: "round",
    steps: [
      {
        title: "Find a society",
        body: "In Groups & societies, tap Find a society and search by name.",
        only: ["society"],
        tip: "Under 16? Your parent adds you to their societies from their Parent dashboard instead.",
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
        body: "Invitations appear in My Groups & Societies (the bronze button shows 1 new), and as a notification. Tap Join — or tap the link you were sent. Got an email from your society? Sign up or log in with that email address and you're in — no need to tap Join.",
        look: [
          { style: "primary", label: "Join" },
          { style: "outline", label: "Decline" },
        ],
        go: { label: "My Groups & Societies", to: "/groups/mine" },
        as: {
          friends: { title: "Accept the invitation", body: "When a friend adds you, it's in My Groups & Societies and in your alerts. Tap Join. If they sent a link instead, just tap it — you're straight in." },
          trip: { title: "Accept the invitation", body: "When the organiser adds you, it's in My Groups & Societies and in your alerts. Tap Join. If they sent a link, tap it — you're straight in." },
        },
      },
      {
        title: "Find your way around",
        body: "Open the group from My Groups & Societies. The group chat is at the top: read the latest, reply right there, or tap it for the full chat. Events shows what's planned, and Start a round draws you into groups on the day.",
        only: ["friends", "trip"],
        look: [
          { style: "field", label: "Message the group…", icon: "chatbubbles-outline" },
          { style: "tile", label: "Events", icon: "calendar-outline" },
          { style: "banner", label: "Start a round", icon: "shuffle", subtitle: "Draw into groups or teams, scored live" },
        ],
        as: { trip: { body: "Open the trip from My Groups & Societies. The trip chat is at the top, with the days to go in the green bar. Events has the trip with its itinerary — your flights, room and tee times — and Start a round draws everyone on the day." } },
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
      friends: { title: "Plan a day out", blurb: "Pick a course and date, see who's in, collect the green fees.", audience: "Whoever started the group" },
      trip: { title: "Plan the trip", blurb: "Dates, rounds, rooms, flights and who's paid — day by day.", audience: "The trip's organiser" },
    },
    next: "round",
    steps: [
      {
        title: "Open your group's Events",
        body: "On your group's page, tap the Events tile, then New event.",
        path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP, EVENTS],
        look: [
          { style: "tile", label: "Events", icon: "calendar-outline" },
          { style: "primary", label: "New event", icon: "add" },
        ],
        who: "Captain or secretary",
        as: { friends: { who: "Whoever started the group" }, trip: { who: "The trip's organiser" } },
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
        title: "Keep the trip kitty",
        body: "On the trip's Itinerary, tap The kitty. Paid for green fees, taxis or dinner for the group? Tap + Add what you paid: what it was, how much, who paid and who it's split between — everyone going, or just some of you. The kitty shows what's been spent and whether you're owed or owe; Settle up lists the fewest payments that square everyone, each with Mark as paid.",
        only: ["trip", "society", "friends"],
        look: [
          { style: "outline", label: "The kitty", icon: "wallet-outline" },
          { style: "primary", label: "+ Add what you paid" },
          { style: "outline", label: "Settle up" },
        ],
        tip: "Pay each other by Revolut, bank or cash — PinPals keeps the tally, never the money. Only for overnight and abroad trips.",
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
    id: "cup",
    section: "groups",
    title: "Play the trip as a Ryder Cup",
    blurb: "Two teams for the whole trip, a format each round, one running points total.",
    icon: "trophy",
    tone: "navy",
    audience: "The trip's organiser and captains",
    as: {
      friends: { blurb: "Your buddies' trip away, two teams, one Cup.", audience: "Whoever started the group, and the captains" },
      society: { audience: "Captain or secretary, and the team captains" },
    },
    next: "round",
    steps: [
      {
        title: "Start the Cup",
        body: "Open the trip's Itinerary and tap Play it as a Ryder Cup. Name the two teams, say who holds the Cup (they keep it on a tie), choose how the teams are picked, and tap Start the Cup.",
        path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP, EVENTS],
        look: [
          { style: "outline", label: "Itinerary", icon: "map-outline" },
          { style: "outline", label: "Play it as a Ryder Cup", icon: "trophy-outline" },
          { style: "primary", label: "Start the Cup" },
        ],
        who: "The trip's organiser",
        as: { society: { who: "Captain or secretary" }, friends: { who: "Whoever started the group" } },
      },
      {
        title: "Make the teams",
        body: "On the Cup, tap Teams, then Make the teams. Put each player on a team — or tap Balance by handicap or Random draw — and tap the star to name each team's captain. With Captains pick, the two captains then take turns on their own phones: Your pick, then Pick.",
        look: [
          { style: "outline", label: "Teams" },
          { style: "outline", label: "Balance by handicap" },
          { style: "primary", label: "Pick" },
        ],
      },
      {
        title: "Plan the sessions",
        body: "Tap Sessions. Each round on the itinerary is a session: pick Fourballs, Foursomes, Greensomes or Singles, and add an afternoon session on a 36-hole day. Every match is a point, and the green box says how many win the Cup.",
        look: [
          { style: "outline", label: "Sessions" },
          { style: "outline", label: "+ Add an afternoon session (36 holes)" },
          { style: "primary", label: "Save the sessions" },
        ],
        who: "The trip's organiser",
        as: { society: { who: "Captain or secretary" }, friends: { who: "Whoever started the group" } },
      },
      {
        title: "Captains send their lineups",
        body: "Open a session from the Cup. Each captain puts their team in order with the arrows — match 1 first, in pairs for fourballs and foursomes — and taps Send the lineup. Secret pairings keep each side's order hidden until both are in.",
        look: [{ style: "primary", label: "Send the lineup" }],
        who: "Each team's captain",
      },
      {
        title: "Start the session",
        body: "On the day, open the session and tap Start the session. The matches are made from the two lineups, team against team; check the course and tees, then start the matches. Everyone scores their match as usual.",
        look: [
          { style: "primary", label: "Start the session" },
          { style: "primary", label: "Start the round" },
        ],
        who: "The trip's organiser",
        as: { society: { who: "Captain or secretary" }, friends: { who: "Whoever started the group" } },
        tip: "You can still swap players within a team in the draw before teeing off — never across the teams.",
      },
      {
        title: "Follow the Cup",
        body: "The Cup shows the running score, what each team needs, the session on the course now with every match, and If it stays like this. When it's won or kept, it says so at the top — tap Share to send the result to the group.",
        look: [
          { style: "outline", label: "The Cup", icon: "trophy-outline" },
          { style: "primary", label: "Share" },
        ],
      },
    ],
  },

  {
    id: "championship",
    section: "groups",
    title: "Run a multi-day championship",
    blurb: "2 to 4 days, a course and format each day, one leaderboard with ▲▼ on the day before.",
    icon: "podium",
    tone: "gold",
    audience: "Captain, secretary",
    as: {
      friends: { blurb: "A weekend away or a summer series between you, on one leaderboard.", audience: "Whoever started the group" },
      trip: { title: "Run a leaderboard across the trip", blurb: "Every round on the trip on one board, like the PGA.", audience: "The trip's organiser" },
    },
    next: "round",
    steps: [
      {
        title: "Start a championship",
        body: "In your group's Events, tap New event, then Multi-day championship.",
        path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP, EVENTS],
        look: [
          { style: "primary", label: "New event", icon: "add" },
          { style: "raised", label: "Multi-day championship", icon: "trophy-outline", subtitle: "2–4 days, a course and format each day" },
        ],
        who: "Captain or secretary",
        as: {
          friends: { who: "Whoever started the group" },
          trip: {
            title: "Turn on the trip's leaderboard",
            body: "Open the trip's Itinerary and switch on Run a leaderboard across the trip. Each round on the itinerary becomes a day of it — the courses and tee times come from the itinerary, so there's nothing to enter twice.",
            path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP, EVENTS],
            look: [
              { style: "outline", label: "Itinerary", icon: "map-outline" },
              { style: "outline", label: "Run a leaderboard across the trip", icon: "toggle-outline" },
            ],
            who: "The trip's organiser",
          },
        },
      },
      {
        title: "Days, courses and formats",
        body: "Pick 2, 3 or 4 days. Give each day its date, course and first tee. Choose Same every day or Different each day, then the format — Stableford, stroke play, scramble, foursomes or greensomes.",
        look: [
          { style: "outline", label: "3 days" },
          { style: "outline", label: "Different each day" },
          { style: "field", label: "Choose the course", icon: "flag-outline" },
        ],
        as: {
          trip: {
            title: "Formats on the itinerary",
            body: "Each round's format is set on its itinerary round. Matchplay rounds are played as usual but don't count on the leaderboard.",
            look: [{ style: "outline", label: "Round", icon: "flag-outline" }],
          },
        },
      },
      {
        title: "How the days add up",
        body: "The green box says how: when every day is scored the same way the scores are added up; when days mix points and strokes, each day's places earn points — 25, 20, 16, 13 and down. Team players share their team's points.",
        look: [{ style: "outline", label: "Overall: scores added up", icon: "trophy-outline" }],
        tip: "Prefer an order of merit? Switch on Use places points instead.",
      },
      {
        title: "Create it",
        body: "Tap Create, and each day appears under Events. Members tap Join all days on the leaderboard — or join day by day. Each day has its own draw and live round, just like a day out.",
        look: [
          { style: "primary", label: "Create 3-day event" },
          { style: "primary", label: "Join all 3 days" },
        ],
        as: { trip: { body: "Everyone going on the trip is on it. On each day, start the round from the itinerary as usual — its scores go straight onto the leaderboard.", look: [{ style: "outline", label: "Trip leaderboard", icon: "podium-outline" }] } },
      },
      {
        title: "Follow the leaderboard",
        body: "Open the championship from Events. Tap R1–R4 to see the board after any day; the arrows show places gained or lost since the night before. Share the TV link to put it on a screen, and add the PinPals widget to see your place from your Home Screen.",
        look: [
          { style: "outline", label: "Leaderboard & days", icon: "podium-outline" },
          { style: "outline", label: "Share the TV link", icon: "tv-outline" },
        ],
        tip: "Each day's results are published as usual; once they are, their countbacks decide the day's places.",
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
        body: "On the society's page, tap Events for the season's fixtures. Each shows where you stand: Confirmed, Requested, Waiting list, or Payment due. Tap Past for the days already played — each opens straight on its full results — the podium, the table and your place; Event details under it still opens the day itself.",
        path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP, EVENTS],
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
        body: "On your group's page, tap the gold Start a round bar. It's also in Live scoring as Groups & Societies — then tap your group under Select your group.",
        path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP],
        look: [
          { style: "banner", label: "Start a round", icon: "shuffle", subtitle: "Draw into groups or teams, scored live" },
          { style: "raised", label: "Groups & Societies", icon: "people", tone: "green", kicker: "Societies & outings", subtitle: "Draw your buddies or society into groups and teams" },
        ],
        go: { label: "Live scoring", to: "/live" },
      },
      {
        title: "Tick who's playing",
        body: "Tick each player, or Tick everyone. In a big group the list folds into one card — tap See full list of players to search, see who's not ticked, and fix any missing index; Done brings you back. Check every handicap index — a society handicap is used where the captain or secretary set one. Tap Add a guest for anyone not on PinPals — guests can go on published tee times too.",
        look: [
          { style: "link", label: "Tick everyone" },
          { style: "link", label: "See full list of players" },
          { style: "link", label: "Add a guest" },
          { style: "field", label: "Index", icon: "speedometer-outline" },
        ],
        as: {
          friends: { body: "Everyone in the group starts ticked — untick anyone not playing. Check each handicap index, and tap Add a guest for a friend who isn't on PinPals." },
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
          { icon: "swap-horizontal", label: "Greensomes Stableford or stroke play", blurb: "Pairs: both drive, play the better drive, then alternate shots. Two pairs to a tee group." },
          { icon: "git-compare", label: "Matchplay", blurb: "Singles, fourball, foursomes, greensomes." },
        ],
        tip: "Foursomes and Scotch foursomes are the same game; each pair plays off half its combined course handicaps. In greensomes a pair plays off 60% of the lower course handicap and 40% of the higher. Both are worked out for you. New to a format? Menu → Game formats explains every one.",
      },
      {
        title: "Name the day and pick when",
        body: "Give the day a name. Tap Date and scroll to a later day to set it up ahead, and tap First tee to set the start time. Choose Fourballs or Threeballs, then Tee times (groups off the 1st, so many minutes apart) or Shotgun start (every group off at once from its own hole).",
        look: [
          { style: "field", label: "Date", icon: "calendar-outline" },
          { style: "field", label: "First tee", icon: "time-outline" },
          { style: "outline", label: "Tee times" },
          { style: "outline", label: "Shotgun start" },
        ],
        tip: "A shotgun takes two groups a hole: with more groups than holes, the extra B groups go on the par 5s and 4s first. Each group's card starts on its own hole. Only whoever runs the group can set a round up for a later date.",
      },
      {
        title: "Ladies off the reds? Mixed tees",
        body: "Under Mixed tees, tick Some players play off other tees, pick the other tees and tap who plays off them. Each player's handicap comes from their own tees. Leave Adjust for the different tees on and the World Handicap System's adjustment is added for the difference in par — the app tells you how many shots.",
        look: [
          { style: "outline", label: "Red", icon: "golf" },
          { style: "outline", label: "Adjust for the different tees" },
        ],
        tip: "Members who've said in Edit profile which course ratings they play off are placed for you: ladies on the ladies' tees, each on the women's card for their tees (Red (Women), or White (Women) for a lady on the whites). Tap anyone to move them. Everyone is scored on the day's one card. Saved to My scorecards, a card goes in on the player's own tees, so the handicap record is right.",
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
        title: "Scramble or pairs? Set a team handicap by hand",
        body: "In a scramble, foursomes or greensomes, each team or pair plays off one handicap, worked out from everyone's index. Under each group in the draw you'll see Team plays off (or the pair's names). Tap it to see how it's worked out, then use − and + (or type it, +2 for a plus team) and tap Team plays off. It changes this game only.",
        look: [
          { style: "outline", label: "Team plays off", icon: "pencil" },
          { style: "primary", label: "Team plays off 7" },
          { style: "outline", label: "Use the worked-out 9" },
        ],
        tip: "A team set by hand shows a gold Set by hand mark with the worked-out figure beside it — on the card, the leaderboard, the TV and the results — so everyone can see it's fair. Swap a player in the draw and that team goes back to the worked-out figure. Once you've teed off, open the team's card, go to Leaderboard and tap Edit by the team handicap; if scores are in, you're asked first and the team is told.",
      },
      {
        title: "Keep the leaderboard secret, if you like",
        body: "Announcing the winners at a dinner? Before you start the day, tick Keep the leaderboard secret. Players then see only their own group's card, not who's winning; you see the whole board, and the TV in the clubhouse stays live. It's shown to everyone the moment you publish the results.",
        look: [{ style: "outline", label: "Keep the leaderboard secret", icon: "eye-off-outline" }],
        tip: "Forgot? Open the day's board and tap Keep the leaderboard secret, or Show it to everyone to open it up early. Only you can put a secret day on a TV.",
        as: {
          society: { tip: "The captain, secretary and event organisers see the whole board too. Forgot? Open the day's board and tap Keep the leaderboard secret, or Show it to everyone to open it up early." },
        },
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
        body: "Once every hole is in, the Score tab shows All 18 holes in, right above the card — tap Complete scorecard. When it asks Get your card certified?, tap Choose who and pick someone you played with. They confirm your scores on their own phone with Face ID or a fingerprint, and your card shows who certified it.",
        look: [
          { style: "primary", label: "Complete scorecard", icon: "checkmark-done" },
          { style: "link", label: "Choose who", icon: "finger-print" },
        ],
        tip: "When the round is finished, everyone on PinPals who played gets their card saved to My scorecards automatically — whoever tapped Complete scorecard. Scores can't be changed once the round is finished.",
      },
      {
        title: "Foursomes and scrambles: the pair's card",
        body: "Playing foursomes or a scramble, it's your pair's (or team's) card — one ball. After the last hole, tap Choose who and pick someone from the OTHER pair in your group to certify it with Face ID. Your partner can't mark your own card.",
        look: [
          { style: "link", label: "Open our pair's card", icon: "document-text-outline" },
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
        tip: "Results are for Stableford and stroke-play days, scrambles and foursomes. A match day's result is its team score, already on its board. Kept the leaderboard secret? Publishing shows it to everyone — so publish after you've read out the winners.",
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
        body: "Under Show on a group's page, pick the society, trip or Golf Buddies group. Its members can look back at the results under Past results on the group's page — tap it to open the list, or See all results for every one: the latest two shown in full, with the podium and where each member finished — even those who didn't play. A day from an event is set to that society already.",
        look: [{ style: "outline", label: "North Dublin Golf Society" }],
        as: {
          friends: { body: "Under Show on a group's page, pick your Golf Buddies group. Everyone in it can look back at the results under Past results on the group's page." },
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
    audience: "18 and over",
    next: "fill",
    steps: [
      {
        title: "Open Post a tee time",
        body: "Tap the round green + at the top of the Tee Times tab.",
        look: [{ style: "primary", label: "+", icon: "add" }],
        go: { label: "Post a tee time", to: "/post-tee-time" },
        who: "Members 18 and over — tee times aren't shown to under 18s",
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
        title: "Invite your group",
        body: "Pick 1, 2 or 3 spaces. Then, under Invite your group, tick your Golf Buddies (or a trip or society you're in). Everyone in it gets an alert and can tap Take a place — no request for you to answer. First come, first served.",
        look: [
          { style: "outline", label: "2 spaces" },
          { style: "outline", label: "Saturday Golf Buddies", icon: "checkmark-circle" },
        ],
        tip: "You get an alert as each one takes a place. Not in a group yet? Tap Start a Golf Buddies group right there.",
      },
      {
        title: "Who else can see it",
        body: "Choose All members, or My connections only for just the golfers you know. Your group is invited either way.",
        look: [
          { style: "outline", label: "All members" },
          { style: "outline", label: "My connections only" },
        ],
      },
      {
        title: "Add the extras and post",
        body: "Optional: Ladies only, Golfers with a good record only, a Handicap limit, and Notes — buggies booked, a few euro on it. Then tap Post tee time.",
        look: [
          { style: "field", label: "Notes", icon: "create-outline" },
          { style: "primary", label: "Post tee time" },
        ],
        tip: "Your connections are told straight away, and the app offers to put it in your calendar.",
      },
      {
        title: "Answer who wants to play",
        body: "When someone asks to join, you get an alert and a gold number on the Tee Times tab. Tap the alert, or My rounds at the top of Tee Times: the request is first, under Needs your answer. Tap Offer a place or Decline.",
        path: [{ icon: "golf-outline", label: "Tee Times" }, { icon: "calendar-outline", label: "My rounds" }],
        look: [
          { style: "primary", label: "Offer a place" },
          { style: "outline", label: "Decline" },
        ],
        tip: "Each request shows the golfer's record — Reliable · 18 of 18 rounds, say, or New to tee times — and a Verified badge if their club membership is checked. The best records come first. Nothing's final until they tap Confirm my place; you always choose who plays.",
        go: { label: "My rounds", to: "/my-rounds" },
      },
      {
        title: "After the round: who turned up",
        body: "For a week after the round, it sits under Played in My rounds with Who turned up? Everyone counts as there unless you tap their name to mark Didn't turn up. They're told and can dispute it. Anyone with a live scorecard from the day can't be marked.",
        path: [{ icon: "golf-outline", label: "Tee Times" }, { icon: "calendar-outline", label: "My rounds" }],
        look: [
          { style: "outline", label: "Who turned up?" },
          { style: "tile", label: "Turned up", icon: "checkmark-circle" },
        ],
        tip: "Calling a round off with players in it inside 24 hours goes on your own record as a late cancellation.",
        go: { label: "My rounds", to: "/my-rounds" },
      },
      {
        title: "Keep track on My rounds",
        body: "Every round you post is on My rounds, with who's in, the places left and what it's waiting on. Tap ••• on a round for Mark full or Cancel round. Delete is only there while nobody has asked to join — after that, cancel it, and everyone in it is told and sees it marked Cancelled.",
        look: [
          { style: "outline", label: "Share this round" },
          { style: "outline", label: "Cancel round", icon: "close-circle-outline" },
        ],
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
    audience: "18 and over",
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
        who: "Members 18 and over — under 18s don't have the Tee Times tab",
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
        body: "Tap a round to see who's playing, the host's record and notes. Tap I'm interested — the host is told and you'll hear back here. Invited with your group? Tap Take a place on the alert or the round and you're in straight away.",
        look: [
          { style: "primary", label: "I'm interested", icon: "hand-right" },
          { style: "primary", label: "Take a place", icon: "checkmark-circle" },
        ],
      },
      {
        title: "Confirm your place",
        body: "When the host offers you a place, you get an alert and a gold number on the Tee Times tab. Tap the alert, or My rounds at the top of Tee Times: the offer is first, under Needs your answer. Tap Confirm my place, or Can't make it so it goes to someone else.",
        path: [{ icon: "golf-outline", label: "Tee Times" }, { icon: "calendar-outline", label: "My rounds" }],
        look: [
          { style: "primary", label: "Confirm my place" },
          { style: "outline", label: "Can't make it" },
        ],
        tip: "Once you're in, the round shows You're playing — tap Add to calendar so the day's kept free. Turning up builds your record; hosts see it on every request, and some rounds are for golfers with a good record only.",
        go: { label: "My rounds", to: "/my-rounds" },
      },
      {
        title: "If plans change",
        body: "Changed your mind before the host answers? Tap ••• on the round in My rounds, then Withdraw request — nothing changes for them, and you can ask again later. Once you have a place, the same ••• has Cancel my place: the host is told and the space reopens. If the host cancels, the round stays on your My rounds marked Cancelled, with Find another round.",
        look: [{ style: "outline", label: "Cancel my place", icon: "exit-outline" }],
        tip: "Cancelling less than 24 hours before the tee time counts as a late cancellation on your record. Marked as a no-show by mistake? Tap I was there under the round in Played.",
        go: { label: "My rounds", to: "/my-rounds" },
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
    audience: "Host or anyone playing, 18 and over",
    steps: [
      {
        title: "Open the round",
        body: "Open My rounds from the top of Tee Times, or the menu. A round with places left has Share this round — or tap the round to open it.",
        path: [MENU, { icon: "calendar-outline", label: "My rounds" }],
        go: { label: "My rounds", to: "/my-rounds" },
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
        body: "On Home, tap the big Start a Round button. On the day of a tee time, buddies round or society outing, the card at the top of Home has Start your round here too. It's in the menu as well.",
        look: [{ style: "raised", label: "Start a Round", icon: "flag", kicker: "Live scoring", subtitle: "Score with your group, watch the leaderboard move" }],
        go: { label: "Live scoring", to: "/live" },
        tip: "Playing a tee time? Only one of you needs to start: open it and tap Start live scoring — everyone on it is added and gets an alert that opens the game. If someone already started it, the button says Open the live game. A player can only be in one game at a time: if you're already in one, Set up a round shows it at the top with Continue, Finish, and Delete if you started it.",
      },
      {
        title: "Already in a live round?",
        body: "Your round sits at the top of Live scoring, above Start your round, marked You're in a live round. Tap Continue round to carry on, Finish round to end it, or Delete round if you started it by mistake. Start a Round, Groups & Societies and Match Day Fun are locked until it's finished or deleted — one live round at a time.",
        look: [{ style: "primary", label: "Continue round", icon: "chevron-forward" }],
        tip: "Delete round is only there for whoever started the round — it removes the card and every score for everyone. A match in a society day is the organiser's to delete.",
      },
      {
        title: "Choose how you're playing",
        body: "Running the society's day? Tap Groups & Societies to draw your members into tee groups or teams. Match Day Fun runs several matches at once with a team score, Ryder Cup style. Just your own fourball? Tap Start a Round.",
        look: [{ style: "raised", label: "Start a Round", icon: "flag", subtitle: "Stableford, stroke play, foursomes, a match or a scramble" }, { style: "raised", label: "Groups & Societies", icon: "people", tone: "green", kicker: "Societies & outings", subtitle: "Draw your buddies or society into groups and teams" }, { style: "raised", label: "Match Day Fun", icon: "trophy", tone: "claret", kicker: "Team matches", subtitle: "Singles, fourballs and foursomes, Ryder Cup style" }],
        tip: "Groups & Societies is covered step by step in Play a round together. The rest of this guide is Start a Round.",
        as: {
          friends: {
            body: "Just your fourball? Tap Start a Round — that's the rest of this guide. Got Golf Buddies set up? Groups & Societies ticks everyone in it and draws you into groups.",
            look: [{ style: "raised", label: "Start a Round", icon: "flag", subtitle: "Stableford, stroke play, foursomes, a match or a scramble" }, { style: "raised", label: "Groups & Societies", icon: "people", tone: "green", kicker: "Societies & outings", subtitle: "Draw your buddies or society into groups and teams" }],
            tip: "Groups & Societies is covered step by step in Play a round together.",
          },
          trip: {
            body: "On the trip, tap Groups & Societies to draw everyone into fourballs for the day, or Match Day Fun for a team competition. Start a Round is for a quick game in your own fourball.",
            look: [{ style: "raised", label: "Start a Round", icon: "flag", subtitle: "Stableford, stroke play, foursomes, a match or a scramble" }, { style: "raised", label: "Groups & Societies", icon: "people", tone: "green", kicker: "Societies & outings", subtitle: "Draw your buddies or society into groups and teams" }, { style: "raised", label: "Match Day Fun", icon: "trophy", tone: "claret", kicker: "Team matches", subtitle: "Singles, fourballs and foursomes, Ryder Cup style" }],
          },
        },
      },
      {
        title: "Course, tees and format",
        body: "After Start a Round: search for the course and check the tees — if the course has a saved card, a tee is already picked so every stroke index is filled in. Choose 18 or 9 holes, then the format.",
        choices: [
          { icon: "stats-chart", label: "Stableford", blurb: "Points per hole." },
          { icon: "list", label: "Stroke play", blurb: "Gross and net." },
          { icon: "git-compare", label: "Singles", blurb: "One v one, hole by hole." },
          { icon: "swap-horizontal", label: "Foursomes", blurb: "Scotch foursomes: pairs, alternate shot. Then pick Stableford, Stroke play or Matchplay." },
          { icon: "people", label: "Scramble", blurb: "Teams of 2 or 4, one ball." },
        ],
        tip: "Foursomes: add two players for one pair, or four for two pairs — 1 & 2 play 3 & 4. The card shows who tees off on each hole. Stableford and stroke play show Handicap allowance under the format: 95% is the WHS recommendation, and Golf Ireland lets a group play off 100, 95, 90 or 85%. On 9 holes, enter the rating, slope and par for the nine you're playing — handicaps use half each index.",
      },
      {
        title: "Add the players and tee off",
        body: "You're in already. Tap Add a PinPal for friends on PinPals, or Add a guest for anyone else, and check each handicap index — plays-off is worked out for the course. Tap a player's plays-off figure to see how it's worked out. Tap Tee off.",
        look: [
          { style: "link", label: "Add a PinPal" },
          { style: "link", label: "Add a guest" },
          { style: "primary", label: "Tee off" },
        ],
        tip: "PinPals you add get the card and leaderboard on their own phone. Under 16? Add a PinPal shows your parent and the PinPals your parent has approved; anyone else goes in as a guest. A scramble team or foursomes pair plays off one handicap, worked out for you: tap Edit by Team plays off (or the pair's Plays off) to set it by hand for this game.",
      },
      {
        title: "Score each hole",
        body: "Each player's score starts at par plus their shots. Use − and + to set it, tap the number to confirm, and tap Next hole. Picked up? Tap NR beside the player's name — the card shows “Picked up · No return”, scored as no return (0 points in Stableford). Hold a number to clear it.",
        look: [
          { style: "outline", label: "−" },
          { style: "primary", label: "5" },
          { style: "outline", label: "+" },
          { style: "primary", label: "Next hole" },
        ],
        tip: "Tap the gold Yardage & shot map button under the hole number for front, centre and back of the green, and to mark each shot. Once a hole is scored and you walk onto the next tee, the round moves on to that hole by itself (if PinPals can use your location). On the strip of holes, a birdie shows red and an eagle or better gold.",
      },
      {
        title: "No signal? Keep scoring",
        body: "Score as normal. With no signal the card says how many scores are saved on your phone, and they send by themselves as soon as you're back in range — even if you close the app in between. Reopen PinPals in a dip and MY ROUND still opens the card saved on your phone.",
        look: [{ style: "tile", label: "No signal — 3 scores saved on your phone", icon: "cloud-offline-outline" }],
        tip: "Complete scorecard waits until every saved score has sent, so the round never finishes a hole short. The hole map opens with no signal too, with GPS distances; the satellite picture needs signal.",
      },
      {
        title: "Or say the scores",
        body: "Tap Say scores under the players and say everyone's, the way you'd tell the group: “Niamh bogey, I had par, Dec a five”. Then check each one — fix any with − and +, and tap Yes on any it wasn't sure of — and tap Save & go to the next hole.",
        look: [
          { style: "primary", label: "Say scores", icon: "mic" },
          { style: "primary", label: "Save & go to hole 8", icon: "checkmark" },
        ],
        tip: "Birdie, par, bogey, double, picked up or no return (NR), “the same” and “the rest of us par” all work. It listens on your phone, so it works with no signal on most iPhones. Nothing saves until you tap Save. Tracking your stats? Add them as you say your score — “I had a five, two putts, missed it short”.",
      },
      {
        title: "Back to your card from anywhere",
        body: "While your round is live, a green MY ROUND pill sits at the top of every screen, with the hole you're on (MY ROUND · H7). Checked a message or the marketplace mid-round? Tap it and you're straight back on your scoring.",
        look: [{ style: "primary", label: "MY ROUND · H7" }],
        tip: "It shows only for a round you're playing in — rounds you're following stay under Watch live. On a busy bar it shortens to the hole (H7), on your own card it goes still, and it's gone once the round is complete.",
      },
      {
        title: "Not sure how to play it?",
        body: "On a slope, in a bunker, in thick rough or into the wind, tap Lie help under the players. Pick the lie and you get the club, the aim and three things to do. Full guide opens the whole lesson in Training.",
        look: [{ style: "outline", label: "Lie help", icon: "help-buoy-outline" }],
        tip: "Right- or left-handed is remembered from Training, so the aim is the right way round for you.",
      },
      {
        title: "Score from your lock screen",
        body: "On an iPhone, your round appears on the lock screen once you open it. Lift the phone, use − and + if you need to, and tap Save — no need to unlock. It moves on to the next hole by itself. NR (no return, if you picked up) is underneath, and Undo takes you back to the hole you just saved. The gold mic opens the round listening, to say the group's scores, and the yardage is your distance to the centre of the green — tap it for the hole map. Playing with others? A second card underneath keeps the leaderboard — the top four with your row lit up, or the matches and the team score. ⟳ refreshes it; tap it to open the Leaderboard.",
        look: [
          { style: "outline", label: "−" },
          { style: "primary", label: "5" },
          { style: "outline", label: "+" },
          { style: "primary", label: "Save", icon: "checkmark" },
        ],
        tip: "It's your own score — or, in a foursomes or greensomes pair or a scramble team, your pair's or team's card, which either of you can save. Not for a foursomes or greensomes match. No signal? It's kept and sent when there is. The yardage needs location: PinPals asks once, and it stops when the round ends (a flag means it's the hole's length from the tee). Tap the card after the last hole and the round opens on Complete scorecard; the card goes when you tap it. The leaderboard card keeps itself up to date while the yardage is on, and after every score you save; the time on it says how fresh it is. Swipe it away and it stays away for that round. Not showing? Settings → PinPals → Live Activities.",
      },
      {
        title: "Score from your watch",
        body: "With PinPals on your Apple Watch or Wear OS watch, the round you open on your phone is on your wrist too. Swipe across: the front, centre and back of the green; the satellite hole map (tap to move the target, turn the crown to zoom); the hazards still in play; scoring; the leaderboard; and your card. To score, turn the crown (or the bezel) or use − and +, then tap Save — it moves on to the next hole. Playing with others? Tap a name, set their score, and Save all does the whole group.",
        look: [
          { style: "outline", label: "−" },
          { style: "primary", label: "4" },
          { style: "outline", label: "+" },
          { style: "primary", label: "Save all", icon: "watch-outline" },
        ],
        tip: "Anyone in the group can score the group, as in the app. In a society or competition round the watch shows distance only, no plays like (Rule 4.3). Your card page has Undo, NR (no return) and any hole to change. No signal? Scores are kept on the watch and sent when there is. Add PinPals to your watch face to see the hole and yards at a glance. Apple Watch: Watch app on your iPhone → PinPals → Install. Wear OS: Play Store on the watch → PinPals.",
      },
      {
        title: "Leaderboard, finish and share",
        body: "The Leaderboard tab updates as everyone scores. After the last hole, tap Complete scorecard — on the Score tab, or at the bottom of the Leaderboard — then get your card certified and Share scorecard to WhatsApp. For a picture of your card, choose My card as a photo, then Save Image — it goes into your Photos, ready for Instagram.",
        look: [
          { style: "outline", label: "Leaderboard" },
          { style: "primary", label: "Complete scorecard" },
          { style: "outline", label: "Share scorecard", icon: "share-outline" },
          { style: "outline", label: "My card as a photo", icon: "image-outline" },
        ],
        tip: "Any card in Menu → My scorecards does the same: tap Send, then Photo of the card. On Android, use that one — the picture opens as a download and lands in your gallery.",
      },
      {
        title: "Add side games",
        body: "Whoever started the round can add side games that run alongside the main score: Best Front 9, Best Back 9, Best Overall, Sixes (three 6-hole games, on your own or in pairs that rotate so you partner everyone once), Skins (ties carry over or are void), Wolf and Nassau (front, back and the 18 against each other, with automatic presses at two down). On the scorecard, tap Add side games, switch on the ones you play, then pick Bragging, Points or Money and the amounts.",
        look: [
          { style: "raised", label: "Add side games", icon: "trophy", subtitle: "Skins, Wolf, Nassau, Sixes and more, alongside the main game" },
          { style: "outline", label: "Pairs" },
          { style: "field", label: "Amount per game  €5" },
          { style: "primary", label: "Start side games" },
        ],
        tip: "Everything is scored on Stableford points off each player's own handicap. They need an 18-hole round where everyone plays their own ball; Sixes in pairs and Wolf need four players. Money isn't offered to anyone under 18.",
      },
      {
        title: "Play Wolf",
        body: "With Wolf on, the side games screen shows whose turn it is: the Wolf, in playing order, round and round. After the drives tap Take and a partner — better ball, two v two — or Lone Wolf, one against the other three for double. Anyone in the group can tap it for the Wolf.",
        look: [
          { style: "outline", label: "Take Ciarán" },
          { style: "primary", label: "Lone Wolf — double or nothing" },
        ],
        tip: "A hole only counts once the Wolf's pick is in. Wolf points are shown as you go; in Money each point is the amount you set.",
      },
      {
        title: "Say you're in, and settle up",
        body: "Playing for money, everyone on PinPals in the round taps I'm in on their own phone — until they do, it's for bragging rights. Side games on the scorecard shows each game live and what you'd win if it ended now. At the end it's Settle up: who won what, everyone's total, and the fewest payments to square it. Tick Mark as paid as each one's done.",
        look: [
          { style: "primary", label: "I'm in" },
          { style: "outline", label: "Mark as paid" },
          { style: "outline", label: "Send a reminder" },
        ],
        tip: "PinPals only keeps the tally — pay each other by Revolut or cash. Change the games or the amount and everyone says I'm in again.",
      },
      {
        title: "Let family or a friend follow along",
        body: "Someone at home who'd love to watch — a parent, a friend at work? While you're playing, tap Share live on the scorecard. Share a link texts them a page that updates hole by hole — no app needed. Or tick PinPals and tap Share: it opens in their app and on their Home Screen widget, and they hear about birdies and the finish.",
        look: [
          { style: "raised", label: "Share live", icon: "radio", subtitle: "Let family or a friend follow your card, hole by hole" },
          { style: "primary", label: "Share a link", icon: "link" },
          { style: "outline", label: "Send to PinPals", icon: "people" },
        ],
        tip: "They see your card and your place (\"2nd of 4\") — never anyone else's scores, and never where you are. Who's watching lists everyone, with Stop; it all stops by itself after the round. Started the round? You can share a guest's card too — handy for a junior playing as a guest. Shared with you? It's under Following in Live scoring.",
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
    id: "passport",
    section: "play",
    title: "Your passport, rivals, leaderboards and year",
    blurb: "Every course you've played on a satellite map, each course's weekly leaderboard, and your year in golf.",
    icon: "earth",
    tone: "navy",
    audience: "Everyone",
    steps: [
      {
        title: "Open your Course Passport",
        body: "On your Profile, under Golf, tap Course Passport. A gold star marks every course you've played — from your scorecards and the courses you've ticked as played. Ireland, Europe and World zoom the map; tap a star for the course. Map only, top right, hides everything under the map so you can move around it freely — Details brings it back.",
        path: [{ icon: "person-circle-outline", label: "Profile" }, { icon: "earth-outline", label: "Course Passport" }],
        look: [{ style: "outline", label: "Ireland" }, { style: "outline", label: "Europe" }, { style: "outline", label: "World" }],
        go: { label: "Course Passport", to: "/passport" },
        tip: "Close stars group into a navy circle with a number — tap it to zoom in. Your newest course is white with a gold ring.",
      },
      {
        title: "Badges and bucket lists",
        body: "Under the map: badges (All 4 Provinces, course milestones, the Links Trail, Played Abroad), your courses by province, and your bucket lists. The Irish Links Trail is twelve of the island's great links; My bucket list is the courses you've saved. Played ones tick off with the date.",
        look: [{ style: "raised", label: "Irish Links Trail · 5 of 12", icon: "list", tone: "claret", kicker: "Bucket list" }],
      },
      {
        title: "This week's leaderboard at a course",
        body: "Open any course and tap This week's leaderboard: everyone's best round there this week, Monday to Sunday, by Stableford, net or gross. Below it is the Course Legend — whoever's played there most in 90 days — and Hole champions, the best net score on each hole this month.",
        look: [{ style: "raised", label: "This week's leaderboard", icon: "podium", subtitle: "Course Legend and hole champions too" }],
        tip: "Every round you save goes on by itself — your name, score and the day, never the card. Cards set to Only me never show. Turn it off in Profile → Privacy & security → Course leaderboards.",
      },
      {
        title: "Your year in golf",
        body: "On your Profile, tap My year in golf: your rounds, best round, birdies, new courses, handicap change, partner of the year and what kind of golfer you were — as story cards. Tap the right side for the next one. The last has Share to Instagram story.",
        path: [{ icon: "person-circle-outline", label: "Profile" }, { icon: "sparkles-outline", label: "My year in golf" }],
        look: [{ style: "primary", label: "Share to Instagram story" }],
        go: { label: "My year in golf", to: "/wrapped" },
        tip: "It's built from your saved scorecards, so the more rounds you score on PinPals, the better your year looks. In January it shows the year just gone.",
      },
      {
        title: "Your rivals",
        body: "On your Profile, tap Your rivals: your record this season against everyone you've played against, your biggest rivalry on top with your last five. Tap anyone for the head to head — this season or all time, each of your best wins and every round against each other. A guest you keep playing gets Send them the record.",
        path: [{ icon: "person-circle-outline", label: "Profile" }, { icon: "flash-outline", label: "Your rivals" }],
        look: [{ style: "outline", label: "All time" }, { style: "primary", label: "Rematch — post a tee time" }],
        go: { label: "Your rivals", to: "/rivals" },
        tip: "Nothing to enter: a finished live round counts when you played against each other — a match, opposite sides of a fourball, or your own balls in the same group, net off your handicaps. Rounds as partners don't.",
      },
      {
        title: "Send a guest their scorecard",
        body: "Played with someone not on PinPals? After the round, under Your fourball, tap WhatsApp or Text message beside their name. They get their card; joining keeps the round in their scorecards and passport, and connects you.",
        look: [{ style: "primary", label: "WhatsApp" }, { style: "outline", label: "Text message" }],
        tip: "Your fourball shows how many golfers have joined from the cards you've sent.",
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
    id: "handicap",
    section: "play",
    title: "Check your handicap",
    blurb: "Your course handicap off any tee and what you play off — the Golf Ireland way.",
    icon: "calculator",
    tone: "gold",
    audience: "Everyone",
    next: "live",
    steps: [
      {
        title: "Open the handicap calculator",
        body: "In the menu, under Play, tap Handicap calculator. On a course's page, the Your handicap here card shows your course handicap off each tee — tap it to open the calculator for that course.",
        look: [{ style: "raised", label: "Handicap calculator", icon: "calculator-outline" }],
        go: { label: "Handicap calculator", to: "/handicap" },
      },
      {
        title: "Course lookup or Enter manually",
        body: "Course lookup lists every tee saved for the course: pick Men or Women, and 18 holes or 9. Not saved, or playing somewhere else? Tap Enter manually and type the slope, course rating and par off the scorecard.",
        look: [{ style: "outline", label: "Course lookup" }, { style: "outline", label: "Enter manually" }],
        tip: "Your index comes from your profile; change it in the box to try another. 9 holes uses half your index, to one decimal, with the nine's own rating, slope and par.",
      },
      {
        title: "Course handicap and plays-off",
        body: "Each tee shows your Course handicap. Pick the allowance for the competition — 95% for a singles Stableford or medal is the WHS recommendation, and Golf Ireland lets a club or society choose 100, 95, 90 or 85% — and Plays shows what you play off.",
        look: [{ style: "outline", label: "100%" }, { style: "primary", label: "95%" }, { style: "outline", label: "90%" }, { style: "outline", label: "85%" }],
      },
      {
        title: "See how it's worked out",
        body: "Tap any tee for every step: index × slope ÷ 113, plus course rating minus par, then the allowance on that exact figure, rounded once. It's the same sum a live round plays off, and it matches Golf Ireland's calculator.",
        tip: "In Start a Round, tap a player's plays-off figure for the same breakdown.",
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
        body: "On a course's page, tap a hole number under Hole by hole. In a live round, tap the gold Yardage & shot map button under the hole number. Or, before you play, use Preview a Course on Live scoring. The satellite view turns so the tee is at the bottom and the green at the top.",
        look: [
          { style: "outline", label: "1" },
          { style: "outline", label: "2" },
          { style: "primary", label: "Yardage & shot map", icon: "navigate" },
        ],
        art: "holeOverview",
      },
      {
        title: "Preview a course before you play",
        body: "On Live scoring, tap the teal Preview a Course button and pick your home club, search, or choose one near you. It opens on the 1st hole's satellite map. Swipe or use the arrows to walk the course, or tap the squares button for the Course summary — the tees, par, rating and slope, out and in — and Go to any hole. When you're ready, Start your round here opens Set up a round with the course and tees already filled in.",
        path: [{ icon: "podium-outline", label: "Live scoring" }, { icon: "map", label: "Preview a Course" }],
        look: [
          { style: "primary", label: "Start your round here", icon: "flag" },
          { style: "outline", label: "Course summary", icon: "grid" },
        ],
        go: { label: "Preview a Course", to: "/live/preview" },
        tip: "Preview a Course is open even while you're in a live round — looking round a course doesn't start a game.",
      },
      {
        title: "Read your numbers",
        body: "The panel at the bottom gives the distance to the Front, Centre and Back of the green. Within 750 m of the green they're measured from you, using your phone's GPS; further away, from the tee. Standing at your ball, the line under the numbers also says how far you are from the tee — your drive. Distances on the map stay on screen as you zoom in.",
        art: "holeNumbers",
        tip: "Par and Index are beside the hole number; the big arrows either side, or a swipe across the panel, change hole. In a round, once your score for the hole is in and you walk onto the next tee, the map moves on to that hole by itself. Drag the panel down to see more of the map — the hole and the three numbers stay. Tap yds to switch to metres.",
      },
      {
        title: "Let the map zoom in as you go",
        body: "With your location on, the map closes in as you near the flag: the whole hole from the tee, then you, the green and the hazards in between from about 250 yards, the green and its surrounds inside 100, and the green itself once you're on it. It glides in as you walk — no need to pinch.",
        look: [{ style: "outline", label: "Auto-zoom", icon: "navigate-circle" }],
        tip: "Pinch or drag the map and auto-zoom waits 15 seconds before picking up again; Show the whole hole (the square button) pulls back for 30. The round button under it turns auto-zoom off or on — your phone remembers.",
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
        title: "Playing a competition",
        body: "In a society event or competition round, Plays like and the suggested club switch off for everyone — the Rules of Golf (Rule 4.3) allow distances but not wind adjustments or club advice from a device. You still get every distance, hazards, arcs and Mark shot, and the wind forecast. Playing your club's own competition? Tap Hazards and more and tick Competition round.",
        look: [
          { style: "outline", label: "Competition round · distances only (Rule 4.3)", icon: "trophy-outline" },
          { style: "outline", label: "Hazards and more", icon: "list" },
        ],
        tip: "Yards or metres: tap the button top right — PinPals remembers your choice.",
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
        body: "In a live round, walk to your ball and tap Mark shot. The map draws each shot and how far it went. Under Which club?, tap the club you hit — it's saved to your round, and My bag learns your real distances from these. Your longest shot with each club shows under the round's scorecard and in My bag — tap one, your longest drive say, and the hole map opens on that hole with the shot drawn in gold. The undo arrow takes back the last shot.",
        art: "holeShots",
        look: [{ style: "primary", label: "Mark shot 2", icon: "locate" }],
        tip: "Distances are GPS estimates — check the course's own markers before an important shot.",
      },
    ],
  },

  {
    id: "myGame",
    section: "play",
    title: "See where your shots go",
    blurb: "My Game reads your scorecards — and, if you track them, your fairways, greens, putts and where you miss.",
    icon: "stats-chart",
    tone: "green",
    audience: "Everyone",
    steps: [
      {
        title: "Open My Game",
        body: "On your Profile, under Golf, tap My Game. It's also at the top of My scorecards, under your stats.",
        path: [{ icon: "person-circle-outline", label: "Profile" }, { icon: "stats-chart-outline", label: "My Game" }],
        go: { label: "My Game", to: "/my-game" },
      },
      {
        title: "What's costing you most",
        body: "The navy card at the top says, in plain words, what's costing you most — up to three things, the biggest first. It's worked out from the scores on your last 20 cards; nothing extra to fill in.",
        look: [{ style: "raised", label: "Doubles or worse: 2.8 a round", kicker: "WHAT'S COSTING YOU MOST", tone: "navy" }],
      },
      {
        title: "How sure it is",
        body: "Under every figure it says how much it's based on. Early read: enough to show, not yet to trust. Good read: enough to go on. With too few cards a figure stays blank and tells you how many more it needs.",
        look: [{ style: "outline", label: "Good read · 15 rounds" }],
      },
      {
        title: "Your course, hole by hole",
        body: "The course you play most is drawn hole by hole: the darker the square, the more that hole costs you on average. A hole shows once you've played it twice.",
        tip: "Team cards — foursomes, greensomes and scramble — aren't counted, and neither are holes you didn't score.",
      },
      {
        title: "Track my stats",
        body: "Want more? Under Your stats, switch on Track my stats. In a live round a small row then appears under your own score: tee shot (left, fairway, right), putts, how far your first putt was, which way you missed the green, and +1 penalty. About five taps a hole. Only you see them.",
        look: [{ style: "outline", label: "Track my stats" }],
        tip: "Greens in regulation and par saves are worked out from your score and putts — you never enter them. Tap a chosen answer again to clear it.",
      },
      {
        title: "Or just say them",
        body: "With Say scores, add your stats after your score: “I had a five, two putts, missed it short” or “bogey, hit the fairway, three putted”. They show under YOUR STATS on the check screen — tap Leave out if it heard wrong — and save with the scores.",
        look: [{ style: "outline", label: "2 putts · missed short" }],
        tip: "Only your own stats are kept: say them after “I” or your name. Penalties work too — “out of bounds”, “in the water”, “two penalty shots”.",
      },
      {
        title: "Or add them in 60 seconds",
        body: "Rather not tap while you play? Open the card in My scorecards and tap Your stats for this round. Swipe through the holes with the same taps — it opens on the first one you haven't done.",
        look: [{ style: "outline", label: "Your stats for this round · 60 seconds", icon: "stats-chart-outline" }],
      },
      {
        title: "Where your shots go",
        body: "Once you've kept stats for a round or so, Where your shots go sets your approach play, short game, putting and penalties against golfers at your goal handicap, in shots a round. The biggest one is your leak, at the top of My Game. Change your goal with − and +.",
        look: [{ style: "outline", label: "Your goal handicap  −  12  +" }],
        tip: "It's an estimate, set against Shot Scope's published averages by handicap. Length and tee shots aren't counted, so the real gap is usually a little bigger.",
      },
      {
        title: "Your practice focus",
        body: "Under it, one thing to practise for your biggest leak — a drill, and a number to move, like missed greens that finish short from 71% to 50%. It updates with every round you keep stats for.",
      },
      {
        title: "See them add up",
        body: "Your stats on My Game shows fairways hit, greens in regulation, where you miss greens, par saves, putts and penalties — with a plain-English line when something stands out, like most of your missed greens finishing short.",
        tip: "No signal on the course? Your taps are kept on the phone and sent when it's back.",
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
    audience: "16 and over",
    next: "messages",
    steps: [
      {
        title: "Open Find PinPals",
        body: "On Home, tap Find Golfers — or in the menu, Browse all members. For you suggests golfers you've played with and people at your club; search by name or club at the top.",
        path: [MENU, { icon: "search-outline", label: "Browse all members" }],
        look: [
          { style: "raised", label: "Find Golfers", icon: "search", tone: "claret", kicker: "Play", subtitle: "Golfers at your club and near you — connect and play" },
          { style: "outline", label: "For you" },
          { style: "outline", label: "My club" },
          { style: "outline", label: "Nearby" },
        ],
        go: { label: "Find PinPals", to: "/members" },
        tip: "Under 16? You don't add PinPals yourself — your parent picks who you can play with.",
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
        title: "Invite friends to join",
        body: "Tap the QR button beside your name at the top of Home, or Invite friends to PinPals in the menu. Send your link on WhatsApp or by text, or show your QR code in the clubhouse — when they join, you're connected straight away.",
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
        path: [MENU, GROUPS, MY_GROUPS, YOUR_GROUP],
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
    audience: "18 and over",
    steps: [
      {
        title: "Open your Inbox",
        body: "Tap the Inbox tab. Chats and Alerts sit at the top — tap either to see just that. Under them, Groups shows just your group and trip chats.",
        look: [
          { style: "tile", label: "Chats", icon: "chatbubbles-outline" },
          { style: "tile", label: "Alerts", icon: "notifications-outline" },
          { style: "outline", label: "Groups" },
        ],
        go: { label: "Inbox", to: "/inbox" },
        tip: "Under 18? Your Inbox shows your alerts only — chats open at 18.",
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
        tip: "For your regular fourball or a golf trip, start Golf Buddies or Plan a Golf Trip in Groups & Societies instead — the chat comes with it, along with rounds, events and the itinerary.",
      },
      {
        title: "Your group and trip chats",
        body: "Every Golf Buddies group and golf trip has its own chat, made with the group. Everyone who joins is in it and sees everything said so far. The next round is pinned at the top with I'm in, the group's rounds and events appear in the chat as cards, and + adds a photo — or, for whoever runs events, a new round. Tap the name at the top for the group's page.",
        look: [
          { style: "primary", label: "I'm in" },
          { style: "outline", label: "Add to the chat", icon: "add" },
        ],
        go: { label: "My Groups & Societies", to: "/groups/mine" },
      },
      {
        title: "Choose your alerts",
        body: "In a group chat, tap ••• at the top for Chat settings. Everything alerts you for every message. Rounds & @me only when someone @mentions you (type @ and their first name) or replies to you — new rounds, events and payments still come through. Muted, none at all.",
        look: [
          { style: "outline", label: "Everything" },
          { style: "outline", label: "Rounds & @me" },
          { style: "outline", label: "Muted" },
        ],
        tip: "Trips of eight or more start new golfers on Rounds & @me, so a busy trip chat doesn't buzz all day. Change it any time.",
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
    blurb: "List clubs and kit in a minute, meet the buyer, get paid in cash or Revolut.",
    icon: "pricetag",
    tone: "gold",
    audience: "18 and over",
    next: "buy",
    steps: [
      {
        title: "Photos and a description",
        body: "In the Marketplace, tap the green Sell button in the middle of the bottom menu (the Marketplace button on Home takes you there). Add up to 8 photos — the first is the cover — then say a bit about it under Description; the + buttons add a line for how long you've had it, any marks and what's included.",
        look: [
          { style: "primary", label: "Sell", icon: "add" },
          { style: "outline", label: "Add photos", icon: "camera-outline" },
          { style: "outline", label: "+ Any marks" },
        ],
        go: { label: "List an item", to: "/new-listing" },
      },
      {
        title: "Say what it is",
        body: "Tap a tile — Clubs (Drivers, Irons, Putters…) or Everything else golf (Bags, Trolleys, Shoes, Clothing, GPS & rangefinders, Balls, Accessories, Training aids). Some ask which kind, like Electric or Push. Or type it — “tm qi10 driver 10.5 stiff” — and tap Fill in: it jumps ahead with the brand, model, loft and shaft filled in.",
        look: [
          { style: "tile", label: "Drivers", icon: "golf" },
          { style: "tile", label: "Trolleys", icon: "cart-outline" },
          { style: "field", label: "tm qi10 driver 10.5 stiff", icon: "sparkles" },
        ],
      },
      {
        title: "Pick the brand and model",
        body: "Brand: tap a logo, search, or open All brands A–Z. Model: the brand's models, newest first — tap yours, then the exact version. Not on the list? Tap Not listed — type it. Your ad uses it straight away, and once a few sellers type the same thing it joins the list for everyone.",
        look: [
          { style: "outline", label: "TaylorMade" },
          { style: "outline", label: "Qi10 · 2024" },
          { style: "outline", label: "Not listed — type it" },
        ],
      },
      {
        title: "Condition and details",
        body: "Pick the condition — each says what it means — then only the details that matter for what you're selling: loft, shaft and hand for clubs, size for shoes and clothing.",
        look: [
          { style: "outline", label: "Excellent" },
          { style: "outline", label: "10.5°" },
          { style: "outline", label: "Stiff" },
        ],
      },
      {
        title: "Price it and post it",
        body: "Set your price — Similar ads on PinPals shows what comparable ads ask; tap Use to take the middle. Choose Fixed price or Open to offers. The title is written for you (change it if you like), and the preview shows the ad as buyers will see it. Tap Post listing — it's free and goes live straight away.",
        look: [
          { style: "field", label: "€ 180", icon: "cash-outline" },
          { style: "outline", label: "Open to offers" },
          { style: "primary", label: "Post listing · it's free" },
        ],
      },
      {
        title: "Answer questions and offers",
        body: "Under your ad, Questions & offers is public — everyone sees the same thing. Tap Answer on a question, and Accept, Counter or Decline on an offer. Private chats about the item are in Messages, on the Marketplace filter (Messages in the Marketplace's bottom menu takes you there).",
        look: [
          { style: "tile", label: "€230 offered · Open", icon: "pricetag-outline" },
          { style: "primary", label: "Accept" },
          { style: "outline", label: "Counter" },
        ],
        go: { label: "Messages", to: "/inbox" },
      },
      {
        title: "Meet up and get paid",
        body: "Agree a time — at your club is best; Suggest meeting at the club in the chat writes the message for you — and let them check it over. They pay you in cash or by Revolut. PinPals doesn't handle the money.",
        look: [{ style: "tile", label: "Meet at the club", icon: "golf-outline" }],
        tip: "Meet in daylight, somewhere people are about. Never post an item before you've been paid.",
      },
      {
        title: "Get it into Top picks",
        body: "On your ad, the Top picks card says how it works: Top picks sit above every other listing for the same club type, brand and model, with a gold PREMIUM badge. You add an ad to Top picks on the PinPals website, from My listings — it shows here as soon as it's on.",
        look: [{ style: "tile", label: "Top picks · PREMIUM", icon: "arrow-up" }],
      },
      {
        title: "Mark it sold and leave feedback",
        body: "Open My ads and tap Sold? on the ad (or Mark as sold on the listing). Pick who bought it from your chats, then tap Good or Not good for them.",
        path: [{ icon: "pricetag-outline", label: "My ads" }],
        look: [
          { style: "outline", label: "Sold?" },
          { style: "primary", label: "Mark as sold" },
          { style: "outline", label: "Good", icon: "thumbs-up-outline" },
        ],
        go: { label: "My ads", to: "/marketplace/my-ads" },
        tip: "Feedback shows on your marketplace page only, never your golf profile. Each side's stays hidden until the other leaves theirs, or a week passes.",
      },
    ],
  },

  {
    id: "buy",
    section: "market",
    title: "Buy gear safely",
    blurb: "Find second-hand clubs and kit near you, meet the seller, and pay them directly.",
    icon: "bag-handle",
    tone: "green",
    audience: "Everyone",
    steps: [
      {
        title: "Browse used gear",
        body: "Tap the Marketplace tab — it has its own bottom menu, with Home on the left to get back. Tap the search box and type it how you'd say it — “ping irons under 400 near me” — and it shows what it understood, fixes spelling and lists matches as you type. Or tap Near me, At my club or Left-handed.",
        look: [
          { style: "field", label: "tm qi10 driver under 300", icon: "search" },
          { style: "outline", label: "Used" },
          { style: "outline", label: "Filters", icon: "options-outline" },
        ],
        go: { label: "Marketplace", to: "/marketplace" },
      },
      {
        title: "Find it by club, brand and model",
        body: "Under the chips, pick in three steps: 1 Club (Drivers, Putters, Bags…), 2 Brand, then 3 Model — each with how many are for sale. The listings are always below and narrow as you pick; skip any step. Tap a finished step to go back to it. Top picks, at the top of the listings, are adverts sellers paid to show first — each says PREMIUM.",
        look: [
          { style: "outline", label: "1 Club · Drivers" },
          { style: "outline", label: "2 Brand · PING" },
          { style: "primary", label: "3 Model · G430" },
          { style: "tile", label: "Top picks", icon: "arrow-up" },
        ],
        go: { label: "Marketplace", to: "/marketplace" },
      },
      {
        title: "Check the seller",
        body: "On the listing, the seller's card shows their feedback from other buyers, how many sales they've made and a Verified badge if their club membership is checked. Tap it to read what people said.",
        look: [{ style: "tile", label: "100% positive · 12 sales", icon: "thumbs-up-outline" }],
      },
      {
        title: "Ask, offer or message",
        body: "Questions & offers on the listing is public: ask something every buyer would want to know, or tap Make an offer and post an amount — you'll see the asking price, the highest offer and how every offer went. Tap Message to talk privately; it opens in Messages with the item pinned at the top.",
        look: [
          { style: "outline", label: "Make an offer" },
          { style: "primary", label: "Message" },
        ],
        tip: "Under 18? You'll see Ask a parent instead. Under 16, it sends the listing to your parent; 16 or 17, it opens your share sheet to send them the link.",
      },
      {
        title: "Meet, check it, pay",
        body: "Meet at a golf club if you can, look it over or hit a few balls with it, then pay the seller in cash or by Revolut. In the chat, Suggest meeting at the club writes the message for you.",
        look: [{ style: "tile", label: "Suggest meeting at the club", icon: "flag" }],
        tip: "PinPals doesn't handle payment. Never pay a deposit, a courier or with a gift card — a message asking for any of those, or with a link in it, gets a yellow warning under it.",
      },
      {
        title: "Leave feedback",
        body: "When the seller marks it sold to you, you get an alert. Tap Good or Not good, pick what went well, and send. Not you? Tap I didn't buy this.",
        look: [
          { style: "outline", label: "Good", icon: "thumbs-up-outline" },
          { style: "primary", label: "Send feedback" },
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
    audience: "18 and over",
    steps: [
      {
        title: "Start a post",
        body: "On Home, tap How was golf today? — or Photo, My round or Review under it. On the Social tab, tap Post (your photo with a +) at the start of the circles, or ⊕ at the top.",
        look: [
          { style: "field", label: "How was golf today?", icon: "chatbubble-outline" },
          { style: "outline", label: "Post", icon: "add-circle-outline" },
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
        title: "React and comment",
        body: "Tap the golf ball on a post for Great Shot, or hold it for On Fire, Nice Round, Amazing and Unlucky. Tap your reaction again to take it away. The top comments show under each post — tap the heart beside one to like it, Reply to answer, or Add a comment. Type @ to mention someone.",
        look: [
          { style: "outline", label: "Great Shot", icon: "golf" },
          { style: "outline", label: "Like", icon: "heart-outline" },
          { style: "field", label: "Add a comment…", icon: "chatbubble-outline" },
        ],
      },
      {
        title: "Watch your group live",
        body: "The circles across the top of Social show what's on now. A red LIVE circle is one of your groups' days: tap it for the leaderboard over the course photo, a gold banner when someone makes a birdie, Great Shot, and comments you can like and reply to. Green LIVE is your own round or a card someone shared with you; gold is results just published. Groups, beside For You and Following, shows posts and results from your groups.",
        look: [
          { style: "outline", label: "LIVE", icon: "radio-button-on" },
          { style: "outline", label: "Great Shot", icon: "flag" },
          { style: "outline", label: "Groups", icon: "people-outline" },
        ],
        go: { label: "Social", to: "/feed" },
        tip: "Your group's members can watch a day without playing in it — unless the organiser keeps the leaderboard secret until the prize-giving.",
      },
      {
        title: "Share a round live with everyone",
        body: "To let all of PinPals watch, turn on Share live on PinPals Social. For a society or group day, the organiser finds it on the day's leaderboard; for your own round, it's on your scorecard under Share live. Everyone on PinPals then sees a red LIVE circle on Social and can watch, give a Great Shot and comment. Turn it off at any time.",
        look: [
          { style: "outline", label: "Share live on PinPals Social", icon: "globe-outline" },
          { style: "outline", label: "LIVE", icon: "radio-button-on" },
        ],
        tip: "It's off unless you turn it on. A secret leaderboard can't be shared, and nor can a game with a member under 18 playing.",
      },
      {
        title: "See who reacted",
        body: "Under a post, tap the reactions — \"Seán Byrne and 11 others\" — to see everyone who reacted and how. Tap a reaction to see just those. Message your PinPals from the list, or tap Add PinPal for anyone else. Shares shows who shared it to their feed.",
        look: [
          { style: "outline", label: "Seán Byrne and 11 others" },
          { style: "outline", label: "Add PinPal", icon: "person-add-outline" },
        ],
      },
      {
        title: "Share a post",
        body: "Tap Share. Under Send in PinPals, tap one or more chats or PinPals (or Search), add a message and tap Send. Share to your feed puts it on your page, with a few words of your own. Or send it out on WhatsApp, Messages, Email, Facebook or X — More has Instagram and Copy.",
        look: [
          { style: "outline", label: "Share", icon: "arrow-redo-outline" },
          { style: "primary", label: "Send to 3", icon: "paper-plane" },
          { style: "outline", label: "Share to your feed", icon: "repeat" },
          { style: "outline", label: "WhatsApp", icon: "logo-whatsapp" },
        ],
        tip: "Posts for someone's connections only can be sent in a chat, but not shared to your feed. Shares are counted on the post — who sent it where is never shown.",
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

  // =========================================================================
  // Junior members (0159)
  // =========================================================================
  {
    id: "parentApproval",
    section: "people",
    title: "Under 16? Getting your parent to approve",
    blurb: "Golfers aged 13 to 15 need a parent or guardian to say yes. Here's how.",
    icon: "shield-checkmark",
    tone: "green",
    audience: "Golfers aged 13–15, and their parents",
    steps: [
      {
        title: "Add your parent's email when you join",
        body: "When you sign up, put in your date of birth. If you're under 16, a box appears for your Parent or guardian's email. We email them a link to approve your account.",
        look: [
          { style: "field", label: "Date of birth", icon: "calendar-outline" },
          { style: "field", label: "Parent or guardian's email" },
        ],
      },
      {
        title: "Wait for them to say yes",
        body: "Until they approve, you'll see Waiting for your parent. Tap Check again, or pull down, to see if they have. You can still read the Rules of Golf and browse the course directory.",
        look: [
          { style: "primary", label: "Check again" },
          { style: "outline", label: "Send again" },
          { style: "outline", label: "Change email" },
        ],
        tip: "No email? Ask them to check their spam folder, then tap Send again. Wrong address? Tap Change email.",
      },
      {
        title: "Your parent approves",
        body: "They open the link, sign in to their own PinPals account (or join — they need to be 18 or over), tick that they agree, and tap Approve. You get an alert: Your parent said yes.",
        who: "Your parent or guardian",
      },
      {
        title: "What you can use",
        body: "Live scoring, scorecards, the hole map and sharing your round live are all yours. You play with your parent, the PinPals your parent approves, and people in groups they add you to. Tee times, Social, chat and selling open at 18.",
        look: [{ style: "raised", label: "Live Scoring", subtitle: "Score with your group, watch the leaderboard move" }],
      },
      {
        title: "Something you'd like in the marketplace?",
        body: "Open the listing and tap Ask a parent — it's sent to your parent, who can buy it for you.",
        look: [{ style: "primary", label: "Ask a parent", icon: "people-outline" }],
      },
      {
        title: "For parents: the Parent dashboard",
        body: "In the menu, under Your account, tap Parent dashboard. Approve your child's account, pick the PinPals they can play with, and add them to your groups and societies.",
        path: [MENU, { icon: "shield-checkmark-outline", label: "Parent dashboard" }],
        who: "Parents and guardians",
        tip: "At 16 the parent link is no longer needed, and at 18 everything on PinPals opens up — by itself, on their birthday.",
      },
    ],
  },
];

/** The big picture on the guides page, for each kind of group. */
export const GUIDE_JOURNEY: Record<Audience, { guide: string; icon: Icon; label: string }[]> = {
  friends: [
    { guide: "start", icon: "people", label: "Start Golf Buddies" },
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
  { on: "2026-10-30", text: "Run an event / plan the trip: new step, Keep the trip kitty — on a trip's Itinerary, The kitty: add what you paid and who it's split between, see what's spent and what you're owed, and Settle up with the fewest payments." },
  { on: "2026-10-30", text: "Score a game live: side games now include Skins (ties carry over or are void), Wolf (take a partner or go Lone Wolf) and Nassau (front, back and the 18 against each other, with automatic presses). New step, Play Wolf." },
  { on: "2026-10-30", text: "Your passport, rivals, leaderboards and year: new step, Your rivals — your record against everyone you've played against (Profile → Your rivals), the head to head with each of them, and Send the record to a guest." },
  { on: "2026-10-30", text: "New guide, Play the trip as a Ryder Cup: on a trip's Itinerary, Play it as a Ryder Cup — two teams (captains pick, balanced by handicap or a random draw), a session for each round in fourballs, foursomes, greensomes or singles, secret lineups from each captain, Start the session, and one running points total with what each team needs." },
  { on: "2026-10-30", text: "Score a game live: if you're already in a live game, Set up a round shows it at the top with Continue, Finish, and Delete when you started it — the same as the Live scoring card." },
  { on: "2026-10-30", text: "Your passport, leaderboards and year: the Course Passport map has a Map only button (top right) that hides the details underneath; Details brings them back." },
  { on: "2026-10-30", text: "Score a game live: two new steps, Add side games (Best Front 9, Back 9, Overall and Sixes, alone or in rotating pairs, for bragging rights, points or money with your own amount) and Say you're in, and settle up (I'm in, live standings, the fewest payments and Mark as paid). New guide, Your passport, leaderboards and year: the Course Passport map and bucket lists, each course's weekly leaderboard with the Course Legend and hole champions, My year in golf, and sending a guest their scorecard." },
  { on: "2026-10-30", text: "Share on Social: new step, Share a round live with everyone — turn on Share live on PinPals Social (the organiser on a day's leaderboard, or a player on their own scorecard) and all of PinPals can watch on Social, give Great Shots and comment. Players in a day now see its red LIVE circle on Social too." },
  { on: "2026-10-29", text: "Use the hole map: new step, Preview a course before you play — Live scoring has a teal Preview a Course button. Pick a course and it opens on the 1st hole's satellite map, with a Course summary (tees, par, rating, out and in), Go to any hole, and Start your round here into Set up a round with the course and tees filled in. Without a round, par and index on the hole map now come from the course's saved card." },
  { on: "2026-10-28", text: "Social has a new look: circles across the top show what's on now — tap Post to share, a red LIVE circle to watch one of your groups' days full screen (leaderboard, birdie banner, Great Shot and comments with likes), green for your round or a card shared with you, gold for new results. A Groups tab sits beside For You and Following, society results appear in the feed with their comments, and the top comments show under every post with a heart to like them. A group's page shows a LIVE banner while its day is on. Share on Social: Start a post and React and comment are updated, and there's a new step, Watch your group live." },
  { on: "2026-10-26", text: "New guide, Check your handicap: Menu → Play → Handicap calculator, and Your handicap here on a course's page — course handicaps off every tee, men's or women's, 18 or 9 holes, or typed in off the card; pick the allowance; tap a tee for how it's worked out. Score a game live: Handicap allowance under Stableford and stroke play (100/95/90/85%), tap a plays-off figure for the breakdown, and 9 holes asks for the nine's own rating." },
  { on: "2026-10-25", text: "Team handicaps set by hand: in a scramble, foursomes or greensomes, tap a team's or pair's handicap — on Set up a round, a scramble day or under each group in the draw — to set it for this game. It's marked Set by hand, with the worked-out figure beside it, on the card, leaderboard, TV and results. Once you've teed off, open the card's Leaderboard tab and tap Edit; the team is told if scores are in. Play a round together: new step." },
  { on: "2026-10-24", text: "Score a game live: new step, No signal? Keep scoring — scores are saved on your phone and send by themselves when you're back in range; the round and the hole map open with no signal; Complete scorecard waits until every saved score has sent." },
  { on: "2026-10-24", text: "Post a tee time: requests show each golfer's record (Reliable · 18 of 18 rounds, or New to tee times) and Verified golfer badge, best records first; new option Golfers with a good record only; new step, After the round: who turned up. Find a game: dropping out inside 24 hours is a late cancellation, and I was there disputes a no-show." },
  { on: "2026-10-24", text: "Buy and Sell: marketplace chats open with tips for buying and selling safely and Suggest meeting at the club; a message asking for a deposit, a courier, a gift card or with a link in it gets a yellow warning. Sellers can be Verified golfers (Profile → Get the Verified badge)." },
  { on: "2026-10-24", text: "Score from your lock screen: in a round with others, a second card under the scoring card shows the leaderboard (or the matches and the team score), with your row lit up. It refreshes as you go and after every score; ⟳ refreshes it, and a tap opens the round on its Leaderboard." },
  { on: "2026-10-24", text: "Score a game live: a round you're playing in now sits at the top of Live scoring with Continue round, Finish round and Delete round. The three start buttons are locked until it's finished or deleted. New step: Already in a live round?" },
  { on: "2026-10-23", text: "Longest shots: tap one under a scorecard or in My bag — your longest drive, say — and the hole map opens on that hole, zoomed on the shot, drawn in gold with its distance. Show the whole hole zooms back out." },
  { on: "2026-10-23", text: "New guide, Run a multi-day championship: 2 to 4 days, a course and format each day, one leaderboard with each player's place up or down on the day before. Trips can switch on Run a leaderboard across the trip on the itinerary." },
  { on: "2026-10-23", text: "Hole map: auto-zoom — with your location on, the map closes in as you near the flag, from the whole hole on the tee to the green itself once you're on it, and glides as you walk. Pinch or drag and it waits; the round button under Show the whole hole turns it off." },
  { on: "2026-10-23", text: "Score a game live and Hole map: once a hole is scored and you walk onto the next tee, the round and the hole map move on to that hole by themselves. Par and Index are bigger, the hole arrows are bigger, and on the strip of holes a birdie shows red and an eagle or better gold." },
  { on: "2026-10-22", text: "Post a tee time: new step, Invite your group — tick your Golf Buddies, trip or society and everyone in it can Take a place in one tap, first come, first served. Find a game shows Take a place too." },
  { on: "2026-10-22", text: "Score a game live: Score from your watch now covers Wear OS watches as well as Apple Watch, and the watch has more pages — front, centre and back of the green, the satellite hole map, hazards, the whole group's scores (Save all) and the leaderboard — plus PinPals on your watch face." },
  { on: "2026-10-21", text: "Score a game live: new step, Back to your card from anywhere — while your round is live, the green MY ROUND pill at the top of every screen takes you straight back to your scoring." },
  { on: "2026-10-21", text: "Run your society: on the website's Live day you can now save the round's set-up (tees, card, format, start) ahead of the day, and just press Start the round on the morning." },
  { on: "2026-10-21", text: "Run your society: Run it from a computer now includes Live day on the website — choose the tees and format, start the round on every player's phone, watch the live scoreboard and publish the results from a big screen." },
  { on: "2026-10-20", text: "Score a game live: bigger names, − and + buttons and scores, easier to read on the course; NR is now beside each player's name." },
  { on: "2026-10-20", text: "Big society days: a match day now takes up to 60 matches (was 12), and a scramble or foursomes day up to 100 teams — enough for 130+ players in Blues v Golds." },
  { on: "2026-10-20", text: "Groups & Societies: Start a new group is now a white panel with a big gold + — Golf Buddies, Plan a Golf Trip and Run a Society sit inside it, each with a gold + Create button. Start a group is updated." },
  { on: "2026-10-20", text: "Run your society: Invite, Find PinPals, Phone numbers, Handicaps and Settings are now in the Run the society panel with the other committee tools, on an even grid." },
  { on: "2026-10-20", text: "Add members on a group's page: under Members, open Add members, tick your PinPals and tap Send — each gets an alert to join, and anyone already invited shows Invited. Invite your golfers is updated." },
  { on: "2026-10-19", text: "Group chats: every Golf Buddies group and golf trip has its chat from the moment it's made, and new members see everything said so far. The chat sits at the top of the group's page with a reply box; in Inbox, Groups shows just group chats. In the chat, the next round is pinned with I'm in, the group's events show as cards, + adds a photo or a round, and ••• opens Chat settings (Everything, Rounds & @me, Muted). Invite your golfers, Find your way around and Chat with your PinPals are updated." },
  { on: "2026-10-19", text: "The six tabs (Home, Tee Times, Marketplace, Social, Inbox, Profile) are now under every screen except the marketplace's own. Find PinPals, My connections and the Groups pages show their name in the coloured bar at the top; Find PinPals' QR code is top right." },
  { on: "2026-10-19", text: "Play a round together: in a group of more than 12, Who's playing folds into one card (Tick everyone, Clear, See full list of players with search) so Course, Format and the draw are right below." },
  { on: "2026-10-19", text: "Publish the results: a group's Results page now shows the latest two in full — podium, top three and where you finished — with earlier ones listed below." },
  { on: "2026-10-19", text: "Get a place on an event: in Events, Past now opens each played day straight on its full results (Event details is still there). A played day's page leads with See the results." },
  { on: "2026-10-19", text: "Groups & Societies in Live scoring opens Select your group: big cards, one per group — tap yours. The page each big Home button opens now wears its colour: green for Groups & Societies, claret for Find PinPals, bronze for Marketplace. Play a round together is updated." },
  { on: "2026-10-19", text: "My rounds now keeps the six tabs along the bottom. On Find PinPals, Bring your fourball is now Invite friends to join, with your own connections listed under it." },
  { on: "2026-10-18", text: "New here? Explore how PinPals works on Home now opens a short guide in four chapters — Find Golfers, Start a Round, Groups & Societies and Marketplace — each with a button that goes there. The how-to guides are linked at the end." },
  { on: "2026-10-18", text: "Groups & societies has four big buttons: My Groups & Societies (your groups, invitations and requests) and Golf Buddies, Plan a Golf Trip and Run a Society to start one. Crews are now called Golf Buddies. Set up a society, Join a group and the steps that open your group are updated." },
  { on: "2026-10-18", text: "Find Golfers on Home now opens Find PinPals. Find PinPals, Post a tee time and Find a game are updated." },
  { on: "2026-10-18", text: "Play a round together: when a round is finished, every member who played gets their card saved to My scorecards — not just whoever tapped Complete scorecard. After certifying someone's card, Open my card takes you to yours." },
  { on: "2026-10-18", text: "Home has four big buttons — Find Golfers, Start a Round, Groups & Societies and Marketplace — and, on the day of a round, a card at the top with Start your round here. Post a tee time, Find a game, Score a game live, Start a group, Bring your fourball and Sell your gear are updated." },
  { on: "2026-10-18", text: "Score a game live: new step, Not sure how to play it? — Lie help under the players gives the club, aim and three things to do for a slope, bunker, rough or wind. Track my stats now asks how far your first putt was, once you've tapped your putts." },
  { on: "2026-10-18", text: "See where your shots go: new step, Or just say them — with Say scores, add your stats after your score (“I had a five, two putts, missed it short”). Score a game live: Or say the scores mentions it." },
  { on: "2026-10-18", text: "See where your shots go: new steps — Where your shots go (against your goal handicap, with your biggest leak) and Your practice focus." },
  { on: "2026-10-18", text: "See where your shots go: new steps — Track my stats (a row under your score in a live round: tee shot, putts, missed green, penalty), Or add them in 60 seconds (from a saved card), and See them add up on My Game." },
  { on: "2026-10-18", text: "New guide, See where your shots go: My Game on your Profile (and at the top of My scorecards) reads your scorecards — what's costing you most, par 3s, 4s and 5s, your start, doubles, and your course hole by hole." },
  { on: "2026-10-18", text: "Mixed tees: members can say in Edit profile (or when they join) which course ratings they play off — Men's, Women's or Prefer not to say. With Mixed tees on, ladies are placed on the ladies' tees, on the women's ratings, by themselves." },
  { on: "2026-10-18", text: "Play a round together: new step, Ladies off the reds? Mixed tees — put some players on other tees; each handicap comes from their own tees, with the World Handicap System adjustment for the difference in par as an option." },
  { on: "2026-10-18", text: "Score from your lock screen now works for foursomes and greensomes pairs and scramble teams too: either of you saves the pair's card without unlocking." },
  { on: "2026-10-18", text: "Play a round together: new step, Keep the leaderboard secret — players see only their own group until you publish the results, so the winners stay a surprise for the prize-giving. The TV stays live. Publish the results mentions it too." },
  { on: "2026-10-18", text: "New: Game formats, under Menu → Play — all 41 ways to play explained in plain English, from Stableford and foursomes to scrambles, skins and Wolf, with handicap allowances and pictures. Play a round together now points to it when you choose the format." },
  { on: "2026-10-18", text: "Play a round together: new Greensomes Stableford and Greensomes stroke play (pairs both drive, play the better, then alternate), and a Shotgun start — every group off at once from its own hole, an A and a B group where needed. Choose the format and Name the day and pick when are updated." },
  { on: "2026-10-17", text: "Societies: the committee can upload the member list from a spreadsheet on the website (Members → Import from spreadsheet). Everyone is emailed, and joins the society as soon as they sign in to PinPals with that address. Set up a society and Join a society are updated." },
  { on: "2026-10-17", text: "Hole map: new step, Playing a competition — in a society event or competition round Plays like and the suggested club are off (Rule 4.3); tick Competition round under Hazards and more for any other competition. Yards or metres is now remembered." },
  { on: "2026-10-17", text: "Tee times: you can take back a request the host hasn't answered yet — Withdraw request under ••• in My rounds, or Withdraw my request on the round. Find a game is updated." },
  { on: "2026-10-17", text: "Share on Social: new steps, See who reacted — tap \"Seán Byrne and 11 others\" for everyone's reaction, with Message or Add PinPal — and Share a post: send to several chats at once, Share to your feed with a few words of your own, or straight to WhatsApp, Messages, Email, Facebook or X. Posts now show how many times they've been shared." },
  { on: "2026-10-17", text: "Tee times: one page, My rounds, for every round you host, play in, have asked to join or been offered — reached from the top of Tee Times, the menu, and every tee-time alert. Requests and offers waiting on you are first, under Needs your answer, and the Tee Times tab shows how many in gold. Post a tee time, Find a game and Fill a place are updated." },
  { on: "2026-10-17", text: "Selling is now six short steps — photos and a description, what it is (clubs or anything else golf), brand, model, details, price — with a preview of the ad before you post. A brand or model that isn't listed can be typed in, and joins the list once a few sellers use it. Sell your gear is updated." },
  { on: "2026-10-17", text: "Marketplace: find gear in three steps — club type, brand, model — with the listings always below, narrowing as you pick. Top picks, at the top, are paid adverts marked PREMIUM. Selling, you can pick the exact model. Buy gear safely and Sell your gear are updated." },
  { on: "2026-10-17", text: "Score a game live: once every hole is in, the Score tab shows All 18 holes in with Complete scorecard (it was Finish round, on the Leaderboard tab only), and the card says Complete. On the last hole with holes missing, it lists them to tap. Tapping the lock screen card after the last hole opens the round there." },
  { on: "2026-10-17", text: "Marketplace redesign: smart search that understands brands, prices, places and typos; public Questions & offers under every ad (ask, offer, and the seller accepts, counters or declines in the open); the sell form fills itself in from the title; marketplace chats are in Messages under Marketplace, with the item pinned. Sell your gear and Buy gear safely are updated." },
  { on: "2026-10-17", text: "Live scoring's three cards are renamed and colour-coded: Start a Round (navy), Groups & Societies (green, was From a Group) and Match Day Fun (claret, was Match Day). The guides show the new cards." },
  { on: "2026-10-17", text: "The marketplace has its own bottom menu (Home, Browse, Sell, Chats, My ads), and buyers pay sellers directly in cash or by Revolut. Sell your gear and Buy gear safely now cover posting for free, chatting, meeting up, Mark as sold and leaving feedback." },
  { on: "2026-10-17", text: "Score a game live: picked up is now NR (no return), a button right under each player's score (Undo NR takes it back); the card shows NR, and saying “no return” or “NR” scores it too." },
  { on: "2026-10-16", text: "PinPals is now open to golfers from 13. New guide: Under 16? Getting your parent to approve — the date of birth at sign-up, Waiting for your parent, Ask a parent in the marketplace, and the Parent dashboard." },
  { on: "2026-10-16", text: "Under 18s: tee times, Social, chats and selling are 18 and over, and finding PinPals 16 and over — those guides now say so. Score a game live: under 16s add their parent and the PinPals their parent approves. Buy gear safely: under 18s see Ask a parent." },
  { on: "2026-10-16", text: "Score a game live: new step, Let family or a friend follow along — Share live sends your card as a link anyone can open, or to PinPals in their app and widget; Who's watching has Stop, and it ends by itself after the round." },
  { on: "2026-10-16", text: "Score a game live: one game per player. If someone on your tee time has already started the game, Start live scoring becomes Open the live game, and a second game with the same players can't be started." },
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
