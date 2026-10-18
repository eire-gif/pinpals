/**
 * Training (Menu → Play → Training, Oct 2026; claude/training.md).
 *
 * Everything the Training section says, written down once: how to play
 * fourteen awkward lies, the Putting Lab's drills, the practice plans that
 * string drills into sessions, and the pre-round warm-up. Pure data and
 * pure helpers, so it's tested (training.test.ts) and works with no signal.
 *
 * Left-handed golfers: anything that depends on which way you stand is
 * written for a right-hander with {left} / {right} in braces, and
 * `forHand()` swaps them. Never write a bare "left" or "right" that should
 * flip — the test checks every guide reads sensibly both ways.
 *
 * The advice is the standard teaching for each lie, in our own words. Have
 * a PGA professional read it before it's promoted; the guide's foot says so.
 */

export type Hand = "right" | "left";

/** Swap {left}/{right} for the golfer's side. */
export function forHand(text: string, hand: Hand): string {
  return text.replace(/\{(left|right)\}/g, (_, w: "left" | "right") => (hand === "right" ? w : w === "left" ? "right" : "left"));
}

// ---------------------------------------------------------------------------
// Lies
// ---------------------------------------------------------------------------

export type LieCategory = "slopes" | "sand" | "rough" | "weather";
export type Level = "Easy" | "Medium" | "Hard";

export type Lie = {
  id: string;
  name: string;
  category: LieCategory;
  level: Level;
  /** The list line: the one thing to remember. */
  key: string;
  /** What the lie does to the ball. */
  intro: string;
  /** The three facts at a glance. */
  club: string;
  aim: string;
  ball: string;
  /** The four keys, in order. */
  keys: { title: string; body: string }[];
  mistake: string;
  /** Three short lines for the live scoring sheet. */
  onCourse: string[];
  drill: { name: string; minutes: number; how: string };
  /** An entry in lib/rules-of-golf.ts, and what it means here. */
  rule?: { id: string; note: string };
  /** How the little picture on the guide is drawn (components/train-art.tsx). */
  art: LieArt;
};

export type LieArt = "uphill" | "downhill" | "above" | "below" | "splash" | "plugged" | "fairwayBunker" | "flier" | "thick" | "divot" | "trees" | "bare" | "into" | "down";

export const LIE_CATEGORIES: { id: LieCategory; label: string }[] = [
  { id: "slopes", label: "Slopes" },
  { id: "sand", label: "Sand" },
  { id: "rough", label: "Rough & trouble" },
  { id: "weather", label: "Wind" },
];

