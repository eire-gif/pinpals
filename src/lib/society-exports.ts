import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { toCsv, type CsvValue } from "./admin/csv";

/**
 * A society's CSV exports (0144). Every query here runs with the MEMBER'S OWN
 * client, so the database decides what they may export: society_member_list,
 * society_money and group_contacts refuse the wrong roles, and row security
 * hides payments, choices and withdrawals from anyone who can't see them on
 * their screen. Nothing is exported that the member couldn't already open in
 * the app.
 *
 *   members      name, office, joined, membership, handicaps*, mobile*
 *                (* only what that officer can see)
 *   booking      one event: groups, tee times, names, handicaps, guests,
 *                meals — the sheet for the golf club
 *   attendance   the season: who entered, withdrew or came as a guest
 *   payments     the season: every event payment and refund, and membership
 *   results      the season's published results on the society's page
 */

export const EXPORT_FILES = ["members", "booking", "attendance", "payments", "results"] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];

export type Built = { filename: string; csv: string; rows: number };

const name = (first: string | null | undefined, last: string | null | undefined) => [first, last].filter(Boolean).join(" ") || "A member";
const idx = (v: number | string | null | undefined): string | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return n < 0 ? `+${Math.abs(n).toFixed(1)}` : n.toFixed(1);
};
const euro = (cents: number | null | undefined): string | null => (cents == null ? null : (cents / 100).toFixed(2));
const OFFICE: Record<string, string> = {
  captain: "Captain",
  secretary: "Secretary",
  vice_captain: "Vice-captain",
  treasurer: "Treasurer",
  handicap_secretary: "Handicap secretary",
  event_organiser: "Event organiser",
};
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "society";

class ExportError extends Error {}
export { ExportError };

function fail(error: { message: string } | null | undefined, fallback: string): never {
  throw new ExportError(error?.message || fallback);
}

/** The season's dates, the same way the money screen counts them. */
async function season(db: SupabaseClient, groupId: number): Promise<{ from: string; to: string; label: string }> {
  const { data: s } = await db.from("society_membership_settings").select("season_start_month").eq("group_id", groupId).maybeSingle<{ season_start_month: number }>();
  const month = s?.season_start_month ?? 1;
  const now = new Date();
  const y = now.getUTCFullYear() - (now.getUTCMonth() + 1 < month ? 1 : 0);
  const from = `${y}-${String(month).padStart(2, "0")}-01`;
  const to = `${y + 1}-${String(month).padStart(2, "0")}-01`;
  return { from, to, label: month === 1 ? String(y) : `${y}-${String((y + 1) % 100).padStart(2, "0")}` };
}

