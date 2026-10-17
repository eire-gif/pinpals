/**
 * Smart search and smart listing titles for the marketplace (Oct 2026).
 *
 * Byte-identical in src/lib/ and mobile/src/lib/ (smart-search.test.ts checks)
 * so the website and the app read a search the same way. Pure: no imports, no
 * network. The brand list is passed in — the website bundles it
 * (src/data/golf-brands.json), the app fetches it — as { id, label, aliases }.
 *
 *   parseSearch("tm qi10 drvier under 300 near me", brands)
 *     -> brand taylormade, category Drivers, up to €300, near me,
 *        text "qi10", and the fix "drvier → driver" to show the member.
 *
 *   completeSearch("taylormade dr", brands) -> ["taylormade drivers", ...]
 *
 *   parseListingTitle("ping g430 driver 10.5 stiff lh", brands)
 *     -> Drivers, Ping, model "G430", loft 10.5°, Stiff, Left-handed, and a
 *        tidy title "Ping G430 driver — 10.5°, stiff, left-handed".
 *
 * Vocabulary values (categories, subcategories, conditions, flexes, counties)
 * are copied from src/lib/marketplace.ts, src/lib/marketplace-brands.ts and
 * src/lib/regions.ts; the test fails if they drift.
 */

export type SmartBrand = { id: string; label: string; aliases?: readonly string[] };

export const SMART_CATEGORIES = [
  "Drivers",
  "Woods & hybrids",
  "Irons",
  "Wedges",
  "Putters",
  "Full sets",
  "Bags & trolleys",
  "Shoes & apparel",
  "Balls & accessories",
] as const;
export type SmartCategory = (typeof SMART_CATEGORIES)[number];

export const SMART_CONDITIONS = ["New / unused", "Excellent", "Good", "Fair"] as const;

export const SMART_COUNTIES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry",
  "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth",
  "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
  "Antrim", "Armagh", "Derry", "Down", "Fermanagh", "Tyrone",
] as const;

/** Towns people type instead of a county. */
export const SMART_TOWNS: Record<string, string> = {
  portmarnock: "Dublin", malahide: "Dublin", swords: "Dublin", howth: "Dublin", skerries: "Dublin",
  rush: "Dublin", lucan: "Dublin", tallaght: "Dublin", dalkey: "Dublin", "dun laoghaire": "Dublin",
  bray: "Wicklow", greystones: "Wicklow", naas: "Kildare", maynooth: "Kildare", newbridge: "Kildare",
  navan: "Meath", ashbourne: "Meath", drogheda: "Louth", dundalk: "Louth", athlone: "Westmeath",
  mullingar: "Westmeath", killarney: "Kerry", tralee: "Kerry", ennis: "Clare", lahinch: "Clare",
  kinsale: "Cork", ballybunion: "Kerry", belfast: "Antrim", portrush: "Antrim", newcastle: "Down",
  letterkenny: "Donegal", wexford: "Wexford", waterford: "Waterford", tullamore: "Offaly",
  portlaoise: "Laois", castlebar: "Mayo", westport: "Mayo", carlow: "Carlow", kilkenny: "Kilkenny",
  clonmel: "Tipperary", nenagh: "Tipperary",
};

type CategoryWord = { category: SmartCategory; subcategory?: string };

