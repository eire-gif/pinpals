/**
 * The console's button and input classes. A plain module (no "use client")
 * so Server Components can call buttonClass() — a helper exported from a
 * client file is only a reference on the server, and calling it crashes the
 * page.
 */

const BUTTON = {
  primary: "bg-green-700 text-cream-50 hover:bg-green-600",
  navy: "bg-navy-900 text-cream-50 hover:bg-navy-800",
  gold: "bg-gold-500 text-navy-900 hover:bg-gold-400",
  quiet: "bg-surface text-ink-900 border border-line hover:bg-cream-100",
  danger: "bg-surface text-red-600 border border-red-600/30 hover:bg-red-100",
} as const;
export type ButtonTone = keyof typeof BUTTON;

export const buttonClass = (tone: ButtonTone = "primary", size: "sm" | "md" = "md") =>
  `inline-flex items-center justify-center gap-1.5 rounded-full font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-5 py-2.5 text-sm"
  } ${BUTTON[tone]}`;

export const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500/70 focus:outline-none focus:ring-2 focus:ring-green-600/40";
