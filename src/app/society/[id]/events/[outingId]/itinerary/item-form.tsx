"use client";

import { useState } from "react";

import ClubCombobox from "@/components/club-combobox";
import { ConsoleForm, Field, SubmitButton, inputClass } from "@/components/society-console/forms";
import { GAPS, placement } from "@/lib/society-console/events-itinerary";
import { checkOutDate, dayHeading, dealIntoSlots, FORMAT_LABELS, ITEM_INFO, teeTimeFor, type ItemKind, type PlayFormat } from "@/lib/society-console/events-trips";
import { shuffle } from "@/lib/society-console/group-draw";
import { outingDateLabel } from "@/lib/society-console/outing-rules";
import { COUNTRIES } from "@/lib/regions";
import { saveItem } from "./actions";

export type ItemFormValues = {
  itemId: number | null;
  kind: ItemKind;
  onDate: string;
  title: string;
  club: { id: number; name: string; country: string | null } | null;
  startsAt: string;
  endsAt: string;
  fromPlace: string;
  toPlace: string;
  carrier: string;
  nights: number;
  gap: number;
  format: PlayFormat | null;
  details: string;
  /** member → slot (0 = on it without a slot). */
  seats: [string, number][];
  slotCount: number;
};

const FORMATS = Object.keys(FORMAT_LABELS) as PlayFormat[];

/**
 * Adding or changing one thing on a trip — the app's itinerary/item.tsx:
 * its fields by kind, and who's on it (a group each on a round, a room each
 * in a stay, ticked on a flight or a bus). Only people on the trip are
 * listed; the database allows nobody else.
 */
