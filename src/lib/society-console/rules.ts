/**
 * The society console (/society) — who sees which tools, and the words the
 * pages use. Pure, tested in rules.test.ts.
 *
 * WHO MAY DO WHAT IS THE DATABASE'S. 0144's society_can(group, user, area)
 * decides every change, and every page and Server Action here calls the same
 * functions the app does with the member's OWN signed-in client. This file
 * only decides which links and buttons to draw, so nobody is shown a tool
 * that would be refused.
 *
 *   owner, captain, secretary   everything (role owner/admin)
 *   vice-captain                events, messages
 *   event organiser             events, messages
 *   treasurer                   money, messages
 *   handicap secretary          handicaps
 *
 * The superadmin console (/admin) is separate and untouched: this is for the
 * people who run one society, signed in with their ordinary PinPals login.
 */

export const SOCIETY_AREAS = ["events", "people", "money", "handicaps", "messages"] as const;
export type SocietyArea = (typeof SOCIETY_AREAS)[number];

export const GROUP_OFFICES = ["captain", "secretary", "vice_captain", "treasurer", "handicap_secretary", "event_organiser"] as const;
export type GroupOffice = (typeof GROUP_OFFICES)[number];
export type GroupRole = "owner" | "admin" | "member";

export const OFFICE_LABELS: Record<GroupOffice, string> = {
  captain: "Captain",
  secretary: "Secretary",
  vice_captain: "Vice-captain",
  treasurer: "Treasurer",
  handicap_secretary: "Handicap secretary",
  event_organiser: "Event organiser",
};

/** One of each, except event organisers (0144). */
export const SINGLE_OFFICES: readonly GroupOffice[] = ["captain", "secretary", "vice_captain", "treasurer", "handicap_secretary"];

export function isGroupOffice(value: unknown): value is GroupOffice {
  return typeof value === "string" && (GROUP_OFFICES as readonly string[]).includes(value);
}

export function isSocietyArea(value: unknown): value is SocietyArea {
  return typeof value === "string" && (SOCIETY_AREAS as readonly string[]).includes(value);
}

/** The same as 0144's society_can, for drawing. */
export function areasFor(role: GroupRole | null, office: GroupOffice | null): SocietyArea[] {
  if (role === "owner" || role === "admin") return [...SOCIETY_AREAS];
  switch (office) {
    case "vice_captain":
    case "event_organiser":
      return ["events", "messages"];
    case "treasurer":
      return ["money", "messages"];
    case "handicap_secretary":
      return ["handicaps"];
    default:
      return [];
  }
}

/** Runs the whole society: the owner, captain and secretary. */
export const runsSociety = (role: GroupRole | null): boolean => role === "owner" || role === "admin";

/** "Owner · Captain", "Treasurer", "Member". */
export function roleLabel(role: GroupRole, office: GroupOffice | null): string {
  const parts: string[] = [];
  if (role === "owner") parts.push("Owner");
  if (office) parts.push(OFFICE_LABELS[office]);
  else if (role === "admin") parts.push("Committee");
  return parts.length ? parts.join(" · ") : "Member";
}

// ---------------------------------------------------------------------------
// The sidebar
// ---------------------------------------------------------------------------

/**
 * `area`: shown to anyone with that area. `run`: only to the owner, captain
 * and secretary (settings, the committee — 0122/0144's own rules).
 * Neither: anyone on the committee.
 */
export type ConsoleNavItem = { slug: string; label: string; area?: SocietyArea; run?: true };
export type ConsoleNavSection = { title: string | null; items: ConsoleNavItem[] };

