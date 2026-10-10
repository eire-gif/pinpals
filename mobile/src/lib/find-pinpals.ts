import { Linking, Share } from "react-native";
import * as SecureStore from "expo-secure-store";

import { SITE_URL } from "@/lib/config";
import { supabase } from "@/lib/supabase";

/**
 * Find PinPals (0118, approved mock-ups 10 Oct 2026): people you may know,
 * who you've played with, why you'd get on, your invite link and QR code,
 * and sending a guest their scorecard.
 *
 * Everything here reads through the database functions in 0118, which do
 * the counting (mutual PinPals, rounds together) the app can't see row by
 * row, and never hand back another member's connection list.
 */

// ---------------------------------------------------------------------------
// People you may know
// ---------------------------------------------------------------------------

export type Suggestion = {
  id: string;
  name: string;
  firstName: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  homeClub: string | null;
  handicap: number | null;
  mutualCount: number;
  sameClub: boolean;
  playedTogether: boolean;
  reason: string;
};

type SuggestionRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  avatar_color: string | null;
  home_club: string | null;
  handicap: number | null;
  mutual_count: number;
  same_club: boolean;
  played_together: boolean;
  reason: string;
};

export async function loadSuggestions(limit = 20): Promise<Suggestion[]> {
  const { data, error } = await supabase.rpc("member_suggestions", { p_limit: limit });
  if (error) return [];
  return ((data ?? []) as SuggestionRow[]).map((r) => ({
    id: r.id,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ") || "A golfer",
    firstName: r.first_name || "them",
    avatarUrl: r.avatar_url,
    avatarColor: r.avatar_color,
    homeClub: r.home_club,
    handicap: r.handicap == null ? null : Number(r.handicap),
    mutualCount: r.mutual_count,
    sameClub: r.same_club,
    playedTogether: r.played_together,
    reason: r.reason,
  }));
}

/** "Not now" — they stop being suggested. */
export async function dismissSuggestion(memberId: string): Promise<void> {
  await supabase.rpc("dismiss_member_suggestion", { p_member: memberId });
}

// ---------------------------------------------------------------------------
// You've played with
// ---------------------------------------------------------------------------

export type PlayedWith = {
  playerId: number;
  roundId: number;
  playedOn: string;
  courseName: string;
  memberId: string | null;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  connection: "pending" | "accepted" | "declined" | null;
  invited: boolean;
};

export async function loadPlayedWith(days = 120): Promise<PlayedWith[]> {
  const { data, error } = await supabase.rpc("played_with_me", { p_days: days });
  if (error) return [];
  return (
    (data ?? []) as {
      player_id: number;
      round_id: number;
      played_on: string;
      course_name: string;
      member_id: string | null;
      display_name: string;
      avatar_url: string | null;
      avatar_color: string | null;
      connection_status: PlayedWith["connection"];
      invited: boolean;
    }[]
  ).map((r) => ({
    playerId: r.player_id,
    roundId: r.round_id,
    playedOn: r.played_on,
    courseName: r.course_name,
    memberId: r.member_id,
    name: r.display_name.replace(/\s*\(guest\)\s*$/i, ""),
    avatarUrl: r.avatar_url,
    avatarColor: r.avatar_color,
    connection: r.connection_status,
    invited: r.invited,
  }));
}

// ---------------------------------------------------------------------------
// Why you'd get on
// ---------------------------------------------------------------------------

export type Affinity = {
  mutualCount: number;
  mutual: { firstName: string; initials: string; avatarUrl: string | null; avatarColor: string | null }[];
  sameClub: boolean;
  clubName: string | null;
  sharedCourses: string[];
  sharedCourseCount: number;
  myHandicap: number | null;
  theirHandicap: number | null;
  roundsLogged: number;
  playedTogether: boolean;
  openRound: { id: number; playDate: string; timeFrom: string | null; exactTeeTime: string | null; clubName: string | null; spaces: number } | null;
};

