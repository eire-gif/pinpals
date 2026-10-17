// Which section of PinPals an app screen belongs to (0161) — pure, so it is
// unit-tested without React Native. Used by lib/activity.ts.

// Section keys — the same list as the website's src/lib/activity.ts.
export type ActivitySection =
  | "home" | "live" | "tee_times" | "groups" | "marketplace" | "social" | "messages"
  | "courses" | "profile" | "news" | "rules" | "sign_up" | "other";

const SCREEN_SECTIONS: Record<string, ActivitySection> = {
  index: "home",
  live: "live",
  scorecards: "live",
  "hole-map": "live",
  "my-rounds": "live",
  "round-invite": "live",
  "handicap-indicator": "live",
  share: "live",
  "tee-times": "tee_times",
  "post-tee-time": "tee_times",
  "tee-time-requests": "tee_times",
  "tee-link": "tee_times",
  invite: "tee_times",
  "confirmed-rounds": "tee_times",
  "offered-places": "tee_times",
  "my-requests": "tee_times",
  groups: "groups",
  group: "groups",
  "new-group": "groups",
  "join-group": "groups",
  "my-trips": "groups",
  compete: "groups",
  marketplace: "marketplace",
  listing: "marketplace",
  "new-listing": "marketplace",
  "my-listings": "marketplace",
  selling: "marketplace",
  buying: "marketplace",
  seller: "marketplace",
  store: "marketplace",
  order: "marketplace",
  checkout: "marketplace",
  "mark-sold": "marketplace",
  saved: "marketplace",
  payouts: "marketplace",
  feed: "social",
  post: "social",
  "new-post": "social",
  comments: "social",
  compose: "social",
  inbox: "messages",
  conversation: "messages",
  "new-chat": "messages",
  courses: "courses",
  course: "courses",
  "rate-course": "courses",
  profile: "profile",
  "edit-profile": "profile",
  member: "profile",
  members: "profile",
  connections: "profile",
  "find-pinpals": "profile",
  "my-bag": "profile",
  rules: "rules",
  login: "sign_up",
  signup: "sign_up",
  onboarding: "sign_up",
  join: "sign_up",
  "auth-confirm": "sign_up",
};

/** The section for a route's segments, e.g. ["(tabs)", "live"] → "live". */
export function sectionForSegments(segments: readonly string[]): ActivitySection {
  const first = segments.find((s) => !s.startsWith("(")) ?? "index";
  return SCREEN_SECTIONS[first] ?? "other";
}

