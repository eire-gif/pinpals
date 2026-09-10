import { describe, it, expect } from "vitest";
import {
  validateDraft,
  normalise,
  trimPunctuation,
  slugify,
  sourceIsDraftable,
  type DraftShape,
} from "./validate";

// A real press release, trimmed. Taken verbatim from the CPG feed so the
// quote checks below are tested against text the pipeline actually collects,
// not against a convenient invention.
const SOURCE = `Stephen Gallacher has been named European Captain for the 2027 Junior Ryder Cup in Limerick.

The Scotsman will lead Europe for a record third time on the Island of Ireland, having captained the side in the last two editions of the biennial event, held in Rome and New York.

Six boys and six girls will take on the United States from September 14-16, 2027, with the first two days of the Junior Ryder Cup being played at Ballyneety Golf Club before the decisive singles matches are held at Adare Manor on the eve of the Ryder Cup itself.

"It's a privilege to lead Team Europe for a third time at the 2027 Junior Ryder Cup in Limerick," said Gallacher. "After experiencing our record-breaking victory in Rome, I'm thrilled to have the chance to captain the team on home soil once again. The Junior Ryder Cup returning to the Island of Ireland for the first time since 2002 is extremely exciting and I'm looking forward to working closely with this latest generation."

Ireland's Leona Maguire represented Europe at the 2008 Junior Ryder Cup and has since registered 8.5 points across three Solheim Cup appearances.`;

const LONG_BODY = [
  "Ballyneety Golf Club will stage two days of international team golf next September, after the Confederation of Professional Golf confirmed its captain for the matches.",
  "For Gallacher it is a third captaincy, a European record. He led the side in Rome and again in New York, and a second win would put him in rare company among captains of the event.",
  "Each team is made up of twelve players, six boys and six girls. The event's alumni list is the reason clubs pay attention, and the pathway it offers is a real one for juniors coming through club programmes rather than academies.",
  "Leona Maguire played in it in 2008 and has since taken 8.5 points from three Solheim Cup appearances, which is the kind of trajectory that makes a home tie worth caring about for anyone with a junior section.",
  "The closing singles move to Adare Manor on the eve of the Ryder Cup, giving the week a shape that no previous edition on this island has had.",
].join("\n\n");

function draft(overrides: Partial<DraftShape> = {}): DraftShape {
  return {
    headline: "Junior Ryder Cup returns to Ireland with Gallacher as captain",
    standfirst:
      "Ballyneety and Adare Manor will host the 2027 matches, with Gallacher leading Europe.",
    body_md: LONG_BODY,
    irish_angle: "Two of the three days are at a members' club rather than a resort.",
    quotes: [],
    source_attribution: "Confederation of Professional Golf, 25 June 2026",
    ...overrides,
  };
}

