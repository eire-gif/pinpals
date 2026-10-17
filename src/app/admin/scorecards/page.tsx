import { redirect } from "next/navigation";
import { activityHref } from "@/lib/admin/live-panel";

/** /admin/scorecards on its own → today's scorecards under Activity. */
export default function AdminScorecardsIndex() {
  redirect(activityHref("scorecards"));
}
