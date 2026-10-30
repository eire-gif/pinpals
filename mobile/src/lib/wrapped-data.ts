import { Linking, Platform, Share } from "react-native";

import { postToSite } from "./api";
import { HAS_IMAGE_MANIPULATOR } from "./native-capabilities";
import { savedToPhotos } from "./scorecard-photo-url";
import { supabase } from "./supabase";
import { buildWrapped, type Wrapped, type WrappedCard, type WrappedPartner } from "./wrapped";

export * from "./wrapped";

/**
 * PinPals Wrapped (claude/wrapped.md): loading the member's own rows and
 * sharing the picture. The numbers come from wrapped.ts, shared with the
 * website, which draws the same year as a story-sized picture.
 */

type CardRow = {
  club_id: number | null;
  course_name: string;
  played_on: string;
  holes: number;
  handicap_index: number | string | null;
  playing_handicap: number | null;
  live_round_id: number | null;
  club: { country: string } | null;
  scorecard_holes: { hole: number; par: number; stroke_index: number | null; strokes: number | null }[];
};

export async function loadWrapped(userId: string, year: number): Promise<Wrapped> {
  const { data, error } = await supabase
    .from("scorecards")
    .select("club_id, course_name, played_on, holes, handicap_index, playing_handicap, live_round_id, club:clubs ( country ), scorecard_holes ( hole, par, stroke_index, strokes )")
    .eq("member_id", userId)
    .lte("played_on", `${year}-12-31`)
    .order("played_on")
    .limit(3000)
    .overrideTypes<CardRow[]>();
  if (error) throw new Error("Couldn't load your year.");
  const rows = data ?? [];
  const thisYear = rows.filter((r) => r.played_on.startsWith(`${year}-`));
  const prior = new Set(rows.filter((r) => r.played_on < `${year}-01-01` && r.club_id != null).map((r) => r.club_id as number));

  const roundIds = thisYear.map((r) => r.live_round_id).filter((x): x is number => x != null);
  let dayRounds = new Set<number>();
  let partners: WrappedPartner[] = [];
  if (roundIds.length) {
    const [rounds, players] = await Promise.all([
      supabase.from("live_rounds").select("id, match_day_id").in("id", roundIds).overrideTypes<{ id: number; match_day_id: number | null }[]>(),
      supabase
        .from("live_round_players")
        .select("round_id, member_id, display_name")
        .in("round_id", roundIds)
        .overrideTypes<{ round_id: number; member_id: string | null; display_name: string }[]>(),
    ]);
    dayRounds = new Set((rounds.data ?? []).filter((r) => r.match_day_id != null).map((r) => r.id));
    const count = new Map<string, WrappedPartner>();
    for (const p of players.data ?? []) {
      if (p.member_id === userId) continue;
      const key = p.member_id ?? `guest:${p.display_name.toLowerCase().replace(/\s*\(guest\)\s*$/, "")}`;
      const name = p.display_name.replace(/\s*\(guest\)\s*$/i, "");
      const e = count.get(key);
      if (e) e.rounds += 1;
      else count.set(key, { key, name, rounds: 1 });
    }
    partners = [...count.values()];
  }

  const cards: WrappedCard[] = thisYear.map((r) => ({
    clubId: r.club_id,
    courseName: r.course_name,
    country: r.club?.country ?? null,
    playedOn: r.played_on,
    holes: r.holes,
    handicapIndex: r.handicap_index == null ? null : Number(r.handicap_index),
    playingHandicap: r.playing_handicap,
    groupDay: r.live_round_id != null && dayRounds.has(r.live_round_id),
    holeList: (r.scorecard_holes ?? [])
      .map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index, strokes: h.strokes }))
      .sort((a, b) => a.hole - b.hole),
  }));
  return buildWrapped(year, cards, partners, prior);
}

/** The member's first name, for the cover. */
export async function loadFirstName(userId: string): Promise<string | null> {
  const { data } = await supabase.from("profiles").select("first_name").eq("id", userId).maybeSingle<{ first_name: string | null }>();
  return data?.first_name ?? null;
}

function asDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read the picture."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.replace(/^data:[^;,]*;base64,/, "data:image/png;base64,"));
    };
    reader.readAsDataURL(blob);
  });
}

export type WrappedShareResult = "saved" | "shared" | "dismissed" | "opened";

/**
 * Share the year as a story-sized picture (1080×1920), drawn by the website
 * from a signed link (POST /api/app/wrapped/share). Same route to the share
 * sheet as a scorecard's photo: iPhone gets the picture itself (Save Image,
 * Instagram Stories, WhatsApp); Android opens it to download.
 */
export async function shareWrapped(year: number): Promise<WrappedShareResult> {
  const { imageUrl } = await postToSite<{ imageUrl: string }>("/api/app/wrapped/share", { year });
  if (Platform.OS === "ios" && HAS_IMAGE_MANIPULATOR) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error("Couldn't make the picture. Please try again.");
    const dataUri = await asDataUri(await res.blob());
    const { manipulateAsync, SaveFormat } = require("expo-image-manipulator") as typeof import("expo-image-manipulator");
    const file = await manipulateAsync(dataUri, [], { format: SaveFormat.PNG });
    const result = await Share.share({ url: file.uri });
    if (result.action === Share.dismissedAction) return "dismissed";
    return savedToPhotos(result.activityType) ? "saved" : "shared";
  }
  await Linking.openURL(Platform.OS === "android" ? `${imageUrl}?download=1` : imageUrl);
  return "opened";
}
