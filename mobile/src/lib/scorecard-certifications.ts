import { postToSite } from "./api";
import type { CertifyMethod } from "./certify-device";
import type { ScorecardHole } from "./scorecard-math";
import { supabase } from "./supabase";

/**
 * Scorecard certification — reads and writes (0128,
 * claude/scorecard-certification.md).
 *
 * Every write goes through a SQL function that checks who may do it; after
 * each one the site is asked to tell the other person (best effort — the
 * write has happened whether or not the notification goes).
 */

export type CertificationStatus = "pending" | "certified" | "queried" | "declined" | "void" | "cancelled" | "expired";

export type Certification = {
  id: number;
  scorecardId: number;
  certifierId: string | null;
  certifierName: string;
  status: CertificationStatus;
  method: CertifyMethod | null;
  queryHole: number | null;
  queryNote: string | null;
  requestedAt: string;
  expiresAt: string;
  respondedAt: string | null;
};

type Row = {
  id: number;
  scorecard_id: number;
  certifier_id: string | null;
  certifier_name: string;
  status: Exclude<CertificationStatus, "expired">;
  method: CertifyMethod | null;
  query_hole: number | null;
  query_note: string | null;
  requested_at: string;
  expires_at: string;
  responded_at: string | null;
};

const COLUMNS = "id, scorecard_id, certifier_id, certifier_name, status, method, query_hole, query_note, requested_at, expires_at, responded_at";

const toCertification = (r: Row): Certification => ({
  id: r.id,
  scorecardId: r.scorecard_id,
  certifierId: r.certifier_id,
  certifierName: r.certifier_name,
  status: r.status === "pending" && new Date(r.expires_at).getTime() <= Date.now() ? "expired" : r.status,
  method: r.method,
  queryHole: r.query_hole,
  queryNote: r.query_note,
  requestedAt: r.requested_at,
  expiresAt: r.expires_at,
  respondedAt: r.responded_at,
});

const notify = (id: number) => void postToSite(`/api/app/scorecards/certifications/${id}/notify`, {}).catch(() => undefined);

const messageOf = (e: unknown, fallback: string) => {
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : fallback;
};

/**
 * The latest request or certificate on a card that the viewer may see: the
 * owner sees every state; anyone else only a certificate.
 */
