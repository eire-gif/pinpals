/** TV pairing codes (Oct 2026), kept apart from tv.ts so they test without
 *  React Native. Same rule as the website's src/lib/tv-token.ts. */

/** As the website reads codes: no 0/O, 1/I/L, so nothing is misread off a screen. */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

/** "k7q 4mp" → "K7Q4MP"; null until it's a whole, valid code. */
export function normaliseTvCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return CODE_RE.test(code) ? code : null;
}

/** What the box shows while typing: capitals, no spaces, six at most. */
export function tidyTvCodeInput(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}
