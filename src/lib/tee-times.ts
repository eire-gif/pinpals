import type { InterestStatus, InviteStatus, InviteVisibility } from "./types";

export const SPACES_OPTIONS = [1, 2, 3] as const;

// ---------- Who an invite is addressed to (0065) ----------

/** The order the two choices are offered in, and the order they're listed
 * anywhere else. "everyone" first because it is the default and the common
 * case — a member posting a spare space usually wants it filled. */
export const VISIBILITY_OPTIONS = ["everyone", "connections"] as const;

export const DEFAULT_VISIBILITY: InviteVisibility = "everyone";

export const VISIBILITY_LABELS: Record<InviteVisibility, string> = {
  everyone: "All Pinpals members",
  connections: "My connections only",
};

/** The one-line explanation shown under each choice on the form. Written as
 * a consequence ("who will see this") rather than a restatement of the
 * label, because the label alone doesn't tell a new member what a connection
 * is or that they might have none yet. */
export const VISIBILITY_DESCRIPTIONS: Record<InviteVisibility, string> = {
  everyone: "Anyone browsing tee-time invites can see it and ask to join.",
  connections: "Only members you've connected with will see it. Nobody else can find it or join.",
};

/** The short form for a card badge. Only rendered for "connections" — an
 * "everyone" invite needs no badge, since that's what a member browsing the
 * public list already assumes. */
export const VISIBILITY_BADGES: Record<InviteVisibility, string | null> = {
  everyone: null,
  connections: "Connections only",
};

export function isInviteVisibility(value: string): value is InviteVisibility {
  return (VISIBILITY_OPTIONS as readonly string[]).includes(value);
}

// ---------- Ladies-only invites (0074) ----------

/** The badge, the filter label and the line in the notification email all
 * say the same three words. One constant so they can't drift into "Women
 * only" in one place and "Ladies only" in another. */
export const LADIES_ONLY_BADGE = "Ladies only";

/** What the tick box says on the post-availability form, and the line under
 * it. The description is deliberately honest about what the flag does —
 * nothing stops a man asking to join (see migration 0074 for why), and a
 * host who believed otherwise would be misled at the moment they decide
 * whether to post. */
export const LADIES_ONLY_LABEL = "Ladies only";
export const LADIES_ONLY_DESCRIPTION =
  "Shown clearly on your invite and in the email members get, so everyone knows it's a ladies' game.";

/**
 * Whether the tee-times list is filtered to ladies-only rounds.
 *
 * Only the literal "1" turns it on — the same shape the other checkbox
 * filters on that page use, and it means a hand-edited `?ladies=maybe`
 * quietly shows everything rather than filtering on a value nobody chose.
 */
export function parseLadiesOnlyFilter(value: string | undefined): boolean {
  return value === "1";
}

export const STATUS_LABELS: Record<InviteStatus, string> = {
  open: "Open",
  full: "Full",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const STATUS_STYLES: Record<InviteStatus, string> = {
  open: "bg-green-100 text-green-800",
  full: "bg-cream-100 text-ink-900",
  cancelled: "bg-red-100 text-red-600",
  completed: "bg-cream-100 text-ink-500",
};

export const INTEREST_STATUS_LABELS: Record<InterestStatus, string> = {
  pending: "Waiting for host",
  accepted: "Awaiting your confirmation",
  confirmed: "Confirmed",
  declined: "Declined",
};

export const INTEREST_STATUS_STYLES: Record<InterestStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  accepted: "bg-green-100 text-green-800",
  confirmed: "bg-green-700 text-cream-50",
  declined: "bg-red-100 text-red-600",
};

// A round on 2026-09-12 expires at the end of that day — after that it's
// just clutter, whether or not the host remembered to close it out.
export function computeExpiry(playDate: string): string {
  return new Date(`${playDate}T23:59:59`).toISOString();
}

export function formatInviteDate(playDate: string): string {
  return new Date(`${playDate}T00:00:00`).toLocaleDateString("en-IE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function formatClock(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, "0")}${period}`;
}

export function formatTimeRange(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  if (from && to) return `${formatClock(from)}–${formatClock(to)}`;
  return formatClock(from ?? to);
}

