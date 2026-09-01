"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // When the emailed reset link lands here, the Supabase browser client reads
    // the recovery session out of the URL and signs the member in temporarily so
    // they can set a new password.
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setStatus("ready");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && session) setStatus("ready");
    });

    // If no recovery session appears, the link was invalid, already used, or
    // opened in a different browser from the one that requested it.
    const timer = setTimeout(() => {
      if (active) setStatus((current) => (current === "ready" ? current : "invalid"));
    }, 5000);

    return () => {
      active = false;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirm = String(form.get("confirm") || "");

    if (password.length < 6) {
      setError("Your new password needs to be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match — please retype them.");
      return;
    }

    setPending(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.push("/dashboard?password_updated=1");
  }

  if (status === "invalid") {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">
          This reset link has expired or isn&rsquo;t valid anymore. Please request a new one.
        </p>
        <a href="/forgot-password" className="inline-block mt-4 text-green-700 font-bold">
          Request a new link →
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-[13.5px] font-bold">New password</label>
        <input id="password" name="password" type="password" required minLength={6} autoComplete="new-password"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
        <span className="text-xs text-ink-500">At least 6 characters.</span>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="confirm" className="text-[13.5px] font-bold">Confirm new password</label>
        <input id="confirm" name="confirm" type="password" required minLength={6} autoComplete="new-password"
          className="px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600" />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>
      )}

      <button
        type="submit"
        disabled={pending || status !== "ready"}
        className="mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {status === "checking" ? "Verifying link…" : pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
