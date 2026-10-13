import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared admin table pieces, so every list looks the same: a rounded card
 * that scrolls sideways on a phone instead of squashing, uppercase column
 * heads, quiet row hover, and one empty state.
 */
export function AdminTable({ children, empty }: { children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-2xl shadow-sm overflow-x-auto">
      {empty ?? <table className="w-full text-sm">{children}</table>}
    </div>
  );
}

export function Th({ children, className = "", narrow = false }: { children?: ReactNode; className?: string; narrow?: boolean }) {
  return (
    <th
      className={`${narrow ? "w-10 px-3" : "px-4"} py-3 text-left text-ink-500 text-xs uppercase tracking-wide font-semibold whitespace-nowrap border-b border-line ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "", narrow = false }: { children?: ReactNode; className?: string; narrow?: boolean }) {
  return <td className={`${narrow ? "w-10 px-3" : "px-4"} py-3 align-middle ${className}`}>{children}</td>;
}

export function Tr({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <tr className={`border-b border-line last:border-0 hover:bg-surface-tint ${muted ? "opacity-70" : ""}`}>{children}</tr>;
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="text-center py-14 px-6">
      <div className="font-semibold text-ink-900">{title}</div>
      {hint && <div className="text-sm text-ink-500 mt-1">{hint}</div>}
    </div>
  );
}

const PILL_TONES = {
  neutral: "bg-cream-100 text-ink-900",
  good: "bg-green-100 text-green-800",
  warn: "bg-gold-500/20 text-ink-900",
  bad: "bg-red-100 text-red-600",
  info: "bg-navy-900 text-cream-50",
} as const;

export type PillTone = keyof typeof PILL_TONES;

/** A status pill. Hidden/removed things are "bad", live things "good". */
export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-block text-xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap ${PILL_TONES[tone]}`}>{children}</span>
  );
}

/** The filter row above a list: inputs, then Filter, then a "Show hidden" toggle. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <form className="flex flex-wrap items-center gap-2 mb-4">{children}</form>;
}

export const filterInput = "px-4 py-2 rounded-full border-[1.5px] border-line bg-surface text-sm";
export const filterButton = "px-5 py-2 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition";

/** "Show hidden / removed" — a checkbox in the filter form, so it travels with the other filters. */
export function ShowHiddenToggle({ checked, label = "Show hidden" }: { checked: boolean; label?: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-ink-900 px-2 cursor-pointer">
      <input type="checkbox" name="hidden" value="1" defaultChecked={checked} className="w-4 h-4" />
      {label}
    </label>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="px-4 py-2 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
      {children}
    </Link>
  );
}
