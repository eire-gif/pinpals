import { redirect } from "next/navigation";
import { focusedInvite } from "@/lib/tee-time-focus";

/**
 * Interested golfers (the host's side) — now part of My rounds (Oct 2026).
 *
 * Every tee time a member is part of, either side, is on one page:
 * /tee-times/mine. This route stays because every tee-time notification
 * already sent, and every email, links here (src/lib/tee-times-server.ts
 * still writes these hrefs, so older versions of the app keep working too).
 * ?invite=<id> is carried across, so it opens at that round.
 */
export default async function Moved({ searchParams }: { searchParams: Promise<{ invite?: string | string[] }> }) {
  const focus = focusedInvite((await searchParams).invite);
  redirect(focus === null ? "/tee-times/mine?show=hosting" : `/tee-times/mine?invite=${focus}`);
}
