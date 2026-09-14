/**
 * The one definition of what a form field looks like.
 *
 * This string used to be copy-pasted — six times as a local `inputClass`
 * constant (both listing forms, the item-details block, the description
 * field, both comboboxes) and eleven more times inline in the tee-time
 * availability form. Seventeen copies of one visual decision is seventeen
 * chances for them to drift apart, and they had: the same disabled field
 * was `opacity-50` in one form and `opacity-60` in the next.
 *
 * SELECT_CLASS exists because a <select> is not a styled box on iOS.
 * Safari keeps `-webkit-appearance: menulist-button` unless it's told
 * otherwise — Tailwind's preflight resets a select's font and background
 * but deliberately leaves its appearance alone — and a native menulist
 * ignores most of the padding it's given and draws its own height. So on
 * an iPhone every select in a form came out shorter than the text inputs
 * above and below it, with its text on a different baseline. On desktop
 * Chrome the difference is a pixel and invisible; on a phone it's the
 * reason a form reads as crooked.
 *
 * `select-chevron` (see globals.css) turns the appearance off and paints
 * the arrow back on, since `appearance: none` takes the native one with
 * it. Note that SELECT_CLASS is built from FIELD_BASE rather than from
 * FIELD_CLASS: it needs a wider right padding to clear that arrow, and
 * composing `px-3.5` with `pr-10` would leave the result depending on
 * which of the two Tailwind happens to emit last. Only one padding
 * utility per axis reaches the element, so there is nothing to resolve.
 *
 * Disabled styling is deliberately NOT included. It varies by control —
 * a field that is merely waiting on a category reads differently from one
 * the listing's state has locked — so each usage still appends its own
 * `disabled:opacity-*`, and appending it can't collide with a value set
 * here.
 */
const FIELD_BASE =
  "w-full py-3 rounded-lg border-[1.5px] border-line bg-surface focus:outline-none focus:border-green-600";

/** Text inputs, number inputs, date/time inputs, textareas. */
export const FIELD_CLASS = `${FIELD_BASE} px-3.5`;

/** Every <select>. Matches FIELD_CLASS's box exactly, arrow included. */
export const SELECT_CLASS = `${FIELD_BASE} pl-3.5 pr-10 select-chevron`;
