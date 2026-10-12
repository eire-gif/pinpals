/**
 * What a golfer's federation membership number is called, by the country
 * they play in (Oct 2026). The number is the same profile field
 * (gui_membership_number) everywhere; only its name changes, so a golfer in
 * England isn't asked for a "GUI number".
 *
 * Pure, no imports. Byte-identical in mobile/src/lib/membership-number.ts
 * (drift test in membership-number.test.ts).
 */

export type MembershipLabel = {
  /** The field's heading: "Golf Ireland membership number". */
  title: string;
  /** What else people call it, if anything: "Still often called a GUI number". */
  aka: string | null;
};

const LABELS: Record<string, MembershipLabel> = {
  ireland: { title: "Golf Ireland membership number", aka: "Still often called a GUI number" },
  "northern-ireland": { title: "Golf Ireland membership number", aka: "Still often called a GUI number" },
  england: { title: "England Golf membership number", aka: "Previously called a CDH number" },
  scotland: { title: "Scottish Golf ID", aka: "Also called a CDH number" },
  wales: { title: "Wales Golf membership number", aka: null },
  spain: { title: "Número de licencia", aka: "Your RFEG federation licence number" },
  portugal: { title: "Número de federado", aka: "Your FPG federation membership number" },
};

/** Ireland's wording when no country is chosen yet, or one we don't know. */
export function membershipLabel(country: string | null | undefined): MembershipLabel {
  return LABELS[country ?? ""] ?? LABELS.ireland;
}
