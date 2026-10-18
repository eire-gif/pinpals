/**
 * Dates as the group screens write them — "Sat 24 Oct" — built by hand so
 * they never depend on Intl. Plain module, no imports, so it can be tested.
 */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parse = (iso: string): Date | null => {
  const [y, m, d] = iso.split("-").map((x) => Number.parseInt(x, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

/** "Sat 24 Oct". Falls back to the input if it isn't a YYYY-MM-DD date. */
export function shortDate(iso: string): string {
  const d = parse(iso);
  return d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : iso;
}

/** { day: "SAT", date: "24", month: "OCT" } for a date block. */
export function dateParts(iso: string): { day: string; date: string; month: string } {
  const d = parse(iso);
  if (!d) return { day: "", date: iso, month: "" };
  return { day: DAYS[d.getDay()].toUpperCase(), date: String(d.getDate()), month: MONTHS[d.getMonth()].toUpperCase() };
}
