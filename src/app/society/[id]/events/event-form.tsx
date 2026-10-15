"use client";

import { useState } from "react";

import ClubCombobox from "@/components/club-combobox";
import { ConsoleForm, Field, SubmitButton, inputClass } from "@/components/society-console/forms";
import { CLOSE_CHOICES, closeChoiceLabel, closesTextFor } from "@/lib/society-console/events-form";
import { addDays, OUTING_KINDS, tripLengthLabel, type OutingKind } from "@/lib/society-console/events-trips";
import { irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { COUNTRIES } from "@/lib/regions";
import { saveEvent } from "./form-actions";

export type EventFormValues = {
  kind: OutingKind;
  title: string;
  club: { id: number; name: string; country: string | null; place: string | null } | null;
  courseName: string;
  playsOn: string;
  endsOn: string;
  location: string;
  firstTee: string;
  fee: string;
  max: string;
  details: string;
  entryMode: "join" | "request";
  waitingList: boolean;
  autoOffer: boolean;
  guestsAllowed: boolean;
  guestFee: string;
  closeDays: number;
  arriveBy: string;
  formatLabel: string;
  dressCode: string;
  meals: string;
  revtag: string;
  iban: string;
  accountName: string;
  payCash: boolean;
  payNote: string;
};

const TRIP_SECTIONS = (kind: OutingKind) => [
  { title: "Location", body: kind === "abroad" ? "Where you're based, e.g. Vale do Lobo, Portugal" : "Where you're based, e.g. Ballybunion, Co. Kerry" },
  { title: "Days & dates", body: "A day for each date, from the first day to the last" },
  { title: "Rounds & tee times", body: "A course each day, groups and start times" },
  { title: "Accommodation", body: "Hotel, nights, who's in which room" },
  kind === "abroad" ? { title: "Flights & transfers", body: "Out and back, who's on which flight, the airport bus" } : { title: "Travel", body: "Car-share or coach, where and when to meet" },
  { title: "Notes", body: "Dinners, dress code, kitty, what to pack" },
];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
      <div>
        <h2 className="font-display font-bold text-lg text-ink-900">{title}</h2>
        {hint && <p className="text-xs text-ink-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Check({ name, label, hint, checked, onChange }: { name: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-green-700" />
      <span>
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * New event / edit event — the app's outing/new.tsx on the web. Every field
 * the app has, in the same order and words. The Server Action checks it all
 * again and the database has the last word.
 */
export default function EventForm({ groupId, outingId, initial, money, hasItinerary }: { groupId: number; outingId: number | null; initial: EventFormValues; money: boolean; hasItinerary?: boolean }) {
  const [kind, setKind] = useState<OutingKind>(initial.kind);
  const [playsOn, setPlaysOn] = useState(initial.playsOn);
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const [country, setCountry] = useState(initial.club?.country || "ireland");
  const [typed, setTyped] = useState(!initial.club && !!initial.courseName);
  const [entryMode, setEntryMode] = useState(initial.entryMode);
  const [waitingList, setWaitingList] = useState(initial.waitingList);
  const [autoOffer, setAutoOffer] = useState(initial.autoOffer);
  const [guestsAllowed, setGuestsAllowed] = useState(initial.guestsAllowed);
  const [payCash, setPayCash] = useState(initial.payCash);
  const [closeDays, setCloseDays] = useState(initial.closeDays);

  const trip = kind !== "day";
  const noun = trip ? "trip" : "outing";
  const today = irishToday();
  const choices = (CLOSE_CHOICES as readonly number[]).includes(closeDays) ? [...CLOSE_CHOICES] : [...CLOSE_CHOICES, closeDays].sort((a, b) => a - b);
  const closesText = /^\d{4}-\d{2}-\d{2}$/.test(playsOn) ? closesTextFor(playsOn, closeDays) : "";

  function pickKind(k: OutingKind) {
    setKind(k);
    if (k !== "day" && endsOn <= playsOn) setEndsOn(addDays(playsOn, 3));
  }
  function moveStart(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setPlaysOn(value);
      return;
    }
    // Move the last day with the first, keeping the trip's length.
    const days = Math.max(1, Math.round((Date.parse(endsOn) - Date.parse(playsOn)) / 86_400_000) || 3);
    setPlaysOn(value);
    setEndsOn(addDays(value, days));
  }

  return (
    <ConsoleForm action={saveEvent} className="grid gap-5">
      <input type="hidden" name="g" value={groupId} />
      {outingId && <input type="hidden" name="outing" value={outingId} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="close_days" value={closeDays} />

      <Section title="The event">
        <Field label="Name">
          <input name="title" defaultValue={initial.title} required maxLength={80} placeholder={trip ? "e.g. Algarve 2027" : "e.g. Captain's Day"} className={inputClass} />
        </Field>
        <div>
          <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-2">What kind of outing?</span>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
            {OUTING_KINDS.map((k) => {
              const on = kind === k.kind;
              const locked = hasItinerary && k.kind === "day";
              return (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={locked}
                  onClick={() => pickKind(k.kind)}
                  title={locked ? "This trip has an itinerary — remove it before making it a day out." : undefined}
                  className={`text-left rounded-xl border p-3 transition disabled:opacity-50 ${on ? "border-navy-900 bg-navy-900 text-cream-50" : "border-line bg-surface hover:bg-cream-100"}`}
                >
                  <span className="block font-semibold text-sm">{k.label}</span>
                  <span className={`block text-xs mt-0.5 ${on ? "text-cream-50/80" : "text-ink-500"}`}>{k.blurb}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={trip ? "First day" : "Date"} hint={playsOn ? outingDateLabel(playsOn) : undefined}>
            <input type="date" name="plays_on" value={playsOn} min={today} max={addDays(today, 730)} onChange={(e) => moveStart(e.target.value)} required className={inputClass} />
          </Field>
          {trip && (
            <Field label="Last day" hint={endsOn > playsOn ? tripLengthLabel(playsOn, endsOn) : undefined}>
              <input type="date" name="ends_on" value={endsOn} min={addDays(playsOn, 1)} max={addDays(playsOn, 20)} onChange={(e) => setEndsOn(e.target.value)} required className={inputClass} />
            </Field>
          )}
        </div>

        {trip ? (
          <>
            <Field label="Location" hint="Optional. Where you're based.">
              <input name="location" defaultValue={initial.location} maxLength={120} placeholder={kind === "abroad" ? "e.g. Vale do Lobo, Portugal" : "e.g. Ballybunion, Co. Kerry"} className={inputClass} />
            </Field>
            <div className="rounded-xl bg-navy-900 text-cream-50 p-4">
              <div className="text-[11px] font-bold tracking-[0.12em] text-gold-400">FULL ITINERARY</div>
              <div className="font-display font-bold text-lg">{endsOn > playsOn ? `${tripLengthLabel(playsOn, endsOn)}${kind === "abroad" ? " abroad" : ""}` : "Your trip"}</div>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {TRIP_SECTIONS(kind).map((s) => (
                  <li key={s.title} className="text-sm">
                    <span className="font-semibold">{s.title}</span> <span className="text-cream-50/75">— {s.body}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-cream-50/75 mt-2">{outingId ? "Change these on the itinerary." : "You build these day by day as soon as the trip is created."}</p>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-2">
              <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500">Course</span>
              {typed ? (
                <input name="course" defaultValue={initial.courseName} maxLength={120} placeholder="The course's name" className={inputClass} required />
              ) : (
                <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <select value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} aria-label="Country">
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <ClubCombobox name="club" country={country} defaultClubId={initial.club?.id ?? null} defaultValue={initial.club?.name ?? ""} required />
                </div>
              )}
              <button type="button" onClick={() => setTyped((v) => !v)} className="justify-self-start text-xs font-semibold text-green-700 hover:underline">
                {typed ? "Search the course list instead" : "Course not listed? Type its name"}
              </button>
            </div>
            <Field label="First tee" hint="Optional. The draw spaces the groups from here.">
              <input type="time" name="first_tee" defaultValue={initial.firstTee} className={`${inputClass} sm:max-w-[180px]`} />
            </Field>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={trip ? "Cost per person" : "Entry fee"} hint="Optional, in euro.">
            <input name="fee" inputMode="decimal" defaultValue={initial.fee} placeholder={trip ? "e.g. 650" : "e.g. 60"} className={inputClass} />
          </Field>
          <Field label="Places" hint="Optional limit.">
            <input name="max" inputMode="numeric" defaultValue={initial.max} placeholder={trip ? "e.g. 12" : "e.g. 40"} className={inputClass} />
          </Field>
        </div>
      </Section>

      <Section title="How members get a place">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {(
            [
              { mode: "join", label: "Join straight away", hint: "First come, first served." },
              { mode: "request", label: "Request a place", hint: "Members ask; you approve each one, or put them on the waiting list." },
            ] as const
          ).map((o) => (
            <label key={o.mode} className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer ${entryMode === o.mode ? "border-navy-900 bg-cream-100" : "border-line"}`}>
              <input type="radio" name="entry_mode" value={o.mode} checked={entryMode === o.mode} onChange={() => setEntryMode(o.mode)} className="mt-1 accent-green-700" />
              <span>
                <span className="block text-sm font-semibold text-ink-900">{o.label}</span>
                <span className="block text-xs text-ink-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <Check name="waiting_list" label="Waiting list when it's full" hint="Needs a limit on places." checked={waitingList} onChange={setWaitingList} />
        {waitingList ? (
          <Check name="auto_offer" label="Offer freed places automatically" hint="The next in line gets 24 hours to take it." checked={autoOffer} onChange={setAutoOffer} />
        ) : (
          autoOffer && <input type="hidden" name="auto_offer" value="on" />
        )}
        <Check name="guests_allowed" label="Members can bring guests" checked={guestsAllowed} onChange={setGuestsAllowed} />
        {guestsAllowed && (
          <Field label="Guest fee" hint="Optional. Blank: the same as the entry fee.">
            <input name="guest_fee" inputMode="decimal" defaultValue={initial.guestFee} placeholder="e.g. 80" className={`${inputClass} sm:max-w-[180px]`} />
          </Field>
        )}
        <div>
          <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-2">Entries close</span>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {choices.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={closeDays === d}
                onClick={() => setCloseDays(d)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold border ${closeDays === d ? "bg-navy-900 text-cream-50 border-navy-900" : "bg-surface border-line text-ink-900 hover:bg-cream-100"}`}
              >
                {closeChoiceLabel(d)}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500 mt-2">
            {closesText ? `${closesText}. ` : ""}Members can join, ask or cancel until then; you can change the list any time.
          </p>
        </div>
      </Section>

      {!trip && (
        <Section title="On the day">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Arrive by" hint="Optional.">
              <input type="time" name="arrive_by" defaultValue={initial.arriveBy} className={inputClass} />
            </Field>
            <Field label="Format" hint="Optional.">
              <input name="format_label" defaultValue={initial.formatLabel} maxLength={60} placeholder="Stableford" className={inputClass} />
            </Field>
          </div>
          <Field label="Dress code" hint="Optional.">
            <input name="dress_code" defaultValue={initial.dressCode} maxLength={200} placeholder="Collared shirts, no denim, soft spikes" className={inputClass} />
          </Field>
          <Field label="Meal choices" hint="Optional, separated by commas — members pick one when they get a place.">
            <input name="meals" defaultValue={initial.meals} maxLength={260} placeholder="Beef, Salmon, Vegetarian" className={inputClass} />
          </Field>
        </Section>
      )}
      {trip && <input type="hidden" name="dress_code" value={initial.dressCode} />}

      {money ? (
        <Section title="How members pay" hint={`Members see these on the ${noun}'s page with a Pay button. Only people in the society can see them.`}>
          <Field label="Revolut username" hint="Optional. Your @name in Revolut — members tap to open Revolut and pay you.">
            <input name="revtag" defaultValue={initial.revtag} maxLength={41} placeholder="@yourname" autoCapitalize="none" autoCorrect="off" className={inputClass} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank transfer — IBAN" hint="Optional.">
              <input name="iban" defaultValue={initial.iban} maxLength={42} placeholder="IE29 AIBK 9311 5212 3456 78" autoCapitalize="characters" autoCorrect="off" className={inputClass} />
            </Field>
            <Field label="Name on the account">
              <input name="account_name" defaultValue={initial.accountName} maxLength={70} className={inputClass} />
            </Field>
          </div>
          <Check name="pay_cash" label="Cash is fine" hint="Members can pay you in person." checked={payCash} onChange={setPayCash} />
          <Field label="Payment note" hint="Optional, e.g. a deadline.">
            <input name="pay_note" defaultValue={initial.payNote} maxLength={200} placeholder="By 1 May, please" className={inputClass} />
          </Field>
        </Section>
      ) : (
        <Section title="How members pay">
          <p className="text-sm text-ink-500">The treasurer, captain or secretary sets where members pay. A new event uses the society&apos;s usual details.</p>
        </Section>
      )}

      <Section title={trip ? "Trip notes" : "Details"} hint={trip ? "For every day: kitty, dress code, what to pack." : "What the fee covers, dress code, dinner, prizes — anything members should know."}>
        <textarea
          name="details"
          defaultValue={initial.details}
          maxLength={1000}
          rows={5}
          placeholder={trip ? "Kitty €100 each to the organiser by 1 May. Collared shirts. Bring your passport." : "Green fee, soup and sandwich, prizes for the top three"}
          className={inputClass}
        />
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{outingId ? "Save changes" : trip ? "Build the itinerary" : "Create the outing"}</SubmitButton>
        {!outingId && (
          <p className="text-xs text-ink-500">
            {trip ? "Members see it under Events and can join it straight away; the itinerary fills in as you add to it." : "It appears under Events for everyone in the society, and they can join it straight away."}
          </p>
        )}
      </div>
    </ConsoleForm>
  );
}