/** Single words (and a few pairs) that name a category or subcategory. */
const CATEGORY_WORDS: Record<string, CategoryWord> = {
  driver: { category: "Drivers" },
  drivers: { category: "Drivers" },
  wood: { category: "Woods & hybrids", subcategory: "Fairway woods" },
  woods: { category: "Woods & hybrids", subcategory: "Fairway woods" },
  fairway: { category: "Woods & hybrids", subcategory: "Fairway woods" },
  fairways: { category: "Woods & hybrids", subcategory: "Fairway woods" },
  hybrid: { category: "Woods & hybrids", subcategory: "Hybrids" },
  hybrids: { category: "Woods & hybrids", subcategory: "Hybrids" },
  rescue: { category: "Woods & hybrids", subcategory: "Hybrids" },
  iron: { category: "Irons" },
  irons: { category: "Irons" },
  wedge: { category: "Wedges" },
  wedges: { category: "Wedges" },
  putter: { category: "Putters" },
  putters: { category: "Putters" },
  mallet: { category: "Putters", subcategory: "Mallet" },
  blade: { category: "Putters", subcategory: "Blade" },
  set: { category: "Full sets" },
  sets: { category: "Full sets" },
  bag: { category: "Bags & trolleys" },
  bags: { category: "Bags & trolleys" },
  trolley: { category: "Bags & trolleys", subcategory: "Push trolleys" },
  trolleys: { category: "Bags & trolleys", subcategory: "Push trolleys" },
  shoes: { category: "Shoes & apparel", subcategory: "Shoes" },
  shoe: { category: "Shoes & apparel", subcategory: "Shoes" },
  waterproofs: { category: "Shoes & apparel", subcategory: "Waterproofs" },
  waterproof: { category: "Shoes & apparel", subcategory: "Waterproofs" },
  jacket: { category: "Shoes & apparel", subcategory: "Waterproofs" },
  glove: { category: "Shoes & apparel", subcategory: "Gloves" },
  gloves: { category: "Shoes & apparel", subcategory: "Gloves" },
  cap: { category: "Shoes & apparel", subcategory: "Headwear" },
  hat: { category: "Shoes & apparel", subcategory: "Headwear" },
  polo: { category: "Shoes & apparel", subcategory: "Other apparel" },
  balls: { category: "Balls & accessories", subcategory: "Golf balls" },
  ball: { category: "Balls & accessories", subcategory: "Golf balls" },
  tees: { category: "Balls & accessories", subcategory: "Tees" },
  headcover: { category: "Balls & accessories", subcategory: "Head covers" },
  headcovers: { category: "Balls & accessories", subcategory: "Head covers" },
  rangefinder: { category: "Balls & accessories", subcategory: "Rangefinders / GPS" },
  rangefinders: { category: "Balls & accessories", subcategory: "Rangefinders / GPS" },
  gps: { category: "Balls & accessories", subcategory: "Rangefinders / GPS" },
};

const CATEGORY_PAIRS: Record<string, CategoryWord> = {
  "full set": { category: "Full sets" },
  "package set": { category: "Full sets" },
  "complete set": { category: "Full sets" },
  "iron set": { category: "Irons", subcategory: "Iron sets" },
  "stand bag": { category: "Bags & trolleys", subcategory: "Stand bags" },
  "cart bag": { category: "Bags & trolleys", subcategory: "Cart bags" },
  "travel bag": { category: "Bags & trolleys", subcategory: "Travel bags" },
  "electric trolley": { category: "Bags & trolleys", subcategory: "Electric trolleys" },
  "push trolley": { category: "Bags & trolleys", subcategory: "Push trolleys" },
  "sand wedge": { category: "Wedges", subcategory: "Sand wedge" },
  "lob wedge": { category: "Wedges", subcategory: "Lob wedge" },
  "gap wedge": { category: "Wedges", subcategory: "Gap wedge" },
  "pitching wedge": { category: "Wedges", subcategory: "Pitching wedge" },
  "golf balls": { category: "Balls & accessories", subcategory: "Golf balls" },
  "head cover": { category: "Balls & accessories", subcategory: "Head covers" },
  "golf shoes": { category: "Shoes & apparel", subcategory: "Shoes" },
};

/** What a word reads as wherever it's typed. */
const SHORTHAND: Record<string, string> = {
  tm: "taylormade",
  cally: "callaway",
  lh: "left-handed",
  lefty: "left-handed",
  leftie: "left-handed",
  rh: "right-handed",
  reg: "regular",
  xstiff: "extra stiff",
  "x-stiff": "extra stiff",
  prov1: "pro v1",
  "pro-v1": "pro v1",
  rf: "rangefinder",
  "e-trolley": "electric trolley",
  etrolley: "electric trolley",
};

const CONDITION_WORDS: Record<string, (typeof SMART_CONDITIONS)[number]> = {
  new: "New / unused",
  unused: "New / unused",
  boxed: "New / unused",
  excellent: "Excellent",
  mint: "Excellent",
  good: "Good",
  fair: "Fair",
};