export const CONSOLE_NAV: ConsoleNavSection[] = [
  { title: null, items: [{ slug: "", label: "Overview" }] },
  {
    title: "Events",
    items: [
      { slug: "events", label: "Events & entries", area: "events" },
      { slug: "live", label: "Live day", area: "events" },
      { slug: "results", label: "Results" },
      { slug: "merit", label: "Order of merit" },
    ],
  },
  {
    title: "Members",
    items: [
      { slug: "members", label: "Members & requests", area: "people" },
      { slug: "members/import", label: "Import from spreadsheet", area: "people" },
      { slug: "committee", label: "Committee", run: true },
      { slug: "handicaps", label: "Handicaps", area: "handicaps" },
    ],
  },
  {
    title: "Money",
    items: [
      { slug: "money", label: "Payments", area: "money" },
      { slug: "membership", label: "Annual membership", area: "money" },
    ],
  },
  {
    title: "Communicate",
    items: [
      { slug: "noticeboard", label: "Noticeboard", area: "messages" },
      { slug: "messages", label: "Send a message", area: "messages" },
    ],
  },
  {
    title: "Society",
    items: [
      { slug: "exports", label: "Exports" },
      { slug: "settings", label: "Settings", run: true },
    ],
  },
];

export function canSee(item: Pick<ConsoleNavItem, "area" | "run">, role: GroupRole | null, areas: readonly SocietyArea[]): boolean {
  if (item.run) return runsSociety(role);
  if (item.area) return areas.includes(item.area);
  return areas.length > 0 || runsSociety(role);
}

export type ResolvedNavSection = { title: string | null; items: { href: string; label: string }[] };

export function consoleNav(groupId: number, role: GroupRole | null, areas: readonly SocietyArea[]): ResolvedNavSection[] {
  return CONSOLE_NAV.map((s) => ({
    title: s.title,
    items: s.items.filter((i) => canSee(i, role, areas)).map((i) => ({ href: consoleHref(groupId, i.slug), label: i.label })),
  })).filter((s) => s.items.length > 0);
}

export const consoleHref = (groupId: number, slug = ""): string => (slug ? `/society/${groupId}/${slug}` : `/society/${groupId}`);

/** The longest nav link the path sits under, so /events/12 lights up "Events". */
export function activeConsoleHref(pathname: string, sections: readonly ResolvedNavSection[]): string | null {
  let best: string | null = null;
  for (const href of sections.flatMap((s) => s.items.map((i) => i.href))) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Reading forms
// ---------------------------------------------------------------------------

/** A trimmed string, or null when blank. Capped so a pasted essay can't through. */
export function text(form: FormData, name: string, max = 2000): string | null {
  const v = form.get(name);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, max);
}

export const checked = (form: FormData, name: string): boolean => {
  const v = form.get(name);
  return v === "on" || v === "true" || v === "1";
};

/** A positive whole number, or null. */
export function positiveInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

/** A handicap index: "" → null, "12.4" → 12.4, "+2" → -2 (plus handicaps), out of range → undefined. */
export function parseIndex(raw: string | null): number | null | undefined {
  if (raw == null || raw.trim() === "") return null;
  const t = raw.trim().replace(",", ".");
  const plus = t.startsWith("+");
  const n = Number(plus ? t.slice(1) : t);
  if (!Number.isFinite(n)) return undefined;
  const v = Math.round((plus ? -n : n) * 10) / 10;
  return v >= -10 && v <= 54 ? v : undefined;
}

/** -2 → "+2.0", 12.4 → "12.4", null → "—". */
export const indexLabel = (n: number | null): string => (n == null ? "—" : n < 0 ? `+${Math.abs(n).toFixed(1)}` : n.toFixed(1));

/** "HH:MM" or blank. */
export function parseClock(raw: string | null): string | null | undefined {
  if (raw == null || raw.trim() === "") return null;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.trim()) ? raw.trim() : undefined;
}

/** "YYYY-MM-DD" that is a real date, or undefined. */
export function parseDate(raw: string | null): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? raw : undefined;
}

/** 6000 → "€60.00"; for money columns, always two places. */
export const euros = (cents: number | null | undefined): string => (cents == null ? "—" : `€${(cents / 100).toFixed(2)}`);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: number): string => MONTHS[(m - 1 + 12) % 12] ?? "January";

/** "2026-10-15T09:12:00Z" → "15 Oct 2026, 10:12" (Irish time). */
export function whenLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

/** "2026-10-20" → "20 Oct 2026". */
export function dayLabel(date: string | null): string {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/** "an hour left", "5 hours left", "expired" — for 24-hour offers. */
export function timeLeft(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"} left`;
  const m = Math.max(1, Math.round(ms / 60000));
  return `${m} min left`;
}
