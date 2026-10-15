import type { Metadata } from "next";
import Link from "next/link";

import { verifyTvToken } from "@/lib/tv-token";

import TvBoardView from "../../tv-board-view";
import TvShell from "../../tv-shell";

export const metadata: Metadata = { title: "PinPals · Live leaderboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** A clubhouse TV showing one game's leaderboard. The token in the address
 *  is the signed link from the organiser's "Show on TV" (src/lib/tv-token.ts). */
export default async function TvScreenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!verifyTvToken(token)) {
    return (
      <TvShell className="tv-pair">
        <div className="tv-eyebrow">PinPals · Clubhouse screen</div>
        <div>
          <h1 className="tv-display">This TV link has expired</h1>
          <p className="tv-sub" style={{ fontSize: 32, marginTop: 24 }}>
            TV links last three days. Open <Link href="/tv" style={{ color: "var(--tv-gold)" }}>pinpals.ie/tv</Link> to pair the screen again.
          </p>
        </div>
        <div className="tv-bottom">
          <span />
          <span>pinpals.ie/tv</span>
        </div>
      </TvShell>
    );
  }
  return <TvBoardView token={token} />;
}
