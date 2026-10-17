/**
 * The public questions & offers thread under a listing (0162), shaped for
 * display. Byte-identical in src/lib/ and mobile/src/lib/ (listing-thread.test.ts
 * checks), so the website and the app group, count and word it the same way.
 * Pure: give it the rows listing_public_posts() returns.
 */

export type ThreadPostRow = {
  id: number | string;
  kind: string;
  parent_id: number | string | null;
  author_name: string | null;
  author_initials: string | null;
  author_color: string | null;
  author_club: string | null;
  is_seller: boolean;
  is_mine: boolean;
  body: string | null;
  amount_cents: number | null;
  status: string | null;
  counter_cents: number | null;
  created_at: string;
};

export type OfferStatus = "open" | "accepted" | "declined" | "countered" | "withdrawn" | "closed";

export type ThreadReply = {
  id: number;
  authorName: string;
  initials: string;
  color: string;
  club: string | null;
  isSeller: boolean;
  isMine: boolean;
  body: string;
  createdAt: string;
};

export type ThreadEntry = ThreadReply & {
  kind: "question" | "offer";
  amountCents: number | null;
  status: OfferStatus | null;
  counterCents: number | null;
  replies: ThreadReply[];
};

export type ThreadSummary = {
  entries: ThreadEntry[];
  questions: number;
  offers: number;
  openOffers: number;
  /** The highest offer still open or countered — what a buyer has to beat. */
  highestOpenCents: number | null;
  /** Everything in the thread, replies included, for the "· 7" count. */
  total: number;
};

const OFFER_STATUSES: readonly OfferStatus[] = ["open", "accepted", "declined", "countered", "withdrawn", "closed"];

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  declined: "Declined",
  countered: "Countered",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

/** Tone for the status pill: good news, bad news, waiting, or done with. */
export const OFFER_STATUS_TONE: Record<OfferStatus, "good" | "bad" | "wait" | "muted"> = {
  open: "wait",
  accepted: "good",
  declined: "bad",
  countered: "wait",
  withdrawn: "muted",
  closed: "muted",
};

function reply(row: ThreadPostRow): ThreadReply {
  return {
    id: Number(row.id),
    authorName: row.author_name?.trim() || "A member",
    initials: (row.author_initials?.trim() || "?").slice(0, 2),
    color: row.author_color || "#123058",
    club: row.author_club,
    isSeller: row.is_seller,
    isMine: row.is_mine,
    body: row.body ?? "",
    createdAt: row.created_at,
  };
}

/** Rows (oldest first) to entries, newest entry first, replies oldest first under each. */
export function buildThread(rows: readonly ThreadPostRow[]): ThreadSummary {
  const entries = new Map<number, ThreadEntry>();
  const replies: ThreadPostRow[] = [];

  for (const row of rows) {
    if (row.kind === "reply") {
      replies.push(row);
      continue;
    }
    if (row.kind !== "question" && row.kind !== "offer") continue;
    const status = OFFER_STATUSES.includes(row.status as OfferStatus) ? (row.status as OfferStatus) : null;
    entries.set(Number(row.id), {
      ...reply(row),
      kind: row.kind,
      amountCents: row.kind === "offer" ? row.amount_cents : null,
      status: row.kind === "offer" ? status ?? "open" : null,
      counterCents: row.counter_cents,
      replies: [],
    });
  }
  for (const row of replies) entries.get(Number(row.parent_id))?.replies.push(reply(row));

  const list = [...entries.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
  const offers = list.filter((e) => e.kind === "offer");
  const live = offers.filter((e) => e.status === "open" || e.status === "countered");
  return {
    entries: list,
    questions: list.length - offers.length,
    offers: offers.length,
    openOffers: offers.filter((e) => e.status === "open").length,
    highestOpenCents: live.length ? Math.max(...live.map((e) => e.amountCents ?? 0)) : null,
    total: list.length + list.reduce((n, e) => n + e.replies.length, 0),
  };
}

export function euros(cents: number | null | undefined): string {
  if (cents == null) return "";
  return `€${cents % 100 === 0 ? (cents / 100).toLocaleString("en-IE") : (cents / 100).toFixed(2)}`;
}

/** "€230 offered", "€200 offered · seller would take €235". */
export function offerLine(entry: ThreadEntry): string {
  const base = `${euros(entry.amountCents)} offered`;
  return entry.status === "countered" && entry.counterCents ? `${base} · seller would take ${euros(entry.counterCents)}` : base;
}

/** "2h", "3d", "12 Oct" — short, for a busy thread. */
export function shortAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60000));
  if (Number.isNaN(mins)) return "";
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d`;
  return then.toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

/** Euro text a member typed ("235", "€235", "235.50") to cents, or null. */
export function parseEuroInput(raw: string): number | null {
  const cleaned = raw.replace(/[€,\s]/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents >= 100 ? cents : null;
}
