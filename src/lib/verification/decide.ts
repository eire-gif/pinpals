/**
 * Verified golfer: what to do with the AI's reading of a membership card
 * (Oct 2026, 0188, claude/trust-and-safety.md).
 *
 * The model only READS the card (name, club, number, whether it looks like a
 * real membership card and whether it looks edited). Whether that matches the
 * member is decided here, in plain code, so it can be tested and so a model
 * that misreads can't approve anyone on its own say-so:
 *
 *   approve  every check passes, clearly
 *   reject   clearly not a membership card at all — they can try again
 *   review   anything in between: a person looks (the photo is kept until then)
 *
 * Pure: no fetch, no Supabase.
 */

export type CardReading = {
  is_membership_card: boolean;
  /** golf_ireland_card | golf_ireland_app | club_card | other */
  card_type: string;
  legible: boolean;
  looks_altered: boolean;
  name_on_card: string | null;
  club_on_card: string | null;
  number_on_card: string | null;
  /** The model's own call on whether club_on_card is the member's stated club. */
  club_matches: boolean;
  /** 0–1, the model's confidence in its own reading. */
  confidence: number;
  notes?: string;
};

export type Claimed = {
  firstName: string | null;
  lastName: string | null;
  club: string;
  number: string;
};

export type Decision =
  | { outcome: "approve"; reason: null }
  | { outcome: "reject"; reason: string }
  | { outcome: "review"; reason: string };

/** Lower case, no accents, letters and spaces only. "Ó Briain" → "o briain". */
export function plain(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same surname ignoring spaces and apostrophes (O'Brien / OBrien / O Brien). */
function sameSurname(a: string, b: string): boolean {
  return a.replace(/ /g, "") === b.replace(/ /g, "") && a.length > 0;
}

/**
 * Does the name on the card belong to this member? The surname must be
 * there; the first name may be in full, or just the initial (cards often
 * print "J MURPHY").
 */
export function nameMatches(onCard: string | null, firstName: string | null, lastName: string | null): boolean {
  const card = plain(onCard);
  const first = plain(firstName);
  const last = plain(lastName);
  if (!card || !last) return false;

  const cardJoined = card.replace(/ /g, "");
  if (!cardJoined.includes(last.replace(/ /g, ""))) return false;

  if (!first) return true;
  const words = card.split(" ");
  // Anything on the card that isn't part of the surname.
  const rest = words.filter((w) => !last.split(" ").includes(w) && !sameSurname(w, last));
  if (rest.length === 0) return false;
  const firstWord = first.split(" ")[0];
  return rest.some(
    (w) =>
      w === firstWord ||
      // An initial: "J" for John.
      (w.length === 1 && firstWord.startsWith(w)) ||
      // A short form either way: "Pat" / "Patrick", "Patricia" / "Pat".
      (w.length >= 3 && firstWord.length >= 3 && (firstWord.startsWith(w) || w.startsWith(firstWord)))
  );
}

/** Digits and letters only, upper case. */
export function plainNumber(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function numberMatches(onCard: string | null, claimed: string): boolean {
  const a = plainNumber(onCard);
  const b = plainNumber(claimed);
  if (a.length < 4 || b.length < 4) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

export const APPROVE_CONFIDENCE = 0.8;

export function decide(reading: CardReading, claimed: Claimed): Decision {
  const confident = reading.confidence >= APPROVE_CONFIDENCE;

  if (!reading.is_membership_card || reading.card_type === "other") {
    return confident
      ? {
          outcome: "reject",
          reason:
            "That doesn't look like a golf membership card. Try a photo of your Golf Ireland card, or the membership card screen in the Golf Ireland app.",
        }
      : { outcome: "review", reason: "We couldn't tell what the photo shows, so a person will check it." };
  }

  if (!reading.legible) {
    return {
      outcome: "reject",
      reason: "We couldn't read the card. Try again in good light, flat on a table, with the whole card in the photo.",
    };
  }

  if (reading.looks_altered) {
    return { outcome: "review", reason: "A person will take a quick look at this one." };
  }

  const name = nameMatches(reading.name_on_card, claimed.firstName, claimed.lastName);
  const number = numberMatches(reading.number_on_card, claimed.number);
  // The Golf Ireland app screen doesn't always show the number; the name and
  // club are enough there. A plastic card always shows it.
  const numberOk = number || (reading.card_type === "golf_ireland_app" && !reading.number_on_card);

  if (confident && name && reading.club_matches && numberOk) {
    return { outcome: "approve", reason: null };
  }

  const missing = [!name && "name", !reading.club_matches && "club", !numberOk && "membership number"].filter(Boolean);
  return {
    outcome: "review",
    reason:
      missing.length > 0
        ? `The ${missing.join(" and ")} on the card didn't quite match your profile, so a person will check it.`
        : "A person will take a quick look at this one.",
  };
}
