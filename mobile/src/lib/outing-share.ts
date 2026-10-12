/**
 * Sharing an outing or trip to Instagram, Facebook, WhatsApp… (Oct 2026).
 *
 * The text goes outside PinPals, so it says only what a society would put
 * on its own page: the name, dates, place, courses and the society. Never
 * who's going, the cost, payment details or tee times.
 *
 * Pure, no imports: tested in outing-share.test.ts.
 */

export type ShareableOuting = {
  kind: "day" | "overnight" | "abroad";
  title: string;
  playsOn: string;
  endsOn: string | null;
  location: string | null;
  courseName: string | null;
  societyName: string | null;
  /** Course names from a trip's rounds, in order. */
  courses: string[];
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(date: string, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

function rangeLabel(from: string, to: string): string {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/** Distinct, in order: "Quinta do Lago, Vale do Lobo & Monte Rei". */
function courseList(courses: string[]): string {
  const seen = [...new Set(courses.map((c) => c.trim()).filter(Boolean))];
  if (seen.length <= 1) return seen[0] ?? "";
  return `${seen.slice(0, -1).join(", ")} & ${seen[seen.length - 1]}`;
}

export function outingShareText(o: ShareableOuting, siteUrl: string): string {
  const lines: string[] = [];
  const society = o.societyName ? ` with ${o.societyName}` : "";
  if (o.kind === "day" || !o.endsOn) {
    lines.push(`⛳ ${o.title}`);
    lines.push(`${dateLabel(o.playsOn, true)}${o.courseName ? ` · ${o.courseName}` : ""}`);
    if (o.societyName) lines.push(`A day out${society}.`);
  } else {
    const rounds = o.courses.length;
    lines.push(`${o.kind === "abroad" ? "✈️" : "⛳"} ${o.title}`);
    lines.push(`${rangeLabel(o.playsOn, o.endsOn)}${o.location ? ` · ${o.location}` : ""}`);
    lines.push(`${o.kind === "abroad" ? "Golf trip abroad" : "Golf weekend"}${society}${rounds ? ` · ${rounds} ${rounds === 1 ? "round" : "rounds"}` : ""}.`);
    const list = courseList(o.courses);
    if (list) lines.push(`Playing ${list}.`);
  }
  lines.push("");
  lines.push(`Organised on PinPals 👉 ${siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`);
  return lines.join("\n");
}