export async function buildExport(db: SupabaseClient, groupId: number, file: ExportFile, outingId: number | null): Promise<Built> {
  const { data: group } = await db.from("groups").select("id, name, kind").eq("id", groupId).maybeSingle<{ id: number; name: string; kind: string }>();
  if (!group) fail(null, "That society isn't available.");
  const base = slug(group.name);

  if (file === "members") {
    const { data, error } = await db.rpc("society_member_list", { p_group_id: groupId });
    if (error) fail(error, "Couldn't load the members.");
    const rows = (data ?? []) as {
      member_id: string;
      first_name: string | null;
      last_name: string | null;
      role: string;
      office: string | null;
      joined_at: string;
      own_index: number | null;
      society_index: number | null;
      membership: string | null;
    }[];
    // Mobiles: only what group_contacts gives this officer.
    const phones = new Map<string, string>();
    const contacts = await db.rpc("group_contacts", { p_group_id: groupId });
    for (const c of (contacts.data ?? []) as { member_id: string; phone: string }[]) phones.set(c.member_id, c.phone);
    const out: CsvValue[][] = rows.map((r) => [
      r.first_name,
      r.last_name,
      r.role === "owner" ? (r.office ? `Owner · ${OFFICE[r.office] ?? r.office}` : "Owner") : r.office ? OFFICE[r.office] ?? r.office : "Member",
      r.joined_at?.slice(0, 10),
      r.membership,
      idx(r.own_index),
      idx(r.society_index),
      phones.get(r.member_id) ?? null,
    ]);
    return { filename: `${base}-members.csv`, csv: toCsv(["First name", "Last name", "Role", "Joined", "Membership", "Handicap index", "Society handicap", "Mobile"], out), rows: out.length };
  }

  if (file === "booking") {
    if (!outingId) fail(null, "Choose the event.");
    const { data: o } = await db
      .from("society_outings")
      .select("id, title, course_name, plays_on, first_tee, group_id")
      .eq("id", outingId)
      .eq("group_id", groupId)
      .maybeSingle<{ id: number; title: string; course_name: string | null; plays_on: string; first_tee: string | null }>();
    if (!o) fail(null, "That event isn't available.");
    const can = await db.rpc("my_society_areas", { p_group_id: groupId });
    if (!((can.data ?? []) as string[]).includes("events")) fail(null, "Only the people who run the event can export its booking sheet.");
    const [entries, guests, choices, hcaps] = await Promise.all([
      db
        .from("society_outing_entries")
        .select("member_id, tee_group, tee_time, tee_position, profile:profiles(first_name, last_name)")
        .eq("outing_id", outingId)
        .overrideTypes<{ member_id: string; tee_group: number | null; tee_time: string | null; tee_position: number | null; profile: { first_name: string | null; last_name: string | null } | null }[]>(),
      db.from("society_outing_guests").select("name, handicap_index, tee_group, tee_time, tee_position, brought_by").eq("outing_id", outingId).overrideTypes<{ name: string; handicap_index: number | null; tee_group: number | null; tee_time: string | null; tee_position: number | null; brought_by: string | null }[]>(),
      db.from("society_outing_choices").select("member_id, meal, guest_meal").eq("outing_id", outingId).overrideTypes<{ member_id: string; meal: string | null; guest_meal: string | null }[]>(),
      db.rpc("society_handicaps", { p_group_id: groupId }),
    ]);
    if (entries.error) fail(entries.error, "Couldn't load who's in.");
    const meal = new Map((choices.data ?? []).map((c) => [c.member_id, c]));
    const hc = new Map(((hcaps.data ?? []) as { member_id: string; own_index: number | null; society_index: number | null }[]).map((h) => [h.member_id, h.society_index ?? h.own_index]));
    const rows = [
      ...(entries.data ?? []).map((e) => ({ g: e.tee_group, t: e.tee_time, p: e.tee_position, n: name(e.profile?.first_name, e.profile?.last_name), h: idx(hc.get(e.member_id)), guest: "", meal: meal.get(e.member_id)?.meal ?? null })),
      ...(guests.data ?? []).map((g) => ({ g: g.tee_group, t: g.tee_time, p: g.tee_position, n: g.name, h: idx(g.handicap_index), guest: "Guest", meal: g.brought_by ? meal.get(g.brought_by)?.guest_meal ?? null : null })),
    ].sort((a, b) => (a.g ?? 999) - (b.g ?? 999) || (a.p ?? 99) - (b.p ?? 99) || a.n.localeCompare(b.n));
    const out: CsvValue[][] = rows.map((r) => [r.g, r.t?.slice(0, 5) ?? null, r.n, r.h, r.guest, r.meal]);
    return {
      filename: `${base}-${o.plays_on}-${slug(o.title)}.csv`,
      csv: toCsv([`${o.title} · ${o.course_name ?? ""} · ${o.plays_on}${o.first_tee ? ` · first tee ${o.first_tee.slice(0, 5)}` : ""}`], []) + toCsv(["Group", "Tee time", "Name", "Handicap", "Guest", "Meal"], out),
      rows: out.length,
    };
  }

  const s = await season(db, groupId);
  const { data: outings, error: oe } = await db
    .from("society_outings")
    .select("id, title, plays_on, status, entry_fee_cents, guest_fee_cents")
    .eq("group_id", groupId)
    .gte("plays_on", s.from)
    .lt("plays_on", s.to)
    .order("plays_on")
    .overrideTypes<{ id: number; title: string; plays_on: string; status: string; entry_fee_cents: number | null; guest_fee_cents: number | null }[]>();
  if (oe) fail(oe, "Couldn't load the events.");
  const ids = (outings ?? []).map((o) => o.id);
  const byId = new Map((outings ?? []).map((o) => [o.id, o]));

  if (file === "attendance") {
    const areas = await db.rpc("my_society_areas", { p_group_id: groupId });
    if (!((areas.data ?? []) as string[]).includes("events")) fail(null, "Only the people who run events can export attendance.");
    const [entries, guests, gone] = await Promise.all([
      ids.length ? db.from("society_outing_entries").select("outing_id, entered_at, profile:profiles(first_name, last_name)").in("outing_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? db.from("society_outing_guests").select("outing_id, name, created_at").in("outing_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? db.from("society_outing_withdrawals").select("outing_id, withdrawn_at, profile:profiles(first_name, last_name)").in("outing_id", ids) : Promise.resolve({ data: [] }),
    ]);
    type P = { first_name: string | null; last_name: string | null } | null;
    const out: CsvValue[][] = [
      ...((entries.data ?? []) as unknown as { outing_id: number; entered_at: string; profile: P }[]).map((e) => [byId.get(e.outing_id)?.plays_on, byId.get(e.outing_id)?.title, name(e.profile?.first_name, e.profile?.last_name), "Entered", e.entered_at.slice(0, 10)]),
      ...((guests.data ?? []) as { outing_id: number; name: string; created_at: string }[]).map((g) => [byId.get(g.outing_id)?.plays_on, byId.get(g.outing_id)?.title, g.name, "Guest", g.created_at.slice(0, 10)]),
      ...((gone.data ?? []) as unknown as { outing_id: number; withdrawn_at: string; profile: P }[]).map((w) => [byId.get(w.outing_id)?.plays_on, byId.get(w.outing_id)?.title, name(w.profile?.first_name, w.profile?.last_name), "Withdrew", w.withdrawn_at.slice(0, 10)]),
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[2]).localeCompare(String(b[2])));
    return { filename: `${base}-attendance-${s.label}.csv`, csv: toCsv(["Date", "Event", "Name", "Status", "On"], out), rows: out.length };
  }

  if (file === "payments") {
    // society_money refuses anyone without the money area: the gate.
    const gate = await db.rpc("society_money", { p_group_id: groupId });
    if (gate.error) fail(gate.error, "Only the treasurer, captain or secretary can export the accounts.");
    const [pays, gpays, members, ms] = await Promise.all([
      ids.length ? db.from("society_outing_payments").select("outing_id, status, marked_at, profile:profiles(first_name, last_name)").in("outing_id", ids) : Promise.resolve({ data: [] }),
      ids.length
        ? db.from("society_outing_guest_payments").select("status, marked_at, guest:society_outing_guests!inner(outing_id, name)").in("guest.outing_id", ids)
        : Promise.resolve({ data: [] }),
      db.from("society_memberships").select("season, status, method, marked_at, profile:profiles(first_name, last_name)").eq("group_id", groupId).eq("season", Number(s.label.slice(0, 4))),
      db.from("society_membership_settings").select("fee_cents").eq("group_id", groupId).maybeSingle<{ fee_cents: number | null }>(),
    ]);
    type P = { first_name: string | null; last_name: string | null } | null;
    const label = (st: string) => ({ cash: "Paid cash", transfer: "Paid by transfer", card: "Paid by card", waived: "Waived", refunded: "Refunded", paid: "Paid", honorary: "Honorary", lapsed: "Lapsed" })[st] ?? st;
    const out: CsvValue[][] = [
      ...((pays.data ?? []) as unknown as { outing_id: number; status: string; marked_at: string; profile: P }[]).map((p) => {
        const o = byId.get(p.outing_id);
        const amount = p.status === "waived" ? 0 : o?.entry_fee_cents ?? 0;
        return [o?.plays_on, o?.title, name(p.profile?.first_name, p.profile?.last_name), "Entry", label(p.status), euro(amount), p.status === "refunded" ? euro(amount) : null, p.marked_at.slice(0, 10)];
      }),
      ...((gpays.data ?? []) as unknown as { status: string; marked_at: string; guest: { outing_id: number; name: string } }[]).map((p) => {
        const o = byId.get(p.guest.outing_id);
        const amount = p.status === "waived" ? 0 : o?.guest_fee_cents ?? o?.entry_fee_cents ?? 0;
        return [o?.plays_on, o?.title, `${p.guest.name} (guest)`, "Guest", label(p.status), euro(amount), null, p.marked_at.slice(0, 10)];
      }),
      ...((members.data ?? []) as unknown as { season: number; status: string; method: string | null; marked_at: string; profile: P }[]).map((m) => [
        null,
        `Membership ${s.label}`,
        name(m.profile?.first_name, m.profile?.last_name),
        "Membership",
        m.status === "paid" ? label(m.method ?? "paid") : label(m.status),
        euro(m.status === "paid" ? ms.data?.fee_cents ?? 0 : 0),
        null,
        m.marked_at.slice(0, 10),
      ]),
    ];
    return { filename: `${base}-accounts-${s.label}.csv`, csv: toCsv(["Event date", "For", "Name", "Type", "Status", "Amount (€)", "Refunded (€)", "Marked on"], out), rows: out.length };
  }

  // results
  const areas = await db.rpc("my_society_areas", { p_group_id: groupId });
  if (((areas.data ?? []) as string[]).length === 0) fail(null, "Only the committee can export results.");
  const { data: res, error: re } = await db
    .from("competition_results")
    .select("results, published_at")
    .eq("group_id", groupId)
    .eq("status", "published")
    .gte("published_at", `${s.from}T00:00:00Z`)
    .order("published_at");
  if (re) fail(re, "Couldn't load the results.");
  type Row = { positionLabel: string; name: string; detail: string | null; score: string; points: number | null; net: string | null; gross: number | null; note: string | null; amended: string[] };
  type R = { event?: { title: string; playedOn: string; courseName: string }; divisions: { label: string; ranking: { rows: Row[] } }[]; prizes: { label: string; winners: { place: string; name: string; score: string }[] }[] };
  const out: CsvValue[][] = [];
  for (const r of (res ?? []) as { results: R; published_at: string }[]) {
    const ev = r.results?.event;
    for (const d of r.results?.divisions ?? []) {
      for (const row of d.ranking.rows) {
        out.push([ev?.playedOn ?? r.published_at.slice(0, 10), ev?.title ?? null, d.label, row.positionLabel, row.detail ? `${row.name} (${row.detail})` : row.name, row.score, row.points, row.net, row.gross, row.amended?.length ? "Amended" : null, row.note]);
      }
    }
    for (const prize of r.results?.prizes ?? []) {
      for (const w of prize.winners) out.push([ev?.playedOn ?? r.published_at.slice(0, 10), ev?.title ?? null, prize.label, w.place, w.name, w.score, null, null, null, null, null]);
    }
  }
  return { filename: `${base}-results-${s.label}.csv`, csv: toCsv(["Date", "Event", "Division / prize", "Place", "Name", "Score", "Points", "Net", "Gross", "Amended", "Note"], out), rows: out.length };
}
