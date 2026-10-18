// Pure: tested in voice-scores.test.ts (no React Native here).
//
// Voice scoring (Oct 2026, claude/voice-scoring.md): turns what a player
// said after a hole — "Niamh bogey, I made par, Dec took a double and
// Ciarán a four" — into a score for each player in the group.
//
// The phone's speech recogniser does the listening; this does the golf. It
// runs on the phone with no network, so it works on a links course with no
// signal, and it already knows the things that make it reliable:
//
//   - the hole's par, so "bogey" on a par 4 is a 5;
//   - who's in the group, so it only listens for those names (with the
//     spellings a recogniser produces for Irish names: Niamh → "Neve");
//   - each player's shots on the hole, so "net par" means something.
//
// It never guesses silently. A word that only sounds like a number ("for",
// "to", "won", "ate", "tree"), a score with no name, two players it can't
// tell apart, or an unlikely number all come back with a `check` reason, and
// the screen asks before saving. Nothing is saved from here: the member
// confirms every score on the next screen.

export type VoicePlayer = {
  /** The row's id on the round screen (a player, or a pair's first player). */
  id: number;
  /** As shown on the card: "Niamh Byrne", or "Eire & Tom" for a pair. */
  name: string;
  /** The member holding the phone ("I", "me"). */
  isMe: boolean;
  /** Their shots on this hole, for "net par"; null when unknown. */
  shots: number | null;
};

export type VoiceScore = {
  playerId: number;
  /** Strokes on the hole; null = picked up. */
  strokes: number | null;
  /** The words it came from, as heard: "Niamh bogey". */
  heard: string;
  /** Why the member should look at this one before saving; null when sure. */
  check: string | null;
};

export type VoiceResult = {
  /** In the order the players were given. */
  scores: VoiceScore[];
  /** Players nobody gave a score for. */
  missing: number[];
};

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};

/** Words a recogniser writes for a number that are also ordinary words. */
const SOUNDS_LIKE: Record<string, number> = { for: 4, fore: 4, to: 2, too: 2, won: 1, ate: 8, tree: 3 };

/** Against par: "bogey" is +1. Absolute scores are handled separately. */
const TERMS: Record<string, number> = {
  albatross: -3, eagle: -2, eagled: -2, birdie: -1, birdy: -1, birdied: -1, birdies: -1,
  par: 0, parred: 0, pars: 0,
  bogey: 1, bogie: 1, bogy: 1, boogie: 1, bogeyed: 1, bogeys: 1,
  double: 2, doubled: 2, triple: 3, tripled: 3, quad: 4, quadruple: 4,
};

/** Phrases, longest first, folded to single tokens before anything else. */
const PHRASES: Array<[string[], Token["kind"], number?]> = [
  [["hole", "in", "one"], "abs", 1],
  [["double", "eagle"], "term", -3],
  [["double", "bogey"], "term", 2],
  [["double", "bogie"], "term", 2],
  [["triple", "bogey"], "term", 3],
  [["triple", "bogie"], "term", 3],
  [["quadruple", "bogey"], "term", 4],
  [["quad", "bogey"], "term", 4],
  [["picked", "it", "up"], "pickup"],
  [["picked", "up"], "pickup"],
  [["pick", "up"], "pickup"],
  [["picked", "the", "ball", "up"], "pickup"],
  [["no", "score"], "pickup"],
  [["no", "return"], "pickup"],
  [["no", "returns"], "pickup"],
  [["n", "r"], "pickup"],
  [["pick", "it", "up"], "pickup"],
  [["picked", "that", "up"], "pickup"],
  [["did", "not", "finish"], "pickup"],
  [["didn't", "finish"], "pickup"],
  [["didnt", "finish"], "pickup"],
  [["the", "same"], "same"],
  [["same", "again"], "same"],
  [["same", "as", "that"], "same"],
  [["the", "rest", "of", "us"], "all"],
  [["rest", "of", "us"], "all"],
  [["the", "rest"], "all"],
  [["we", "all"], "all"],
  [["all", "of", "us"], "all"],
  [["i", "mean"], "corr"],
  [["make", "that"], "corr"],
];

