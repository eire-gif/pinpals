import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// The super admin's "Live now" panel (0161). One call to admin_live_stats()
// for the whole thing; the shape below mirrors that function's jsonb.

export type LiveGame = {
  id: number;
  course_name: string;
  format: string;
  holes: number;
  started_at: string;
  last_score_at: string | null;
  players: number;
  thru: number;
};

export type LiveFeedItem = {
  kind: "game_started" | "game_finished" | "new_member" | "tee_time" | "listing" | "group";
  at: string;
  label: string;
};

export type LiveStats = {
  generated_at: string;
  day_start: string;
  now: {
    online: number;
    members_online: number;
    guests_online: number;
    web: number;
    ios: number;
    android: number;
    games_in_play: number;
    players_on_course: number;
    scores_last_10_min: number;
    by_section: Record<string, number>;
  };
  games: LiveGame[];
  today: {
    games_started: number;
    games_finished: number;
    scores_entered: number;
    scorecards_saved: number;
    new_members: number;
    tee_times_posted: number;
    tee_time_requests: number;
    listings_posted: number;
    messages_sent: number;
    posts: number;
    groups_created: number;
    visitors: number;
    members_active: number;
    app_opens: number;
    views: number;
    web_views: number;
    app_views: number;
    new_installs: number;
  };
  yesterday: {
    games_started: number;
    new_members: number;
    tee_times_posted: number;
    listings_posted: number;
    messages_sent: number;
    views: number;
    visitors: number;
    new_installs: number;
  };
  views_by_section: Record<string, number>;
  hourly: { hour: string; views: number; games: number; members: number }[];
  installs: {
    total: number;
    ios: number;
    android: number;
    active_7d: number;
    push_ios: number;
    push_android: number;
    push_web: number;
  };
  totals: { members: number; games: number; live_listings: number };
  feed: LiveFeedItem[];
};

/** null when the numbers can't be read — the panel says so rather than
 *  showing zeros that look real. */
export async function getLiveStats(): Promise<LiveStats | null> {
  const { data, error } = await createAdminClient().rpc("admin_live_stats", { p_tz: "Europe/Dublin" });
  if (error || !data) {
    console.error("live stats failed", error?.message);
    return null;
  }
  return data as LiveStats;
}
