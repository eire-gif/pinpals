import { Alert } from "react-native";
import { router, type Href } from "expo-router";

import { openGameFrom, openGamePath, type OpenGame } from "@/lib/open-game";
import { supabase } from "@/lib/supabase";

/**
 * What a start screen does when a game can't start. If someone in it is
 * already in an open game (0157) — the other player on the tee time got
 * there first — it says so and opens that game; anything else is shown as
 * the usual "Couldn't start" message.
 */
export function explainStartError(e: unknown, title: string): void {
  const game = openGameFrom(e);
  const message = e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string" ? (e as { message: string }).message : "Please try again.";
  if (!game) {
    Alert.alert(title, message);
    return;
  }
  Alert.alert("This game has already started", message, [
    { text: "Not now", style: "cancel" },
    { text: "Open the game", onPress: () => router.replace(openGamePath(game) as Href) },
  ]);
}

export type MyOpenGame = OpenGame & { roundId: number; startedBy: string | null; courseName: string };

/** The open game you're a player in (started in the last 8 hours), if any. */
export async function myOpenGame(): Promise<MyOpenGame | null> {
  const { data, error } = await supabase.rpc("my_open_live_game");
  if (error) return null;
  const r = ((data ?? []) as { kind: "round" | "day"; id: number; round_id: number; started_by: string | null; course_name: string }[])[0];
  return r ? { kind: r.kind, id: Number(r.id), roundId: Number(r.round_id), startedBy: r.started_by, courseName: r.course_name } : null;
}