export const LIES: Lie[] = [
  // ——— Slopes ———
  {
    id: "uphill",
    name: "Uphill lie",
    category: "slopes",
    level: "Easy",
    key: "Shoulders with the slope · one more club",
    intro: "Your front foot is higher than your back foot. The slope adds loft, so the ball climbs higher, flies shorter and likes to turn {left}.",
    club: "+1 club",
    aim: "A little {right}",
    ball: "Just forward of centre",
    keys: [
      { title: "Match the slope", body: "Tilt your shoulders so they run with the ground. More weight settles on your lower, back foot — let it." },
      { title: "Ball slightly forward", body: "Just ahead of centre, so the club meets it as it travels up the hill." },
      { title: "Club up, aim {right}", body: "One more club for a gentle slope, two for a steep one. The ball wants to draw, so aim a few yards {right}." },
      { title: "Swing up the hill", body: "Let the club follow the slope through the ball. A ¾ swing keeps you balanced — hold your finish." },
    ],
    mistake: "Leaning into the hill. The club digs in behind the ball and you hit it heavy.",
    onCourse: ["Tilt your shoulders to match the slope.", "Take one more club — it'll fly higher and shorter.", "Aim a little {right}: it wants to go {left}."],
    drill: { name: "Bank drill", minutes: 10, how: "Find a slope at the practice ground. Hit five balls with a 7-iron using your normal set-up, then five using the four keys. Note which five finish closer." },
    rule: { id: "rule-8", note: "You can take a fair stance, but you can't flatten or build up the ground to make the slope easier." },
    art: "uphill",
  },
  {
    id: "downhill",
    name: "Downhill lie",
    category: "slopes",
    level: "Medium",
    key: "Ball back · chase it down the slope",
    intro: "Your front foot is lower than your back foot. The slope takes loft off, so the ball comes out lower, runs further and tends to go {right}.",
    club: "Same, or one less",
    aim: "A little {left}",
    ball: "Back of centre",
    keys: [
      { title: "Match the slope", body: "Tilt so your lead shoulder is lower and your shoulders run with the ground. Your weight moves onto your front foot." },
      { title: "Ball back of centre", body: "Moving it back lets you catch the ball before the ground rises up behind it." },
      { title: "Allow for the run", body: "Less loft means a lower flight and more roll. Pick a landing spot short of the target and aim a little {left}." },
      { title: "Chase it down the hill", body: "Stay down and let the club travel down the slope after the ball. Finish with your chest pointing down the hill." },
    ],
    mistake: "Hanging back to help the ball up. You catch the top of it and it scuttles along the ground.",
    onCourse: ["Weight on your front foot, shoulders with the slope.", "Ball back of centre.", "It'll come out low and run — aim a little {left}."],
    drill: { name: "Chase the slope", minutes: 10, how: "From a downslope, hit five 8-irons and hold each finish for three seconds, chest facing down the hill. If you can't hold it, shorten the swing." },
    rule: { id: "rule-8", note: "A fair stance is fine; digging in or kicking the ground flat is not." },
    art: "downhill",
  },
  {
    id: "above-feet",
    name: "Ball above your feet",
    category: "slopes",
    level: "Easy",
    key: "Grip down · aim {right}",
    intro: "The ball sits higher than your feet, so it's closer to you. Your swing gets flatter and the ball curves {left}.",
    club: "+1 club",
    aim: "{right} of the target",
    ball: "Middle",
    keys: [
      { title: "Grip down", body: "Hold the club an inch or two further down — more the steeper the slope — so you don't hit the ground first." },
      { title: "Stand a little taller", body: "Less bend from the hips. Your weight goes slightly towards your toes to stop you falling back." },
      { title: "Aim {right}", body: "The ball will curve {left}. Aim off by more the steeper the slope and the more lofted the club." },
      { title: "Smooth ¾ swing", body: "Gripping down costs distance, so take one more club and swing at three-quarter pace to stay balanced." },
    ],
    mistake: "Not gripping down, so the club hits the slope before the ball and the shot comes out heavy and {left}.",
    onCourse: ["Grip down an inch or two.", "Aim {right} — it will curve {left}.", "One more club, smooth ¾ swing."],
    drill: { name: "Grip-down ladder", minutes: 8, how: "On a side slope, hit three balls gripping at the top, three an inch down and three two inches down. Notice which strike is cleanest." },
    art: "above",
  },
  {
    id: "below-feet",
    name: "Ball below your feet",
    category: "slopes",
    level: "Medium",
    key: "Sit into it · aim {left} · stay down",
    intro: "The ball is lower than your feet and further away. Your swing gets steeper and the ball curves {right}.",
    club: "+1 club",
    aim: "{left} of the target",
    ball: "Middle",
    keys: [
      { title: "Sit into it", body: "Flex your knees more and bend a little further from the hips so you can reach the ball. Weight towards your heels." },
      { title: "Hold the end of the grip", body: "Use the full length of the club to make up the distance to the ball." },
      { title: "Aim {left}", body: "The ball will curve {right}. Aim off by more the steeper the slope." },
      { title: "Stay down through it", body: "Keep your knee flex all the way through. A ¾ swing makes that much easier." },
    ],
    mistake: "Standing up as you swing. The club rises with you and you thin it or catch it off the hosel.",
    onCourse: ["Flex your knees more and keep the flex.", "Full length of the grip.", "Aim {left} — it will curve {right}."],
    drill: { name: "Hold the flex", minutes: 8, how: "Hit five balls from below your feet with an 8-iron, keeping your knee flex until the ball has landed. Then five more at normal pace." },
    art: "below",
  },
  // ——— Sand ———
  {
    id: "greenside-bunker",
    name: "Greenside splash",
    category: "sand",
    level: "Medium",
    key: "Open face · hit the sand, not the ball",
    intro: "The ball sits up in a greenside bunker. You never touch the ball — the sand throws it out.",
    club: "Sand wedge",
    aim: "Body slightly {left}",
    ball: "Forward of centre",
    keys: [
      { title: "Open the face, then grip", body: "Turn the face open first, then take your grip, so it stays open through the shot." },
      { title: "Wide and low", body: "A wider stance with your feet wriggled into the sand lowers you, so the club slides under the ball." },
      { title: "Look at the sand, not the ball", body: "Pick a spot about 5cm (two inches) behind the ball and splash the club through it." },
      { title: "Accelerate to a full finish", body: "Most bunker shots fail because the club slows down. Swing about twice as hard as a pitch of the same length." },
    ],
    mistake: "Slowing down into the sand. The club stops, and the ball stays in the bunker.",
    onCourse: ["Open the face, then take your grip.", "Hit 5cm behind the ball.", "Keep accelerating to a full finish."],
    drill: { name: "Line drill", minutes: 10, how: "In a practice bunker, draw a line in the sand. With no ball, make ten swings that send sand flying out on the target side of the line. Then put a ball just ahead of the line." },
    rule: { id: "rule-12", note: "Don't touch the sand with your club right behind the ball, in a practice swing or on your backswing — two-stroke penalty." },
    art: "splash",
  },
  {
    id: "plugged",
    name: "Plugged · fried egg",
    category: "sand",
    level: "Hard",
    key: "Square face · steep · expect run-out",
    intro: "The ball is buried in its own crater. You have to dig it out, and it will come out low with no spin.",
    club: "Sand or pitching wedge",
    aim: "Straight at the target",
    ball: "Centre to back",
    keys: [
      { title: "Square, or a touch closed", body: "An open face bounces off the top of the sand. You need the leading edge to dig." },
      { title: "Weight forward, ball back", body: "Lean onto your front foot with the ball just back of centre." },
      { title: "Chop down hard", body: "Hinge your wrists early and drive the club down just behind the crater's edge. Don't worry about a follow-through." },
      { title: "Play for the run", body: "With no spin, it will roll. Land it short and let it run towards the pin." },
    ],
    mistake: "Using the splash technique. The open face skims over the top and the ball barely moves.",
    onCourse: ["Square face — let the edge dig.", "Weight forward, ball back.", "Chop down; it will run out."],
    drill: { name: "Fried-egg reps", minutes: 10, how: "Press five balls into a practice bunker with your foot. Play each one with a square face and a steep chop, and note where they land and stop." },
    rule: { id: "rule-12", note: "No free relief for a ball embedded in a bunker. If it's unplayable, the bunker options in Rule 19 cost at least one stroke." },
    art: "plugged",
  },
  {
    id: "fairway-bunker",
    name: "Fairway bunker",
    category: "sand",
    level: "Hard",
    key: "Ball first · grip down · check the lip",
    intro: "A long way from the green and you want distance. The opposite of a splash: hit the ball before the sand.",
    club: "Enough loft to clear the lip",
    aim: "At the target",
    ball: "Centre",
    keys: [
      { title: "Check the lip first", body: "Choose the club that clears the lip comfortably, not the one for the distance. Getting out comes first." },
      { title: "Feet in lightly, grip down", body: "Settle your feet just enough for balance, then grip down to match how far you've sunk in." },
      { title: "Quiet legs", body: "A ¾ swing, mostly with your upper body. If your legs slide, you'll hit it fat." },
      { title: "Look at the front of the ball", body: "It helps you catch the ball before the sand." },
    ],
    mistake: "Taking the club for the distance instead of the lip. The ball hits the face of the bunker and stays in.",
    onCourse: ["Pick the club that clears the lip.", "Grip down, feet in lightly.", "Ball first — look at its front edge."],
    drill: { name: "Tee in the sand", minutes: 10, how: "Push a tee into the sand just in front of the ball, level with the surface. Hit ten shots where the ball goes and the tee is clipped after it." },
    rule: { id: "rule-12", note: "Don't touch the sand in your backswing or test it with your club — two-stroke penalty." },
    art: "fairwayBunker",
  },
  // ——— Rough and trouble ———
  {
    id: "light-rough",
    name: "Light rough · flier",
    category: "rough",
    level: "Easy",
    key: "Sitting up? It'll fly further — club down",
    intro: "The ball is sitting up in light rough. Grass gets between the face and the ball, so it spins less, flies further and runs on landing.",
    club: "Same, or one less",
    aim: "At the target",
    ball: "As normal",
    keys: [
      { title: "Read the lie", body: "Sitting up means a flier. Sitting down in the grass means it comes out shorter — see Thick rough." },
      { title: "Hover the club", body: "Rest the club just behind the ball without pressing it into the grass, so the ball doesn't move." },
      { title: "Sweep it", body: "A normal, shallow swing. Don't try to hit down hard — the ball is already up." },
      { title: "Land it short", body: "With less spin it will run. Aim to land it on the front of the green." },
    ],
    mistake: "Playing your usual club and carrying the green, because it flew further than you expected.",
    onCourse: ["Sitting up = flier: same club or one less.", "Hover the club so the ball doesn't move.", "Land it short; it will run."],
    drill: { name: "Fairway v rough", minutes: 8, how: "Hit three 9-irons off the fairway and three from light rough where the ball sits up. Pace out the difference — that's your flier distance." },
    rule: { id: "rule-9", note: "If the ball moves when you set the club down, it's a one-stroke penalty and you put it back. Hovering avoids it." },
    art: "flier",
  },
  {
    id: "thick-rough",
    name: "Thick rough",
    category: "rough",
    level: "Hard",
    key: "More loft · steeper · just get it out",
    intro: "The ball is down in long grass. The grass grabs the club and twists the face, so the ball comes out lower, shorter and often {left}.",
    club: "More loft than you think",
    aim: "The safest part of the fairway",
    ball: "Middle, hands ahead",
    keys: [
      { title: "Pick the escape", body: "Choose where you can get to, not where you'd like to be. A wedge back to the fairway beats a second shot from the rough." },
      { title: "Firm grip, ball middle", body: "Hold a little firmer with your lead hand so the grass can't close the face. Hands slightly ahead." },
      { title: "Steep swing", body: "Hinge your wrists early and come down steeply so less grass gets between the club and the ball." },
      { title: "Drive through", body: "Keep the club moving after the ball. Expect it to come out low and run." },
    ],
    mistake: "Reaching for a long club. It snags in the grass, and the ball moves a few yards.",
    onCourse: ["Pick a safe target and a lofted club.", "Firm grip, hands ahead, steep swing.", "It'll come out low and run."],
    drill: { name: "Escape routes", minutes: 10, how: "Drop five balls into thick rough. Before each shot, say your target out loud, then play a wedge to it. Count how many finish on the fairway." },
    rule: { id: "rule-8", note: "You can't flatten the grass behind the ball or bend it out of the way to improve your lie." },
    art: "thick",
  },
  {
    id: "divot",
    name: "Ball in a divot",
    category: "rough",
    level: "Medium",
    key: "Ball back · hit down · expect it low",
    intro: "Your ball has finished in an old divot hole. You need to hit down to get under it, so it will come out lower and run.",
    club: "One less for the run",
    aim: "At the target",
    ball: "Back of centre",
    keys: [
      { title: "Ball back", body: "Move it back in your stance so you hit down on it." },
      { title: "Hands ahead, weight forward", body: "Lean your hands towards the target and favour your front foot." },
      { title: "Steep and short", body: "Hit down firmly and keep the follow-through short." },
      { title: "Plan for roll", body: "It will come out low with little spin. Land it short of the flag." },
    ],
    mistake: "Trying to lift it out. You catch the top of the ball and it stays in the divot.",
    onCourse: ["Ball back, hands ahead.", "Hit down, short finish.", "Expect a low ball that runs."],
    drill: { name: "Divot practice", minutes: 8, how: "At the range, place balls in old divot holes. Hit five 9-irons with the ball back and hands ahead, and watch the lower flight." },
    rule: { id: "rule-9", note: "No free relief from a divot hole under the Rules, unless your club has a local rule for repaired divots. Play it as it lies." },
    art: "divot",
  },
  {
    id: "under-trees",
    name: "Punch under trees",
    category: "rough",
    level: "Medium",
    key: "Low club · ball back · short, low finish",
    intro: "Branches are in the way, so the ball has to stay low. Your goal is to get back into play, not to reach the green.",
    club: "5- to 7-iron",
    aim: "The widest gap",
    ball: "Back of centre",
    keys: [
      { title: "Pick the gap and the landing", body: "Find the widest opening and where the ball should finish. Being in play is the win." },
      { title: "Less loft, ball back", body: "A 5- to 7-iron with the ball back in your stance keeps the flight low." },
      { title: "Hands ahead, short backswing", body: "Lean the shaft forward and take the club back to about hip height." },
      { title: "Low finish", body: "Stop with your hands no higher than your hips. That holds the ball down." },
    ],
    mistake: "Trying the hero shot through a small gap. One branch, and you're playing from the trees again.",
    onCourse: ["Choose the widest gap back into play.", "Low iron, ball back, hands ahead.", "Short backswing, finish low."],
    drill: { name: "Under the bar", minutes: 8, how: "At the range, imagine a bar at head height ten yards ahead. Hit five shots with a 6-iron that would stay under it." },
    rule: { id: "rule-8", note: "You can't break or bend branches to clear your swing. Touching them while taking your stance fairly is fine." },
    art: "trees",
  },
  {
    id: "bare-lie",
    name: "Bare or tight lie",
    category: "rough",
    level: "Medium",
    key: "Ball first · quiet wrists · brush the turf",
    intro: "Little or no grass under the ball — hardpan, a worn patch or a firm links fairway. There's no cushion, so the strike must be ball first.",
    club: "Less bounce — pitching wedge, or putt it",
    aim: "At the target",
    ball: "Middle",
    keys: [
      { title: "Consider the putter", body: "Near the green with nothing in the way, putting or a hybrid chip is often the safest shot." },
      { title: "Less bounce", body: "A sand wedge's bounce skids off hard ground. A pitching wedge sits flatter." },
      { title: "Hands slightly ahead", body: "Lean the shaft forward a touch to strike down on the back of the ball." },
      { title: "Quiet wrists", body: "Brush the turf with a steady, rocking motion of the shoulders. No flick at the bottom." },
    ],
    mistake: "Trying to scoop it into the air. The club bounces off the ground and you thin it across the green.",
    onCourse: ["Near the green? Putt it if you can.", "Pitching wedge, hands slightly ahead.", "Quiet wrists, brush the turf."],
    drill: { name: "Towel drill", minutes: 8, how: "Lay a towel 30cm behind the ball. Hit ten chips from a tight lie without touching the towel. It forces ball-first contact." },
    art: "bare",
  },
  // ——— Wind ———
  {
    id: "into-wind",
    name: "Into the wind",
    category: "weather",
    level: "Medium",
    key: "Swing easy when it's breezy · +1 or 2 clubs",
    intro: "A headwind adds spin and lifts the ball, so it balloons and falls short. Any curve gets bigger, too.",
    club: "+1 or +2 clubs",
    aim: "Allow for any crosswind",
    ball: "One ball back",
    keys: [
      { title: "Take more club", body: "One more for a breeze, two or three for a strong wind." },
      { title: "Ball back a touch", body: "One ball-width further back than normal lowers the flight." },
      { title: "Swing easy", body: "A smoother, ¾ swing puts less spin on the ball, so it bores through the wind." },
      { title: "Finish low", body: "Hold a shorter, lower finish. A big finish sends the ball higher into the wind." },
    ],
    mistake: "Swinging harder. More speed means more spin, and the ball climbs and drops short.",
    onCourse: ["One or two more clubs.", "Ball back a touch.", "Swing easy, finish low."],
    drill: { name: "Three-quarter shots", minutes: 10, how: "Hit five 7-irons at full pace, then five 6-irons at ¾ pace with a low finish. Compare the heights — on a windy day, the second set wins." },
    art: "into",
  },
  {
    id: "downwind",
    name: "Downwind",
    category: "weather",
    level: "Easy",
    key: "One less club · land it short",
    intro: "A following wind takes spin off the ball. It flies further, comes down flatter and won't stop as quickly.",
    club: "One less club",
    aim: "Short of the flag",
    ball: "As normal",
    keys: [
      { title: "Take less club", body: "One less for a breeze, more in a strong wind." },
      { title: "Let it fly high", body: "A higher shot rides the wind further. With a driver, tee it a little higher." },
      { title: "Land it short", body: "With less spin it will release. Pick a landing spot short of where you want to finish." },
      { title: "Smooth tempo", body: "Your normal swing. The wind does the extra work." },
    ],
    mistake: "Flying the ball at the flag. It lands, releases and finishes over the back.",
    onCourse: ["One less club.", "Land it short of the flag.", "It won't stop quickly."],
    drill: { name: "Landing spots", minutes: 8, how: "On a calm day at the range, pick a landing spot and a finish spot for each shot. On a windy day, repeat and see how much further the ball releases." },
    art: "down",
  },
];