const FLEXES: Record<string, string> = {
  stiff: "Stiff",
  regular: "Regular",
  senior: "Senior",
  ladies: "Ladies",
  "extra stiff": "Extra stiff",
};

/** Words that carry no meaning in a search or a title. */
const NOISE = new Set([
  "a", "an", "the", "for", "with", "and", "in", "of", "golf", "club", "clubs", "sale",
  "selling", "looking", "want", "wanted", "any", "some", "me", "my", "used", "condition",
  "great", "lovely", "barely", "only", "hand", "handed", "shaft", "flex", "head", "inc",
  "including", "included", "plus", "&", "-", "–", "€", "eur", "euro", "euros",
]);

type Vocabulary = { core: readonly string[]; brands: readonly string[] };

/**
 * Words typo-correction is allowed to land on. Brand names only for longer
 * words: with hundreds of brands, a four-letter word is always one letter
 * away from some brand ("shed" -> "Seed").
 */
function vocabulary(brands: readonly SmartBrand[]): Vocabulary {
  const words = new Set<string>([
    ...Object.keys(CATEGORY_WORDS),
    ...Object.keys(CATEGORY_PAIRS).flatMap((p) => p.split(" ")),
    ...Object.keys(CONDITION_WORDS),
    "stiff", "regular", "senior", "ladies", "graphite", "steel", "left-handed", "right-handed",
    "under", "below", "over", "near", "electric", "stand", "wedge",
    ...SMART_COUNTIES.map((c) => c.toLowerCase()),
    ...Object.keys(SMART_TOWNS).filter((t) => !t.includes(" ")),
  ]);
  const brandWords = new Set<string>();
  for (const brand of brands) {
    for (const name of [brand.label, ...(brand.aliases ?? [])]) {
      const n = norm(name);
      if (!n.includes(" ") && n.length >= 5 && !words.has(n)) brandWords.add(n);
    }
  }
  return { core: [...words], brands: [...brandWords] };
}

function norm(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .trim();
}

