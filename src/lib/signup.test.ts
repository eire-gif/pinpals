import { describe, expect, it } from "vitest";

import { recordedConsentsFor, validateSignUp, type SignUpInput } from "./signup";
import { SIGNUP_DOCUMENTS } from "@/lib/legal";

const base: SignUpInput = {
  firstName: "Aoife",
  lastName: "Byrne",
  email: "aoife@example.ie",
  password: "a long enough passphrase",
  agreedToDocuments: true,
  readPrivacy: true,
  confirmedAge: true,
  marketingEmail: false,
};

describe("validateSignUp", () => {
  it("accepts a complete sign-up", () => {
    expect(validateSignUp(base)).toBeNull();
  });

  it("refuses without the terms or the privacy acknowledgement", () => {
    expect(validateSignUp({ ...base, agreedToDocuments: false })).toMatch(/terms/);
    expect(validateSignUp({ ...base, readPrivacy: false })).toMatch(/terms/);
  });

  it("refuses without the 18+ declaration", () => {
    expect(validateSignUp({ ...base, confirmedAge: false })).toMatch(/18/);
  });

  it("refuses a short password and blank names", () => {
    expect(validateSignUp({ ...base, password: "short" })).not.toBeNull();
    expect(validateSignUp({ ...base, firstName: "  " })).toMatch(/name/);
  });
});

describe("recordedConsentsFor", () => {
  it("records every sign-up document with a version and hash, plus age and marketing", () => {
    const rows = recordedConsentsFor(base);
    for (const doc of SIGNUP_DOCUMENTS) {
      const row = rows.find((r) => r.type === doc.consentType);
      expect(row?.granted).toBe(true);
      expect(row?.version).toBe(doc.version);
      expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(rows.find((r) => r.type === "age_18_declaration")?.granted).toBe(true);
    // An explicit "no" to marketing is recorded, not omitted.
    expect(rows.find((r) => r.type === "marketing_email")).toEqual({ type: "marketing_email", granted: false });
  });
});
