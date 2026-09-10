import { describe, it, expect } from "vitest";
import { canonicalDocumentText, documentSha256 } from "./hash";
import { LEGAL_DOCUMENTS, SIGNUP_DOCUMENTS, getLegalDocument, isLegalDocumentSlug } from "./index";
import { CONSENT_TYPES, DOCUMENT_CONSENT_TYPES } from "@/lib/consent";
import type { LegalDocument } from "./types";

const SAMPLE: LegalDocument = {
  slug: "terms",
  consentType: "terms",
  title: "Sample",
  shortTitle: "Sample",
  version: "1.0",
  effectiveFrom: "2026-01-01",
  summary: "A summary.",
  keyPoints: ["A key point."],
  sections: [
    {
      id: "one",
      heading: "1. One",
      blocks: [
        { kind: "p", text: "A paragraph." },
        { kind: "ul", items: ["First", "Second"] },
        { kind: "note", text: "A note." },
      ],
    },
  ],
};

describe("documentSha256", () => {
  it("produces a lowercase hex digest the database CHECK constraint accepts", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(documentSha256(doc)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("is stable across calls", () => {
    expect(documentSha256(SAMPLE)).toBe(documentSha256(SAMPLE));
  });

  it("changes when the operative text changes", () => {
    const edited: LegalDocument = {
      ...SAMPLE,
      sections: [
        {
          ...SAMPLE.sections[0],
          blocks: [{ kind: "p", text: "A different paragraph." }],
        },
      ],
    };
    expect(documentSha256(edited)).not.toBe(documentSha256(SAMPLE));
  });

  it("changes when the version changes, even if the text does not", () => {
    expect(documentSha256({ ...SAMPLE, version: "1.1" })).not.toBe(documentSha256(SAMPLE));
  });

  it("does NOT change when only the surrounding marketing copy changes", () => {
    // The whole point of the hand-built canonical form: re-wording a key
    // point must not invalidate every existing consent record.
    const reworded: LegalDocument = {
      ...SAMPLE,
      title: "A different title",
      shortTitle: "Different",
      summary: "A completely different summary.",
      keyPoints: ["An entirely different key point.", "And another."],
      effectiveFrom: "2027-06-30",
    };
    expect(documentSha256(reworded)).toBe(documentSha256(SAMPLE));
  });

  it("distinguishes a list item from a paragraph with the same words", () => {
    const asParagraph: LegalDocument = {
      ...SAMPLE,
      sections: [{ id: "one", heading: "1. One", blocks: [{ kind: "p", text: "First" }] }],
    };
    const asListItem: LegalDocument = {
      ...SAMPLE,
      sections: [{ id: "one", heading: "1. One", blocks: [{ kind: "ul", items: ["First"] }] }],
    };
    expect(documentSha256(asParagraph)).not.toBe(documentSha256(asListItem));
  });

  it("gives every shipped document a distinct hash", () => {
    const hashes = LEGAL_DOCUMENTS.map(documentSha256);
    expect(new Set(hashes).size).toBe(LEGAL_DOCUMENTS.length);
  });
});

describe("canonicalDocumentText", () => {
  it("includes the slug, version and every section's operative text", () => {
    const text = canonicalDocumentText(SAMPLE);
    expect(text).toContain("slug:terms");
    expect(text).toContain("version:1.0");
    expect(text).toContain("section:one");
    expect(text).toContain("p:A paragraph.");
    expect(text).toContain("li:First");
    expect(text).toContain("note:A note.");
  });
});

describe("the document registry", () => {
  it("has a unique slug and a unique consent type per document", () => {
    expect(new Set(LEGAL_DOCUMENTS.map((d) => d.slug)).size).toBe(LEGAL_DOCUMENTS.length);
    expect(new Set(LEGAL_DOCUMENTS.map((d) => d.consentType)).size).toBe(LEGAL_DOCUMENTS.length);
  });

  it("only uses consent types the database CHECK constraint allows", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(CONSENT_TYPES).toContain(doc.consentType);
    }
    for (const type of DOCUMENT_CONSENT_TYPES) {
      expect(CONSENT_TYPES).toContain(type);
    }
  });

  it("resolves documents by slug and rejects unknown ones", () => {
    expect(getLegalDocument("terms")?.slug).toBe("terms");
    expect(getLegalDocument("nonsense")).toBeUndefined();
    expect(isLegalDocumentSlug("privacy")).toBe(true);
    expect(isLegalDocumentSlug("nonsense")).toBe(false);
  });

  it("gives every document a version, an effective date and at least one section", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.version, doc.slug).toMatch(/^\d+\.\d+$/);
      expect(doc.effectiveFrom, doc.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.sections.length, doc.slug).toBeGreaterThan(0);
      expect(doc.keyPoints.length, doc.slug).toBeGreaterThan(0);
    }
  });

  it("gives every section a unique anchor within its document", () => {
    for (const doc of LEGAL_DOCUMENTS) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size, doc.slug).toBe(ids.length);
    }
  });

  it("requires every sign-up document to be one of the registered documents", () => {
    for (const doc of SIGNUP_DOCUMENTS) {
      expect(LEGAL_DOCUMENTS).toContain(doc);
    }
  });
});