export async function loadCertification(scorecardId: number): Promise<Certification | null> {
  const { data, error } = await supabase
    .from("scorecard_certifications")
    .select(COLUMNS)
    .eq("scorecard_id", scorecardId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw error;
  return data ? toCertification(data) : null;
}

/** Which of these cards are certified. Never throws: a list without ticks is fine. */
export async function certifiedIds(scorecardIds: number[]): Promise<Set<number>> {
  if (scorecardIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("scorecard_certifications")
    .select("scorecard_id")
    .in("scorecard_id", scorecardIds)
    .eq("status", "certified")
    .overrideTypes<{ scorecard_id: number }[]>();
  if (error) return new Set();
  return new Set((data ?? []).map((r) => r.scorecard_id));
}

export type Candidate = {
  memberId: string;
  name: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  playedInRound: boolean;
};

/** Who you can ask to certify this card of yours. */
export async function loadCandidates(scorecardId: number): Promise<Candidate[]> {
  const { data, error } = await supabase.rpc("scorecard_certify_candidates", { p_scorecard_id: scorecardId });
  if (error) throw new Error(messageOf(error, "Couldn't load your playing partners."));
  return (
    (data ?? []) as { member_id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null; played_in_round: boolean }[]
  ).map((r) => ({
    memberId: r.member_id,
    name: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "A PinPal",
    avatarUrl: r.avatar_url,
    avatarColor: r.avatar_color,
    playedInRound: r.played_in_round,
  }));
}

export async function requestCertification(scorecardId: number, certifierId: string): Promise<number> {
  const { data, error } = await supabase.rpc("scorecard_certify_request", { p_scorecard_id: scorecardId, p_certifier: certifierId });
  if (error) throw new Error(messageOf(error, "Couldn't send the request."));
  const id = Number(data);
  notify(id);
  return id;
}

/** A request, as the certifier (or owner) opens it. */
export type OpenedRequest = {
  id: number;
  scorecardId: number;
  status: CertificationStatus;
  role: "owner" | "certifier";
  challenge: string | null;
  cardHash: string | null;
  certifierName: string;
  method: CertifyMethod | null;
  queryHole: number | null;
  queryNote: string | null;
  expiresAt: string;
  respondedAt: string | null;
  owner: { id: string; name: string; firstName: string; avatarUrl: string | null; avatarColor: string | null };
  /** Null for the certifier once the request is closed (not pending or certified). */
  card: {
    courseName: string;
    teeName: string | null;
    holes: 9 | 18;
    playedOn: string;
    handicapIndex: number | null;
    playingHandicap: number | null;
  } | null;
  holeList: ScorecardHole[];
};

export async function openRequest(id: number): Promise<OpenedRequest> {
  const { data, error } = await supabase.rpc("scorecard_certification_open", { p_id: id });
  if (error) throw new Error(messageOf(error, "Couldn't open this request."));
  const o = data as {
    id: number;
    scorecard_id: number;
    status: CertificationStatus;
    role: "owner" | "certifier";
    challenge: string | null;
    card_hash: string | null;
    certifier_name: string;
    method: CertifyMethod | null;
    query_hole: number | null;
    query_note: string | null;
    expires_at: string;
    responded_at: string | null;
    owner: { id: string; first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null };
    card: { course_name: string; tee_name: string | null; holes: number; played_on: string; handicap_index: number | string | null; playing_handicap: number | null } | null;
    hole_list: { hole: number; par: number; stroke_index: number | null; yards: number | null; strokes: number | null; putts: number | null }[] | null;
  };
  return {
    id: o.id,
    scorecardId: o.scorecard_id,
    status: o.status,
    role: o.role,
    challenge: o.challenge,
    cardHash: o.card_hash,
    certifierName: o.certifier_name,
    method: o.method,
    queryHole: o.query_hole,
    queryNote: o.query_note,
    expiresAt: o.expires_at,
    respondedAt: o.responded_at,
    owner: {
      id: o.owner.id,
      name: [o.owner.first_name, o.owner.last_name].filter(Boolean).join(" ").trim() || "A PinPal",
      firstName: o.owner.first_name?.trim() || "A PinPal",
      avatarUrl: o.owner.avatar_url,
      avatarColor: o.owner.avatar_color,
    },
    card: o.card
      ? {
          courseName: o.card.course_name,
          teeName: o.card.tee_name,
          holes: o.card.holes === 9 ? 9 : 18,
          playedOn: o.card.played_on,
          handicapIndex: o.card.handicap_index == null ? null : Number(o.card.handicap_index),
          playingHandicap: o.card.playing_handicap,
        }
      : null,
    holeList: (o.hole_list ?? []).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index, yards: h.yards, strokes: h.strokes, putts: h.putts })),
  };
}

/** Thrown when the server no longer recognises this phone's key: set it up again and retry. */
export class StaleCertifyKey extends Error {}

export async function certify(id: number, method: CertifyMethod, keyId: string | null, signature: string | null): Promise<void> {
  const { error } = await supabase.rpc("scorecard_certify", { p_id: id, p_key_id: keyId, p_signature: signature, p_method: method });
  if (error) {
    if ((error as { hint?: string }).hint === "certify_key") throw new StaleCertifyKey(error.message);
    throw new Error(messageOf(error, "Couldn't certify the card."));
  }
  notify(id);
}

export async function queryHole(id: number, hole: number, note: string): Promise<void> {
  const { error } = await supabase.rpc("scorecard_certification_query", { p_id: id, p_hole: hole, p_note: note.trim() || null });
  if (error) throw new Error(messageOf(error, "Couldn't send your query."));
  notify(id);
}

export async function declineRequest(id: number): Promise<void> {
  const { error } = await supabase.rpc("scorecard_certification_decline", { p_id: id });
  if (error) throw new Error(messageOf(error, "Couldn't decline the request."));
  notify(id);
}

export type WaitingRequest = {
  id: number;
  ownerName: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  courseName: string;
  playedOn: string;
};

/** Cards people have asked me to certify. Never throws: an empty list is fine. */
export async function loadWaitingRequests(): Promise<WaitingRequest[]> {
  const { data, error } = await supabase.rpc("my_certification_requests");
  if (error) return [];
  return (
    (data ?? []) as { id: number; first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null; course_name: string; played_on: string }[]
  ).map((r) => ({
    id: r.id,
    ownerName: [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || "A PinPal",
    avatarUrl: r.avatar_url,
    avatarColor: r.avatar_color,
    courseName: r.course_name,
    playedOn: r.played_on,
  }));
}

/** "12 Oct, 17:42" in Irish time. */
export function certifiedAtLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
  const time = d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin" });
  return `${day}, ${time}`;
}
