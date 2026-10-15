/**
 * The society console's people pages (members, committee, handicaps,
 * settings) — the words and the small decisions about which buttons to draw.
 * Pure, tested in people-rules.test.ts.
 *
 * As everywhere in the console, the database decides: these only keep a
 * button off the page when its function would refuse it anyway.
 *
 *   remove_group_member (0120)  owner: anyone but themselves; admin
 *                               (captain/secretary): ordinary members only
 *   set_group_office (0144)     the owner only
 *   set_group_role (0122)       the owner only; in a society no plain admin
 *   group_invite_code /
 *   reset_group_invite_code     owner and admins (a society's members never
 *                               invite — update_group keeps it off)
 *   group_can_style (0144)      owner, captain, secretary
 *   delete_group (0120)         the owner only
 */

import { GROUP_OFFICES, OFFICE_LABELS, SINGLE_OFFICES, type GroupOffice, type GroupRole } from "./rules";

export type MembershipFilter = "all" | "paid" | "unpaid" | "claimed" | "honorary" | "lapsed";
export const MEMBERSHIP_FILTERS: { key: MembershipFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid up" },
  { key: "unpaid", label: "Unpaid" },
  { key: "claimed", label: "Says paid" },
  { key: "honorary", label: "Honorary" },
  { key: "lapsed", label: "Lapsed" },
];
export const isMembershipFilter = (v: unknown): v is MembershipFilter => typeof v === "string" && MEMBERSHIP_FILTERS.some((f) => f.key === v);

/** Every word typed must appear in the name or home club (as the app's search). */
export function matchesSearch(q: string | null | undefined, ...fields: (string | null | undefined)[]): boolean {
  const words = (q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** remove_group_member's own rule, for drawing: never the owner, never yourself. */
export function canRemove(me: { id: string; role: GroupRole }, them: { id: string; role: GroupRole }): boolean {
  if (them.id === me.id || them.role === "owner") return false;
  if (me.role === "owner") return true;
  return me.role === "admin" && them.role === "member";
}

/** What each office opens (0144's society_can), one line each. */
export const OFFICE_DUTIES: Record<GroupOffice, string> = {
  captain: "Runs the society with the secretary: events, members, money, handicaps, messages and settings.",
  secretary: "Runs the society with the captain: events, members, money, handicaps, messages and settings.",
  vice_captain: "Events and entries, and messages to members.",
  treasurer: "Money — entry fees, annual membership, who has paid — and messages to members.",
  handicap_secretary: "Sets the handicaps the society plays each member off.",
  event_organiser: "Events and entries, and messages to members. A society can have several.",
};

export type OfficeHolder = { id: string; name: string };

/** The committee, office by office, in the app's order. */
export function committeeByOffice<T extends { id: string; name: string; office: GroupOffice | null }>(members: T[]): { office: GroupOffice; label: string; duties: string; single: boolean; holders: T[] }[] {
  return GROUP_OFFICES.map((office) => ({
    office,
    label: OFFICE_LABELS[office],
    duties: OFFICE_DUTIES[office],
    single: SINGLE_OFFICES.includes(office),
    holders: members.filter((m) => m.office === office).sort((a, b) => a.name.localeCompare(b.name, "en-IE")),
  }));
}

/** The confirm shown before appointing to an office someone already holds. */
export function appointConfirm(office: GroupOffice, current: OfficeHolder | null, meId: string): string | undefined {
  if (!current || !SINGLE_OFFICES.includes(office)) return undefined;
  const label = OFFICE_LABELS[office].toLowerCase();
  return `${current.id === meId ? "You stand" : `${current.name} stands`} down as ${label}. Appoint the new ${label}?`;
}

/** Society alerts a member can switch (0143's set_society_alert_pref; the app's ALERT_PREFS). */
export type AlertPrefKind = "new_event" | "entries_closing" | "tee_times" | "payment_reminders" | "noticeboard" | "results";
export const ALERT_PREFS: { kind: AlertPrefKind; label: string; hint?: string }[] = [
  { kind: "new_event", label: "New events" },
  { kind: "entries_closing", label: "Entries closing", hint: "The day before, if you haven't entered" },
  { kind: "tee_times", label: "Tee times out · your tee time tomorrow" },
  { kind: "payment_reminders", label: "Payment reminders", hint: "At most once a week" },
  { kind: "noticeboard", label: "Noticeboard posts" },
  { kind: "results", label: "Results published" },
];

/** The app's groupNameProblem (src/lib/groups.ts), for a friendly answer before update_group's. */
export const GROUP_NAME_MAX = 60;
export const GROUP_ABOUT_MAX = 500;

/** What the society's link message says, as the app's invite screen. */
export const inviteMessage = (name: string, url: string): string => `Join ${name} on PinPals — our society, with live scoring for our rounds. Tap to join: ${url}`;

/** How the society is found (privacy is set when it is made; update_group doesn't change it). */
export const PRIVACY_LABELS: Record<string, { label: string; hint: string }> = {
  request: { label: "Found by search · ask to join", hint: "Golfers can find the society and ask to join; the owner, captain or secretary approves them." },
  invite: { label: "Invite only", hint: "Only people you invite, or who have the link, can join." },
  open: { label: "Open", hint: "Anyone can join." },
};

/** WHS individual stroke play — what society days use (the app's handicaps screen). */
export const SOCIETY_ALLOWANCE = 0.95;

/** A rating/slope/par typed into the calculator: a number in range, or null. */
export function parseCourseNumber(raw: string | null | undefined, min: number, max: number): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw.trim().replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
