"use client";

import { useState } from "react";
import { dateFromParts } from "@/lib/junior";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const select =
  "w-full px-3 py-3 rounded-lg border-[1.5px] border-line bg-surface focus:outline-none focus:border-green-600";

/**
 * Date of birth as three selects — day, month, year (0159). Neutral on
 * purpose: years run from this year back 100 with nothing marking a minimum
 * age, so the form doesn't teach anyone which year to pick.
 *
 * Submits `dobDay`, `dobMonth`, `dobYear` (the server joins them with
 * dateFromParts()), and tells the parent the joined YYYY-MM-DD as it changes
 * so the sign-up form can ask for a parent's email when it needs one.
 */
export default function DateOfBirthFields({
  idPrefix = "dob",
  onChange,
  required = true,
}: {
  idPrefix?: string;
  onChange?: (isoDate: string) => void;
  required?: boolean;
}) {
  const [parts, setParts] = useState({ day: "", month: "", year: "" });
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 101 }, (_, i) => thisYear - i);

  function update(key: "day" | "month" | "year", value: string) {
    const next = { ...parts, [key]: value };
    setParts(next);
    onChange?.(dateFromParts(next.day, next.month, next.year));
  }

  return (
    <fieldset className="grid gap-1.5 min-w-0">
      <legend className="text-[13.5px] font-bold mb-1.5">Date of birth</legend>
      <div className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2">
        <label className="sr-only" htmlFor={`${idPrefix}-day`}>Day</label>
        <select id={`${idPrefix}-day`} name="dobDay" required={required} value={parts.day} onChange={(e) => update("day", e.target.value)} className={select} autoComplete="bday-day">
          <option value="">Day</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${idPrefix}-month`}>Month</label>
        <select id={`${idPrefix}-month`} name="dobMonth" required={required} value={parts.month} onChange={(e) => update("month", e.target.value)} className={select} autoComplete="bday-month">
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`${idPrefix}-year`}>Year</label>
        <select id={`${idPrefix}-year`} name="dobYear" required={required} value={parts.year} onChange={(e) => update("year", e.target.value)} className={select} autoComplete="bday-year">
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}
