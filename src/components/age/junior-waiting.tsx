import SignOutButton from "@/components/sign-out-button";
import { maskEmail, type AgeAccess } from "@/lib/junior";
import ParentEmailForm from "./parent-email-form";

/**
 * "Waiting for your parent" — what a 13–15 year old sees on every signed-in
 * page until a parent approves (band junior_pending, 0159). They can sign in
 * and see this; nothing else involves anyone else until then.
 *
 * The address on file is shown masked (j***@gmail.com): enough to spot a
 * typo, not enough to read someone's email off a shared screen.
 */
export default function JuniorWaiting({ access }: { access: AgeAccess }) {
  const email = access.parent?.email ?? "";
  const declined = access.parent?.status === "declined" || access.parent?.status === "revoked";

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Nearly there
      </span>
      <h1 className="font-display font-bold text-3xl mt-2 mb-4">Waiting for your parent</h1>
      <div className="bg-surface rounded-2xl shadow-lg p-8 grid gap-5">
        {declined ? (
          <p className="text-ink-700">
            Your parent or guardian didn&rsquo;t approve your account. If that was a mistake, send
            the request again — or to a different parent or guardian.
          </p>
        ) : email ? (
          <p className="text-ink-700">
            We&rsquo;ve emailed <strong className="text-ink-900">{maskEmail(email)}</strong> to ask
            them to approve your account. Once they say yes, live scoring and sharing your rounds
            switch on.
          </p>
        ) : (
          <p className="text-ink-700">
            Members under 16 need a parent or guardian to approve their account. Add their email
            and we&rsquo;ll send them a link.
          </p>
        )}
        <div className="grid gap-2">
          <h2 className="font-display font-bold text-lg">{email ? "Send it again, or to someone else" : "Ask a parent"}</h2>
          <ParentEmailForm submitLabel={email ? "Send" : "Send to my parent"} />
          <p className="text-xs text-ink-500">They&rsquo;ll need their own PinPals account to approve — they can make one from the email.</p>
        </div>
        <div className="pt-4 border-t border-line">
          <SignOutButton className="text-sm font-semibold text-ink-500 hover:text-ink-900 transition" />
        </div>
      </div>
    </div>
  );
}
