import type { Metadata } from "next";
import { redirect } from "next/navigation";

import FollowView from "@/app/follow/follow-view";
import "@/app/follow/follow.css";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Following a round · PinPals", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * A card a PinPal shared with you (Follow my round, 0158), on the website.
 *
 * The app opens this itself when it has the Following screen; this page is
 * for everything else — an app too old to have that screen (it opens the
 * alert's link here in its web view, already signed in) and a computer. It
 * shows the same live card as the link page, read with the member's own
 * session (/api/follow/mine/<id>), so only the follower, the sharer or the
 * golfer whose card it is can see it.
 */
export default async function LiveFollowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const followId = Number(id);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/live/follow/${Number.isSafeInteger(followId) && followId > 0 ? followId : ""}`)}`);

  return (
    <div className="fl-root">
      <FollowView followId={Number.isSafeInteger(followId) && followId > 0 ? followId : -1} />
    </div>
  );
}