/** The speaker: "I made par". "We"/"us" is their own side when a row is a pair or team. */
const ME = new Set(["i", "i'm", "im", "i've", "ive", "i'd", "id", "me", "myself", "mine", "my", "we", "us", "our", "ours"]);
const ALL = new Set(["everyone", "everybody", "all"]);
const CORRECTIONS = new Set(["no", "sorry", "actually", "correction", "wait", "scratch"]);
const SAME = new Set(["same", "ditto"]);
const PICKUP = new Set(["blob", "nr", "wiped", "lifted", "pickup", "pickedup"]);
/** A number right before these isn't a score: "two putts", "three putted", "two penalty shots". */
const NOT_A_SCORE_AFTER = new Set(["putt", "putts", "putted", "putting", "shots", "clubs", "iron", "penalty", "penalties"]);
/** …nor right after these: "on seven", "hole seven", "on in two". */
const NOT_A_SCORE_BEFORE = new Set(["hole", "on", "number", "in"]);

/**
 * How recognisers write Irish names, folded (no fadas, lower case). The key
 * is the name as people spell it; the values are what comes back from
 * speech. A name not here still matches itself, a near spelling ("Niam"),
 * or a short form ("Dec" for Declan).
 */
export const NAME_SOUNDS: Record<string, string[]> = {
  niamh: ["neve", "neeve", "neev", "nieve", "neave", "niav", "nev", "neeve's"],
  caoimhe: ["keeva", "kweeva", "keva", "kiva", "queva", "keefa"],
  ciaran: ["kieran", "kiran", "keiran", "kieren", "keeran", "ciaron", "kerin"],
  ciara: ["kiara", "keira", "kira", "kiera", "ciarra"],
  sean: ["shaun", "shawn", "shon", "sian"],
  seamus: ["shamus", "shaymus", "seamas"],
  siobhan: ["shivaun", "shivon", "chevonne", "shavon", "shevaun", "shivawn", "shevonne"],
  oisin: ["osheen", "oshin", "usheen", "ocean", "oison"],
  aoife: ["eefa", "eefah", "eifa", "ifa", "eva"],
  sadhbh: ["sive", "syve", "sieve"],
  darragh: ["dara", "darra", "daragh", "darrah"],
  dara: ["darragh", "darra", "daragh"],
  padraig: ["pauric", "porick", "padrig", "patrick", "paudie"],
  eoin: ["owen", "oin", "own"],
  eoghan: ["owen", "oin"],
  cian: ["keen", "kian", "kean", "keane"],
  roisin: ["rosheen", "roshin", "rosh"],
  grainne: ["grawnya", "grania", "granya", "grawnia"],
  tadhg: ["tige", "tiger", "teig", "tig", "tyg"],
  fionn: ["finn", "fin", "fionne"],
  aoibhinn: ["eveen", "aveen", "eveenn"],
  clodagh: ["cloda", "clodah", "clodha"],
  meabh: ["maeve", "mave", "maev"],
  maeve: ["mave", "maev", "meabh"],
  orla: ["orlagh", "orlah"],
  eimear: ["emer", "eemer", "ema", "eimer"],
  saoirse: ["seersha", "sersha", "sorsha", "searsha", "seersa"],
  ruairi: ["rory", "rorie", "ruari"],
  ruaidhri: ["rory", "rorie"],
  dearbhla: ["dervla", "dearvla"],
  ailbhe: ["alva", "alvah", "alvy"],
  cillian: ["killian", "kilian", "cilian"],
  diarmuid: ["dermot", "dermod", "diarmaid", "dermy"],
  donncha: ["dunnacha", "donagh", "donnacha", "dunnaka"],
  donnacha: ["dunnacha", "donagh", "donncha", "dunnaka"],
  fiachra: ["feeakra", "feakra", "fiakra"],
  muireann: ["mirren", "miran", "mirran"],
  mairead: ["muraed", "mareid", "maraid", "mar-aid"],
  cathal: ["cahal", "kahal", "cahill"],
  caoimhin: ["keeveen", "kevin", "keveen"],
  eamon: ["eamonn", "aymon", "aymen", "ayman", "amon"],
  eamonn: ["eamon", "aymon", "aymen", "ayman", "amon"],
  nuala: ["noola", "nula"],
  blathnaid: ["blawnid", "blawneed"],
  una: ["oona", "oonagh"],
  declan: ["deco", "dec", "deckland"],
  tomas: ["thomas", "tom"],
  liam: ["leam", "lee-am"],
};

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export type Token =
  | { kind: "name"; players: number[]; text: string }
  | { kind: "me"; text: string }
  | { kind: "abs"; value: number; text: string }
  | { kind: "term"; value: number; net: boolean; text: string }
  | { kind: "weak"; value: number; text: string }
  | { kind: "pickup"; text: string }
  | { kind: "same"; text: string }
  | { kind: "all"; text: string }
  | { kind: "both"; text: string }
  | { kind: "corr"; text: string }
  | { kind: "word"; text: string };

