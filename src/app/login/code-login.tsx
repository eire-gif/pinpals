"use client";

import { useActionState, useState } from "react";
import { sendLoginCode, verifyLoginCode, type CodeLoginState } from "./code-actions";
import { maskPhone } from "@/lib/phone";

const input = "px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600";
const button = "mt-1 w-full py-3.5 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60";

/** "Sign in with a text code" — under the password form, closed until asked for. */
export default function CodeLogin({ next }: { next?: string }) {
  const [open, setOpen] = useState(false);
  const [sent, sendAction, sending] = useActionState<CodeLoginState, FormData>(sendLoginCode, {});
  const [checked, verifyAction, verifying] = useActionState<CodeLoginState, FormData>(verifyLoginCode, {});
  const sentTo = checked.sentTo ?? sent.sentTo;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full text-sm font-bold text-green-700 hover:text-green-600 mt-4">
        Sign in with a text code instead
      </button>
    );
  }

  return (
    <div className="mt-6 pt-6 border-t border-line grid gap-4">
      {!sentTo ? (
        <form action={sendAction} className="grid gap-3">
          <label htmlFor="phone" className="text-[13.5px] font-bold">Your mobile</label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="087 123 4567" required className={input} />
          <p className="text-[13px] text-ink-500">The number you verified on your account. We&rsquo;ll text you a code.</p>
          {sent.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{sent.error}</p>}
          <button type="submit" disabled={sending} className={button}>{sending ? "Sending…" : "Text me a code"}</button>
        </form>
      ) : (
        <form action={verifyAction} className="grid gap-3">
          {next && <input type="hidden" name="next" value={next} />}
          <input type="hidden" name="sentTo" value={sentTo} />
          <label htmlFor="code" className="text-[13.5px] font-bold">Code sent to {maskPhone(sentTo)}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required
            className={`${input} text-center text-2xl tracking-[0.4em]`} />
          <p className="text-[13px] text-ink-500">If this number is on a PinPals account, the code is on its way.</p>
          {checked.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{checked.error}</p>}
          <button type="submit" disabled={verifying} className={button}>{verifying ? "Checking…" : "Log in"}</button>
        </form>
      )}
    </div>
  );
}
