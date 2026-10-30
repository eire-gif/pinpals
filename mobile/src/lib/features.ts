/**
 * Feature flags (Oct 2026 feed redesign, phase 12).
 *
 * Plain constants, flipped by an over-the-air update (`eas update`): no
 * remote-config service, no network call, nothing to fail at launch. That
 * suits both jobs they do:
 *
 *   KILL SWITCHES for shipped features that depend on a migration. The
 *   deploy order is migration → merge → OTA; if an OTA ever lands first (it
 *   has once), a feature can be switched off in minutes without a store
 *   build. Off means the entry point disappears — nothing already posted
 *   stops displaying, and no data is touched.
 *
 *   GATES for unfinished features. Off until their backend exists; their
 *   screens must check the flag. features.test.ts fails if one is switched
 *   on without its test being updated, so nothing half-built ships by
 *   accident.
 *
 * Post TYPES have their own rollout switch (`status` in post-details.ts),
 * because that file is shared with the website and can't import this one.
 */
export const FEATURES = {
  // ---- Kill switches (shipped, on) ----
  /** "Share your round" offers on Home, Social and played rounds (phase 7, needs 0099). */
  recapPrompts: true,
  /** Claiming an achievement in the composer (phase 8, needs 0100). Cards for
   *  achievements already posted always draw. */
  achievementClaims: true,
  /** Rounds / Courses / Highlights / Achievements on member pages (phase 10).
   *  Off: the page shows Posts only, as before. */
  profileSections: true,
  /** Video posts (0102): composing and playing clips. Also needs a binary
   *  with expo-video — see native-capabilities.ts. Off: no video button;
   *  posted videos still show their poster. */
  video: true,
  /** Live scoring (claude/live-scoring.md, needs 0103 — applied 7 Oct 2026).
   *  Off hides the Home card and the menu entry; its screens say "on its way". */
  liveScoring: true,
  /** Hole maps: satellite view, GPS yardages, shot positions (claude/hole-maps.md,
   *  needs 0108 — applied 9 Oct 2026). Off hides the round's "Hole map"
   *  button and the course page's "Hole by hole"; the screen says "on its way". */
  shotMaps: true,
  /** Scorecards (claude/scorecards.md, needs 0110 — applied 9 Oct 2026). Off
   *  hides the menu entry, the live round's "Save my scorecard" and the
   *  profile link; the screens say "on its way". */
  scorecards: true,
  /** Groups, step B (claude/groups-step-b.md, needs 0120): crews, trips and
   *  societies — members, invitations, requests and invite links. Off hides
   *  the menu entry and Home's strip; the screens say "on its way". */
  groups: true,
  /** Scorecard certification (claude/scorecard-certification.md, needs 0128):
   *  a playing partner certifies your card with Face ID / fingerprint. Off
   *  hides the panel on cards, the certify prompt after a round and the
   *  "waiting for you" list; the certify screen says "on its way". */
  scorecardCertification: true,

  /** In-app advertising (claude/advertising.md, needs 0139): takeovers, banners,
   *  sponsored posts and course partners. Also needs ad_settings.ads_enabled
   *  switched on in /admin/advertising — both must be on for any advert to
   *  show. Off: nothing is fetched and nothing draws. On since 13 Oct 2026;
   *  the master switch in /admin/advertising is the kill switch. */
  ads: true,
  /** Show on TV (claude/clubhouse-tv.md, needs 0147 and the website's /tv
   *  pages): a round or society day's leaderboard on a clubhouse TV. Off
   *  hides the Show on TV buttons; the screen says "on its way". */
  clubhouseTv: true,
  /** Competitions (claude/competitions.md, needs 0148): matchplay leagues,
   *  ladders and open competitions. Off hides the menu entry;
   *  the screens say "on its way". */
  competitions: true,
  /** Voice scoring (claude/voice-scoring.md): "Say scores" on the round screen
   *  and the lock screen card's mic. No migration: scores go through the same
   *  path as tapping them in. Also needs a binary with the speech recogniser —
   *  see native-capabilities.ts. Off hides the button and the card's mic. */
  voiceScoring: true,
  /** Follow my round (claude/follow-my-round.md, needs 0158 and the
   *  website's /follow pages): Share live on the scoring screen, and
   *  Following in Live scoring. Off hides both. */
  liveFollow: true,
  /** Junior members — 13 and over (claude/junior-members.md, needs 0159 and
   *  the website's /api/app/age/* routes and /parent page): the date of birth
   *  at sign-up, the "add your date of birth" and "waiting for your parent"
   *  screens, and hiding what under-18s can't use. Off: nothing is fetched
   *  and every member is drawn as an adult — the database still enforces the
   *  age limits whatever the app shows. */
  ageBands: true,
  /** The cash marketplace (claude/cash-marketplace.md, needs 0160): Mark as
   *  sold with a named buyer, two-way feedback, seller pages, and — while
   *  marketplace_settings.payments_enabled is off — no Buy now, Buyer
   *  Protection or payouts anywhere. Off: the marketplace behaves as before
   *  0160, with checkout. */
  cashMarketplace: true,
  /** The leaderboard card on the lock screen (claude/lock-screen-leaderboard.md):
   *  a second Live Activity under the scoring card while a round with others
   *  on it is live. No migration — it reads the watch's board route. Also needs
   *  a binary with the card (LiveBoardLiveActivity.swift); an older binary
   *  ignores it. Off: just the scoring card, as before. */
  lockScreenBoard: true,
  /** Side games (claude/side-games.md, needs 0196): Best Front 9 / Back 9 /
   *  Overall and Sixes alongside a round, with settle-up. Off hides the
   *  round screen's Side games row; the screen says "on its way". */
  sideGames: true,
  /** Course leaderboards (claude/course-boards.md, needs 0197): this week's
   *  board, Course Legend and hole champions on a course page, and the
   *  "Course leaderboards" switch in Privacy. Off hides the course page's
   *  Leaderboard row; the screens say "on its way". */
  courseBoards: true,
  /** Course Passport (claude/course-passport.md, no migration): the satellite
   *  map of courses played, badges and bucket lists. Off hides the Profile
   *  and menu entries; the screens say "on its way". */
  coursePassport: true,
  /** PinPals Wrapped (claude/wrapped.md, no migration; the share picture needs
   *  the website's /w/[token]/photo): your year in golf as story cards. Off
   *  hides the Profile and menu entries; the screen says "on its way". */
  wrapped: true,
  /** Ryder Cup mode for trips (claude/ryder-cup-mode.md, needs 0200): two
   *  teams over an overnight or abroad trip, a format for each round and one
   *  running points total. Off hides the itinerary's Cup card; the screens
   *  say "on its way". */
  tripCup: true,
  /** The trip kitty (claude/trip-kitty.md, needs 0202): who paid what on a
   *  trip, split between whom, balances and settle-up. Off hides the
   *  itinerary's Kitty card; the screens say "on its way". */
  tripKitty: true,
  /** Rivalries (claude/rivalries.md, no migration): your head-to-head record
   *  with everyone you've played against, from finished live rounds. Off
   *  hides the Profile entry; the screens say "on its way". */
  rivalries: true,

  // ---- Gates (unfinished, off) ----
  /** Shared rounds (phase 9): model only — see claude/shared-round-model.md. */
  sharedRounds: false,
  /** Memberships — Basic / Premium / Pro (claude/memberships.md, needs 0156).
   *  The plans screen, membership settings and the upgrade sheet. Also needs
   *  in-app purchases (RevenueCat, a new binary) before anyone can pay, and
   *  paid plans switched on in /admin/monetisation before anything locks.
   *  Off: nothing is fetched, every feature is allowed, and the plans screen
   *  says "on its way". */
  memberships: false,

} as const;

export type Feature = keyof typeof FEATURES;

export const isOn = (feature: Feature): boolean => FEATURES[feature];
