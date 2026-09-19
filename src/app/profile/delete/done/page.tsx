import Link from "next/link";

export const metadata = { title: "Account deleted · PinPals" };

/**
 * Public on purpose. By the time a member reaches this page their session has
 * been revoked, so anything behind a login check would bounce them to the
 * sign-in screen — which reads like the deletion failed.
 *
 * Apple asks for a confirmation that the deletion has been requested, and for
 * the member to be told how long it takes. That is the whole job of this page.
 */
export default async function DeletionRequestedPage({
  searchParams,
}: {
  searchParams: Promise<{ on?: string }>;
}) {
  const { on } = await searchParams;

  const when = on ? new Date(on) : null;
  const scheduled =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString("en-IE", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;

  return (
    <div className="max-w-xl mx-auto px-6 py-24 text-center flex flex-col gap-4">
      <h1 className="font-display font-bold text-2xl">
        Your account is being deleted
      </h1>
      <p className="text-ink-700">
        You&rsquo;ve been signed out and your account is now closed.
        {scheduled
          ? ` Everything we don't have to keep will be deleted on ${scheduled}.`
          : " Everything we don't have to keep will be deleted in 30 days."}
      </p>
      {/* No claim of a confirmation email until one is actually sent. Apple
          asks for a confirmation when the deletion completes; this page is the
          confirmation that it has started, and the completion email is still
          to be built — see the build spec. */}
      <p className="text-ink-500 text-sm">
        If you&rsquo;ve changed your mind, contact us before that date and
        we&rsquo;ll stop it.
      </p>
      <Link
        href="/"
        className="self-center mt-4 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition"
      >
        Back to PinPals
      </Link>
    </div>
  );
}
