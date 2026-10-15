import { describe, expect, it } from "vitest";

import { buildItemP, parseItemPeople, type ItemFields } from "./events-itinerary";

const trip = { playsOn: "2027-05-13", endsOn: "2027-05-16" };
const blank: ItemFields = { kind: null, onDate: "2027-05-14", title: null, clubId: null, clubName: null, startsAt: null, endsAt: null, fromPlace: null, toPlace: null, carrier: null, nights: null, gap: null, format: null, details: null };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("buildItemP", () => {
  it("a round keeps the course, gap and format only", () => {
    const r = buildItemP({ ...blank, kind: "round", clubId: 9, clubName: "Quinta do Lago", startsAt: "09:00", gap: "9", format: "stableford", fromPlace: "DUB", nights: "3" }, trip);
    expect(r).toEqual({
      p: { on_date: "2027-05-14", kind: "round", title: "Quinta do Lago", starts_at: "09:00", ends_at: null, details: null, club_id: 9, from_place: null, to_place: null, carrier: null, nights: null, tee_interval: 9, play_format: "stableford" },
    });
  });
  it("asks for what each kind needs", () => {
    expect(buildItemP({ ...blank, kind: "round" }, trip)).toEqual({ error: "Choose the course." });
    expect(buildItemP({ ...blank, kind: "flight", title: "Outbound", fromPlace: "DUB" }, trip)).toEqual({ error: "Say where the flight is from and to." });
    expect(buildItemP({ ...blank, kind: "stay", title: "Dona Filipa", nights: "4" }, trip)).toEqual({ error: "That stay runs past the end of the trip." });
    expect(buildItemP({ ...blank, kind: "note", title: "x", onDate: "2027-05-20" }, trip)).toEqual({ error: "Choose a day of the trip." });
  });
});

describe("parseItemPeople", () => {
  it("groups for a round, a plain list for a flight, nobody on a meal", () => {
    expect(parseItemPeople(JSON.stringify([{ member: B, slot: 2 }, { member: A, slot: 1 }]), "round")).toEqual({ people: [{ member: A, slot: 1 }, { member: B, slot: 2 }] });
    expect(parseItemPeople(JSON.stringify([{ member: A, slot: 3 }]), "flight")).toEqual({ people: [{ member: A, slot: null }] });
    expect(parseItemPeople("[]", "meal")).toEqual({ people: null });
  });
  it("refuses someone twice, or without a room", () => {
    expect(parseItemPeople(JSON.stringify([{ member: A, slot: 1 }, { member: A, slot: 2 }]), "stay")).toEqual({ error: "That list doesn't look right." });
    expect(parseItemPeople(JSON.stringify([{ member: A, slot: null }]), "stay")).toEqual({ error: "Put everyone in a room." });
  });
});
