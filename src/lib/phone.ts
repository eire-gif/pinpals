/**
 * Mobile numbers: what a member types, to the one form PinPals stores
 * (E.164, "+353871234567"), and back to something readable. Plus the links
 * a captain taps to call, text or WhatsApp.
 *
 * Pure, no imports. Byte-identical in mobile/src/lib/phone.ts — the test
 * checks.
 *
 * A number with no country code is taken as Irish ("087 123 4567"); a UK
 * mobile needs its +44. Numbers are checked for shape only — the text code is
 * what proves one is real.
 */

export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

export function normalisePhone(input: string): PhoneResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter your mobile number." };
  if (/[^0-9+()\s.-]/.test(raw)) return { ok: false, error: "Use digits only, like 087 123 4567." };

  let digits = raw.replace(/[^0-9+]/g, "");
  if (digits.indexOf("+") > 0) return { ok: false, error: "That number doesn't look right." };

  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith("+")) {
    // Irish, written the local way: 087 123 4567 → +353 87 123 4567.
    if (!digits.startsWith("0")) return { ok: false, error: "Start with 0 (like 087…) or a country code (like +44…)." };
    digits = `+353${digits.slice(1)}`;
  }
  // +353 (0)87… — the bracketed nought some people still write.
  digits = digits.replace(/^\+3530/, "+353").replace(/^\+440/, "+44");

  if (!/^\+[1-9][0-9]{6,14}$/.test(digits)) return { ok: false, error: "That number doesn't look right." };
  if (digits.startsWith("+353") && !/^\+3538[3-9][0-9]{7}$/.test(digits)) {
    return { ok: false, error: "That isn't an Irish mobile number — they start 083 to 089." };
  }
  return { ok: true, e164: digits };
}

/** "+353871234567" → "087 123 4567"; others with spaces after the code. */
export function formatPhone(e164: string): string {
  const m = /^\+353(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (m) return `0${m[1]} ${m[2]} ${m[3]}`;
  const uk = /^\+44(\d{4})(\d{6})$/.exec(e164);
  if (uk) return `+44 ${uk[1]} ${uk[2]}`;
  return e164;
}

/** Only the last few digits, for "we sent a code to … 4567". */
export function maskPhone(e164: string): string {
  return `•••• ${e164.slice(-4)}`;
}

export const telUrl = (e164: string): string => `tel:${e164}`;
export const smsUrl = (e164: string): string => `sms:${e164}`;
export const whatsappUrl = (e164: string): string => `https://wa.me/${e164.replace(/^\+/, "")}`;

/** A six-digit text code, as typed (spaces allowed). */
export function cleanCode(input: string): string | null {
  const code = input.replace(/\s/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}
