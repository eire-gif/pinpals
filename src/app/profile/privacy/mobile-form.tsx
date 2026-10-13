"use client";

import { useActionState, useState } from "react";
import { confirmAddCode, removeMobile, sendAddCode, type MobileState } from "./actions";
import { formatPhone, maskPhone } from "@/lib/phone";

const input = "px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600";
const primary = "px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60";
const secondary = "px-5 py-3 rounded-full font-bold border-[1.5px] border-green-700 text-green-700 hover:bg-green-50 transition";

export default function MobileForm({ current }: { current: string | null }) {
  const [editing, setEditing] = useState(false);
  const [sent, sendAction, sending] = useActionState<MobileState, FormData>(sendAddCode, {});
  const [checked, confirmAction, confirming] = useActionState<MobileState, FormData>(confirmAddCode, {});
  const sentTo = checked.done ? undefined : (checked.sentTo ?? sent.sentTo);

  if (current && !editing) {
    return (
      <div className="grid gap-3">
        <p className="font-bold text-lg">{formatPhone(current)} <span className="text-sm font-semibold text-green-700">· verified</span></p>
        <p className="text-sm text-ink-500">You can sign in with a text code to this number. Only you can see it, unless you share it with a group in the app.</p>
        <div className="flex gap-3 flex-wrap">
          <button type="button" className={secondary} onClick={() => setEditing(true)}>Change number</button>
          <form action={removeMobile}>
            <button type="submit" className={`${secondary} border-red-600 text-red-600 hover:bg-red-100`}>Remove</button>
          </form>
        </div>
      </div>
    );
  }

  if (!sentTo) {
    return (
      <form action={sendAction} className="grid gap-3">
        <label htmlFor="phone" className="text-[13.5px] font-bold">Mobile number</label>
        <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="087 123 4567" required className={input} />
        <p className="text-[13px] text-ink-500">We&rsquo;ll text you a code. Outside Ireland, start with your country code (+44…).</p>
        {sent.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{sent.error}</p>}
        <div className="flex gap-3">
          {current && <button type="button" className={secondary} onClick={() => setEditing(false)}>Cancel</button>}
          <button type="submit" disabled={sending} className={primary}>{sending ? "Sending…" : "Text me a code"}</button>
        </div>
      </form>
    );
  }

  return (
    <form action={confirmAction} className="grid gap-3">
      <input type="hidden" name="sentTo" value={sentTo} />
      <label htmlFor="code" className="text-[13.5px] font-bold">Code sent to {maskPhone(sentTo)}</label>
      <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required
        className={`${input} text-center text-2xl tracking-[0.4em] max-w-xs`} />
      {checked.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{checked.error}</p>}
      <div>
        <button type="submit" disabled={confirming} className={primary}>{confirming ? "Checking…" : "Verify"}</button>
      </div>
    </form>
  );
}
