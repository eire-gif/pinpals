import { describe, expect, it } from "vitest";
import { activeMention, insertMention, matchMentions, mentionIdsInBody, mentionSegments } from "./mentions";

const niamh = { id: "n", name: "Niamh Gallagher" };
const niamhK = { id: "k", name: "Niamh" };
const conor = { id: "c", name: "Conor Doyle" };

describe("activeMention", () => {
  it("finds the word after an @ at the cursor", () => {
    expect(activeMention("great shot @Nia", 15)).toEqual({ query: "Nia", start: 11 });
    expect(activeMention("@", 1)).toEqual({ query: "", start: 0 });
  });
  it("ignores emails, finished mentions and text after the cursor", () => {
    expect(activeMention("eire@me.com", 11)).toBeNull();
    expect(activeMention("@Niamh Gallagher great", 22)).toBeNull();
    expect(activeMention("hi @Nia and more", 7)).toEqual({ query: "Nia", start: 3 });
  });
});

describe("insertMention", () => {
  it("replaces the @query with the full name and a space", () => {
    expect(insertMention("great shot @Nia", 11, 15, "Niamh Gallagher")).toEqual({
      text: "great shot @Niamh Gallagher ",
      cursor: 28,
    });
    expect(insertMention("@Co  well done", 0, 3, "Conor Doyle")).toEqual({ text: "@Conor Doyle well done", cursor: 13 });
  });
});

describe("matchMentions", () => {
  it("matches first or last names, case-insensitively, once each", () => {
    expect(matchMentions([niamh, conor, niamh], "gal").map((m) => m.id)).toEqual(["n"]);
    expect(matchMentions([niamh, conor], "").map((m) => m.id)).toEqual(["n", "c"]);
    expect(matchMentions([niamh, conor], "x")).toEqual([]);
  });
});

describe("mentionIdsInBody", () => {
  it("keeps only names still in the text", () => {
    expect(mentionIdsInBody("@Niamh Gallagher nice", [niamh, conor])).toEqual(["n"]);
  });
});

describe("mentionSegments", () => {
  it("splits text and mentions, longest name first", () => {
    expect(mentionSegments("Well done @Niamh Gallagher and @Conor Doyle!", [niamhK, niamh, conor])).toEqual([
      { text: "Well done " },
      { text: "@Niamh Gallagher", mention: niamh },
      { text: " and " },
      { text: "@Conor Doyle", mention: conor },
      { text: "!" },
    ]);
  });
  it("is plain text without mentions", () => {
    expect(mentionSegments("Lovely day", [])).toEqual([{ text: "Lovely day" }]);
    expect(mentionSegments("Lovely @day", [conor])).toEqual([{ text: "Lovely @day" }]);
  });
});
