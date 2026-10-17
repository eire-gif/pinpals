import { describe, expect, it } from "vitest";
import { foldWords, listeningHints, parseVoiceScores, type VoicePlayer } from "./voice-scores";

const group: VoicePlayer[] = [
  { id: 1, name: "Eire Duffy", isMe: true, shots: 1 },
  { id: 2, name: "Niamh Byrne", isMe: false, shots: 1 },
  { id: 3, name: "Declan Walsh", isMe: false, shots: 0 },
  { id: 4, name: "Ciarán Murphy", isMe: false, shots: 1 },
];

const scoresOf = (r: ReturnType<typeof parseVoiceScores>) => Object.fromEntries(r.scores.map((s) => [s.playerId, s.strokes]));
const checkOf = (r: ReturnType<typeof parseVoiceScores>, id: number) => r.scores.find((s) => s.playerId === id)?.check ?? null;

describe("parseVoiceScores", () => {
  it("reads a whole group in golf words, against the hole's par", () => {
    const r = parseVoiceScores("Niamh bogey, I made par, Dec took a double and Ciarán a four", 4, group);
    expect(scoresOf(r)).toEqual({ 1: 4, 2: 5, 3: 6, 4: 4 });
    expect(r.missing).toEqual([]);
    expect(r.scores.every((s) => s.check === null)).toBe(true);
  });

  it("asks about a word that only sounds like a number", () => {
    const r = parseVoiceScores("Niamh bogey I made par Dec took a double and Ciarán for", 4, group);
    expect(scoresOf(r)[4]).toBe(4);
    expect(checkOf(r, 4)).toMatch(/for.*4/);
    expect(checkOf(r, 2)).toBeNull();
  });

  it("prefers a real number over a sound-alike in the same breath", () => {
    const r = parseVoiceScores("Niamh won the hole with a three", 4, group);
    expect(scoresOf(r)[2]).toBe(3);
    expect(checkOf(r, 2)).toBeNull();
  });

  it("knows how recognisers spell Irish names", () => {
    const r = parseVoiceScores("Neve five Kieran six", 4, group);
    expect(scoresOf(r)).toEqual({ 2: 5, 4: 6 });
    expect(r.missing).toEqual([1, 3]);
  });

  it("takes short forms and near spellings", () => {
    expect(scoresOf(parseVoiceScores("Dec 5 Niam 6", 4, group))).toEqual({ 3: 5, 2: 6 });
  });

  it("reads a score said before the name", () => {
    expect(scoresOf(parseVoiceScores("a five for Niamh and a six for Dec", 4, group))).toEqual({ 2: 5, 3: 6 });
  });

  it("takes the corrected score", () => {
    const r = parseVoiceScores("Niamh five, no, six", 4, group);
    expect(scoresOf(r)).toEqual({ 2: 6 });
    expect(checkOf(r, 2)).toBeNull();
  });

  it("handles picked up, net terms and hole in one", () => {
    const r = parseVoiceScores("Dec picked up, I had a net par, Niamh hole in one", 3, group);
    expect(scoresOf(r)).toEqual({ 1: 4, 2: 1, 3: null });
  });

  it("hears no return and NR as picked up", () => {
    expect(scoresOf(parseVoiceScores("Dec no return, Niamh N.R., I had a par", 4, group))).toEqual({ 1: 4, 2: null, 3: null });
    expect(scoresOf(parseVoiceScores("Niamh NR", 4, group))).toEqual({ 2: null });
    expect(scoresOf(parseVoiceScores("I picked up", 4, group))).toEqual({ 1: null });
  });

  it("gives everyone else the score after 'the rest of us'", () => {
    expect(scoresOf(parseVoiceScores("Dec birdie, the rest of us par", 4, group))).toEqual({ 1: 4, 2: 4, 3: 3, 4: 4 });
    expect(scoresOf(parseVoiceScores("we all had bogeys", 5, group))).toEqual({ 1: 6, 2: 6, 3: 6, 4: 6 });
  });

  it("copies 'the same'", () => {
    expect(scoresOf(parseVoiceScores("Niamh six, Dec the same, same for me", 4, group))).toEqual({ 1: 6, 2: 6, 3: 6 });
  });

  it("ignores putts, hole numbers and 'par four' on a par 4", () => {
    expect(scoresOf(parseVoiceScores("on seven Niamh had two putts for a five", 4, group))).toEqual({ 2: 5 });
    expect(scoresOf(parseVoiceScores("Dec par four", 4, group))).toEqual({ 3: 4 });
  });

  it("doesn't take everyday words for names", () => {
    const theo: VoicePlayer[] = [{ id: 9, name: "Theo Ryan", isMe: false, shots: 0 }, { id: 1, name: "Eire", isMe: true, shots: 0 }];
    expect(scoresOf(parseVoiceScores("then I made the par", 4, theo))).toEqual({ 1: 4 });
  });

  it("asks whose score it was when no name is heard", () => {
    const r = parseVoiceScores("five", 4, group);
    expect(scoresOf(r)).toEqual({ 1: 5 });
    expect(checkOf(r, 1)).toMatch(/No name/);
    const solo = parseVoiceScores("five", 4, [group[0]]);
    expect(checkOf(solo, 1)).toBeNull();
  });

  it("flags two players it can't tell apart, and unlikely numbers", () => {
    const seans: VoicePlayer[] = [
      { id: 1, name: "Sean Kelly", isMe: false, shots: 0 },
      { id: 2, name: "Sean Daly", isMe: false, shots: 0 },
    ];
    const r = parseVoiceScores("Shaun four", 4, seans);
    expect(scoresOf(r)).toEqual({ 1: 4 });
    expect(checkOf(r, 1)).toMatch(/More than one/);
    expect(checkOf(parseVoiceScores("Dec eleven", 4, group), 3)).toMatch(/11 on a par 4/);
  });

  it("matches a pair's row by either name", () => {
    const pairs: VoicePlayer[] = [
      { id: 10, name: "Eire & Tom", isMe: true, shots: 0 },
      { id: 20, name: "Ciarán & Ruth", isMe: false, shots: 0 },
    ];
    expect(scoresOf(parseVoiceScores("Ruth's pair a five, we had par", 4, pairs))).toEqual({ 20: 5, 10: 4 });
  });

  it("doesn't take everyday words for names it could start", () => {
    const g: VoicePlayer[] = [
      { id: 1, name: "Eire", isMe: true, shots: 0 },
      { id: 2, name: "Andrew Hadley", isMe: false, shots: 0 },
      { id: 3, name: "William Sheila", isMe: false, shots: 0 },
      { id: 4, name: "Niamh", isMe: false, shots: 0 },
    ];
    expect(scoresOf(parseVoiceScores("I had par", 4, g))).toEqual({ 1: 4 });
    expect(scoresOf(parseVoiceScores("Niamh will have a five", 4, g))).toEqual({ 4: 5 });
    expect(scoresOf(parseVoiceScores("Eire four and five for Niamh", 4, g))).toEqual({ 1: 4, 4: 5 });
  });

  it("gives 'both' to the last two named only", () => {
    expect(scoresOf(parseVoiceScores("Niamh and I both had par", 4, group))).toEqual({ 1: 4, 2: 4 });
  });

  it("doesn't take 'on in two' or 'the par four' for a score", () => {
    expect(scoresOf(parseVoiceScores("Niamh was on in two and made bogey", 4, group))).toEqual({ 2: 5 });
    const r = parseVoiceScores("Dec had a five on the par four", 4, group);
    expect(scoresOf(r)).toEqual({ 3: 5 });
    expect(checkOf(r, 3)).toBeNull();
  });

  it("asks rather than guessing between two scores", () => {
    const r = parseVoiceScores("Niamh five six", 4, group);
    expect(scoresOf(r)).toEqual({ 2: 5 });
    expect(checkOf(r, 2)).toMatch(/two scores/);
  });

  it("keeps the words each score came from", () => {
    const r = parseVoiceScores("Niamh bogey", 4, group);
    expect(r.scores[0].heard).toBe("niamh bogey");
  });
});

describe("foldWords", () => {
  it("drops fadas, case and punctuation", () => {
    expect(foldWords("Ciarán's 4! Seán—par")).toEqual(["ciaran's", "4", "sean", "par"]);
  });
});

describe("listeningHints", () => {
  it("lists the group's names before the golf words", () => {
    expect(listeningHints(group).slice(0, 3)).toEqual(["Eire", "Duffy", "Niamh"]);
    expect(listeningHints([{ id: 1, name: "Eire & Tom", isMe: true, shots: 0 }])).toContain("Tom");
  });
});