export default function ItemForm({
  groupId,
  outingId,
  playsOn,
  days,
  entrants,
  initial,
}: {
  groupId: number;
  outingId: number;
  playsOn: string;
  days: string[];
  entrants: { memberId: string; name: string }[];
  initial: ItemFormValues;
}) {
  const kind = initial.kind;
  const info = ITEM_INFO[kind];
  const place = placement(kind);
  const slotWord = kind === "round" ? "Group" : "Room";
  const [onDate, setOnDate] = useState(initial.onDate);
  const [country, setCountry] = useState(initial.club?.country || "portugal");
  const [startsAt, setStartsAt] = useState(initial.startsAt);
  const [gap, setGap] = useState(initial.gap);
  const [nights, setNights] = useState(initial.nights);
  const [format, setFormat] = useState<PlayFormat | null>(initial.format);
  const [seats, setSeats] = useState(() => new Map(initial.seats));
  const [slotCount, setSlotCount] = useState(Math.max(1, initial.slotCount));

  function seat(memberId: string, slot: number | null) {
    setSeats((prev) => {
      const next = new Map(prev);
      if (slot == null) next.delete(memberId);
      else next.set(memberId, slot);
      return next;
    });
  }
  function dealAtRandom() {
    const dealt = dealIntoSlots(shuffle(entrants.map((e) => e.memberId)), kind === "round" ? 4 : 2);
    setSeats(dealt);
    setSlotCount(Math.max(1, ...dealt.values()));
  }

  // In entrant order, so positions within a group follow the list (the app's rule).
  const people = entrants
    .filter((e) => seats.has(e.memberId))
    .map((e) => ({ member: e.memberId, slot: place === "slots" ? Math.min(seats.get(e.memberId) || 1, slotCount) : null }))
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
  const seated = entrants.filter((e) => seats.has(e.memberId)).length;

  return (
    <ConsoleForm action={saveItem} className="grid gap-5">
      <input type="hidden" name="g" value={groupId} />
      <input type="hidden" name="outing" value={outingId} />
      {initial.itemId && <input type="hidden" name="item" value={initial.itemId} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="gap" value={gap} />
      <input type="hidden" name="nights" value={nights} />
      <input type="hidden" name="format" value={format ?? ""} />
      {place !== "none" && <input type="hidden" name="people" value={JSON.stringify(people)} />}

      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
        <div className="text-[11px] font-bold tracking-[0.1em]" style={{ color: info.ink }}>
          {onDate ? dayHeading(playsOn, onDate).toUpperCase() : info.kicker}
        </div>
        <Field label="Day">
          <select name="on_date" value={onDate} onChange={(e) => setOnDate(e.target.value)} className={inputClass}>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayHeading(playsOn, d)}
              </option>
            ))}
          </select>
        </Field>

        {kind === "round" ? (
          <div className="grid gap-2">
            <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500">Course</span>
            <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
              <select value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} aria-label="Country">
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ClubCombobox name="club" country={country} defaultClubId={initial.club?.id ?? null} defaultValue={initial.club?.name ?? ""} />
            </div>
            <Field label="Or type the course's name" hint="If it isn't in the list.">
              <input name="title" defaultValue={initial.club ? "" : initial.title} maxLength={120} className={inputClass} />
            </Field>
          </div>
        ) : (
          <Field label={kind === "stay" ? "Hotel or house" : kind === "flight" ? "Name" : "What"}>
            <input
              name="title"
              defaultValue={initial.title}
              required
              maxLength={120}
              placeholder={kind === "stay" ? "e.g. Dona Filipa Hotel" : kind === "flight" ? "e.g. Outbound" : kind === "transfer" ? "e.g. Minibus to the hotel" : kind === "meal" ? "e.g. Welcome dinner" : "e.g. Free afternoon"}
              className={inputClass}
            />
          </Field>
        )}

        {(kind === "flight" || kind === "transfer") && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <input name="from_place" defaultValue={initial.fromPlace} maxLength={60} placeholder={kind === "flight" ? "DUB" : "Faro airport"} required={kind === "flight"} className={inputClass} />
            </Field>
            <Field label="To">
              <input name="to_place" defaultValue={initial.toPlace} maxLength={60} placeholder={kind === "flight" ? "FAO" : "Hotel"} required={kind === "flight"} className={inputClass} />
            </Field>
          </div>
        )}

        {kind !== "stay" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={kind === "round" ? "First tee" : kind === "flight" ? "Departs" : "Time"}>
              <input type="time" name="starts_at" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} />
            </Field>
            {(kind === "flight" || kind === "transfer") && (
              <Field label={kind === "flight" ? "Lands (local)" : "Arrives"}>
                <input type="time" name="ends_at" defaultValue={initial.endsAt} className={inputClass} />
              </Field>
            )}
          </div>
        )}

        {(kind === "flight" || kind === "transfer") && (
          <Field label={kind === "flight" ? "Airline and flight number" : "Company"} hint="Optional. Booking references stay with each member — they're not kept here.">
            <input name="carrier" defaultValue={initial.carrier} maxLength={60} placeholder={kind === "flight" ? "e.g. Aer Lingus EI 490" : "e.g. Algarve Golf Transfers"} className={inputClass} />
          </Field>
        )}

        {kind === "round" && (
          <>
            <div>
              <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1.5">Format</span>
              <div className="flex flex-wrap gap-1.5">
                {FORMATS.map((f) => (
                  <Chip key={f} on={format === f} onClick={() => setFormat(format === f ? null : f)}>
                    {FORMAT_LABELS[f]}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1.5">Minutes between groups</span>
              <div className="flex flex-wrap gap-1.5">
                {GAPS.map((x) => (
                  <Chip key={x} on={gap === x} onClick={() => setGap(x)}>
                    {`${x} min`}
                  </Chip>
                ))}
              </div>
            </div>
          </>
        )}

        {kind === "stay" && (
          <Field label="Nights" hint={onDate ? `Check in ${outingDateLabel(onDate)} · check out ${outingDateLabel(checkOutDate(onDate, nights))}` : undefined}>
            <input type="number" min={1} max={30} value={nights} onChange={(e) => setNights(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} className={`${inputClass} max-w-[120px]`} />
          </Field>
        )}

        <Field label="Notes" hint="Optional.">
          <textarea name="details" defaultValue={initial.details} maxLength={1000} rows={3} className={inputClass} />
        </Field>
      </section>

      {place !== "none" && (
        <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-ink-900">{place === "slots" ? (kind === "round" ? "Groups & tee times" : "Rooms") : `Who's on it · ${seated} of ${entrants.length}`}</h2>
            {entrants.length === 0 && <p className="text-xs text-ink-500">Nobody has joined the trip yet. Add members from the trip&apos;s page.</p>}
          </div>
          {entrants.length > 0 && place === "slots" && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-ink-900">
                  <span>{kind === "round" ? "Groups" : "Rooms"}</span>
                  <input type="number" min={1} max={Math.max(1, Math.min(60, entrants.length))} value={slotCount} onChange={(e) => setSlotCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} className="w-20 rounded-lg border border-line px-2 py-1.5" />
                </label>
                <button type="button" onClick={dealAtRandom} className="rounded-full bg-navy-900 text-cream-50 px-4 py-1.5 text-sm font-semibold hover:bg-navy-800">
                  {kind === "round" ? "Random draw" : "Pair at random"}
                </button>
              </div>
              {kind === "round" && startsAt && (
                <p className="text-xs text-ink-500">{Array.from({ length: slotCount }, (_, i) => `${i + 1}: ${teeTimeFor(startsAt, gap, i + 1)}`).join("   ")}</p>
              )}
              <ul className="divide-y divide-line">
                {entrants.map((e) => {
                  const s = seats.get(e.memberId);
                  return (
                    <li key={e.memberId} className="py-2 flex flex-wrap items-center gap-2">
                      <span className="flex-1 min-w-[10rem] text-sm font-semibold text-ink-900">{e.name}</span>
                      <div className="flex flex-wrap gap-1">
                        <SlotPick on={s == null} label={`${e.name}: not ${kind === "round" ? "playing" : "staying"}`} onClick={() => seat(e.memberId, null)}>
                          –
                        </SlotPick>
                        {Array.from({ length: slotCount }, (_, i) => i + 1).map((n) => (
                          <SlotPick key={n} on={s === n} label={`${e.name}: ${slotWord.toLowerCase()} ${n}`} onClick={() => seat(e.memberId, n)}>
                            {n}
                          </SlotPick>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {entrants.length > 0 && place === "list" && (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {entrants.map((e) => (
                <li key={e.memberId}>
                  <label className="flex items-center gap-2.5 text-sm text-ink-900 cursor-pointer">
                    <input type="checkbox" checked={seats.has(e.memberId)} onChange={(ev) => seat(e.memberId, ev.target.checked ? 0 : null)} className="h-4 w-4 accent-green-700" />
                    {e.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div>
        <SubmitButton>{initial.itemId ? "Save" : `Add the ${info.label.toLowerCase()}`}</SubmitButton>
      </div>
    </ConsoleForm>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold border ${on ? "bg-navy-900 text-cream-50 border-navy-900" : "border-line bg-surface hover:bg-cream-100"}`}>
      {children}
    </button>
  );
}

function SlotPick({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} onClick={onClick} className={`h-8 min-w-8 px-2 rounded-lg border text-sm font-semibold ${on ? "bg-green-700 text-cream-50 border-green-700" : "border-line bg-surface hover:bg-cream-100"}`}>
      {children}
    </button>
  );
}