export async function loadAffinity(memberId: string): Promise<Affinity | null> {
  const { data, error } = await supabase.rpc("member_affinity", { p_other: memberId });
  if (error || !data) return null;
  const a = data as Record<string, unknown> & {
    mutual?: { first_name: string | null; initials: string; avatar_url: string | null; avatar_color: string | null }[];
    open_round?: { id: number; play_date: string; time_from: string | null; exact_tee_time: string | null; club_name: string | null; spaces: number } | null;
  };
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    mutualCount: Number(a.mutual_count ?? 0),
    mutual: (a.mutual ?? []).map((m) => ({ firstName: m.first_name ?? "", initials: m.initials, avatarUrl: m.avatar_url, avatarColor: m.avatar_color })),
    sameClub: !!a.same_club,
    clubName: (a.club_name as string | null) ?? null,
    sharedCourses: (a.shared_courses as string[] | null) ?? [],
    sharedCourseCount: Number(a.shared_course_count ?? 0),
    myHandicap: num(a.my_handicap),
    theirHandicap: num(a.their_handicap),
    roundsLogged: Number(a.rounds_logged ?? 0),
    playedTogether: !!a.played_together,
    openRound: a.open_round
      ? {
          id: a.open_round.id,
          playDate: a.open_round.play_date,
          timeFrom: a.open_round.time_from,
          exactTeeTime: a.open_round.exact_tee_time,
          clubName: a.open_round.club_name,
          spaces: a.open_round.spaces,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Your invite link and QR code
// ---------------------------------------------------------------------------

export const inviteUrl = (code: string) => `${SITE_URL}/join/${code}`;
/** Drawn by the website (src/app/join/[code]/qr) — no QR library in the app. */
export const qrImageUrl = (code: string) => `${SITE_URL}/join/${code}/qr`;

export async function myInviteCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_invite_code");
  return error || typeof data !== "string" ? null : data;
}

export const inviteMessage = (code: string) =>
  `Join me on PinPals — golfers sharing tee times, live scoring and buying and selling gear. Tap to connect with me: ${inviteUrl(code)}`;

/** Connect with whoever's code this is. Returns their member id. */
export async function connectByInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc("connect_by_invite", { p_code: code.toLowerCase() });
  if (error) throw new Error(error.message);
  return data as string;
}

export const isInviteCode = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{8}$/i.test(value);

// A code opened from a link before signing in is kept until they are.
const PENDING_KEY = "pp_pending_invite";

export async function rememberPendingInvite(code: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, code.toLowerCase()).catch(() => undefined);
}

/** Called once signed in (app/_layout.tsx): connect, then forget the code. */
export async function consumePendingInvite(): Promise<string | null> {
  const code = await SecureStore.getItemAsync(PENDING_KEY).catch(() => null);
  if (!code) return null;
  await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined);
  try {
    return await connectByInvite(code);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending: WhatsApp, text, or the share sheet
// ---------------------------------------------------------------------------

export type ShareChannel = "whatsapp" | "sms" | "more";

export async function shareVia(channel: ShareChannel, message: string): Promise<void> {
  const text = encodeURIComponent(message);
  // openURL rather than canOpenURL first: canOpenURL needs each scheme
  // declared in the native build, openURL just tries. No WhatsApp (or a
  // simulator with no Messages) falls back to the share sheet.
  const url = channel === "whatsapp" ? `whatsapp://send?text=${text}` : channel === "sms" ? `sms:&body=${text}` : null;
  if (url) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // fall through
    }
  }
  await Share.share({ message });
}

// ---------------------------------------------------------------------------
// Sending a guest their scorecard
// ---------------------------------------------------------------------------

export async function guestScorecardMessage(playerId: number, guestName: string, courseName: string): Promise<string> {
  const { data, error } = await supabase.rpc("round_guest_invite", { p_player_id: playerId });
  if (error || typeof data !== "string") throw new Error(error?.message ?? "Couldn't make the link.");
  const first = guestName.split(" ")[0] || "there";
  return `Hi ${first} — here's your scorecard from ${courseName} on PinPals. Join (it's free) to keep the round and follow our games: ${SITE_URL}/guest/${data}`;
}
