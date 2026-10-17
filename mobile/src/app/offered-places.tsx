import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Places offered to you — now part of My rounds (Oct 2026).
 *
 * Every tee time a member is part of, either side, is on one page:
 * app/my-rounds.tsx. This route stays so that old links, alerts already in
 * people's inboxes and anything bookmarked still land somewhere sensible.
 * ?invite=<id> is carried across, so it opens at that round.
 */
export default function Moved() {
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const round = invite && /^\d{1,15}$/.test(invite) ? invite : null;
  const params = round ? { invite: round } : { show: "requested" };
  return <Redirect href={{ pathname: "/my-rounds", params }} />;
}
