import { describe, expect, it } from "vitest";

import { IRISH_LINKS_TRAIL, badges, countriesPlayed, mapPins, matchTrail, provinceCounts, provinceOf, stampsFrom, type PassportClub } from "./passport-rules";

const club = (id: number, name: string, country: string, region: string | null, lat: number | null = 53, lng: number | null = -6): PassportClub => ({
  id,
  name,
  country,
  region,
  latitude: lat,
  longitude: lng,
});

const portmarnock = club(1, "Portmarnock Golf Club", "ireland", "Dublin");
const lahinch = club(2, "Lahinch Golf Club", "ireland", "Clare");
const enniscrone = club(3, "Enniscrone Golf Club", "ireland", "Sligo");
const portrush = club(4, "Royal Portrush Golf Club", "northern-ireland", "Antrim");
const valderrama = club(5, "Real Club Valderrama", "spain", null);
const noMap = club(6, "Somewhere GC", "ireland", "Cork", null, null);

describe("provinces", () => {
  it("counties to provinces; all of Northern Ireland is Ulster", () => {
    expect(provinceOf(portmarnock)).toBe("Leinster");
    expect(provinceOf(lahinch)).toBe("Munster");
    expect(provinceOf(enniscrone)).toBe("Connacht");
    expect(provinceOf(portrush)).toBe("Ulster");
    expect(provinceOf(club(9, "Donegal GC", "ireland", "Donegal"))).toBe("Ulster");
    expect(provinceOf(club(9, "X", "ireland", "Co. Kerry"))).toBe("Munster");
    expect(provinceOf(valderrama)).toBeNull();
  });

  it("with no county on file, by where the course is", () => {
    const at = (lat: number, lng: number) => provinceOf({ country: "ireland", region: null, latitude: lat, longitude: lng });
    expect(at(53.43, -6.13)).toBe("Leinster"); // Portmarnock
    expect(at(52.93, -9.35)).toBe("Munster"); // Lahinch
    expect(at(52.51, -9.67)).toBe("Munster"); // Ballybunion
    expect(at(51.6, -8.53)).toBe("Munster"); // Old Head
    expect(at(54.21, -9.1)).toBe("Connacht"); // Enniscrone
    expect(at(54.3, -8.57)).toBe("Connacht"); // County Sligo
    expect(at(53.3, -9.05)).toBe("Connacht"); // Galway
    expect(at(55.1, -7.5)).toBe("Ulster"); // Ballyliffin
    expect(at(52.85, -6.04)).toBe("Leinster"); // The European Club
    expect(provinceOf({ country: "ireland", region: null, latitude: null, longitude: null })).toBeNull();
  });
});

describe("stamps", () => {
  it("one per club, rounds counted, newest first; ticked-only courses after", () => {
    const stamps = stampsFrom(
      [
        { club: portmarnock, playedOn: "2026-06-01" },
        { club: lahinch, playedOn: "2026-09-20" },
        { club: portmarnock, playedOn: "2026-10-01" },
      ],
      [portmarnock, portrush],
    );
    expect(stamps.map((s) => [s.id, s.rounds, s.lastPlayed])).toEqual([
      [1, 2, "2026-10-01"],
      [2, 1, "2026-09-20"],
      [4, 0, null],
    ]);
    expect(provinceCounts(stamps)).toEqual({ Leinster: 1, Munster: 1, Connacht: 0, Ulster: 1 });
    expect(countriesPlayed(stamps)).toEqual(["ireland"]);
  });
});

describe("badges", () => {
  it("all four provinces, played abroad, milestones and the trail", () => {
    const stamps = stampsFrom([], [portmarnock, lahinch, enniscrone, portrush, valderrama]);
    const b = Object.fromEntries(badges(stamps, 3, 12).map((x) => [x.id, x]));
    expect(b.provinces).toMatchObject({ earned: true });
    expect(b.abroad).toMatchObject({ earned: true, detail: "1 course abroad" });
    expect(b.courses).toMatchObject({ earned: false, detail: "5 of 10", label: "10 Courses" });
    expect(b.trail).toMatchObject({ earned: false, detail: "3 of 12" });
    const twelve = Array.from({ length: 12 }, (_, i) => club(100 + i, `C${i}`, "ireland", "Dublin"));
    expect(badges(stampsFrom([], twelve), 12, 12).find((x) => x.id === "courses")).toMatchObject({ earned: true, label: "10 Courses", detail: "12 of 25" });
    expect(badges(stampsFrom([], twelve), 12, 12).find((x) => x.id === "trail")!.earned).toBe(true);
  });
});

describe("the Irish Links Trail", () => {
  it("matches directory clubs by name in the right country, shortest name first", () => {
    const dir = [
      { id: 1, name: "Portmarnock Golf Club", country: "ireland" },
      { id: 2, name: "Portmarnock Hotel & Golf Links", country: "ireland" },
      { id: 3, name: "Royal Portrush Golf Club", country: "northern-ireland" },
      { id: 4, name: "Carne Golf Links", country: "ireland" },
      { id: 5, name: "Lahinch Golf Club", country: "ireland" },
      { id: 6, name: "Lahinch Castle Course", country: "ireland" },
    ];
    const m = matchTrail(IRISH_LINKS_TRAIL, dir);
    expect(m.get("portmarnock")?.id).toBe(1);
    expect(m.get("royal-portrush")?.id).toBe(3);
    expect(m.get("lahinch")?.id).toBe(5);
    expect(m.get("ballybunion")).toBeUndefined();
    expect(IRISH_LINKS_TRAIL).toHaveLength(12);
  });
});

describe("map pins", () => {
  it("played with the newest picked out, then bucket-list courses not yet played; no pin without a location", () => {
    const stamps = stampsFrom([{ club: lahinch, playedOn: "2026-09-20" }], [portmarnock, noMap]);
    const pins = mapPins(stamps, [portrush, portmarnock], (d) => d);
    expect(pins.map((p) => [p.id, p.kind])).toEqual([
      [2, "newest"],
      [1, "played"],
      [4, "bucket"],
    ]);
  });
});