describe("quote verification", () => {
  it("accepts a quote that appears word-for-word in the source", () => {
    const result = validateDraft(
      draft({
        quotes: [
          {
            text: "The Junior Ryder Cup returning to the Island of Ireland for the first time since 2002 is extremely exciting",
            speaker: "Stephen Gallacher",
          },
        ],
      }),
      SOURCE,
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.verifiedQuotes).toBe(1);
  });

  it("rejects a fabricated quote", () => {
    const result = validateDraft(
      draft({
        quotes: [
          {
            text: "Ireland is the greatest golfing nation on earth",
            speaker: "Stephen Gallacher",
          },
        ],
      }),
      SOURCE,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("FABRICATED QUOTE");
    expect(result.verifiedQuotes).toBe(0);
  });

  it("rejects the whole draft, not just the bad quote, when one is fabricated", () => {
    // A model that invented one quote may have invented facts too, so a
    // fabrication must not be recoverable by dropping the quote.
    const result = validateDraft(
      draft({
        quotes: [
          { text: "Six boys and six girls will take on the United States", speaker: "A" },
          { text: "This is completely invented", speaker: "B" },
        ],
      }),
      SOURCE,
    );
    expect(result.ok).toBe(false);
    expect(result.verifiedQuotes).toBe(1);
  });

  it("accepts a quote whose full stop became a comma before an attribution", () => {
    // House style: "...once again," said Gallacher. The source has a full
    // stop. This is the false positive that broke the prototype's first run.
    const result = validateDraft(
      draft({
        quotes: [
          {
            text: "I'm thrilled to have the chance to captain the team on home soil once again,",
            speaker: "Stephen Gallacher",
          },
        ],
      }),
      SOURCE,
    );
    expect(result.errors).toEqual([]);
    expect(result.verifiedQuotes).toBe(1);
  });

  it("accepts a quote that differs only by smart quotes and dashes", () => {
    const result = validateDraft(
      draft({
        quotes: [
          {
            text: "It’s a privilege to lead Team Europe for a third time",
            speaker: "Stephen Gallacher",
          },
        ],
      }),
      SOURCE,
    );
    expect(result.verifiedQuotes).toBe(1);
  });

  it("rejects a quote with no speaker", () => {
    const result = validateDraft(
      draft({
        quotes: [
          { text: "Six boys and six girls will take on the United States", speaker: "" },
        ],
      }),
      SOURCE,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("no speaker");
  });

  it("catches a quoted passage in the body that was never declared", () => {
    const result = validateDraft(
      draft({
        body_md: `${LONG_BODY}\n\nHe added: "This sentence was never in any press release at all."`,
        quotes: [],
      }),
      SOURCE,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("UNDECLARED QUOTE");
  });

  it("does not flag a declared, verified quote as undeclared", () => {
    const text =
      "The Junior Ryder Cup returning to the Island of Ireland for the first time since 2002 is extremely exciting";
    const result = validateDraft(
      draft({
        body_md: `${LONG_BODY}\n\n"${text}," Gallacher said.`,
        quotes: [{ text, speaker: "Stephen Gallacher" }],
      }),
      SOURCE,
    );
    expect(result.errors).toEqual([]);
  });
});

describe("extract length", () => {
  it("passes original prose", () => {
    const result = validateDraft(draft(), SOURCE);
    expect(result.longestExtractWords).toBeLessThanOrEqual(25);
    expect(result.ok).toBe(true);
  });

  it("rejects a long verbatim run lifted from the source", () => {
    const lifted =
      "Six boys and six girls will take on the United States from September 14-16, 2027, with the first two days of the Junior Ryder Cup being played at Ballyneety Golf Club before the decisive singles matches are held at Adare Manor on the eve of the Ryder Cup itself.";
    const result = validateDraft(
      draft({ body_md: `${LONG_BODY}\n\n${lifted}` }),
      SOURCE,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("extract too long");
  });

  it("does not count a marked quote towards the extract limit", () => {
    const long =
      "It's a privilege to lead Team Europe for a third time at the 2027 Junior Ryder Cup in Limerick. After experiencing our record-breaking victory in Rome, I'm thrilled to have the chance to captain the team on home soil once again.";
    const result = validateDraft(
      draft({
        body_md: `${LONG_BODY}\n\n"${long}"`,
        quotes: [{ text: long, speaker: "Stephen Gallacher" }],
      }),
      SOURCE,
    );
    expect(result.errors.join(" ")).not.toContain("extract too long");
  });
});

describe("banned content", () => {
  it.each([
    ["He is understood to have been managing a back injury.", "speculative"],
    ["Sources say the appointment was contentious.", "hearsay"],
    ["He has been struggling with a shoulder problem.", "health"],
    ["The captain reportedly wanted a different venue.", "allegation"],
    ["He was accused of breaching the rules.", "conduct"],
  ])("rejects: %s", (sentence) => {
    const result = validateDraft(
      draft({ body_md: `${LONG_BODY}\n\n${sentence}` }),
      SOURCE,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("banned content");
  });

  it("does not flag ordinary golf prose", () => {
    const result = validateDraft(
      draft({ body_md: `${LONG_BODY}\n\nHe won four DP World Tour titles.` }),
      SOURCE,
    );
    expect(result.ok).toBe(true);
  });
});

describe("shape and length", () => {
  it("rejects a body under the minimum", () => {
    const result = validateDraft(draft({ body_md: "Too short." }), SOURCE);
    expect(result.errors.join(" ")).toContain("body too short");
  });

  it("rejects an over-long headline", () => {
    const result = validateDraft(
      draft({ headline: "A".repeat(71) }),
      SOURCE,
    );
    expect(result.errors.join(" ")).toContain("headline too long");
  });

  it("rejects an over-long standfirst", () => {
    const result = validateDraft(
      draft({ standfirst: Array(31).fill("word").join(" ") }),
      SOURCE,
    );
    expect(result.errors.join(" ")).toContain("standfirst too long");
  });

  it("rejects a missing source attribution", () => {
    const result = validateDraft(draft({ source_attribution: "  " }), SOURCE);
    expect(result.errors.join(" ")).toContain("source_attribution");
  });

  it("allows a null irish_angle — a weak candidate, not an invalid one", () => {
    const result = validateDraft(draft({ irish_angle: null }), SOURCE);
    expect(result.ok).toBe(true);
  });
});

describe("normalise and trimPunctuation", () => {
  it("folds smart punctuation and whitespace", () => {
    expect(normalise("  It’s   a  “test” — yes  ")).toBe(`it's a "test" - yes`);
  });

  it("strips wrapping quotes and terminal punctuation", () => {
    expect(trimPunctuation('"support to me,"')).toBe("support to me");
    expect(trimPunctuation("support to me.")).toBe("support to me");
  });

  it("leaves internal punctuation alone", () => {
    expect(trimPunctuation("one, two, three.")).toBe("one, two, three");
  });
});

describe("slugify", () => {
  it("makes a url-safe slug", () => {
    expect(slugify("Junior Ryder Cup returns to Ireland!")).toBe(
      "junior-ryder-cup-returns-to-ireland",
    );
  });

  it("strips accents rather than dropping the word", () => {
    expect(slugify("Højgaard wins")).toBe("hojgaard-wins");
  });

  it("appends a suffix for uniqueness", () => {
    expect(slugify("Same headline", "2026")).toBe("same-headline-2026");
  });

  it("never returns an empty slug", () => {
    expect(slugify("!!!", "x")).toBe("x");
  });

  it("produces a slug the database constraint accepts", () => {
    const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const h of [
      "Molinari returns as vice captain for Adare Manor",
      "Research puts a number on women's golf retention",
      "R&A — 2027   preview!!",
    ]) {
      expect(slugify(h)).toMatch(pattern);
    }
  });
});

describe("sourceIsDraftable", () => {
  // These are the real body lengths the USGA Media Center RSS delivered on
  // 10 September 2026. CPG's average over the same period was 3,319.
  it.each([
    ["Stout Awarded McCormack Medal for Being Top Male Amateur", 56],
    ["Final Six Players Named to USA Walker Cup Team", 46],
    ["Kiara Romero Wins the McCormack Medal", 93],
  ])("refuses a headline-only feed item: %s", (title) => {
    const result = sourceIsDraftable(title, title);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/too thin|little more than its own headline/);
  });

  it("refuses a body that is only the headline plus a one-line summary", () => {
    const title = "Sankaty Head Golf Club to Host 2036 U.S. Women's Mid-Amateur";
    const body = `${title}\n\nSecond USGA championship awarded to Massachusetts club`;
    expect(sourceIsDraftable(body, title).ok).toBe(false);
  });

  it("accepts a real press release", () => {
    expect(sourceIsDraftable(SOURCE, "Stephen Gallacher named captain").ok).toBe(true);
  });

  it("refuses an empty body", () => {
    expect(sourceIsDraftable("", "A headline").ok).toBe(false);
  });

  it("catches padding that repeats the headline to reach the length floor", () => {
    const title = "Some Golf Announcement";
    const padded = Array(30).fill(title).join(" ");
    // Long enough in raw characters, but almost nothing that is not the title.
    expect(padded.length).toBeGreaterThan(600);
    expect(sourceIsDraftable(padded, title).ok).toBe(false);
  });
});
