import { DAY_FORMATS, MAX_DAYS, MIN_DAYS, type DayFormat } from "@/lib/championship";

/**
 * Multi-day championships in society admin (0187): the form's checks, and
 * the `p` save_championship takes — exactly what the app's set-up screen
 * sends (mobile/src/lib/championships.ts). The database checks it all again.
 */

export type ChampionshipDayInput = { playsOn: string; clubId: number | null; courseName: string; firstTee: string; format: string };

export type ChampionshipInput = {
  title: string;
  rule: string;
  fee: string;
  max: string;
  details: string;
  days: ChampionshipDayInput[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

export function buildChampionshipP(input: ChampionshipInput): { p: Record<string, unknown> } | { error: string } {
  const title = input.title.trim();
  if (!title) return { error: "Give the championship a name" };
  if (title.length > 80) return { error: "That name is too long — 80 characters at most" };
  if (input.days.length < MIN_DAYS || input.days.length > MAX_DAYS) return { error: "A championship is 2, 3 or 4 days" };
  const rule = input.rule === "places" ? "places" : "auto";
  let prev = "";
  const days = [];
  for (const [i, d] of input.days.entries()) {
    if (!DATE.test(d.playsOn)) return { error: `Choose a date for day ${i + 1}` };
    if (prev && d.playsOn <= prev) return { error: "Each day comes after the one before" };
    prev = d.playsOn;
    if (!d.courseName.trim()) return { error: `Choose the course for day ${i + 1}` };
    if (d.firstTee && !TIME.test(d.firstTee)) return { error: `The first tee on day ${i + 1} doesn't look right` };
    if (!DAY_FORMATS.some((f) => f.id === d.format)) return { error: `Choose a format for day ${i + 1}` };
    days.push({
      plays_on: d.playsOn,
      club_id: d.clubId,
      course_name: d.courseName.trim(),
      first_tee: d.firstTee || null,
      format: d.format as DayFormat,
      format_label: DAY_FORMATS.find((f) => f.id === d.format)?.label ?? null,
    });
  }
  const fee = input.fee.trim().replace(/^€/, "");
  let feeCents: number | null = null;
  if (fee) {
    const n = Number(fee);
    if (!Number.isFinite(n) || n < 0 || n > 1000) return { error: "The entry fee is between €0 and €1,000" };
    feeCents = Math.round(n * 100);
  }
  let max: number | null = null;
  if (input.max.trim()) {
    const n = Number(input.max.trim());
    if (!Number.isInteger(n) || n < 1 || n > 500) return { error: "Places are between 1 and 500" };
    max = n;
  }
  const details = input.details.trim();
  if (details.length > 1000) return { error: "The details are too long — 1,000 characters at most" };
  return { p: { title, rule, entry_fee_cents: feeCents, max_entries: max, details: details || null, days } };
}

export type ChampionshipSummary = { id: number; title: string; rule: "auto" | "places"; status: "open" | "cancelled"; tripOutingId: number | null };
