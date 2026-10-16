"use client";

import { startTransition, useActionState, useState } from "react";
import { ACCESS_LABELS, ACCESS_LEVELS, WHEN_LOCKED, WHEN_LOCKED_LABELS, type AccessLevel, type MembershipFeature, type WhenLocked } from "@/lib/memberships";
import { saveFeature, type MembershipActionState } from "./actions";

// One row of the Feature access table. Every change saves straight away (and
// is audited); with paid plans switched off none of it reaches members yet.

const SELECTED: Record<AccessLevel, string> = {
  off: "bg-line text-ink-900 shadow-sm",
  free: "bg-green-700 text-cream-50 shadow-sm",
  premium: "bg-navy-800 text-cream-50 shadow-sm",
  pro: "bg-gold-500 text-navy-900 shadow-sm",
};

export default function FeatureRow({ feature, canEdit }: { feature: MembershipFeature; canEdit: boolean }) {
  const [state, action, pending] = useActionState<MembershipActionState, FormData>(saveFeature, {});
  const [access, setAccess] = useState<AccessLevel>(feature.access);
  const [whenLocked, setWhenLocked] = useState<WhenLocked>(feature.when_locked);
  const [keep, setKeep] = useState(feature.keep_for_existing);

  function save(next: { access?: AccessLevel; whenLocked?: WhenLocked; keep?: boolean }) {
    const a = next.access ?? access;
    const w = next.whenLocked ?? whenLocked;
    const k = next.keep ?? keep;
    setAccess(a);
    setWhenLocked(w);
    setKeep(k);
    const fd = new FormData();
    fd.set("key", feature.key);
    fd.set("access", a);
    fd.set("when_locked", w);
    if (k) fd.set("keep_for_existing", "on");
    startTransition(() => action(fd));
  }

  const paid = access === "premium" || access === "pro";

  return (
    <div className="grid gap-3 py-4 border-b border-line md:grid-cols-[minmax(0,1fr)_340px_190px_160px] md:items-center md:gap-5">
      <div className="min-w-0">
        <div className="font-semibold text-ink-900">{feature.name}</div>
        {feature.description && <div className="text-xs text-ink-500 mt-0.5 leading-relaxed">{feature.description}</div>}
        {state.error && <div className="text-xs text-red-600 mt-1">{state.error}</div>}
        {pending && <div className="text-xs text-ink-500 mt-1">Saving…</div>}
      </div>

      <div role="group" aria-label={`${feature.name}: who can use it`} className="grid grid-cols-4 gap-1 bg-cream-100 p-1 rounded-xl">
        {ACCESS_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            disabled={!canEdit || pending}
            aria-pressed={access === level}
            onClick={() => level !== access && save({ access: level })}
            className={`min-h-10 rounded-lg text-[13px] font-semibold transition disabled:cursor-not-allowed ${
              access === level ? SELECTED[level] : "text-ink-500 hover:text-ink-900"
            }`}
          >
            {ACCESS_LABELS[level]}
          </button>
        ))}
      </div>

      <label className={`flex items-center gap-2.5 text-sm ${paid ? "text-ink-900" : "text-ink-500 opacity-60"}`}>
        <input
          type="checkbox"
          className="w-5 h-5 accent-navy-800"
          checked={keep}
          disabled={!canEdit || pending || !paid}
          onChange={(e) => save({ keep: e.target.checked })}
        />
        Keep for existing members
      </label>

      <label className={`flex flex-col gap-1 text-xs ${paid ? "text-ink-500" : "text-ink-500 opacity-60"}`}>
        When locked
        <select
          value={whenLocked}
          disabled={!canEdit || pending || !paid}
          onChange={(e) => save({ whenLocked: e.target.value as WhenLocked })}
          className="text-sm px-2 py-1.5 border border-line rounded-lg bg-surface text-ink-900 disabled:opacity-60"
        >
          {WHEN_LOCKED.map((w) => (
            <option key={w} value={w}>
              {WHEN_LOCKED_LABELS[w]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
