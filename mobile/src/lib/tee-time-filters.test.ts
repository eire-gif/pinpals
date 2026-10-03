import { describe, expect, it } from "vitest";
import { DEFAULT_TEE_TIME_FILTERS, activeTeeTimeFilterCount, applyTeeTimeFilters } from "./tee-time-filters";

const round = (play_date: string, extra: Partial<{ has_tee_time_booked: boolean; ladies_only: boolean; spaces_available: number }> = {}) => ({
  play_date,
  has_tee_time_booked: false,
  ladies_only: false,
  spaces_available: 1,
  ...extra,
});

// Wednesday 7 October 2026.
const WED = new Date(2026, 9, 7, 15, 0);

describe("applyTeeTimeFilters", () => {
  const rounds = [
    round("2026-10-07"),
    round("2026-10-10", { has_tee_time_booked: true, spaces_available: 3 }),
    round("2026-10-11", { ladies_only: true, spaces_available: 2 }),
    round("2026-10-20"),
  ];

  it("shows everything by default", () => {
    expect(applyTeeTimeFilters(rounds, DEFAULT_TEE_TIME_FILTERS, WED)).toHaveLength(4);
  });

  it("this week means today and the six days after", () => {
    const out = applyTeeTimeFilters(rounds, { ...DEFAULT_TEE_TIME_FILTERS, when: "week" }, WED);
    expect(out.map((r) => r.play_date)).toEqual(["2026-10-07", "2026-10-10", "2026-10-11"]);
  });

  it("this weekend is the coming Saturday and Sunday", () => {
    const out = applyTeeTimeFilters(rounds, { ...DEFAULT_TEE_TIME_FILTERS, when: "weekend" }, WED);
    expect(out.map((r) => r.play_date)).toEqual(["2026-10-10", "2026-10-11"]);
  });

  it("on a Sunday, this weekend is today only", () => {
    const sunday = new Date(2026, 9, 11, 9, 0);
    const out = applyTeeTimeFilters(rounds, { ...DEFAULT_TEE_TIME_FILTERS, when: "weekend" }, sunday);
    expect(out.map((r) => r.play_date)).toEqual(["2026-10-11"]);
  });

  it("booked, ladies-only and spaces filter as named", () => {
    expect(applyTeeTimeFilters(rounds, { ...DEFAULT_TEE_TIME_FILTERS, bookedOnly: true }, WED)).toHaveLength(1);
    expect(applyTeeTimeFilters(rounds, { ...DEFAULT_TEE_TIME_FILTERS, ladiesOnly: true }, WED)).toHaveLength(1);
    expect(applyTeeTimeFilters(rounds, { ...DEFAULT_TEE_TIME_FILTERS, minSpaces: 2 }, WED)).toHaveLength(2);
  });

  it("counts active filters for the button badge", () => {
    expect(activeTeeTimeFilterCount(DEFAULT_TEE_TIME_FILTERS)).toBe(0);
    expect(activeTeeTimeFilterCount({ when: "weekend", bookedOnly: true, ladiesOnly: false, minSpaces: 2 })).toBe(3);
  });
});
