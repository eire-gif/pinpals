/**
 * Book a pro (0204, claude/book-a-pro.md): loading and saving.
 *
 * Reads go straight to Supabase (RLS: approved pros for everyone; your own
 * pro row, hours and bookings for you). The pro's own changes and holding a
 * time are RPCs. Paying happens on the website (/dashboard/lessons/<id>, in
 * the app's web view); cancelling goes through the website too, because it
 * may move money back.
 */
import { postToSite } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { BookingStatus, CancelPolicy, HoursRow, ProKind, ProStatus, ServiceKind } from "@/lib/pro-rules";

export type ProService = {
  id: number;
  kind: ServiceKind;
  title: string;
  details: string | null;
  minutes: number;
  priceCents: number;
  position: number;
};

export type Pro = {
  id: number;
  memberId: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  kind: ProKind;
  pgaNumber: string | null;
  qualification: string | null;
  club: string;
  county: string | null;
  bio: string | null;
  cancelPolicy: CancelPolicy;
  status: ProStatus;
  declineReason: string | null;
  services: ProService[];
};

export type Lesson = {
  id: number;
  proId: number;
  memberId: string;
  title: string;
  starts_at: string;
  ends_at: string;
  price_cents: number;
  commission_cents: number;
  cancel_policy: CancelPolicy;
  free_cancel_until: string | null;
  focus: string[];
  note: string | null;
  status: BookingStatus;
  hold_until: string;
  payment_status: "unpaid" | "pending" | "paid";
  payout_status: "none" | "held" | "released" | "failed";
  cancelled_by: "member" | "pro" | "system" | null;
  refund_cents: number;
  /** The other side: the pro's name for the golfer, the golfer's for the pro. */
  proName: string;
  proClub: string;
  proMemberId: string;
  golferName: string;
};

type ProRow = {
  id: number;
  member_id: string;
  kind: ProKind;
  pga_number: string | null;
  qualification: string | null;
  club: string;
  county: string | null;
  bio: string | null;
  cancel_policy: CancelPolicy;
  status: ProStatus;
  decline_reason: string | null;
  profile: { first_name: string; last_name: string | null; avatar_url: string | null; avatar_color: string | null } | null;
  pro_services: { id: number; kind: ServiceKind; title: string; details: string | null; minutes: number; price_cents: number; position: number; active: boolean }[];
};

const PRO_COLS =
  "id, member_id, kind, pga_number, qualification, club, county, bio, cancel_policy, status, decline_reason, profile:profiles!pros_member_id_fkey(first_name, last_name, avatar_url, avatar_color), pro_services(id, kind, title, details, minutes, price_cents, position, active)";

const fullName = (p: { first_name: string; last_name: string | null } | null | undefined) =>
  p ? `${p.first_name} ${p.last_name ?? ""}`.trim() : "A member";

const toPro = (r: ProRow): Pro => ({
  id: r.id,
  memberId: r.member_id,
  name: fullName(r.profile),
  avatarUrl: r.profile?.avatar_url ?? null,
  avatarColor: r.profile?.avatar_color ?? null,
  kind: r.kind,
  pgaNumber: r.pga_number,
  qualification: r.qualification,
  club: r.club,
  county: r.county,
  bio: r.bio,
  cancelPolicy: r.cancel_policy,
  status: r.status,
  declineReason: r.decline_reason,
  services: (r.pro_services ?? [])
    .filter((s) => s.active)
    .sort((a, b) => a.position - b.position || a.price_cents - b.price_cents)
    .map((s) => ({ id: s.id, kind: s.kind, title: s.title, details: s.details, minutes: s.minutes, priceCents: s.price_cents, position: s.position })),
});

/** Approved pros, with what they offer. Your county first. */
export async function loadPros(): Promise<Pro[]> {
  const { data, error } = await supabase.from("pros").select(PRO_COLS).eq("status", "approved").order("created_at", { ascending: false }).limit(300);
  if (error) throw error;
  return ((data ?? []) as unknown as ProRow[]).map(toPro).filter((p) => p.services.length > 0);
}

export async function loadPro(id: number): Promise<Pro | null> {
  const { data, error } = await supabase.from("pros").select(PRO_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toPro(data as unknown as ProRow) : null;
}

/** Your own pro row (any status), or null. */
export async function loadMyPro(me: string): Promise<Pro | null> {
  const { data, error } = await supabase.from("pros").select(PRO_COLS).eq("member_id", me).maybeSingle();
  if (error) throw error;
  return data ? toPro(data as unknown as ProRow) : null;
}

export async function loadMyHours(proId: number): Promise<HoursRow[]> {
  const { data, error } = await supabase.from("pro_hours").select("weekday, start_min, end_min").eq("pro_id", proId);
  if (error) throw error;
  return (data ?? []) as HoursRow[];
}

export async function loadMyTimeOff(proId: number): Promise<{ id: number; starts_at: string; ends_at: string }[]> {
  const { data, error } = await supabase
    .from("pro_time_off")
    .select("id, starts_at, ends_at")
    .eq("pro_id", proId)
    .gt("ends_at", new Date().toISOString())
    .order("starts_at");
  if (error) throw error;
  return data ?? [];
}

/** Free start times for one service, from today for `days` days. */
export async function loadSlots(serviceId: number, days = 14): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("pro_slots", { p_service_id: serviceId, p_from: today, p_days: days });
  if (error) throw error;
  return ((data ?? []) as { starts_at: string }[]).map((r) => r.starts_at);
}

