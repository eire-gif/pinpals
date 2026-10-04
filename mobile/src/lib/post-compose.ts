import { router } from "expo-router";

import type { PostType } from "./post-details";

/**
 * Opens the composer for one post type — from the Create a post menu, the
 * feed's quick chips, or anywhere else that wants to start a post.
 */
export function openPostType(t: PostType, how: "push" | "replace" = "push") {
  // An open tee time is not a feed post: it has its own table, matching
  // and reminders. Hand off to that flow rather than build a second one.
  const target = t === "tee_time" ? ("/post-tee-time" as const) : { pathname: "/new-post" as const, params: { type: t } };
  if (how === "replace") router.replace(target);
  else router.push(target);
}

