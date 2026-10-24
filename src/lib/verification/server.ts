import "server-only";

import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude } from "@/lib/news/claude";
import { decide, type CardReading, type Decision } from "./decide";

/**
 * Verified golfer (Oct 2026, 0188, claude/trust-and-safety.md).
 *
 * A member sends a photo of their membership card (or the Golf Ireland app's
 * card screen) with their Golf Ireland number and club. Claude reads the
 * card; decide() compares it with their profile in plain code:
 *
 *   approve → member_verifications 'verified' + a verified_members row (the badge)
 *   reject  → 'rejected' with a reason they can act on; they can try again
 *   review  → 'needs_review'; the photo is stored in the private
 *             verification-cards bucket for staff at /admin/trust, and
 *             deleted when they decide
 *
 * The photo is never stored unless a person has to look. It is resized and
 * stripped of EXIF by sharp before it goes anywhere.
 *
 * Every write uses the admin (service role) client: members have no write
 * policy on these tables.
 */

export const VERIFY_MODEL = process.env.VERIFY_MODEL ?? "claude-sonnet-5";
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_ATTEMPTS_PER_DAY = 5;
const BUCKET = "verification-cards";

export type VerificationStatus = "none" | "checking" | "verified" | "needs_review" | "rejected";

export type VerificationView = {
  status: VerificationStatus;
  clubName: string | null;
  number: string | null;
  reason: string | null;
  decidedAt: string | null;
};

export class VerificationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

type Row = {
  member_id: string;
  golf_ireland_number: string;
  club_name: string;
  status: Exclude<VerificationStatus, "none">;
  reason: string | null;
  attempts: number;
  submitted_at: string;
  decided_at: string | null;
  photo_path: string | null;
};

export function toView(row: Row | null): VerificationView {
  if (!row) return { status: "none", clubName: null, number: null, reason: null, decidedAt: null };
  return {
    status: row.status,
    clubName: row.club_name,
    number: row.golf_ireland_number,
    reason: row.reason,
    decidedAt: row.decided_at,
  };
}

/** The member's own state, read with THEIR client (RLS: own row only). */
export async function myVerification(supabase: SupabaseClient, userId: string): Promise<VerificationView> {
  const { data } = await supabase
    .from("member_verifications")
    .select("member_id, golf_ireland_number, club_name, status, reason, attempts, submitted_at, decided_at, photo_path")
    .eq("member_id", userId)
    .maybeSingle<Row>();
  return toView(data ?? null);
}

const SYSTEM = `You read photos of golf club membership cards for PinPals, an Irish golf app, to confirm a member is a real club golfer.
You only report what you can see. Never guess a name, club or number that isn't visible.
Reply with JSON only, no other text, in exactly this shape:
{"is_membership_card": boolean, "card_type": "golf_ireland_card" | "golf_ireland_app" | "club_card" | "other", "legible": boolean, "looks_altered": boolean, "name_on_card": string | null, "club_on_card": string | null, "number_on_card": string | null, "club_matches": boolean, "confidence": number, "notes": string}
- is_membership_card: a golf club or Golf Ireland (or GUI/ILGU, England Golf, Scottish Golf, Wales Golf, Golf Union) membership card, or a screenshot of the card screen in the Golf Ireland or a club's app.
- looks_altered: true if text looks pasted on, mismatched fonts, edited, or the photo is of a screen showing an edited image.
- club_matches: whether the club on the card is the same club as the member says (ignore "Golf Club", "GC", "Golf Links" and similar differences).
- confidence: 0 to 1, how sure you are of your reading as a whole.
- notes: one short sentence, plain English, for a person reviewing it.`;