export const lieById = (id: string): Lie | undefined => LIES.find((l) => l.id === id);
export const liesIn = (c: LieCategory): Lie[] => LIES.filter((l) => l.category === c);

/** Search lies by name, key or what golfers type ("ball above my feet", "wet sand"). */
export function searchLies(query: string): Lie[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length === 0) return [];
  const scored = LIES.map((l) => {
    const hay = `${l.name} ${l.key} ${l.intro} ${l.category} ${SYNONYMS[l.id] ?? ""}`.toLowerCase();
    const hits = words.filter((w) => hay.includes(w)).length;
    return { l, hits, name: words.filter((w) => l.name.toLowerCase().includes(w)).length };
  }).filter((s) => s.hits > 0);
  scored.sort((a, b) => b.hits - a.hits || b.name - a.name);
  return scored.map((s) => s.l);
}

const STOP = new Set(["the", "my", "ball", "is", "on", "in", "a", "an", "of", "it", "to", "from", "with", "and", "or"]);
const SYNONYMS: Record<string, string> = {
  uphill: "upslope up slope hill front foot higher",
  downhill: "downslope down slope front foot lower",
  "above-feet": "sidehill side slope above my feet higher than feet hook",
  "below-feet": "sidehill side slope below my feet lower than feet slice",
  "greenside-bunker": "trap sand bunker splash greenside soft sand wet sand",
  plugged: "buried plugged embedded fried egg sand trap",
  "fairway-bunker": "trap sand long bunker distance",
  "light-rough": "first cut semi rough flyer flier",
  "thick-rough": "long grass heavy rough deep rough hay fescue",
  divot: "divot hole sand filled",
  "under-trees": "trees branches punch knockdown stinger low",
  "bare-lie": "hardpan bare tight links firm worn path",
  "into-wind": "headwind wind breezy knockdown",
  downwind: "tailwind following wind",
};

