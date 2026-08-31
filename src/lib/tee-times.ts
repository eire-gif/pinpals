import type { InterestStatus, InviteStatus } from "./types";

export const SPACES_OPTIONS = [1, 2, 3] as const;

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
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
};

export const INTEREST_STATUS_STYLES: Record<InterestStatus, string> = {
  pending: "bg-cream-100 text-ink-900",
  accepted: "bg-green-100 text-green-800",
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