/** Lower case, no fadas, digits and letters only: "Ciarán's 4!" → ["ciaran's", "4"]. */
export function foldWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** Every word a player answers to: each part of their name and how it sounds. */
function nameKeys(name: string): { exact: Set<string>; parts: string[] } {
  const parts = foldWords(name.replace(/&/g, " ")).filter((w) => w !== "and" && w.length >= 2);
  const exact = new Set<string>();
  for (const p of parts) {
    exact.add(p);
    for (const s of NAME_SOUNDS[p] ?? []) exact.add(s);
  }
  return { exact, parts };
}

/**
 * Everyday words that must never be taken for a name by the near-spelling
 * and short-form rules ("the" is not Theresa, "then" is not Theo).
 */
const NOT_NAMES = new Set(
  (
    "the then than that this they them there their these those with what when where went want were well very just also back " +
    "once good nice made make took gave give going gone said says shot shots hole holes green tee drive putt putts chip into " +
    "onto over under after from have having been some same again still only even mine mind plus less more most next last first " +
    "much bit lot and will had has have she her hers his him who how why was are can could did does done got get gets put " +
    "out way but not con col ran all any yes yeah yep now new old our you your yours its it's let let's say see saw sure " +
    "great grand fair poor bad lucky unlucky missed holed sank tapped lipped close short long left right edge fringe bunker " +
    "water rough fairway nearly almost about around another other each every both either neither man men lad lads"
  ).split(" ")
);

