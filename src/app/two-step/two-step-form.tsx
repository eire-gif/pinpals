"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const input = "w-full px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600 text-center text-2xl tracking-[0.4em]";
const primary = "w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60";

type Setup = { factorId: string; qr: string; secret: string };

/**
 * Enter a code from an existing authenticator, or — the first time — scan a
 * QR code into one (Google Authenticator, 1Password, Authy, Microsoft
 * Authenticator) and confirm it with its first code.
 */
export default function TwoStepForm({ hasFactor, next = "/admin" }: { hasFactor: boolean; next?: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      const verified = data?.totp.find((f) => f.status === "verified");
      if (!live) return;
      if (verified) return setFactorId(verified.id);
      if (hasFactor) return; // shouldn't happen; the list is the truth

      // First time: clear any half-finished setup, then start a fresh one.
      for (const f of data?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data: enrolled, error: enrolError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "PinPals admin" });
      if (!live) return;
      if (enrolError || !enrolled) return setError("Couldn't start setting up two-step sign-in. Refresh and try again.");
      setSetup({ factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
      setFactorId(enrolled.id);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) return;
    const token = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) return setError("Type the six-digit code from your authenticator app.");
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: token });
    if (verifyError) {
      setBusy(false);
      return setError("That code didn't work. Codes change every 30 seconds — try the current one.");
    }
    // The session is now aal2, in the cookie the server reads.
    router.replace(next);
    router.refresh();
  };

  if (!factorId && !error) return <p className="text-sm text-ink-500 text-center">Loading…</p>;

  return (
    <form onSubmit={verify} className="grid gap-4">
      {setup ? (
        <div className="grid gap-3 text-sm text-ink-700">
          <p className="font-bold text-ink-900">1. Scan this with your authenticator app</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" className="w-48 h-48 mx-auto bg-white p-2 rounded-lg" />
          <p className="text-[13px] text-ink-500">
            Can&rsquo;t scan? Enter this key instead: <code className="font-mono break-all text-ink-900">{setup.secret}</code>
          </p>
          <p className="font-bold text-ink-900">2. Type the six-digit code it shows</p>
        </div>
      ) : (
        <p className="text-sm text-ink-700">Type the six-digit code from your authenticator app.</p>
      )}
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        aria-label="Six-digit code"
        className={input}
        autoFocus
      />
      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}
      <button type="submit" disabled={busy || !factorId} className={primary}>
        {busy ? "Checking…" : setup ? "Turn on two-step sign-in" : "Continue to Admin"}
      </button>
      <p className="text-[12.5px] text-ink-500 text-center">Lost your authenticator? Another super admin can reset it, or email privacy@pinpals.ie.</p>
    </form>
  );
}
