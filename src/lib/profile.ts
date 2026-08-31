import type { Profile } from "./types";

// The optional fields that make up a "complete" Pinpals profile. First and
// last name aren't included — they're required at signup, so every member
// starts at a non-zero baseline once these are filled in too.
const COMPLETION_FIELDS: ReadonlyArray<keyof Profile> = [
  "home_club",
  "county",
  "handicap",
  "bio",
  "gui_membership_number",
];

export function profileCompletion(profile: Pick<Profile, (typeof COMPLETION_FIELDS)[number]> | null): number {
  if (!profile) return 0;
  const filled = COMPLETION_FIELDS.filter((field) => {
    const value = profile[field];
    return value !== null && value !== undefined && value !== "";
  }).length;
  return Math.round((filled / COMPLETION_FIELDS.length) * 100);
}
