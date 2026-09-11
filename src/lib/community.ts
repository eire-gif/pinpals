/**
 * Who the Find Golfers directory is showing — pure, framework-free, no
 * Supabase and no Next.js, so the vocabulary and its validation can be
 * unit-tested directly (same shape as src/lib/geo.ts and
 * src/lib/notifications.ts).
 */

/**
 * The three scopes, in the order they're offered.
 *
 * "everyone" is first and is the default because it's what the page has
 * always done, and because a member with no home club and no connections
 * yet — every member on their first day — would otherwise land on an empty
 * directory and conclude the site has nobody on it.
 */
export const DIRECTORY_SCOPES = ["everyone", "club", "connections"] as const;
export type DirectoryScope = (typeof DIRECTORY_SCOPES)[number];

export const DEFAULT_SCOPE: DirectoryScope = "everyone";

export const SCOPE_LABELS: Record<DirectoryScope, string> = {
  everyone: "All members",
  club: "My club",
  connections: "My connections",
};

/** The line under each option. Says what the choice does, not what it is
 * called — the same reason the tee-time audience selector this is modelled
 * on explains "anyone browsing can see it" rather than repeating "public". */
export const SCOPE_DESCRIPTIONS: Record<DirectoryScope, string> = {
  everyone: "Every golfer on Pinpals, filtered by whatever you search for above.",
  club: "Members who play out of the same home club as you.",
  connections: "Members you've already connected with.",
};

export function isDirectoryScope(value: string): value is DirectoryScope {
  return (DIRECTORY_SCOPES as readonly string[]).includes(value);
}

/** Read the scope out of a URL search param, falling back to the default for
 * anything missing or unrecognised — the URL is user-editable, and an
 * unknown scope should quietly show the full directory rather than filter on
 * something nonsensical. */
export function parseScope(value: string | undefined): DirectoryScope {
  return value && isDirectoryScope(value) ? value : DEFAULT_SCOPE;
}