// ---------------------------------------------------------------------------
// Putting Lab
// ---------------------------------------------------------------------------

export type DrillFocus = "speed" | "line" | "short" | "game";

/**
 * How a drill is scored on the phone:
 *   streak  — hole them in order; a miss sends you back to the start.
 *             Done when `target` are holed in a row. Best = fewest putts.
 *   outOf   — `target` attempts, count the good ones. Best = most good.
 *   strokes — `target` holes, tap the putts on each. Best = fewest putts.
 */
export type DrillScoring =
  | { kind: "streak"; target: number; unit: string }
  | { kind: "outOf"; target: number; good: string }
  | { kind: "strokes"; target: number; par: number };

export type Drill = {
  id: string;
  name: string;
  focus: DrillFocus;
  /** Works on a carpet at home. */
  home: boolean;
  minutes: number;
  blurb: string;
  setup: string;
  steps: string[];
  tip: string;
  scoring: DrillScoring;
};

export const DRILL_FOCUS: { id: DrillFocus; label: string }[] = [
  { id: "speed", label: "Speed" },
  { id: "line", label: "Start line" },
  { id: "short", label: "Short putts" },
  { id: "game", label: "Games" },
];

export const DRILLS: Drill[] = [
  {
    id: "ladder-lag",
    name: "Ladder lag",
    focus: "speed",
    home: false,
    minutes: 12,
    blurb: "10 · 20 · 30 · 40ft — finish inside a putter-length",
    setup: "Lay a putter on the green behind a hole as a backstop. Put tees at 10, 20, 30 and 40 feet away.",
    steps: [
      "Putt from each tee in turn, shortest first, then back down the ladder.",
      "A good putt finishes within a putter-length of the hole and doesn't touch the putter behind it.",
      "Before each putt, make two practice strokes looking at the hole, not the ball.",
    ],
    tip: "Most three-putts start with a first putt left well short or run well past. This drill trains the length, not the line.",
    scoring: { kind: "outOf", target: 10, good: "inside a putter-length" },
  },
  {
    id: "fringe",
    name: "Fringe drill",
    focus: "speed",
    home: false,
    minutes: 8,
    blurb: "Stop it on the far fringe, not past",
    setup: "Stand 25–40 feet from the far edge of the practice green, with no hole in between.",
    steps: [
      "Putt so the ball stops on the fringe — touching it, not past it.",
      "Change distance after every putt so you can't groove one stroke.",
      "Count how many finish on the fringe from ten.",
    ],
    tip: "With no hole to look at, you only think about pace. It's the quickest way to learn a new green's speed.",
    scoring: { kind: "outOf", target: 10, good: "on the fringe" },
  },
  {
    id: "eyes-closed",
    name: "Eyes-closed lag",
    focus: "speed",
    home: false,
    minutes: 8,
    blurb: "Feel the length, then guess before you look",
    setup: "Pick a hole 20–35 feet away.",
    steps: [
      "Set up, look at the hole, then close your eyes and putt.",
      "Before opening them, say \"short\", \"long\" or \"good\".",
      "Count how many guesses were right from ten.",
    ],
    tip: "It connects what the stroke feels like with how far the ball goes — the feel you need on a new course.",
    scoring: { kind: "outOf", target: 10, good: "guessed right" },
  },
  {
    id: "uphill-downhill",
    name: "Uphill, downhill",
    focus: "speed",
    home: false,
    minutes: 10,
    blurb: "The same 20ft, both ways up a slope",
    setup: "Find a slope on the practice green. Place two tees 20 feet apart up and down it.",
    steps: [
      "Putt uphill to the top tee, then downhill to the bottom one.",
      "A good putt stops within a putter-length of the tee.",
      "Notice how much shorter the downhill stroke has to be.",
    ],
    tip: "Uphill putts are nearly always left short and downhill ones run past. Learn the difference before your round.",
    scoring: { kind: "outOf", target: 10, good: "within a putter-length" },
  },
  {
    id: "gate",
    name: "Gate drill",
    focus: "line",
    home: true,
    minutes: 8,
    blurb: "Two tees just wider than the ball, 30cm ahead",
    setup: "From 4 feet, push two tees into the green 30cm in front of the ball, just wider than a ball apart.",
    steps: [
      "Putt through the gate without touching either tee.",
      "Twenty balls. Count the clean ones.",
      "At home, use two pens on the carpet and a glass as the hole.",
    ],
    tip: "If the ball starts on line, most short putts go in. The gate shows you straight away if the face is open or closed.",
    scoring: { kind: "outOf", target: 20, good: "clean through the gate" },
  },
  {
    id: "coin-line",
    name: "Coin line",
    focus: "line",
    home: true,
    minutes: 8,
    blurb: "Roll the ball over a coin on your line",
    setup: "On a straight 8-foot putt, place a coin on your line about 30cm in front of the ball.",
    steps: [
      "Aim at the coin, not the hole, and roll the ball over it.",
      "Ten balls. Count the ones that cross the coin.",
      "On a breaking putt, put the coin on the start line you've read.",
    ],
    tip: "Good putters aim at a spot close to the ball. A near target is easier to hit than a hole eight feet away.",
    scoring: { kind: "outOf", target: 10, good: "over the coin" },
  },
  {
    id: "hallway",
    name: "Hallway line",
    focus: "line",
    home: true,
    minutes: 10,
    blurb: "Putt along a carpet seam or a strip of tape to a mug",
    setup: "Find a straight line on the floor — a seam, a board edge or a strip of tape — about 8 feet long. A mug on its side is the hole.",
    steps: [
      "Putt along the line so the ball stays on it the whole way.",
      "Ten balls. Count the ones that reach the mug on the line.",
      "Finish each session with three that you must hole.",
    ],
    tip: "Ten minutes in the evening keeps your stroke going through the winter.",
    scoring: { kind: "outOf", target: 10, good: "on the line to the mug" },
  },
  {
    id: "clock",
    name: "Clock drill",
    focus: "short",
    home: false,
    minutes: 10,
    blurb: "8 balls round the hole at 3ft — miss one, start again",
    setup: "Place eight balls in a circle 3 feet from the hole, like the hours on a clock.",
    steps: [
      "Hole them in order, starting at 12 o'clock.",
      "Miss one and you go back to 12.",
      "When you can do it at 3 feet, try 4, then 6.",
    ],
    tip: "Go through your full routine on every ball. The restart is there to make the seventh and eighth putts feel like they matter.",
    scoring: { kind: "streak", target: 8, unit: "in a row" },
  },
  {
    id: "three-six-nine",
    name: "3-6-9",
    focus: "short",
    home: false,
    minutes: 10,
    blurb: "Three putts each from 3, 6 and 9 feet",
    setup: "Put tees at 3, 6 and 9 feet from a hole on a gentle slope.",
    steps: [
      "Three putts from each tee, shortest first.",
      "Count how many you hole from nine.",
      "Beat 6 and you're holing more than most single-figure golfers.",
    ],
    tip: "These are the putts that decide a score. Practise them under a bit of pressure, not as a warm-up.",
    scoring: { kind: "outOf", target: 9, good: "holed" },
  },
  {
    id: "mug",
    name: "Mug pressure",
    focus: "short",
    home: true,
    minutes: 6,
    blurb: "Ten in a row into a mug from 4 feet",
    setup: "Lay a mug on its side on the carpet. Mark a spot 4 feet away.",
    steps: [
      "Hole ten in a row. Miss, and you start again.",
      "Full routine on every putt.",
      "When it's easy, step back to 5 feet.",
    ],
    tip: "The cup is smaller than a hole, so the real thing looks bigger when you're on the course.",
    scoring: { kind: "streak", target: 10, unit: "in a row" },
  },
  {
    id: "par-18",
    name: "Par 18",
    focus: "game",
    home: false,
    minutes: 15,
    blurb: "9 holes on the putting green, par 2 each",
    setup: "Pick nine holes on the practice green, from 10 to 40 feet, with different slopes.",
    steps: [
      "Play each hole like a real one: hole out every time.",
      "Par is 2 a hole, so 18 for the nine.",
      "Tap your putts for each hole. Under 18 is a great score.",
    ],
    tip: "It mixes long and short putts the way a round does, and every three-putt costs you.",
    scoring: { kind: "strokes", target: 9, par: 2 },
  },
  {
    id: "around-the-world",
    name: "Around the world",
    focus: "game",
    home: false,
    minutes: 12,
    blurb: "Four sides of the hole, 3 to 6 feet",
    setup: "Place tees at 3, 4, 5 and 6 feet on four sides of a hole — uphill, downhill and both side slopes.",
    steps: [
      "Hole all four from 3 feet, then move out to 4, and so on.",
      "Miss one and that distance starts again.",
      "Sixteen in a row to finish.",
    ],
    tip: "You see every break from short range, which is exactly what you face after a decent lag.",
    scoring: { kind: "streak", target: 16, unit: "holed" },
  },
];

