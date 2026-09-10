import { createHash } from "node:crypto";
import type { LegalDocument } from "./types";

/**
 * A content fingerprint for a legal document, stored alongside every
 * consent record.
 *
 * ============ What this is actually for ============
 *
 * A version string on its own is a promise, not evidence: nothing stops a
 * document being edited while its version stays at "1.0", and the consent
 * record would then say a member accepted text they never saw. The hash
 * closes that: if the stored SHA-256 for a member's acceptance does not
 * match the current document's, the text has changed since — whether or
 * not anyone remembered to bump the version. /dashboard/legal treats that
 * mismatch exactly as it treats a version mismatch, and asks the member to
 * review again.
 *
 * It is a change detector, not a tamper-proof seal. Anyone able to change
 * the repository can change the document and its hash together. What it
 * defends against is the realistic failure — an edit made in good faith
 * without a version bump — not an adversary with commit access.
 *
 * ============ Why the canonical form is built by hand ============
 *
 * Not `JSON.stringify(doc)`. That would fold in `summary`, `keyPoints`,
 * `shortTitle` and `effectiveFrom`, so re-wording a summary bullet would
 * invalidate every existing consent record even though the agreement had
 * not changed. It would also depend on object key order, which is a
 * property of how the object literal happens to be written.
 *
 * So the canonical form below is explicit, ordered, and covers exactly the
 * operative text: the slug, the version, and every section's id, heading
 * and content. Change the agreement and the hash moves; change the
 * marketing copy around it and the hash holds still.
 *
 * Note that the documents interpolate the operator's legal name and
 * address (src/lib/legal/operator.ts), so filling those in for the first
 * time WILL change every hash. That is correct — the document genuinely
 * did not name a controller before — and it should happen before launch,
 * while there is nobody to re-prompt.
 */
export function canonicalDocumentText(doc: LegalDocument): string {
  const lines: string[] = [`slug:${doc.slug}`, `version:${doc.version}`];

  for (const section of doc.sections) {
    lines.push(`section:${section.id}`, `heading:${section.heading}`);
    for (const block of section.blocks) {
      switch (block.kind) {
        case "p":
          lines.push(`p:${block.text}`);
          break;
        case "note":
          lines.push(`note:${block.text}`);
          break;
        case "ul":
          for (const item of block.items) lines.push(`li:${item}`);
          break;
      }
    }
  }

  return lines.join("\n");
}

/** Lowercase hex SHA-256 of the canonical text. Matches the CHECK constraint in migration 0074. */
export function documentSha256(doc: LegalDocument): string {
  return createHash("sha256").update(canonicalDocumentText(doc), "utf8").digest("hex");
}
