import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deletionStatus, GRACE_DAYS } from "@/lib/account-deletion";
import DeleteAccountForm from "./delete-account-form";

export const metadata = { title: "Delete your account · PinPals" };

/**
 * One page, three states: already requested, blocked by something in flight,
 * or ready to go. Apple requires that the member be told what is kept and
 * why, and how long the process takes; all of that is on this page rather
 * than behind a link, because a member deciding whether to leave should not
 * have to go and find it.
 */
export default async function DeleteAccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { pending, blockedReason } = await deletionStatus(supabase, user.id);

  const scheduled = pending
    ? new Date(pending.scheduledFor).toLocaleDateString("en-IE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="max-w-xl mx-auto px-6 py-16 flex flex-col gap-6">
      <div>
        <Link href="/profile" className="text-sm text-ink-500 hover:text-ink-900">
          ← Back to profile
        </Link>
        <h1 className="font-display font-bold text-2xl mt-3">
          Delete your account
        </h1>
      </div>

      {pending ? (
        <div className="bg-red-100 text-red-600 rounded-2xl px-5 py-4 text-sm">
          <p className="font-bold">Your account is scheduled for deletion.</p>
          <p className="mt-1">
            It will be deleted on {scheduled}. You can&rsquo;t sign in between
            now and then. If you&rsquo;ve changed your mind, email us before
            that date and we&rsquo;ll stop it.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-surface border border-line rounded-2xl p-6 text-sm text-ink-700 flex flex-col gap-4">
            <div>
              <p className="font-bold text-ink-900">What happens straight away</p>
              <ul className="mt-2 flex flex-col gap-1.5 list-disc pl-5">
                <li>You&rsquo;re signed out everywhere and can&rsquo;t sign back in.</li>
                <li>
                  Any tee times you&rsquo;re hosting are cancelled, and anyone
                  who&rsquo;d taken a place is told.
                </li>
                <li>Anything you have for sale is taken down.</li>
              </ul>
            </div>

            <div>
              <p className="font-bold text-ink-900">
                What happens after {GRACE_DAYS} days
              </p>
              <p className="mt-2">
                Your profile, photo, connections, messages, saved addresses and
                notification settings are deleted. Your name is removed from
                anything that has to stay.
              </p>
            </div>

            <div>
              <p className="font-bold text-ink-900">What we have to keep</p>
              <p className="mt-2">
                If you&rsquo;ve bought or sold on PinPals, Irish tax law
                requires us to keep the records of those transactions for six
                years — order, payment and refund history. Those records stay,
                with your name removed. Reviews you wrote about other sellers
                also stay, shown as &ldquo;Former member&rdquo;, so their
                ratings aren&rsquo;t changed by you leaving.
              </p>
            </div>

            <p className="text-ink-500 border-t border-line pt-4">
              This can&rsquo;t be undone once the {GRACE_DAYS} days are up.
            </p>
          </div>

          {blockedReason ? (
            <div className="bg-red-100 text-red-600 rounded-2xl px-5 py-4 text-sm">
              <p className="font-bold">
                You can&rsquo;t delete your account just yet.
              </p>
              <p className="mt-1">{blockedReason}</p>
              <p className="mt-2">
                Once that&rsquo;s settled, come back here and you&rsquo;ll be
                able to finish.
              </p>
            </div>
          ) : (
            <DeleteAccountForm />
          )}
        </>
      )}
    </div>
  );
}
