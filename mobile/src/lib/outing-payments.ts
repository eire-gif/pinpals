/**
 * How members pay for an outing (0127) — the rules the screens use. The
 * database tidies and checks the same things; this file decides what to
 * show and catches a mistyped IBAN before it's saved.
 *
 * Pure, no imports: tested in outing-payments.test.ts.
 */

export type ClaimMethod = "revolut" | "transfer" | "cash";

export const CLAIM_LABELS: Record<ClaimMethod, string> = {
  revolut: "Revolut",
  transfer: "bank transfer",
  cash: "cash",
};

/** "@Geoff.Walsh " → "geoff.walsh"; "" → null; anything unusable → undefined. */
export function normaliseRevtag(text: string): string | null | undefined {
  const t = text.trim().replace(/^@/, "").toLowerCase();
  if (t === "") return null;
  return /^[a-z0-9._-]{2,40}$/.test(t) ? t : undefined;
}

/** The Revolut payment page for a username. Opens the Revolut app if installed; otherwise the web page, where non-Revolut people can pay by card. */
export const revolutUrl = (revtag: string): string => `https://revolut.me/${encodeURIComponent(revtag)}`;

/** "ie29 aibk 9311…" → "IE29AIBK9311…"; "" → null. */
export const compactIban = (text: string): string | null => {
  const t = text.replace(/\s+/g, "").toUpperCase();
  return t === "" ? null : t;
};

/** "IE29AIBK93115212345678" → "IE29 AIBK 9311 5212 3456 78". */
export const formatIban = (iban: string): string => iban.replace(/(.{4})(?=.)/g, "$1 ");

/**
 * The IBAN check digits (ISO 13616, mod 97): catches almost every typo.
 * Accepts spaces and lower case.
 */
export function ibanIsValid(text: string): boolean {
  const iban = compactIban(text);
  if (!iban || !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of moved) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** What to put in the payment's reference: "Kerry November – Geoff Walsh" (max 35, what Irish banks allow). */
export function paymentReference(outingTitle: string, memberName: string): string {
  const full = `${outingTitle} – ${memberName}`;
  return full.length <= 35 ? full : full.slice(0, 34).trimEnd() + "…";
}

/** The ways this outing can be paid, in the order the screen shows them. */
export function payWays(o: { payRevtag: string | null; payIban: string | null; payCash: boolean }): ClaimMethod[] {
  return [...(o.payRevtag ? (["revolut"] as const) : []), ...(o.payIban ? (["transfer"] as const) : []), ...(o.payCash ? (["cash"] as const) : [])];
}
