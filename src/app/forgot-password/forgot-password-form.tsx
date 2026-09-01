"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordForm() {
  const [supabase] = useState(() => createClient());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const email = String(new FormData(event.currentTarget).get("email") || "").trim();
    if (!email) {
      setError("Please enter the email address for your account.");
      return;
    }

    setPending(true);
    // Sent from the browser so the reset link always points back to the exact
    // domain the member is on (which is on the Supabase redirect allow-list).
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }

    // Always report success even if the email isn't registered — this avoids
    // revealing which addresses have accounts.
    setSuccess(true);
  }

  if (success) {
    return (
      <div className="text-center py-6">
        <div className="w-16 h-16 rounded-full bg-green-100 text-green-700 flex items-center justify-center mx-auto mb-4">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 7l9 6 9-6" />
            <path d="M21 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </div>
        <h2 className="font-display font-bold text-2xl mb-2">Check your inbox</h2>
        <p className="text-ink-500">
          If that email belongs to a Pinpals account, we&rsquo;ve sent a link to reset your
          password. It expires after a short while, so use it soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-[13.5px] font-bold">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        <span className="text-xs text-ink-500">We&rsquo;ll email you a link to set a new password.</span>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {pending ? "Sending link…" : "Send reset link"}
      </button>
    </form>
  );
}
