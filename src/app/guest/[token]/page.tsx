import { notFound } from "next/navigation";

import { SOFT_CARD } from "@/components/marketplace/buy-styles";
import { isGuestToken } from "@/lib/find-pinpals";
import { shotsByHole, stablefordPoints, type CardHole } from "@/lib/live-scoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import ClaimForm from "./claim-form";

export const metadata = { title: "Your scorecard on PinPals", robots: { index: false } };

/**
 * /guest/<token> — "Send Mark his scorecard" (0118). A round's guest sees
 * their own card from that round — only theirs, read with the service role
 * because they have no account yet — and can join PinPals to keep it. The
 * token is the permission: 24 random characters, one per guest.
 */
export default async function GuestCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.toLowerCase();
  if (!isGuestToken(token)) notFound();

  const admin = createAdminClient();
  const { data: invite } = await admin
    .from("round_guest_invites")
    .select("player_id, round_id, claimed_by, invited_by")
    .eq("token", token)
    .maybeSingle<{ player_id: number; round_id: number; claimed_by: string | null; invited_by: string | null }>();
  if (!invite) notFound();

  const [{ data: round }, { data: player }, { data: holes }, { data: scores }, { data: inviter }, auth] = await Promise.all([
    admin.from("live_rounds").select("course_name, format, holes, played_on").eq("id", invite.round_id).maybeSingle<{ course_name: string; format: string; holes: number; played_on: string }>(),
    admin.from("live_round_players").select("display_name, playing_handicap").eq("id", invite.player_id).maybeSingle<{ display_name: string; playing_handicap: number }>(),
    admin.from("live_round_holes").select("hole, par, stroke_index").eq("round_id", invite.round_id).order("hole").returns<{ hole: number; par: number; stroke_index: number | null }[]>(),
    admin.from("live_round_scores").select("hole, strokes").eq("player_id", invite.player_id).returns<{ hole: number; strokes: number | null }[]>(),
    invite.invited_by
      ? admin.from("profiles").select("first_name").eq("id", invite.invited_by).maybeSingle<{ first_name: string | null }>()
      : Promise.resolve({ data: null }),
    (await createClient()).auth.getUser(),
  ]);
  if (!round || !player) notFound();

  const card: CardHole[] = (holes ?? []).map((h) => ({ hole: h.hole, par: h.par, strokeIndex: h.stroke_index }));
  const shots = shotsByHole(player.playing_handicap, card);
  const byHole = new Map((scores ?? []).map((s) => [s.hole, s.strokes]));
  const rows = card.map((h) => {
    const strokes = byHole.get(h.hole) ?? null;
    return { ...h, strokes, points: shots && strokes != null ? stablefordPoints(strokes, h.par, shots.get(h.hole) ?? 0) : null };
  });
  const totalStrokes = rows.reduce((t, r) => t + (r.strokes ?? 0), 0);
  const totalPoints = rows.every((r) => r.points == null) ? null : rows.reduce((t, r) => t + (r.points ?? 0), 0);
  const halves = rows.length > 9 ? [rows.slice(0, 9), rows.slice(9)] : [rows];
  const date = new Date(`${round.played_on}T12:00:00`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="rounded-3xl bg-navy-900 text-cream-50 p-7">
        <p className="text-xs font-bold tracking-widest uppercase text-gold-400">
          {inviter?.first_name ? `From ${inviter.first_name} · ` : ""}{round.course_name}
        </p>
        <h1 className="font-display font-bold text-3xl mt-2">{player.display_name}&rsquo;s scorecard</h1>
        <p className="text-cream-50/80 mt-1">
          {date} · {round.format === "stableford" ? "Stableford" : round.format === "stroke" ? "Stroke play" : "Match play"}
        </p>
        <div className="flex gap-8 mt-5">
          {totalPoints != null && round.format === "stableford" ? (
            <div>
              <p className="font-extrabold text-4xl text-gold-400">{totalPoints}</p>
              <p className="text-sm text-cream-50/75">points</p>
            </div>
          ) : null}
          <div>
            <p className="font-extrabold text-4xl text-gold-400">{totalStrokes || "—"}</p>
            <p className="text-sm text-cream-50/75">strokes</p>
          </div>
        </div>
      </div>

      <div className={`${SOFT_CARD} mt-5 overflow-x-auto`}>
        {halves.map((half, i) => (
          <table key={i} className={`w-full text-sm text-center ${i ? "mt-4" : ""}`}>
            <tbody>
              <tr className="text-ink-500 text-xs">
                <th className="text-left font-semibold py-1 pr-2">Hole</th>
                {half.map((r) => <td key={r.hole}>{r.hole}</td>)}
              </tr>
              <tr className="text-ink-500 text-xs">
                <th className="text-left font-semibold py-1 pr-2">Par</th>
                {half.map((r) => <td key={r.hole}>{r.par}</td>)}
              </tr>
              <tr className="font-extrabold text-navy-900">
                <th className="text-left py-1 pr-2">Score</th>
                {half.map((r) => <td key={r.hole}>{r.strokes ?? "–"}</td>)}
              </tr>
            </tbody>
          </table>
        ))}
      </div>

      <div className={`${SOFT_CARD} mt-5`}>
        {invite.claimed_by ? (
          <p className="text-center text-ink-500">This round has been saved to a PinPals profile.</p>
        ) : (
          <>
            <p className="font-extrabold text-navy-900 text-lg text-center">Keep this round</p>
            <p className="text-sm text-ink-500 text-center mt-1 mb-4">
              Join PinPals and it&rsquo;s saved to your profile{inviter?.first_name ? `, and you're connected with ${inviter.first_name}` : ""}. Free, and it takes a minute.
            </p>
            <ClaimForm token={token} signedIn={!!auth.data.user} />
          </>
        )}
      </div>
    </div>
  );
}
