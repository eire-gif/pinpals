import { describe, expect, it } from "vitest";
import { parentEmailContent } from "./age-access";

describe("the parent's approval email (0159)", () => {
  const link = "https://pinpals.ie/parent#" + "a".repeat(43);
  const email = parentEmailContent({ childFirstName: "Aoife", link });

  it("names the child by first name and carries the link", () => {
    expect(email.subject).toBe("Aoife wants to join PinPals");
    expect(email.text).toContain(link);
    expect(email.html).toContain(link);
    expect(email.text).toContain("30 days");
    expect(email.text).toContain("If you don't know about this, ignore this email");
  });

  it("escapes the name in the HTML", () => {
    const evil = parentEmailContent({ childFirstName: "<b>x</b>", link });
    expect(evil.html).not.toContain("<b>x</b>");
  });
});
