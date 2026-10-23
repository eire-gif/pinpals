import { describe, expect, it } from "vitest";

import { buildChampionshipP } from "./championships";

const day = (playsOn: string, format = "stableford") => ({ playsOn, clubId: 1, courseName: "The Island", firstTee: "08:30", format });

describe("buildChampionshipP", () => {
  it("builds what save_championship takes", () => {
    const r = buildChampionshipP({ title: " Autumn Classic ", rule: "auto", fee: "€60", max: "40", details: "", days: [day("2026-11-05"), day("2026-11-06", "scramble4")] });
    expect(r).toEqual({
      p: {
        title: "Autumn Classic",
        rule: "auto",
        entry_fee_cents: 6000,
        max_entries: 40,
        details: null,
        days: [
          { plays_on: "2026-11-05", club_id: 1, course_name: "The Island", first_tee: "08:30", format: "stableford", format_label: "Stableford" },
          { plays_on: "2026-11-06", club_id: 1, course_name: "The Island", first_tee: "08:30", format: "scramble4", format_label: "Texas scramble (4)" },
        ],
      },
    });
  });

  it("refuses the wrong number of days, days out of order and unknown formats", () => {
    const base = { title: "X", rule: "auto", fee: "", max: "", details: "" };
    expect(buildChampionshipP({ ...base, days: [day("2026-11-05")] })).toEqual({ error: "A championship is 2, 3 or 4 days" });
    expect(buildChampionshipP({ ...base, days: [day("2026-11-06"), day("2026-11-05")] })).toEqual({ error: "Each day comes after the one before" });
    expect(buildChampionshipP({ ...base, days: [day("2026-11-05", "matchplay"), day("2026-11-06")] })).toEqual({ error: "Choose a format for day 1" });
    expect(buildChampionshipP({ ...base, title: " ", days: [day("2026-11-05"), day("2026-11-06")] })).toEqual({ error: "Give the championship a name" });
  });
});
