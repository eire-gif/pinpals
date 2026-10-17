// Live activity (0161) — the pure half: which section of PinPals a page or
// app screen belongs to, and checking a ping before it goes anywhere near the
// database. No Supabase, no Next.js, so it's unit-tested on its own.
//
// The same section keys are used by the website (activity-beacon.tsx) and the
// app (mobile/src/lib/activity.ts), so the admin panel can show one "where are
// people right now" breakdown across both.

export const ACTIVITY_SECTIONS = [
  "home",
  "live",
  "tee_times",
  "groups",
  "marketplace",
  "social",
  "messages",
  "courses",
  "profile",
  "news",
  "rules",
  "sign_up",
  "other",
] as const;

export type ActivitySection = (typeof ACTIVITY_SECTIONS)[number];

export const SECTION_LABELS: Record<ActivitySection, string> = {
  home: "Home",
  live: "Live scoring & scorecards",
  tee_times: "Tee times",
  groups: "Groups, societies & events",
  marketplace: "Marketplace",
  social: "Social feed",
  messages: "Messages & inbox",
  courses: "Courses",
  profile: "Profiles & members",
  news: "News",
  rules: "Rules of Golf",
  sign_up: "Sign up & log in",
  other: "Everything else",
};

export const ACTIVITY_PLATFORMS = ["web", "ios", "android"] as const;
export type ActivityPlatform = (typeof ACTIVITY_PLATFORMS)[number];

// First path segment → section. Anything not listed is "other".
const WEB_SECTIONS: Record<string, ActivitySection> = {
  "": "home",
  dashboard: "home",
  live: "live",
  scorecards: "live",
  results: "live",
  c: "live",
  "tee-times": "tee_times",
  t: "tee_times",
  groups: "groups",
  society: "groups",
  community: "groups",
  marketplace: "marketplace",
  "marketplace-preview": "marketplace",
  shops: "marketplace",
  checkout: "marketplace",
  feed: "social",
  s: "social",
  inbox: "messages",
  conversations: "messages",
  notifications: "messages",
  courses: "courses",
  profile: "profile",
  members: "profile",
  connections: "profile",
  news: "news",
  rules: "rules",
  signup: "sign_up",
  login: "sign_up",
  join: "sign_up",
  "forgot-password": "sign_up",
  "reset-password": "sign_up",
  "two-step": "sign_up",
};

/** Pages that never ping: the admin console (staff would inflate the
 *  numbers), clubhouse TV screens (they'd show as "online" all day) and the
 *  auth callback hops. */
export function isUntrackedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  const first = pathname.split("/")[1] ?? "";
  return first === "admin" || first === "tv" || first === "auth" || first === "api";
}

export function sectionForWebPath(pathname: string | null | undefined): ActivitySection {
  const first = (pathname ?? "/").split("?")[0].split("/")[1] ?? "";
  return WEB_SECTIONS[first] ?? "other";
}

export type ActivityPing = {
  session: string;
  platform: ActivityPlatform;
  section: ActivitySection;
  view: boolean;
  install: string | null;
  appVersion: string | null;
};

const ID_RE = /^[A-Za-z0-9-]{16,64}$/;

/** Checks a ping's body. Returns null for anything malformed — the route
 *  answers 204 either way, so a bad client learns nothing and breaks nothing. */
export function parseActivityPing(body: unknown): ActivityPing | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.session !== "string" || !ID_RE.test(b.session)) return null;
  if (typeof b.platform !== "string" || !(ACTIVITY_PLATFORMS as readonly string[]).includes(b.platform)) return null;
  const section = (ACTIVITY_SECTIONS as readonly string[]).includes(b.section as string)
    ? (b.section as ActivitySection)
    : "other";
  const platform = b.platform as ActivityPlatform;
  const install =
    platform !== "web" && typeof b.install === "string" && ID_RE.test(b.install) ? b.install : null;
  const appVersion =
    platform !== "web" && typeof b.appVersion === "string" && /^[\w.\- ()]{1,40}$/.test(b.appVersion)
      ? b.appVersion
      : null;
  return { session: b.session, platform, section, view: b.view === true, install, appVersion };
}
