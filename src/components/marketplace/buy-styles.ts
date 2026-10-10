/**
 * The marketplace's buying journey looks the same on the website as in the
 * app (Oct 2026 redesign, approved mock-ups 1–4): navy and gold, soft white
 * cards, and ONE gold button raised on a darker gold lip for the step that
 * spends money — Buy now, Reserve and pay, Pay now, Confirm handover.
 */

/** The money button. Pair with a <button> or <Link>. */
export const GOLD_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full bg-gold-400 text-navy-900 font-extrabold " +
  "px-6 py-3.5 shadow-[0_3px_0_#9c7a2c] hover:brightness-105 active:translate-y-[3px] active:shadow-none " +
  "transition disabled:opacity-45 disabled:pointer-events-none";

/** The quieter partner: navy outline. */
export const NAVY_OUTLINE_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full border-[1.5px] border-navy-900 text-navy-900 font-bold " +
  "px-5 py-3 hover:bg-navy-900 hover:text-gold-400 transition disabled:opacity-45";

/** A white card with a soft navy shadow, as the app draws them. */
export const SOFT_CARD = "bg-surface rounded-2xl p-5 shadow-[0_3px_14px_rgba(12,32,56,0.08)]";

export const CARD_TITLE = "font-extrabold text-[17px] text-navy-900";
