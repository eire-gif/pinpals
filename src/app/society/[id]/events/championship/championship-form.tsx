"use client";

import { useState } from "react";

import ClubCombobox from "@/components/club-combobox";
import { ConsoleForm, Field, SubmitButton, inputClass } from "@/components/society-console/forms";
import { DAY_FORMATS, canAddUp, dayFormat, resolveRule, ruleLine, type ChampionshipRule } from "@/lib/championship";
import { addDays } from "@/lib/society-console/events-trips";
import { irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { COUNTRIES } from "@/lib/regions";
import { saveChampionship } from "./actions";

export type ChampionshipFormDay = {
  playsOn: string;
  club: { id: number; name: string; country: string | null } | null;
  courseName: string;
  firstTee: string;
  format: string;
  /** Played or started: can't be changed any more. */
  locked?: boolean;
};

export type ChampionshipFormValues = {
  title: string;
  rule: ChampionshipRule;
  fee: string;
  max: string;
  details: string;
  days: ChampionshipFormDay[];
};

function DayCard({ i, day, onChange }: { i: number; day: ChampionshipFormDay; onChange: (d: ChampionshipFormDay) => void }) {
  const [country, setCountry] = useState(day.club?.country || "ireland");
  const [typed, setTyped] = useState(!day.club && !!day.courseName);
  const today = irishToday();
  if (day.locked) {
    return (
      <div className="rounded-xl border border-line bg-cream-50 p-4">
        <div className="text-[11px] font-bold tracking-[0.12em] text-ink-500">DAY {i + 1} · PLAYED OR STARTED</div>
        <div className="font-semibold text-ink-900">{day.courseName}</div>
        <div className="text-sm text-ink-500">
          {outingDateLabel(day.playsOn)} · {dayFormat(day.format).label}
        </div>
        <input type="hidden" name={`plays_on_${i}`} value={day.playsOn} />
        <input type="hidden" name={`course_${i}`} value={day.courseName} />
        {day.club && <input type="hidden" name={`club_${i}`} value={day.club.id} />}
        <input type="hidden" name={`first_tee_${i}`} value={day.firstTee} />
        <input type="hidden" name={`format_${i}`} value={day.format} />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line p-4 grid gap-3">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-gold-400 text-navy-900 leading-none">
          <span className="text-[9px] font-bold tracking-widest">DAY</span>
          <span className="text-lg font-extrabold -mt-2">{i + 1}</span>
        </span>
        <div className="grid gap-3 sm:grid-cols-3 flex-1">
          <Field label="Date" hint={day.playsOn ? outingDateLabel(day.playsOn) : undefined}>
            <input type="date" name={`plays_on_${i}`} value={day.playsOn} min={today} max={addDays(today, 730)} onChange={(e) => onChange({ ...day, playsOn: e.target.value })} required className={inputClass} />
          </Field>
          <Field label="First tee" hint="Optional">
            <input type="time" name={`first_tee_${i}`} value={day.firstTee} onChange={(e) => onChange({ ...day, firstTee: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Format">
            <select name={`format_${i}`} value={day.format} onChange={(e) => onChange({ ...day, format: e.target.value })} className={inputClass}>
              {DAY_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <div className="grid gap-2">
        <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500">Course</span>
        {typed ? (
          <input name={`course_${i}`} defaultValue={day.courseName} maxLength={120} placeholder="The course's name" className={inputClass} required />
        ) : (
          <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
            <select value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} aria-label={`Country for day ${i + 1}`}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            <ClubCombobox name={`club_${i}`} country={country} defaultClubId={day.club?.id ?? null} defaultValue={day.club?.name ?? ""} required />
          </div>
        )}
        <button type="button" onClick={() => setTyped((v) => !v)} className="justify-self-start text-xs font-semibold text-green-700 hover:underline">
          {typed ? "Search the course list instead" : "Course not listed? Type its name"}
        </button>
      </div>
    </div>
  );
}

/**
 * New / change a multi-day championship: 2, 3 or 4 days, a course, first
 * tee and format each day, and how the days add up. The app's set-up screen
 * on the web. Each day becomes an ordinary event (entries, draw, live day,
 * results) under the championship.
 */
export default function ChampionshipForm({ groupId, championshipId, initial }: { groupId: number; championshipId: number | null; initial: ChampionshipFormValues }) {
  const [days, setDays] = useState<ChampionshipFormDay[]>(initial.days);
  const [rule, setRule] = useState<ChampionshipRule>(initial.rule);
  const locked = days.filter((d) => d.locked).length;

  function setCount(n: number) {
    setDays((cur) => {
      if (n <= cur.length) return cur.slice(0, Math.max(n, locked));
      const out = [...cur];
      while (out.length < n) {
        const last = out[out.length - 1];
        out.push({ playsOn: last ? addDays(last.playsOn, 1) : addDays(irishToday(), 14), club: null, courseName: "", firstTee: last?.firstTee ?? "", format: last?.format ?? "stableford" });
      }
      return out;
    });
  }

  const kinds = days.map((d) => dayFormat(d.format).kind);
  const resolved = resolveRule(rule, kinds);
  const line = ruleLine(resolved, kinds);

  return (
    <ConsoleForm action={saveChampionship} className="grid gap-5">
      <input type="hidden" name="g" value={groupId} />
      {championshipId && <input type="hidden" name="championship" value={championshipId} />}
      <input type="hidden" name="days" value={days.length} />
      <input type="hidden" name="rule" value={rule} />

      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
        <Field label="Name">
          <input name="title" defaultValue={initial.title} maxLength={80} placeholder="e.g. Autumn Classic 2026" required className={inputClass} />
        </Field>
        <div>
          <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1">How many days?</span>
          <div role="radiogroup" aria-label="How many days" className="flex gap-2">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={days.length === n}
                disabled={n < locked}
                onClick={() => setCount(n)}
                className={`px-5 py-2.5 rounded-xl font-bold text-sm border transition ${days.length === n ? "bg-gold-400 border-gold-400 text-navy-900" : "bg-surface border-line text-ink-900 hover:border-gold-400"} disabled:opacity-40`}
              >
                {n} days
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
        <div>
          <h2 className="font-display font-bold text-lg text-ink-900">A course and format for each day</h2>
          <p className="text-xs text-ink-500 mt-0.5">Days in date order, within three weeks. Each day gets its own entries, draw and live day, like any day out.</p>
        </div>
        {days.map((d, i) => (
          <DayCard key={i} i={i} day={d} onChange={(nd) => setDays((cur) => cur.map((x, k) => (k === i ? nd : x)))} />
        ))}
      </section>

      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-3">
        <h2 className="font-display font-bold text-lg text-ink-900">The overall leaderboard</h2>
        <div className="rounded-xl bg-green-700/10 border border-green-700/30 p-4">
          <div className="font-bold text-ink-900">{line.title}</div>
          <p className="text-sm text-ink-900 mt-0.5">{line.body}</p>
        </div>
        {canAddUp(kinds) && (
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={rule === "places"} onChange={(e) => setRule(e.target.checked ? "places" : "auto")} className="mt-0.5 h-4 w-4 accent-green-700" />
            <span>
              <span className="block text-sm font-semibold text-ink-900">Use places points instead</span>
              <span className="block text-xs text-ink-500">Each day ranks the field and awards 25, 20, 16, 13… — like an order of merit.</span>
            </span>
          </label>
        )}
        <p className="text-xs text-ink-500">Arrows show each player&apos;s place against the end of the day before. Level at the end: the better final day wins, then the day before.</p>
      </section>

      <section className="bg-surface rounded-2xl border border-line shadow-sm p-5 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entry fee" hint="Optional, in euro, charged on day 1.">
            <input name="fee" inputMode="decimal" defaultValue={initial.fee} placeholder="e.g. 120" className={inputClass} />
          </Field>
          <Field label="Places" hint="Optional limit, each day.">
            <input name="max" inputMode="numeric" defaultValue={initial.max} placeholder="e.g. 40" className={inputClass} />
          </Field>
        </div>
        <Field label="Details" hint="Optional. Shown on every day.">
          <textarea name="details" defaultValue={initial.details} maxLength={1000} rows={3} className={inputClass} />
        </Field>
      </section>

      <div>
        <SubmitButton pendingLabel="Saving…">{championshipId ? "Save changes" : `Create ${days.length}-day championship`}</SubmitButton>
      </div>
    </ConsoleForm>
  );
}