/** The players a word could be: exact or sounds-like first, then near spellings and short forms. */
function playersFor(word: string, keys: Array<{ id: number; exact: Set<string>; parts: string[] }>): number[] {
  const bare = word.replace(/'s$/, "");
  const exact = keys.filter((k) => k.exact.has(bare)).map((k) => k.id);
  if (exact.length) return exact;
  if (isScoreWord(bare) || NOT_NAMES.has(bare) || ME.has(bare)) return [];
  const near = keys
    .filter((k) =>
      k.parts.some(
        (p) =>
          // "Niam" for Niamh; "Dec" or "Ciar" for Declan or Ciarán.
          (bare.length >= 4 && p.length >= 4 && editDistance(bare, p) <= 1) || (bare.length >= 3 && p.length > bare.length && p.startsWith(bare))
      )
    )
    .map((k) => k.id);
  return near;
}

function isScoreWord(w: string): boolean {
  return w in NUMBERS || w in TERMS || w in SOUNDS_LIKE || /^\d{1,2}$/.test(w) || PICKUP.has(w) || w === "ace" || w === "net";
}

/** Exported for voice-stats.ts, which reads the same words for the speaker's own stats. */
export function tokenise(words: string[], players: readonly VoicePlayer[]): Token[] {
  const keys = players.map((p) => ({ id: p.id, ...nameKeys(p.name) }));
  const out: Token[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const phrase = PHRASES.find(([ws]) => ws.every((x, j) => words[i + j] === x));
    if (phrase) {
      const [ws, kind, value] = phrase;
      const text = ws.join(" ");
      i += ws.length - 1;
      if (kind === "abs") out.push({ kind, value: value!, text });
      else if (kind === "term") out.push({ kind, value: value!, net: false, text });
      else out.push({ kind, text } as Token);
      continue;
    }
    // A player's own name wins over everything except a phrase: a Pat is
    // never a par, but "par" is never Pat either (exact matches only).
    const named = playersFor(w, keys);
    if (named.length && !(w in TERMS) && !(w in NUMBERS) && !(w in SOUNDS_LIKE)) {
      out.push({ kind: "name", players: named, text: w });
      continue;
    }
    if (ME.has(w)) {
      out.push({ kind: "me", text: w });
      continue;
    }
    if (w === "net" && words[i + 1] && words[i + 1] in TERMS) {
      const next = words[i + 1];
      out.push({ kind: "term", value: TERMS[next], net: true, text: `net ${next}` });
      i += 1;
      continue;
    }
    // "on the par four", "this par 5": the hole, not a score.
    if (w === "par" && ["the", "this", "that", "a"].includes(words[i - 1] ?? "") && words[i + 1] != null && (words[i + 1] in NUMBERS || /^\d$/.test(words[i + 1]))) {
      const next = words[i + 1];
      const n = next in NUMBERS ? NUMBERS[next] : Number(next);
      if (n >= 3 && n <= 6 && words[i - 1] !== "a") {
        out.push({ kind: "word", text: `par ${next}` });
        i += 1;
        continue;
      }
    }
    if (w in TERMS) {
      out.push({ kind: "term", value: TERMS[w], net: false, text: w });
      continue;
    }
    if (w === "ace") {
      out.push({ kind: "abs", value: 1, text: w });
      continue;
    }
    const n = w in NUMBERS ? NUMBERS[w] : /^\d{1,2}$/.test(w) ? Number(w) : null;
    if (n != null) {
      const before = words[i - 1];
      const after = words[i + 1];
      if ((after && NOT_A_SCORE_AFTER.has(after)) || (before && NOT_A_SCORE_BEFORE.has(before))) {
        out.push({ kind: "word", text: w });
      } else {
        out.push({ kind: "abs", value: n, text: w });
      }
      continue;
    }
    if (w in SOUNDS_LIKE) {
      out.push({ kind: "weak", value: SOUNDS_LIKE[w], text: w });
      continue;
    }
    if (PICKUP.has(w)) out.push({ kind: "pickup", text: w });
    else if (SAME.has(w)) out.push({ kind: "same", text: w });
    else if (ALL.has(w)) out.push({ kind: "all", text: w });
    else if (w === "both") out.push({ kind: "both", text: w });
    else if (CORRECTIONS.has(w)) out.push({ kind: "corr", text: w });
    else out.push({ kind: "word", text: w });
  }
  // "Niamh Byrne": two words, one mention.
  const merged: Token[] = [];
  for (const t of out) {
    const last = merged[merged.length - 1];
    if (t.kind === "name" && last?.kind === "name" && last.players.some((p) => t.players.includes(p))) {
      last.players = last.players.filter((p) => t.players.includes(p));
      last.text = `${last.text} ${t.text}`;
      continue;
    }
    merged.push(t);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Putting names and scores together
// ---------------------------------------------------------------------------

type Value = { strokes: number | null; check: string | null };
type ScoreToken = Extract<Token, { kind: "abs" | "term" | "weak" | "pickup" }>;

const isScore = (t: Token): t is ScoreToken => t.kind === "abs" || t.kind === "term" || t.kind === "weak" || t.kind === "pickup";

function valueOf(t: ScoreToken, par: number, player: VoicePlayer | undefined): Value {
  switch (t.kind) {
    case "pickup":
      return { strokes: null, check: null };
    case "abs":
      return { strokes: t.value, check: null };
    case "weak":
      return { strokes: t.value, check: `Sounded like “${t.text}”. Did you mean ${t.value}?` };
    case "term": {
      const shots = t.net ? (player?.shots ?? null) : 0;
      return {
        strokes: Math.max(1, par + t.value + (shots ?? 0)),
        check: t.net && shots == null ? "Heard “net”, but this hole has no shots set. Check the score." : null,
      };
    }
  }
}

export function parseVoiceScores(transcript: string, par: number, players: readonly VoicePlayer[]): VoiceResult {
  const tokens = tokenise(foldWords(transcript), players);
  const me = players.find((p) => p.isMe);
  const byId = new Map(players.map((p) => [p.id, p]));
  const results = new Map<number, VoiceScore>();

  /** Who a name or "me" token means; ambiguous names go to the first not yet scored. */
  const resolve = (t: Token): { id: number; check: string | null } | null => {
    if (t.kind === "me") return me ? { id: me.id, check: null } : null;
    if (t.kind !== "name") return null;
    const open = t.players.filter((id) => !results.has(id));
    const id = open[0] ?? t.players[0];
    const check = t.players.length > 1 ? `More than one player could be “${t.text}”. Check this is the right one.` : null;
    return { id, check };
  };

  const bind = (id: number, v: Value, heard: string, extraCheck: string | null) => {
    if (v.strokes != null && (v.strokes < 1 || v.strokes > 15)) return;
    const check =
      v.check ?? extraCheck ?? (v.strokes != null && v.strokes >= par + 5 ? `That's a ${v.strokes} on a par ${par}. Is that right?` : null);
    results.set(id, { playerId: id, strokes: v.strokes, heard, check });
  };

  let current: { id: number; check: string | null; start: number; bound: boolean; weak: number | null } | null = null;
  let correcting = false;
  let allMode = false;
  let bothMode = false;
  /** Everyone named so far, most recent last: "Niamh and I both had par". */
  const named: number[] = [];
  let lastValue: Value | null = null;
  /** A score said before its name: "a five for Niamh". */
  let floating: { value: Value; start: number } | null = null;
  const textOf = (from: number, to: number) =>
    tokens
      .slice(Math.min(from, to), Math.max(from, to) + 1)
      .map((t) => t.text)
      .join(" ");

  /** A name that only got a sound-alike word ("Ciarán for…") takes it, flagged. */
  const settleWeak = () => {
    if (current && !current.bound && current.weak != null) {
      const w = tokens[current.weak] as ScoreToken;
      bind(current.id, valueOf(w, par, byId.get(current.id)), textOf(current.start, current.weak), current.check);
      lastValue = results.get(current.id)!;
      current.bound = true;
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === "name" || t.kind === "me") {
      const who = resolve(t);
      if (!who) continue;
      const prev = tokens[i - 1];
      // "five for Niamh", "same for me": the score already said is theirs.
      if (floating && prev?.kind === "weak" && (prev.text === "for" || prev.text === "to")) {
        bind(who.id, floating.value, textOf(floating.start, i), who.check);
        lastValue = floating.value;
        floating = null;
        settleWeak();
        current = { ...who, start: i, bound: true, weak: null };
        continue;
      }
      settleWeak();
      current = { ...who, start: i, bound: false, weak: null };
      named.push(who.id);
      correcting = false;
      allMode = false;
      bothMode = false;
      floating = null;
      continue;
    }
    if (t.kind === "both") {
      bothMode = true;
      continue;
    }
    if (t.kind === "corr") {
      correcting = true;
      continue;
    }
    if (t.kind === "all") {
      settleWeak();
      allMode = true;
      current = null;
      continue;
    }
    if (t.kind === "same") {
      if (!lastValue) continue;
      const v: Value = { strokes: lastValue.strokes, check: null };
      if (current && !current.bound) {
        bind(current.id, v, textOf(current.start, i), current.check);
        current.bound = true;
      } else {
        floating = { value: v, start: i };
      }
      continue;
    }
    if (t.kind === "weak") {
      const next = tokens[i + 1];
      const connector = (t.text === "for" || t.text === "to") && (next?.kind === "name" || next?.kind === "me");
      if (connector) continue;
      if (current && !current.bound && current.weak == null) current.weak = i;
      continue;
    }
    if (!isScore(t)) continue;

    // "par four" on a par 4 is one score, not two.
    const prev = tokens[i - 1];
    if (t.kind === "abs" && t.value === par && prev?.kind === "term" && prev.value === 0) continue;

    if (allMode) {
      for (const p of players) {
        if (!results.has(p.id)) bind(p.id, valueOf(t, par, p), textOf(i - 1, i), null);
      }
      lastValue = valueOf(t, par, me);
      allMode = false;
      continue;
    }
    if (bothMode) {
      const pair = [...new Set(named)].slice(-2);
      for (const id of pair) bind(id, valueOf(t, par, byId.get(id)), textOf(i - 2, i), pair.length < 2 ? "Heard “both”, but only one name. Check who else." : null);
      lastValue = valueOf(t, par, me);
      bothMode = false;
      if (current && pair.includes(current.id)) current.bound = true;
      continue;
    }
    if (current && (!current.bound || correcting)) {
      const v = valueOf(t, par, byId.get(current.id));
      const had = results.get(current.id);
      bind(current.id, v, textOf(current.start, i), current.check);
      if (had && !correcting && had.strokes !== v.strokes) results.get(current.id)!.check = `Heard two scores for ${byId.get(current.id)?.name.split(" ")[0]}. Check it.`;
      lastValue = v;
      current.bound = true;
      current.weak = null;
      correcting = false;
      continue;
    }
    // A second score for someone already scored, not handed on with "for
    // Niamh": don't guess which is right — keep the first and ask.
    const n1 = tokens[i + 1];
    const n2 = tokens[i + 2];
    const handedOn = n1?.kind === "weak" && (n1.text === "for" || n1.text === "to") && (n2?.kind === "name" || n2?.kind === "me");
    if (current?.bound && !handedOn) {
      const had = results.get(current.id);
      const v = valueOf(t, par, byId.get(current.id));
      if (had && had.strokes !== v.strokes) had.check = `Heard two scores for ${byId.get(current.id)?.name.split(" ")[0]}. Check it.`;
      continue;
    }
    // A score with nobody waiting for it: maybe "… for Niamh" comes next.
    floating = { value: valueOf(t, par, undefined), start: i };
  }
  settleWeak();

  // Nobody named at all: a lone player's score is theirs; otherwise it's
  // probably the speaker's own, but ask.
  if (named.length === 0 && results.size === 0 && floating) {
    const solo = players.length === 1 ? players[0] : me;
    if (solo) {
      bind(solo.id, floating.value, textOf(floating.start, floating.start), players.length === 1 ? null : "No name heard. Was this your score?");
    }
  }

  const scores = players.filter((p) => results.has(p.id)).map((p) => results.get(p.id)!);
  return { scores, missing: players.filter((p) => !results.has(p.id)).map((p) => p.id) };
}

/**
 * Words to hand the recogniser so it listens for this group: their names
 * (as spelled, and how they sound) and the golf words. Recognisers take a
 * short list; names first.
 */
export function listeningHints(players: readonly VoicePlayer[]): string[] {
  const names = new Set<string>();
  for (const p of players) {
    for (const part of p.name.replace(/&/g, " ").split(/\s+/)) {
      if (part.length >= 2 && part.toLowerCase() !== "and") names.add(part);
    }
  }
  return [...names, "birdie", "bogey", "double bogey", "par", "eagle", "picked up", "no return"].slice(0, 40);
}
