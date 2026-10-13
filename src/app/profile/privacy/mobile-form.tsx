"use client";

import { useActionState, useState } from "react";
import { removeMobile, saveMobile, type MobileState } from "./actions";
import { formatPhone } from "@/lib/phone";

const input = "px-3.5 py-3 rounded-lg border-[1.5px] border-line focus:outline-none focus:border-green-600";
const primary = "px-5 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60";
const secondary = "px-5 py-3 rounded-full font-bold border-[1.5px] border-green-700 text-green-700 hover:bg-green-50 transition";

export default function MobileForm({ current }: { current: string | null }) {
  const [editing, setEditing] = useState(false);
  const [state, saveAction, saving] = useActionState<MobileState, FormData>(async (prev, formData) => {
    const next = await saveMobile(prev, formData);
    if (next.done) setEditing(false);
    return next;
  }, {});

  if (current && !editing) {
    return (
      <div className="grid gap-3">
        <p className="font-bold text-lg">{formatPhone(current)}</p>
        <p className="text-sm text-ink-500">Only you can see it, unless you share it with a group in the app.</p>
        <div className="flex gap-3 flex-wrap">
          <button type="button" className={secondary} onClick={() => setEditing(true)}>Change number</button>
          <form action={removeMobile}>
            <button type="submit" className={`${secondary} border-red-600 text-red-600 hover:bg-red-100`}>Remove</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form action={saveAction} className="grid gap-3">
      <label htmlFor="phone" className="text-[13.5px] font-bold">Mobile number</label>
      <input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="087 123 4567" required
        defaultValue={current ? formatPhone(current) : ""} className={input} />
      <p className="text-[13px] text-ink-500">Outside Ireland, start with your country code (+44…).</p>
      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>}
      <div className="flex gap-3">
        {current && <button type="button" className={secondary} onClick={() => setEditing(false)}>Cancel</button>}
        <button type="submit" disabled={saving} className={primary}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