export const drillById = (id: string): Drill | undefined => DRILLS.find((d) => d.id === id);

/** Is a new score better than the best kept so far? */
export function isBetter(scoring: DrillScoring, score: number, best: number | null): boolean {
  if (best == null) return true;
  return scoring.kind === "outOf" ? score > best : score < best;
}

/** How a score reads: "7/10 inside a putter-length", "19 putts", "16 putts (−2)". */
export function scoreLabel(scoring: DrillScoring, score: number): string {
  if (scoring.kind === "outOf") return `${score}/${scoring.target} ${scoring.good}`;
  if (scoring.kind === "streak") return `${score} putts`;
  const par = scoring.target * scoring.par;
  const diff = score - par;
  return `${score} putts (${diff === 0 ? "level" : diff > 0 ? `+${diff}` : `−${-diff}`})`;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type PlanItem = { drill: string; minutes: number } | { lie: string; minutes: number } | { task: string; minutes: number; detail: string };

export type PlanSession = { title: string; items: PlanItem[] };

export type PlanWeek = { theme: string; target: string; sessions: PlanSession[] };

export type Plan = {
  id: string;
  name: string;
  blurb: string;
  goal: string;
  /** Shown on the card: "4 weeks · 3 × 25 min". */
  shape: string;
  home: boolean;
  weeks: PlanWeek[];
};

export const PLANS: Plan[] = [
  {
    id: "kill-3-putt",
    name: "Kill the 3-putt",
    blurb: "Start line, then speed, then pressure, then the course",
    goal: "Fewer than one three-putt a round",
    shape: "4 weeks · 3 × 25 min a week",
    home: false,
    weeks: [
      {
        theme: "Start line",
        target: "15 of 20 through the gate",
        sessions: [
          { title: "Find your line", items: [{ drill: "gate", minutes: 10 }, { drill: "coin-line", minutes: 10 }, { drill: "clock", minutes: 5 }] },
          { title: "Line at home", items: [{ drill: "hallway", minutes: 15 }, { drill: "mug", minutes: 10 }] },
          { title: "Line under pressure", items: [{ drill: "gate", minutes: 10 }, { drill: "three-six-nine", minutes: 10 }, { drill: "clock", minutes: 5 }] },
        ],
      },
      {
        theme: "Speed",
        target: "6 of 10 from the ladder inside a putter-length",
        sessions: [
          { title: "Learn the length", items: [{ drill: "ladder-lag", minutes: 12 }, { drill: "fringe", minutes: 8 }, { drill: "gate", minutes: 5 }] },
          { title: "Feel it", items: [{ drill: "eyes-closed", minutes: 10 }, { drill: "uphill-downhill", minutes: 10 }, { drill: "clock", minutes: 5 }] },
          { title: "Speed test", items: [{ drill: "gate", minutes: 5 }, { drill: "ladder-lag", minutes: 10 }, { drill: "par-18", minutes: 10 }] },
        ],
      },
      {
        theme: "Pressure",
        target: "Clock drill done at 4 feet",
        sessions: [
          { title: "Short ones count", items: [{ drill: "clock", minutes: 10 }, { drill: "three-six-nine", minutes: 10 }, { drill: "fringe", minutes: 5 }] },
          { title: "Around the hole", items: [{ drill: "around-the-world", minutes: 12 }, { drill: "ladder-lag", minutes: 8 }, { drill: "mug", minutes: 5 }] },
          { title: "Beat your Par 18", items: [{ drill: "ladder-lag", minutes: 8 }, { drill: "par-18", minutes: 12 }, { drill: "clock", minutes: 5 }] },
        ],
      },
      {
        theme: "On the course",
        target: "Fewer than one three-putt a round",
        sessions: [
          {
            title: "Warm up like it counts",
            items: [
              { drill: "fringe", minutes: 5 },
              { task: "Play nine holes and tap your putts", minutes: 0, detail: "Turn on Track my stats and tap your putts and first-putt distance on every hole. It shows where the three-putts start." },
            ],
          },
          { title: "Fix what the card showed", items: [{ drill: "ladder-lag", minutes: 10 }, { drill: "three-six-nine", minutes: 10 }, { drill: "clock", minutes: 5 }] },
          {
            title: "The test round",
            items: [
              { drill: "uphill-downhill", minutes: 5 },
              { task: "Play a full round", minutes: 0, detail: "Same routine on every putt, and count your three-putts. Under one is the target." },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "bunker-confidence",
    name: "Bunker confidence",
    blurb: "Splash, fried egg and fairway sand",
    goal: "Out first time, every time",
    shape: "2 weeks · 3 × 20 min a week",
    home: false,
    weeks: [
      {
        theme: "The splash",
        target: "8 of 10 out and on the green",
        sessions: [
          { title: "Hit the line", items: [{ lie: "greenside-bunker", minutes: 20 }] },
          { title: "Short and long", items: [{ lie: "greenside-bunker", minutes: 15 }, { task: "Vary the length", minutes: 5, detail: "Same swing, different finish: half finish for short, full finish for long." }] },
          { title: "Bad lies", items: [{ lie: "plugged", minutes: 15 }, { lie: "greenside-bunker", minutes: 5 }] },
        ],
      },
      {
        theme: "Every bunker",
        target: "Out first time from every lie",
        sessions: [
          { title: "Fairway sand", items: [{ lie: "fairway-bunker", minutes: 20 }] },
          { title: "Mixed bag", items: [{ lie: "greenside-bunker", minutes: 7 }, { lie: "plugged", minutes: 7 }, { lie: "fairway-bunker", minutes: 6 }] },
          { title: "One ball each", items: [{ task: "One ball, every lie", minutes: 20, detail: "Throw one ball into a different part of the bunker each time and play it as it lies. Out first time is the only score." }] },
        ],
      },
    ],
  },
  {
    id: "winter-indoors",
    name: "Winter indoors",
    blurb: "Carpet putting to keep your stroke over the winter",
    goal: "Ten in a row into the mug from 5 feet",
    shape: "6 weeks · 2 × 15 min a week",
    home: true,
    weeks: [1, 2, 3, 4, 5, 6].map((w) => ({
      theme: w <= 2 ? "Start line" : w <= 4 ? "Short putts" : "Pressure",
      target: w <= 2 ? "8 of 10 along the hallway line" : w <= 4 ? "10 in a row into the mug" : "10 in a row from 5 feet",
      sessions: [
        { title: `Week ${w} · A`, items: w <= 2 ? [{ drill: "hallway", minutes: 10 }, { drill: "gate", minutes: 5 }] : [{ drill: "mug", minutes: 10 }, { drill: "coin-line", minutes: 5 }] },
        { title: `Week ${w} · B`, items: w <= 4 ? [{ drill: "gate", minutes: 5 }, { drill: "mug", minutes: 10 }] : [{ drill: "hallway", minutes: 5 }, { drill: "mug", minutes: 10 }] },
      ],
    })),
  },
];

export const planById = (id: string): Plan | undefined => PLANS.find((p) => p.id === id);

/** Every session in order, numbered from 0. */
export function planSessions(plan: Plan): { index: number; week: number; session: PlanSession }[] {
  const out: { index: number; week: number; session: PlanSession }[] = [];
  plan.weeks.forEach((w, wi) => w.sessions.forEach((s) => out.push({ index: out.length, week: wi, session: s })));
  return out;
}

export const sessionMinutes = (s: PlanSession) => s.items.reduce((n, i) => n + i.minutes, 0);

/** The first session not yet done, or null when the plan is finished. */
export function nextSession(plan: Plan, done: ReadonlySet<number>): number | null {
  const all = planSessions(plan);
  const next = all.find((s) => !done.has(s.index));
  return next ? next.index : null;
}

// ---------------------------------------------------------------------------
// Warm-up before a round
// ---------------------------------------------------------------------------

export type WarmUpLength = "carPark" | "standard" | "full";

export const WARM_UPS: Record<WarmUpLength, { label: string; minutes: number; steps: { title: string; minutes: number; body: string }[] }> = {
  carPark: {
    label: "Car park",
    minutes: 5,
    steps: [
      { title: "Loosen up", minutes: 3, body: "Ten hip circles each way, ten turns with a club across your shoulders, then slow swings holding two clubs." },
      { title: "Practice green", minutes: 2, body: "Three long putts to feel the pace, then three from 3 feet so the last thing you see is the ball dropping." },
    ],
  },
  standard: {
    label: "Standard",
    minutes: 20,
    steps: [
      { title: "Loosen up", minutes: 3, body: "Hip circles, ten trunk turns with a club across your shoulders, slow swings with two clubs." },
      { title: "Putting green — speed first", minutes: 6, body: "Three 30-foot putts uphill and three downhill to learn today's pace. Then six from 3 feet." },
      { title: "Chipping", minutes: 3, body: "Five chips to a spot on the fringe, and two out of the practice bunker if there is one." },
      { title: "Range", minutes: 8, body: "Wedge, 7-iron, hybrid, driver. Finish with three balls using the club you'll hit off the first tee, with your full routine." },
    ],
  },
  full: {
    label: "Full",
    minutes: 40,
    steps: [
      { title: "Loosen up", minutes: 5, body: "Hip circles, trunk turns, arm swings and slow two-club swings until you feel warm." },
      { title: "Range — build up", minutes: 15, body: "Ten wedges at half pace, then ten 7-irons, five hybrids or woods, and five drivers." },
      { title: "Range — play the first holes", minutes: 5, body: "Hit the tee shot and approach for the first three holes, with your routine on every ball." },
      { title: "Chipping and bunker", minutes: 7, body: "Chips to two different targets, and five splash shots." },
      { title: "Putting green", minutes: 8, body: "The fringe drill to learn the pace, then the clock drill at 3 feet. Finish on a holed putt." },
    ],
  },
};

/** The putting routine shown under the warm-up and on the Putting Lab. */
export const PUTTING_ROUTINE = [
  "Read the putt from the low side, behind the hole.",
  "Pick a spot a foot in front of the ball on your line.",
  "Two practice strokes looking at the hole, feeling the length.",
  "Set up, one look, go. Under ten seconds.",
];

/** Windy-day line under the warm-up's range block. */
export const WINDY_EXTRA = "Breezy today? Add three low 7-irons with the ball back and a short finish.";
