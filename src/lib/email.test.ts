import { describe, expect, it } from "vitest";
import { renderEmailHtml } from "./email";

// sendEmail() itself isn't unit tested here — it's a thin fetch() wrapper
// around Resend's HTTP API with no branching logic worth mocking (see its
// own header comment: fails open, never throws). renderEmailHtml() is the
// pure part: given the same input, it always produces the same markup, and
// its escaping is exactly the kind of thing worth pinning down with a test
// — every notification body reaching this function can contain another
// member's own free text (a listing title, a name), so it must never be
// interpolated unescaped into the HTML it renders.

describe("renderEmailHtml", () => {
  it("includes the title, body lines, and CTA in the output", () => {
    const html = renderEmailHtml({
      title: "New message",
      bodyLines: ["You have a new message on Pinpals."],
      ctaLabel: "View message",
      ctaHref: "https://pinpals.ie/conversations/5",
    });

    expect(html).toContain("New message");
    expect(html).toContain("You have a new message on Pinpals.");
    expect(html).toContain("View message");
    expect(html).toContain("https://pinpals.ie/conversations/5");
  });

  it("escapes HTML-significant characters in the title", () => {
    const html = renderEmailHtml({
      title: '<script>alert("hi")</script>',
      bodyLines: ["body"],
      ctaLabel: "Go",
      ctaHref: "https://pinpals.ie/",
    });

    expect(html).not.toContain("<script>alert(\"hi\")</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML-significant characters in body lines", () => {
    const html = renderEmailHtml({
      title: "Title",
      bodyLines: ['A & B <tag> "quoted"'],
      ctaLabel: "Go",
      ctaHref: "https://pinpals.ie/",
    });

    expect(html).toContain("A &amp; B &lt;tag&gt; &quot;quoted&quot;");
    expect(html).not.toContain("<tag>");
  });

  it("escapes the CTA href", () => {
    const html = renderEmailHtml({
      title: "Title",
      bodyLines: ["body"],
      ctaLabel: "Go",
      ctaHref: 'https://pinpals.ie/?x="onmouseover="alert(1)',
    });

    expect(html).not.toContain('x="onmouseover="alert(1)"');
  });

  it("renders one paragraph per body line", () => {
    const html = renderEmailHtml({
      title: "Title",
      bodyLines: ["First line.", "Second line."],
      ctaLabel: "Go",
      ctaHref: "https://pinpals.ie/",
    });

    // 2 body-line paragraphs plus the fixed "Pinpals — golf community &
    // marketplace" footer paragraph the template always appends.
    expect(html.match(/<p /g)?.length).toBe(3);
    expect(html).toContain("First line.");
    expect(html).toContain("Second line.");
  });
});
