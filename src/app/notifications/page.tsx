import { redirect } from "next/navigation";

/**
 * Notifications moved into the inbox.
 *
 * The route stays because it is baked into every notification email, every
 * push payload sent before the merge, and whatever members have bookmarked.
 * A dead link in an email from three weeks ago is not an acceptable cost of
 * tidying a URL, so this redirects rather than 404s.
 *
 * Permanent rather than temporary: the alerts-only page is not coming back.
 */
export default function NotificationsPage() {
  redirect("/inbox");
}