async function prepare(file: File): Promise<Buffer> {
  if (file.size > MAX_BYTES) throw new VerificationError("That photo is too large. Try a smaller one.");
  try {
    const input = Buffer.from(await file.arrayBuffer());
    return await sharp(input, { failOn: "truncated" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new VerificationError("We couldn't open that photo. Try a JPEG or PNG.");
  }
}

async function readCard(jpeg: Buffer, claimed: { name: string; club: string; number: string }): Promise<CardReading> {
  const result = await callClaude<CardReading>({
    model: VERIFY_MODEL,
    system: SYSTEM,
    user: `The member says their name is "${claimed.name}", their club is "${claimed.club}" and their membership number is "${claimed.number}". Read the card in the photo.`,
    maxTokens: 500,
    images: [{ mediaType: "image/jpeg", base64: jpeg.toString("base64") }],
  });
  const r = result.data;
  return {
    is_membership_card: !!r.is_membership_card,
    card_type: typeof r.card_type === "string" ? r.card_type : "other",
    legible: !!r.legible,
    looks_altered: !!r.looks_altered,
    name_on_card: typeof r.name_on_card === "string" ? r.name_on_card : null,
    club_on_card: typeof r.club_on_card === "string" ? r.club_on_card : null,
    number_on_card: typeof r.number_on_card === "string" ? r.number_on_card : null,
    club_matches: !!r.club_matches,
    confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0,
    notes: typeof r.notes === "string" ? r.notes.slice(0, 300) : undefined,
  };
}

export async function submitVerification(input: {
  admin: SupabaseClient;
  userId: string;
  file: File;
  number: string;
  clubName: string;
  clubId: number | null;
}): Promise<VerificationView> {
  const { admin, userId } = input;
  const number = input.number.trim();
  const clubName = input.clubName.trim();
  if (number.replace(/[^A-Za-z0-9]/g, "").length < 4 || number.length > 40) {
    throw new VerificationError("Enter your Golf Ireland (or club) membership number.");
  }
  if (!clubName || clubName.length > 120) throw new VerificationError("Choose your club.");

  const { data: existing } = await admin
    .from("member_verifications")
    .select("member_id, golf_ireland_number, club_name, status, reason, attempts, submitted_at, decided_at, photo_path")
    .eq("member_id", userId)
    .maybeSingle<Row>();

  if (existing?.status === "verified") return toView(existing);
  if (existing?.status === "needs_review") {
    throw new VerificationError("Your card is with a person to check already. You'll get an alert when it's done.", 409);
  }

  const sameDay = existing && Date.now() - new Date(existing.submitted_at).getTime() < 24 * 3600_000;
  const attempts = sameDay ? existing.attempts + 1 : 1;
  if (attempts > MAX_ATTEMPTS_PER_DAY) {
    throw new VerificationError("That's a few tries today. Have another go tomorrow.", 429);
  }

  const jpeg = await prepare(input.file);

  const [{ data: profile }, { data: priv }] = await Promise.all([
    admin.from("profiles").select("first_name, last_name").eq("id", userId).maybeSingle<{ first_name: string | null; last_name: string | null }>(),
    admin.from("member_private").select("legal_last_name, gui_membership_number").eq("member_id", userId).maybeSingle<{
      legal_last_name: string | null;
      gui_membership_number: string | null;
    }>(),
  ]);
  const firstName = profile?.first_name ?? null;
  // A junior's surname is masked on profiles (0159); their legal one is private.
  const lastName = priv?.legal_last_name || profile?.last_name || null;

  const base = {
    member_id: userId,
    golf_ireland_number: number,
    club_id: input.clubId,
    club_name: clubName,
    attempts,
    submitted_at: new Date().toISOString(),
    photo_path: null as string | null,
  };

  let reading: CardReading | null = null;
  let decision: Decision;
  try {
    reading = await readCard(jpeg, { name: [firstName, lastName].filter(Boolean).join(" "), club: clubName, number });
    decision = decide(reading, { firstName, lastName, club: clubName, number });
  } catch {
    // No key, the API down, an unreadable reply: a person checks instead.
    decision = { outcome: "review", reason: "A person will check your card shortly." };
  }

  const now = new Date().toISOString();
  let row: Record<string, unknown>;

  if (decision.outcome === "approve") {
    row = { ...base, status: "verified", method: "ai", ai_result: reading, reason: null, decided_at: now, decided_by: null };
  } else if (decision.outcome === "reject") {
    row = { ...base, status: "rejected", method: "ai", ai_result: reading, reason: decision.reason, decided_at: now, decided_by: null };
  } else {
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
    if (uploadError) throw new VerificationError("Couldn't save your photo just now. Please try again.", 500);
    row = { ...base, status: "needs_review", method: null, ai_result: reading, reason: decision.reason, photo_path: path, decided_at: null, decided_by: null };
  }

  const { error } = await admin.from("member_verifications").upsert(row, { onConflict: "member_id" });
  if (error) throw new VerificationError("Couldn't save that just now. Please try again.", 500);

  if (decision.outcome === "approve") {
    await admin.from("verified_members").upsert({ member_id: userId, club_name: clubName, verified_at: now }, { onConflict: "member_id" });
  }

  // Keep their membership number on file if they hadn't given one before.
  if (!priv?.gui_membership_number) {
    await admin.from("member_private").upsert({ member_id: userId, gui_membership_number: number }, { onConflict: "member_id" });
  }

  return {
    status: row.status as VerificationStatus,
    clubName,
    number,
    reason: (row.reason as string | null) ?? null,
    decidedAt: (row.decided_at as string | null) ?? null,
  };
}

/** Staff decision on a card a person had to check. Deletes the photo either way. */
export async function decideByStaff(input: {
  admin: SupabaseClient;
  memberId: string;
  staffUserId: string;
  approve: boolean;
  reason: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { admin, memberId } = input;
  const { data: row } = await admin
    .from("member_verifications")
    .select("member_id, club_name, status, photo_path")
    .eq("member_id", memberId)
    .maybeSingle<{ member_id: string; club_name: string; status: string; photo_path: string | null }>();
  if (!row || row.status !== "needs_review") return { ok: false, error: "That check has already been decided." };

  const now = new Date().toISOString();
  const reason = input.approve
    ? null
    : input.reason?.trim() ||
      "We couldn't confirm your membership from that photo. Try again with your Golf Ireland card or the card screen in the Golf Ireland app.";

  const { error } = await admin
    .from("member_verifications")
    .update({ status: input.approve ? "verified" : "rejected", method: "admin", reason, photo_path: null, decided_at: now, decided_by: input.staffUserId })
    .eq("member_id", memberId)
    .eq("status", "needs_review");
  if (error) return { ok: false, error: "Couldn't save — try again." };

  if (row.photo_path) await admin.storage.from(BUCKET).remove([row.photo_path]);

  if (input.approve) {
    await admin.from("verified_members").upsert({ member_id: memberId, club_name: row.club_name, verified_at: now }, { onConflict: "member_id" });
  }

  await admin.rpc("notify_user", {
    p_user_id: memberId,
    p_type: input.approve ? "verification_approved" : "verification_rejected",
    p_title: input.approve ? "You're a Verified golfer" : "We couldn't verify your card",
    p_body: input.approve ? "The Verified badge is now on your profile." : reason,
    p_data: { href: "/profile/verify" },
    p_dedupe_key: `verification:${memberId}:${now}`,
  });

  return { ok: true };
}

/** Take a badge away (staff). The member can apply again. */
export async function revokeVerification(admin: SupabaseClient, memberId: string, staffUserId: string, reason: string) {
  await admin.from("verified_members").delete().eq("member_id", memberId);
  await admin
    .from("member_verifications")
    .update({ status: "rejected", method: "admin", reason, decided_at: new Date().toISOString(), decided_by: staffUserId })
    .eq("member_id", memberId);
}

/** Signed link to a card photo for staff, valid 10 minutes. */
export async function cardPhotoUrl(admin: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
