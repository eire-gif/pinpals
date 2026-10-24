/**
 * Staying safe in marketplace chats (Oct 2026, 0188).
 *
 * The database stamps messages.safety_flags on every message in a
 * marketplace conversation (message_safety_flags() in 0188). This turns a
 * flag into the warning the OTHER person sees under that message, and holds
 * the first-contact tips and the "meet at the club" suggestion. Nothing is
 * ever blocked. Pure — the website uses an exact copy (src/lib/ and mobile/src/lib/ message-safety.ts).
 */

export type SafetyFlag = "link" | "pay_first" | "courier" | "odd_payment" | "off_app";

const KNOWN: SafetyFlag[] = ["pay_first", "odd_payment", "courier", "link", "off_app"];

const WARNINGS: Record<SafetyFlag, string> = {
  pay_first: "This asks for money before you've seen the item. Never pay a deposit to someone you haven't met.",
  odd_payment: "Gift cards, crypto and PayPal friends & family can't be got back. Pay cash or Revolut when you have the item.",
  courier: "Couriers, delivery fees and payment links are a common scam. Meet in person if you can.",
  link: "Links can lead to fake payment or login pages. Don't enter card or bank details.",
  off_app: "Keep the chat on PinPals. If something goes wrong, we can only help with what's here.",
};

/** Only flags we know, most serious first. */
export function cleanFlags(flags: readonly string[] | null | undefined): SafetyFlag[] {
  if (!flags || flags.length === 0) return [];
  return KNOWN.filter((k) => flags.includes(k));
}

/** One warning line for a message (the most serious), or null. */
export function safetyWarning(flags: readonly string[] | null | undefined): string | null {
  const clean = cleanFlags(flags);
  return clean.length > 0 ? WARNINGS[clean[0]] : null;
}

export const SAFETY_TIPS_TITLE = "Buying and selling safely";

export const SAFETY_TIPS: string[] = [
  "Meet at a golf club, in daylight, and check the item before you pay.",
  "Pay cash or Revolut at the handover. Never pay a deposit or a courier.",
  "Keep the chat on PinPals. PinPals will never ask for card or bank details here.",
];

/** The message a "Suggest meeting at the club" tap puts in the box. */
export function meetAtClubMessage(club: string | null | undefined): string {
  const where = club && club.trim() ? club.trim() : "a golf club near us";
  return `Could we meet at ${where}? Easy to check them there and I can pay cash or Revolut on the spot.`;
}

/** Where a seller-facing suggestion should say instead: they bring the item. */
export function meetAtClubMessageForSeller(club: string | null | undefined): string {
  const where = club && club.trim() ? club.trim() : "a golf club near us";
  return `Happy to meet at ${where} so you can have a look before you pay. Cash or Revolut on the day is perfect.`;
}