const LESSON_COLS =
  "id, pro_id, member_id, title, starts_at, ends_at, price_cents, commission_cents, cancel_policy, free_cancel_until, focus, note, status, hold_until, payment_status, payout_status, cancelled_by, refund_cents, golfer:profiles!pro_bookings_member_id_fkey(first_name, last_name), pro:pros!inner(member_id, club, profile:profiles!pros_member_id_fkey(first_name, last_name))";

type LessonRow = Omit<Lesson, "proId" | "memberId" | "proName" | "proClub" | "proMemberId" | "golferName"> & {
  pro_id: number;
  member_id: string;
  golfer: { first_name: string; last_name: string | null } | null;
  pro: { member_id: string; club: string; profile: { first_name: string; last_name: string | null } | null } | null;
};

const toLesson = (r: LessonRow): Lesson => ({
  ...r,
  proId: r.pro_id,
  memberId: r.member_id,
  focus: r.focus ?? [],
  proName: fullName(r.pro?.profile),
  proClub: r.pro?.club ?? "",
  proMemberId: r.pro?.member_id ?? "",
  golferName: fullName(r.golfer),
});

export async function loadLesson(id: number): Promise<Lesson | null> {
  const { data, error } = await supabase.from("pro_bookings").select(LESSON_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? toLesson(data as unknown as LessonRow) : null;
}

/** Lessons you've booked, newest first (paid ones and ones you're paying for). */
export async function loadMyLessons(me: string): Promise<Lesson[]> {
  const { data, error } = await supabase
    .from("pro_bookings")
    .select(LESSON_COLS)
    .eq("member_id", me)
    .in("status", ["booked", "cancelled", "pending_payment"])
    .order("starts_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as unknown as LessonRow[]).map(toLesson).filter((l) => l.status !== "cancelled" || l.payment_status === "paid");
}

/** A pro's diary: booked lessons from a day ago on. */
export async function loadDiary(proId: number): Promise<Lesson[]> {
  const { data, error } = await supabase
    .from("pro_bookings")
    .select(LESSON_COLS)
    .eq("pro_id", proId)
    .eq("status", "booked")
    .gte("ends_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("starts_at")
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as unknown as LessonRow[]).map(toLesson);
}

/** What's been paid out and what's still to come, for a pro. */
export async function loadEarnings(proId: number): Promise<{ heldCents: number; paidCents: number }> {
  const { data, error } = await supabase
    .from("pro_bookings")
    .select("price_cents, commission_cents, payout_status")
    .eq("pro_id", proId)
    .in("payout_status", ["held", "released"])
    .limit(2000);
  if (error) throw error;
  let heldCents = 0;
  let paidCents = 0;
  for (const r of (data ?? []) as { price_cents: number; commission_cents: number; payout_status: string }[]) {
    const take = r.price_cents - r.commission_cents;
    if (r.payout_status === "held") heldCents += take;
    else paidCents += take;
  }
  return { heldCents, paidCents };
}

// ---- Writes ----

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type ProApplication = {
  kind: ProKind;
  pga_number: string;
  qualification: string;
  club: string;
  county: string | null;
  bio: string;
  cancel_policy: CancelPolicy;
};

export const applyAsPro = (p: ProApplication) => rpc<number>("pro_apply", { p });
export const setProPaused = (paused: boolean) => rpc<void>("pro_set_paused", { p_paused: paused });
export const saveService = (id: number | null, p: { kind: ServiceKind; title: string; details: string; minutes: number; price_cents: number; position: number }) =>
  rpc<number>("pro_service_save", { p_id: id, p });
export const removeService = (id: number) => rpc<void>("pro_service_remove", { p_id: id });
export const setHours = (rows: HoursRow[]) => rpc<void>("pro_hours_set", { p: rows });
export const addTimeOff = (starts: string, ends: string) => rpc<number>("pro_time_off_add", { p_starts: starts, p_ends: ends });
export const removeTimeOff = (id: number) => rpc<void>("pro_time_off_remove", { p_id: id });

/** Holds the time for 15 minutes; returns the booking to pay for. */
export const holdLesson = (serviceId: number, startsAt: string, focus: string[], note: string) =>
  rpc<number>("pro_book", { p_service_id: serviceId, p_starts_at: startsAt, p_focus: focus, p_note: note.trim() || null });

/** Cancels, on the website, which also makes any refund. */
export const cancelLesson = (id: number, reason: string) =>
  postToSite<{ refund_cents: number; refunded: boolean }>(`/api/app/lessons/${id}/cancel`, { reason: reason.trim() || null });

/** The website page where the golfer pays. */
export const lessonPayPath = (id: number) => `/dashboard/lessons/${id}`;
