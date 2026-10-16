import FollowView from "./follow-view";

export const dynamic = "force-dynamic";

/**
 * A shared live scorecard (Follow my round, 0158): pinpals.ie/follow#<secret>.
 *
 * The secret is after the #, so the browser never sends it to any server —
 * it stays out of request logs and referrers. The page reads it on the phone
 * and fetches the card with it as a header (/api/follow/card). It's kept in
 * the address so a bookmark or Add to Home Screen still opens the card.
 */
export default function FollowPage() {
  return <FollowView />;
}
