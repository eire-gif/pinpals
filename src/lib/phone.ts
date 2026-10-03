/**
 * Phone number normalisation for the optional sign-up field.
 *
 * ============ Why this is hand-rolled ============
 *
 * The obvious answer is libphonenumber. It is also ~150KB, it is a
 * dependency that has to be kept current as numbering plans change, and
 * the entire job here is: take what an Irish or UK golfer typed into a box
 * and turn it into E.164. Pinpals covers Ireland, Northern Ireland,
 * England, Scotland and Wales — two dialling plans, one of which (+44)
 * already covers Northern Ireland. A member from anywhere else can type a
 * full international number and it is accepted as given.
 *
 * What this deliberately does NOT do is claim the number is real,
 * reachable, or a mobile. It is not verified — no SMS is sent — so the
 * only honest guarantee is "this is shaped like a phone number". The
 * database CHECK in migration 0074 says the same thing and no more.
 *
 * If phone verification is ever added, this function stays exactly as it
 * is: normalisation and verification are different jobs, and conflating
 * them is how you end up unable to store a number you have not yet
 * verified.
 */

export type PhoneRegion = "IE" | "GB" | "INT";

export const PHONE_REGIONS: readonly { value: PhoneRegion; label: string; dialCode: string }[] = [
  { value: "IE", label: "Ireland (+353)", dialCode: "+353" },
  { value: "GB", label: "UK & Northern Ireland (+44)", dialCode: "+44" },
  { value: "INT", label: "Somewhere else", dialCode: "" },
] as const;

export function isPhoneRegion(value: string): value is PhoneRegion {
  return PHONE_REGIONS.some((region) => region.value === value);
}

/** E.164: a plus, a non-zero country digit, then 6–14 more. Mirrors the CHECK in migration 0074. */
const E164 = /^\+[1-9][0-9]{6,14}$/;

export type PhoneResult =
  | { ok: true; e164: string | null }
  | { ok: false; error: string };

/**
 * Turns what a member typed into E.164, or explains why it can't.
 *
 * An empty input is `{ ok: true, e164: null }` rather than an error — the
 * field is optional, and "left blank" is a valid answer that callers must
 * not have to special-case before calling.
 *
 * Handling of a leading zero is the part worth knowing about: "087 123
 * 4567" and "+353 87 123 4567" are the same number written the two ways
 * people actually write them, so a leading national trunk zero is dropped
 * and replaced by the selected region's dial code. A number that already
 * starts with "+" is taken at face value and the region ignored, because
 * someone who typed a country code knows better than the dropdown does.
 */
export function normalisePhone(raw: string, region: PhoneRegion): PhoneResult {
  // Strip everything people put in phone numbers for legibility. A leading
  // "+" is preserved separately because the strip would otherwise eat it.
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, e164: null };

  const startsInternational = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/[^0-9]/g, "");

  if (!digits) {
    return { ok: false, error: "That doesn't look like a phone number." };
  }

  let candidate: string;

  if (startsInternational) {
    // "00353…" is the same as "+353…" — both are how a member might write
    // an international number, and neither should be treated as national.
    const withoutPrefix = trimmed.startsWith("00") ? digits.replace(/^00/, "") : digits;
    candidate = `+${withoutPrefix}`;
  } else if (region === "INT") {
    return {
      ok: false,
      error: "Start with your country code, like +33 6 12 34 56 78.",
    };
  } else {
    const dialCode = PHONE_REGIONS.find((r) => r.value === region)?.dialCode ?? "";
    // Drop the national trunk zero: 087… becomes +35387….
    candidate = `${dialCode}${digits.replace(/^0+/, "")}`;
  }

  if (!E164.test(candidate)) {
    return {
      ok: false,
      error: "That doesn't look like a phone number — check the digits and try again.",
    };
  }

  return { ok: true, e164: candidate };
}

/** Renders a stored E.164 number back into something readable. Display only. */
export function formatPhoneForDisplay(e164: string | null): string {
  if (!e164) return "";
  if (e164.startsWith("+353")) {
    // +35387xxxxxxx -> +353 87 xxx xxxx
    const rest = e164.slice(4);
    return `+353 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`.trimEnd();
  }
  if (e164.startsWith("+44")) {
    const rest = e164.slice(3);
    return `+44 ${rest.slice(0, 4)} ${rest.slice(4)}`.trimEnd();
  }
  return e164;
}
