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

  // ---- Gates (unfinished, off) ----
  /** Groups (phase 11): model only — see claude/groups-architecture.md. */
  groups: false,
  /** Shared rounds (phase 9): model only — see claude/shared-round-model.md. */
  sharedRounds: false,

} as const;

export type Feature = keyof typeof FEATURES;

export const isOn = (feature: Feature): boolean => FEATURES[feature];