function tokenize(raw: string): string[] {
  return norm(raw)
    .replace(/[^a-z0-9.€°<>\-/\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Damerau–Levenshtein distance, capped (returns cap + 1 once it's exceeded). */
export function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

/** The closest vocabulary word to a probable typo, or null. Short words and numbers are left alone. */
function correct(word: string, vocab: Vocabulary): string | null {
  if (word.length < 4 || /\d/.test(word) || vocab.core.includes(word) || vocab.brands.includes(word)) return null;
  const cap = word.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = cap + 1;
  for (const candidate of word.length >= 5 ? [...vocab.core, ...vocab.brands] : vocab.core) {
    const distance = editDistance(word, candidate, cap);
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate.length < best.length)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= cap ? best : null;
}

/** Brand at the start of `tokens` (longest name first), or null. */
function brandAt(tokens: readonly string[], at: number, brands: readonly SmartBrand[]): { brand: SmartBrand; length: number } | null {
  let found: { brand: SmartBrand; length: number } | null = null;
  for (const brand of brands) {
    for (const name of [brand.label, brand.id.replace(/-/g, " "), ...(brand.aliases ?? [])]) {
      const parts = tokenize(name);
      if (parts.length === 0 || at + parts.length > tokens.length) continue;
      if (parts.every((p, i) => tokens[at + i] === p) && (!found || parts.length > found.length)) {
        found = { brand, length: parts.length };
      }
    }
  }
  return found;
}

function euroCents(raw: string): number | null {
  const m = raw.replace(/[€,]/g, "").match(/^(\d{1,6})(\.\d{1,2})?(k)?$/);
  if (!m) return null;
  const value = Number(m[1] + (m[2] ?? "")) * (m[3] ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

export type SmartChip = { key: string; label: string; value: string };

export type SmartSearch = {
  /** What's left for the full-text search on titles (models, words we don't know). */
  text: string;
  category: SmartCategory | "";
  subcategory: string;
  brands: string[];
  county: string;
  condition: string;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  leftHanded: boolean;
  nearMe: boolean;
  /** "We understood" — one per thing read out of the words. */
  chips: SmartChip[];
  /** Spellings put right, to say so ("drvier → driver"). */
  corrections: { from: string; to: string }[];
};

export const EMPTY_SMART_SEARCH: SmartSearch = {
  text: "",
  category: "",
  subcategory: "",
  brands: [],
  county: "",
  condition: "",
  minPriceCents: null,
  maxPriceCents: null,
  leftHanded: false,
  nearMe: false,
  chips: [],
  corrections: [],
};

const euro = (cents: number) => `€${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

/** Reads a search the way a golfer types it. Never throws. */
export function parseSearch(raw: string, brands: readonly SmartBrand[]): SmartSearch {
  const vocab = vocabulary(brands);
  const corrections: { from: string; to: string }[] = [];

  // Expand shorthand and fix spelling first, so everything after works on clean words.
  const tokens: string[] = [];
  for (const original of tokenize(raw.slice(0, 200))) {
    const short = SHORTHAND[original];
    if (short) {
      tokens.push(...short.split(" "));
      continue;
    }
    const fixed = correct(original, vocab);
    if (fixed) {
      corrections.push({ from: original, to: fixed });
      tokens.push(...fixed.split(" "));
    } else {
      tokens.push(original);
    }
  }

  const out: SmartSearch = { ...EMPTY_SMART_SEARCH, brands: [], chips: [], corrections };
  const text: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    const pair = `${t} ${next}`;

    // Price: "under 300", "below €300", "<300", "300 max", "over 100", "100-300"
    if (["under", "below", "max", "upto", "less", "cheaper"].includes(t) || (t === "up" && next === "to")) {
      const skip = t === "up" || t === "less" || t === "cheaper" ? 1 : 0;
      const after = tokens[i + 1 + skip] === "than" ? 2 + skip : 1 + skip;
      const cents = euroCents(tokens[i + after] ?? "");
      if (cents) {
        out.maxPriceCents = cents;
        i += after;
        continue;
      }
    }
    if (["over", "above", "from", "min"].includes(t)) {
      const cents = euroCents(next);
      if (cents) {
        out.minPriceCents = cents;
        i += 1;
        continue;
      }
    }
    if (/^<\d/.test(t)) {
      const cents = euroCents(t.slice(1));
      if (cents) {
        out.maxPriceCents = cents;
        continue;
      }
    }
    const range = t.match(/^€?(\d{1,6})-€?(\d{1,6})$/);
    if (range && !/^\d-?(pw|sw|lw|gw)$/.test(t) && Number(range[2]) > 10) {
      out.minPriceCents = Number(range[1]) * 100;
      out.maxPriceCents = Number(range[2]) * 100;
      continue;
    }
    if (/^€\d/.test(t)) {
      const cents = euroCents(t);
      if (cents) {
        out.maxPriceCents = cents;
        continue;
      }
    }

    // Where
    if (t === "near" && (next === "me" || next === "here")) {
      out.nearMe = true;
      i += 1;
      continue;
    }
    const town = SMART_TOWNS[pair] ?? SMART_TOWNS[t];
    if (town) {
      out.county = town;
      if (SMART_TOWNS[pair]) i += 1;
      continue;
    }
    const county = SMART_COUNTIES.find((c) => c.toLowerCase() === t);
    if (county) {
      out.county = county;
      continue;
    }

    // Hand
    if (t === "left-handed" || (t === "left" && (next === "handed" || next === "hand"))) {
      out.leftHanded = true;
      if (t === "left") i += 1;
      continue;
    }
    if (t === "right-handed") continue;

    // Brand (can be several words)
    const brand = brandAt(tokens, i, brands);
    if (brand) {
      if (!out.brands.includes(brand.brand.id)) out.brands.push(brand.brand.id);
      i += brand.length - 1;
      continue;
    }

    // Category, pairs first
    const category = CATEGORY_PAIRS[pair] ?? CATEGORY_WORDS[t];
    if (category && !(t === "set" && out.category === "Irons")) {
      if (!out.category || out.category === category.category) {
        out.category = category.category;
        if (category.subcategory) out.subcategory = category.subcategory;
      }
      if (CATEGORY_PAIRS[pair]) i += 1;
      continue;
    }

    // Condition
    const condition = CONDITION_WORDS[t];
    if (condition && !(t === "new" && next === "level")) {
      out.condition = condition;
      continue;
    }

    if (NOISE.has(t)) continue;
    text.push(t);
  }

  out.text = text.join(" ").trim();

  const brandLabel = (id: string) => brands.find((b) => b.id === id)?.label ?? id;
  for (const id of out.brands) out.chips.push({ key: `brand:${id}`, label: "Brand", value: brandLabel(id) });
  if (out.text) out.chips.push({ key: "text", label: "Looking for", value: out.text });
  if (out.category) out.chips.push({ key: "category", label: "In", value: out.subcategory ? `${out.category} · ${out.subcategory}` : out.category });
  if (out.minPriceCents !== null && out.maxPriceCents !== null) out.chips.push({ key: "price", label: "Price", value: `${euro(out.minPriceCents)}–${euro(out.maxPriceCents)}` });
  else if (out.maxPriceCents !== null) out.chips.push({ key: "price", label: "Up to", value: euro(out.maxPriceCents) });
  else if (out.minPriceCents !== null) out.chips.push({ key: "price", label: "From", value: euro(out.minPriceCents) });
  if (out.nearMe) out.chips.push({ key: "near", label: "Where", value: "Near me" });
  else if (out.county) out.chips.push({ key: "county", label: "Where", value: out.county });
  if (out.condition) out.chips.push({ key: "condition", label: "Condition", value: out.condition });
  if (out.leftHanded) out.chips.push({ key: "left", label: "Hand", value: "Left-handed" });

  return out;
}

/** True when a parse found anything beyond plain words. */
export function understoodSomething(search: SmartSearch): boolean {
  return search.chips.some((c) => c.key !== "text") || search.corrections.length > 0;
}

/**
 * Auto-complete: finishes the word being typed with a brand, a category or a
 * county, and offers the whole line back. Up to `limit`, best first.
 */
export function completeSearch(raw: string, brands: readonly SmartBrand[], limit = 4): string[] {
  const typed = raw.replace(/\s+/g, " ").trimStart();
  if (!typed.trim()) return [];
  const endsWithSpace = /\s$/.test(typed);
  const words = typed.trim().split(" ");
  const last = endsWithSpace ? "" : norm(words[words.length - 1]);
  const head = endsWithSpace ? words.join(" ") : words.slice(0, -1).join(" ");
  if (!last && !endsWithSpace) return [];

  const parsed = parseSearch(head, brands);
  const options: { text: string; score: number }[] = [];
  const add = (word: string, score: number) => {
    const line = `${head ? `${head} ` : ""}${word}`.trim();
    if (norm(line) !== norm(typed.trim()) && !options.some((o) => norm(o.text) === norm(line))) options.push({ text: line, score });
  };

  if (last.length >= 1) {
    if (parsed.brands.length === 0) {
      for (const b of brands) {
        if (norm(b.label).startsWith(last) || (b.aliases ?? []).some((a) => norm(a).startsWith(last))) add(b.label, 3 + (norm(b.label) === last ? 1 : 0));
      }
    }
    if (!parsed.category) {
      const seen = new Set<string>();
      for (const [word, meaning] of Object.entries(CATEGORY_WORDS)) {
        if (word.startsWith(last) && word.length > 2 && !seen.has(meaning.category)) {
          seen.add(meaning.category);
          add(word.endsWith("s") || ["set", "shoe", "cap", "hat", "gps"].includes(word) ? word : `${word}s`, 2);
        }
      }
    }
    if (!parsed.county && last.length >= 2) {
      for (const c of SMART_COUNTIES) if (c.toLowerCase().startsWith(last)) add(c, 1);
    }
  } else if (parsed.brands.length > 0 && !parsed.category) {
    for (const word of ["drivers", "irons", "putters", "wedges"]) add(word, 1);
  } else if (parsed.category && parsed.maxPriceCents === null) {
    add("under €100", 1);
    add("under €250", 1);
  }

  return options
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .slice(0, limit)
    .map((o) => o.text);
}

// ---------------------------------------------------------------------------
// Selling: a title in, the form filled out
// ---------------------------------------------------------------------------

/** Display spellings for models people type in lower case. */
const MODEL_SPELLINGS: Record<string, string> = {
  qi10: "Qi10", qi35: "Qi35", stealth: "Stealth", sim: "SIM", sim2: "SIM2", spider: "Spider", p790: "P790", p770: "P770",
  g430: "G430", g425: "G425", g410: "G410", g400: "G400", i230: "i230", i525: "i525", blueprint: "Blueprint",
  paradym: "Paradym", rogue: "Rogue", mavrik: "Mavrik", apex: "Apex", epic: "Epic", "ai smoke": "Ai Smoke",
  tsr2: "TSR2", tsr3: "TSR3", tsi2: "TSi2", tsi3: "TSi3", t100: "T100", t150: "T150", t200: "T200", t350: "T350",
  vokey: "Vokey", sm9: "SM9", sm10: "SM10", "pro v1": "Pro V1", "pro v1x": "Pro V1x", newport: "Newport",
  phantom: "Phantom", "special select": "Special Select", jaws: "JAWS", "jaws raw": "JAWS Raw", odyssey: "Odyssey",
  "white hot": "White Hot", "ai one": "Ai-ONE", hoofer: "Hoofer", m5: "M5", m6: "M6", jpx: "JPX", zx5: "ZX5", zx7: "ZX7",
};

export type ListingDraft = {
  title: string;
  category: SmartCategory | "";
  subcategory: string;
  brand: string;
  model: string;
  loft: string;
  shaftFlex: string;
  shaftMaterial: string;
  dexterity: string;
  /** Which of the above came from the title, to show "filled in for you". */
  filled: ("category" | "subcategory" | "brand" | "model" | "loft" | "shaftFlex" | "shaftMaterial" | "dexterity")[];
};

const titleCase = (word: string) =>
  /^[a-z]{1,3}\d/.test(word) || /^\d/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Reads a seller's rough title — "taylormade qi10 driver 10.5 stiff" — into
 * the listing form's fields, and writes a tidy title from them. Fields it
 * can't tell are left empty for the seller.
 */
export function parseListingTitle(raw: string, brands: readonly SmartBrand[]): ListingDraft {
  const vocab = vocabulary(brands);
  const tokens: string[] = [];
  for (const original of tokenize(raw.slice(0, 120))) {
    const short = SHORTHAND[original];
    if (short) tokens.push(...short.split(" "));
    else tokens.push(correct(original, vocab) ?? original);
  }

  const d: ListingDraft = { title: "", category: "", subcategory: "", brand: "", model: "", loft: "", shaftFlex: "", shaftMaterial: "", dexterity: "", filled: [] };
  const modelWords: string[] = [];
  let brandLabel = "";
  let ironRange = "";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    const pair = `${t} ${next}`;

    const loft = t.match(/^(\d{1,2}(?:\.\d)?)(?:°|deg|degree|degrees)?$/);
    if (loft && Number(loft[1]) >= 2 && Number(loft[1]) <= 64 && (t.includes(".") || /°|deg/.test(t) || ["°", "deg", "degree", "degrees", "loft"].includes(next))) {
      d.loft = `${loft[1]}°`;
      if (["°", "deg", "degree", "degrees", "loft"].includes(next)) i += 1;
      continue;
    }
    const range = t.match(/^(\d{1,2}|[3-9])-(pw|sw|gw|aw|lw|\d{1,2})$/);
    if (range) {
      ironRange = `${range[1]}–${range[2].toUpperCase()}`;
      if (!d.category) d.category = "Irons";
      if (!d.subcategory) d.subcategory = "Iron sets";
      continue;
    }

    const flex = FLEXES[pair] ?? FLEXES[t];
    if (flex) {
      d.shaftFlex = flex;
      if (FLEXES[pair]) i += 1;
      continue;
    }
    if (t === "graphite" || t === "steel") {
      d.shaftMaterial = t === "graphite" ? "Graphite" : "Steel";
      continue;
    }
    if (t === "left-handed" || (t === "left" && (next === "handed" || next === "hand"))) {
      d.dexterity = "Left-handed";
      if (t === "left") i += 1;
      continue;
    }
    if (t === "right-handed") {
      d.dexterity = "Right-handed";
      continue;
    }

    const brand = !d.brand ? brandAt(tokens, i, brands) : null;
    if (brand) {
      d.brand = brand.brand.id;
      brandLabel = brand.brand.label;
      i += brand.length - 1;
      continue;
    }

    const category = CATEGORY_PAIRS[pair] ?? CATEGORY_WORDS[t];
    if (category) {
      if (!d.category) d.category = category.category;
      if (category.subcategory && d.category === category.category && !d.subcategory) d.subcategory = category.subcategory;
      if (CATEGORY_PAIRS[pair]) i += 1;
      continue;
    }

    if (NOISE.has(t) || CONDITION_WORDS[t]) continue;
    modelWords.push(t);
  }

  if (d.dexterity === "Left-handed" && d.category && ["Drivers", "Woods & hybrids", "Irons", "Putters"].includes(d.category) && !d.subcategory) {
    d.subcategory = "Left-handed";
  }

  // Model: known spellings for pairs then singles, otherwise sensible capitals.
  const model: string[] = [];
  for (let i = 0; i < modelWords.length; i++) {
    const pair = `${modelWords[i]} ${modelWords[i + 1] ?? ""}`;
    if (MODEL_SPELLINGS[pair]) {
      model.push(MODEL_SPELLINGS[pair]);
      i += 1;
    } else {
      model.push(MODEL_SPELLINGS[modelWords[i]] ?? titleCase(modelWords[i]));
    }
  }
  d.model = model.join(" ").slice(0, 80);

  const kind =
    d.category === "Drivers" ? "driver"
    : d.category === "Irons" ? "irons"
    : d.category === "Wedges" ? (d.subcategory && d.subcategory !== "Left-handed" ? d.subcategory.toLowerCase() : "wedge")
    : d.category === "Putters" ? "putter"
    : d.category === "Woods & hybrids" ? (d.subcategory === "Hybrids" ? "hybrid" : "fairway wood")
    : d.category === "Full sets" ? "full set"
    : d.category === "Bags & trolleys" ? (d.subcategory ? d.subcategory.toLowerCase().replace(/s$/, "") : "bag")
    : "";
  const name = [brandLabel, d.model, kind].filter(Boolean).join(" ");
  const details = [ironRange, d.loft, d.shaftFlex ? d.shaftFlex.toLowerCase() : "", d.shaftMaterial ? d.shaftMaterial.toLowerCase() : "", d.dexterity === "Left-handed" ? "left-handed" : ""].filter(Boolean);
  d.title = (d.category ? `${name}${details.length ? ` — ${details.join(", ")}` : ""}` : raw.replace(/\s+/g, " ").trim()).slice(0, 100);
  if (d.title) d.title = d.title.charAt(0).toUpperCase() + d.title.slice(1);

  d.filled = (["category", "subcategory", "brand", "model", "loft", "shaftFlex", "shaftMaterial", "dexterity"] as const).filter((k) => d[k] !== "");
  return d;
}

// ---------------------------------------------------------------------------
// Price guide
// ---------------------------------------------------------------------------

/**
 * "Similar ads are priced €220–€270": the middle half of comparable asking
 * prices (in cents), rounded to €5. Null below three, where a range would be
 * one seller's opinion dressed up as a market.
 */
export function priceGuide(pricesCents: readonly number[]): { lowCents: number; highCents: number; count: number } | null {
  const sorted = pricesCents.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length < 3) return null;
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const round5 = (cents: number) => Math.max(500, Math.round(cents / 500) * 500);
  const lowCents = round5(at(0.25));
  const highCents = Math.max(lowCents, round5(at(0.75)));
  return { lowCents, highCents, count: sorted.length };
}
