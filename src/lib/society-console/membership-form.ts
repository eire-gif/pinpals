/**
 * Annual membership settings (0144) as the console's form sends them —
 * checked the same way the app's membership-settings screen checks them,
 * with the same words, before save_membership_settings() checks again.
 *
 * Pure: tested in membership-form.test.ts.
 */

import { compactIban, ibanIsValid, normaliseRevtag } from "./outing-payments";
import { parseFee } from "./outing-rules";

export type MembershipSettingsInput = {
  enabled: boolean;
  feeCents: number | null;
  seasonStartMonth: number;
  dueAfterDays: number;
  unpaidPolicy: "allow" | "block";
  payRevtag: string | null;
  payIban: string | null;
  payAccountName: string | null;
  payCash: boolean;
  payNote: string | null;
};

/** The app's choices for "Due after". */
export const DUE_DAYS = [0, 14, 30, 60, 90] as const;

export const UNPAID_POLICIES: { value: "allow" | "block"; label: string }[] = [
  { value: "allow", label: "They can still enter events" },
  { value: "block", label: "They can't enter events until they pay" },
];

export type MembershipDraft = {
  enabled: boolean;
  fee: string;
  startMonth: string;
  dueAfter: string;
  policy: string;
  revtag: string;
  iban: string;
  accountName: string;
  cash: boolean;
  note: string;
};

/** The settings a draft stands for, or what's wrong with it in the app's words. */
export function parseMembershipDraft(d: MembershipDraft): MembershipSettingsInput | { error: string } {
  const feeCents = parseFee(d.fee);
  const tag = normaliseRevtag(d.revtag);
  const iban = compactIban(d.iban);
  const accountName = d.accountName.trim();
  const note = d.note.trim();
  const month = Number(d.startMonth);
  const due = Number(d.dueAfter);

  if (d.enabled && feeCents === undefined) return { error: "Check the fee — write it as a number, like 80 or 65.50." };
  if (d.enabled && feeCents == null) return { error: "Add the fee — how much is a year's membership?" };
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: "Choose the month the season starts." };
  if (!(DUE_DAYS as readonly number[]).includes(due)) return { error: "Choose when membership falls due." };
  if (d.policy !== "allow" && d.policy !== "block") return { error: "Choose what happens if someone hasn't paid." };
  if (tag === undefined) return { error: "Check the Revolut name — a Revolut @name is letters, numbers, dots, dashes or underscores." };
  if (iban && !ibanIsValid(iban)) return { error: "Check the IBAN — it doesn't add up, one of the characters may be wrong." };
  if (iban && !accountName) return { error: "Add the account name — whose name is the bank account in? Members' banks check it." };
  if (accountName.length > 70) return { error: "That account name is too long." };
  if (note.length > 200) return { error: "The payment note is too long — 200 characters at most." };

  return {
    enabled: d.enabled,
    // Like the app: a fee that doesn't parse is dropped when membership is off.
    feeCents: feeCents ?? null,
    seasonStartMonth: month,
    dueAfterDays: due,
    unpaidPolicy: d.policy,
    payRevtag: tag,
    payIban: iban,
    payAccountName: accountName || null,
    payCash: d.cash,
    payNote: note || null,
  };
}

/** 8000 → "80", 6550 → "65.50", null → "". For filling the fee box. */
export const feeInput = (cents: number | null): string => (cents == null ? "" : cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** "Due 30 days after 1 January each season." */
export function dueSentence(dueAfterDays: number, monthName: string): string {
  return `Due ${dueAfterDays === 0 ? "on" : `${dueAfterDays} days after`} 1 ${monthName} each season.`;
}
