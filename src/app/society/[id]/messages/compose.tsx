"use client";

import { useEffect, useState, useTransition } from "react";

import { ConsoleForm, Field, SubmitButton, inputClass } from "@/components/society-console/forms";
import type { Audience } from "@/lib/society-console/data";
import { countRecipients, sendMessage } from "./actions";

/**
 * The message form, with the live count of who it would reach — the one
 * part that needs the browser. The count is the database's own
 * (society_audience_count), asked again whenever the audience or event
 * changes; sending goes through the sendMessage Server Action.
 */

type Option = { audience: Audience; label: string; needsEvent?: boolean };
type EventOption = { id: number; label: string };

const people = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;

export function Compose({ groupId, audiences, events, initialAudience, initialOuting }: { groupId: number; audiences: Option[]; events: EventOption[]; initialAudience: Audience; initialOuting: number | null }) {
  const [audience, setAudience] = useState<Audience>(initialAudience);
  const [outing, setOuting] = useState<number | null>(initialOuting);
  // The count, with the audience and event it was for, so a stale answer is never shown.
  const [counted, setCounted] = useState<{ key: string; n: number | null } | null>(null);
  const [counting, startCount] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const needsEvent = !!audiences.find((a) => a.audience === audience)?.needsEvent;
  const toEveryone = audience === "everyone";
  const key = `${audience}:${needsEvent ? (outing ?? "") : ""}`;
  const count = counted?.key === key ? counted.n : null;

  useEffect(() => {
    if (needsEvent && outing == null) return;
    let live = true;
    startCount(async () => {
      const n = await countRecipients(groupId, audience, needsEvent ? outing : null).catch(() => null);
      if (live) setCounted({ key, n });
    });
    return () => {
      live = false;
    };
  }, [groupId, audience, outing, needsEvent, key]);

  const ready = title.trim().length > 0 && (!needsEvent || outing != null) && count != null && count > 0 && !counting;

  return (
    <ConsoleForm
      action={async (prev, form) => {
        const r = await sendMessage(prev, form);
        if (r.ok) {
          setTitle("");
          setBody("");
        }
        return r;
      }}
      className="grid gap-5"
    >
      <input type="hidden" name="g" value={groupId} />

      <fieldset>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <legend className="font-display font-bold text-ink-900">Who gets it</legend>
          <span aria-live="polite" className="text-sm font-semibold text-green-700">
            {counting ? "Counting…" : count != null ? people(count) : needsEvent && outing == null ? "Choose an event" : ""}
          </span>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {audiences.map((a) => (
            <label key={a.audience} className="flex items-center gap-3 cursor-pointer rounded-xl border border-line px-3 py-2.5 text-sm text-ink-900 has-[:checked]:border-green-700 has-[:checked]:bg-green-100/50">
              <input type="radio" name="audience" value={a.audience} checked={audience === a.audience} onChange={() => setAudience(a.audience)} className="h-4 w-4 accent-green-700" />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>

      {needsEvent && (
        <Field label="Which event">
          {events.length === 0 ? (
            <p className="text-sm text-ink-500">There are no upcoming events open right now.</p>
          ) : (
            <select name="outing" value={outing ?? ""} onChange={(e) => setOuting(e.target.value ? Number(e.target.value) : null)} className={inputClass} required>
              <option value="">Choose an event…</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field label="Title">
        <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} placeholder="Title" className={inputClass} />
      </Field>
      <Field label="Message" hint={`${body.length}/1000`}>
        <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={6} placeholder="Write your message" className={inputClass} />
      </Field>

      <label className={`flex items-start gap-3 ${toEveryone ? "cursor-pointer" : "opacity-60"}`}>
        <input type="checkbox" name="notice" disabled={!toEveryone} key={String(toEveryone)} className="mt-0.5 h-4 w-4 accent-green-700" />
        <span>
          <span className="block text-sm font-semibold text-ink-900">Also post on the noticeboard</span>
          <span className="block text-xs text-ink-500">{toEveryone ? "Members see it there too." : "Only for messages to everyone. Messages about money are never posted on the noticeboard."}</span>
        </span>
      </label>

      <p className="text-xs text-ink-500">It arrives as an alert in the app that members can&apos;t turn off, so keep it for things that matter.</p>

      <div>
        {ready ? (
          <SubmitButton pendingLabel="Sending…">{`Send to ${people(count ?? 0)}`}</SubmitButton>
        ) : (
          <button type="button" disabled className="inline-flex items-center justify-center rounded-full font-semibold px-5 py-2.5 text-sm bg-green-700 text-cream-50 opacity-50 cursor-not-allowed">
            {needsEvent && outing == null ? "Choose an event" : count === 0 ? "Nobody to send it to" : "Send"}
          </button>
        )}
      </div>
    </ConsoleForm>
  );
}
