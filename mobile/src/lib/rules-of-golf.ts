/**
 * Rules of Golf lookup — PinPals' own plain-English summaries, each pointing
 * at the official wording on randa.org.
 *
 * WHY SUMMARIES AND NOT THE RULES THEMSELVES. The text of the Rules of Golf
 * is copyright The R&A and the USGA. We do not have a licence to republish
 * it, so nothing in this file is copied from it: the rule numbers and titles
 * are how golfers name the Rules, and every summary is written by us. Each
 * entry links to the R&A's own page for that Rule, which is the authority —
 * it also carries the quarterly Clarifications, so members always land on
 * current wording without this file having to chase it. If a licence is ever
 * granted, the official text can be added per entry without changing the
 * screens.
 *
 * KEEPING IT CURRENT. Edition: the 2023 Rules of Golf. The next edition takes
 * effect on 1 January 2028 — re-check every summary against it then, and bump
 * RULES_EDITION. Model Local Rules (e.g. the lost-ball alternative) are only
 * in force where a club or committee adopts them, and the summaries say so.
 *
 * Pure, no imports. Byte-identical in mobile/src/lib/rules-of-golf.ts — the
 * test in src/lib/rules-of-golf.test.ts fails if the two drift apart.
 */

export const RULES_EDITION = {
  name: "2023 Rules of Golf",
  nextEdition: "1 January 2028",
  checked: "2026-10-13",
};

export const RA_RULES_HOME = "https://www.randa.org/rog/the-rules-of-golf";
export const RA_DEFINITIONS = "https://www.randa.org/rog/definitions";
/** Where the R&A lists its Rules App, Clarifications and other resources. */
export const RA_RULES_HUB = "https://www.randa.org/rules/rules-hub";

export type RuleEntry = {
  /** Stable id, used in links (#rule-18, #lost-ball). */
  id: string;
  /** "rule" is one of the 25 Rules or the Definitions; "topic" is a common
   *  situation within a Rule that golfers search for by name. */
  kind: "rule" | "topic";
  /** The Rule it sits in: 1–25, or 0 for the Definitions. */
  rule: number;
  /** Display reference: "Rule 18", "18.3", "Definitions", "Local Rule E-5". */
  ref: string;
  title: string;
  /** Our words. A sentence or three. */
  summary: string;
  /** Short practical points, also our words. */
  points?: string[];
  /** Extra words golfers actually type: slang, old names, synonyms. */
  keywords: string[];
};

/** The official R&A page for an entry's Rule. */
export function officialUrl(entry: Pick<RuleEntry, "rule">): string {
  return entry.rule === 0 ? RA_DEFINITIONS : `${RA_RULES_HOME}/rule-${entry.rule}`;
}

export const RULES: RuleEntry[] = [
  // ——— The 25 Rules ———
  {
    id: "rule-1",
    kind: "rule",
    rule: 1,
    ref: "Rule 1",
    title: "The Game, Player Conduct and the Rules",
    summary:
      "Golf is played over the course as you find it, with the ball as it lies. You are expected to play in the spirit of the game: act with integrity, show consideration for others and look after the course. Players apply the Rules to themselves, including calling their own penalties.",
    points: [
      "Serious misconduct can lead to disqualification.",
      "A committee may set its own code of conduct with its own penalties.",
    ],
    keywords: ["spirit of the game", "etiquette", "conduct", "integrity", "behaviour", "honesty", "disqualified"],
  },
  {
    id: "rule-2",
    kind: "rule",
    rule: 2,
    ref: "Rule 2",
    title: "The Course",
    summary:
      "The course is split into five defined areas: the general area, the teeing area of the hole you're playing, bunkers, penalty areas and the putting green of the hole you're playing. Which area your ball is in decides which Rules apply. Out of bounds is everything beyond the course boundary.",
    keywords: ["areas of the course", "general area", "fairway", "rough", "boundary", "white stakes", "out of bounds", "integral object"],
  },
  {
    id: "rule-3",
    kind: "rule",
    rule: 3,
    ref: "Rule 3",
    title: "The Competition",
    summary:
      "Covers the two main forms of play — match play (hole by hole) and stroke play (total strokes) — and how handicaps are applied in each. In stroke play you must return a scorecard with correct hole scores, certified by you and your marker.",
    keywords: ["match play", "stroke play", "medal", "handicap", "net score", "gross score", "competition", "marker", "scorecard"],
  },
  {
    id: "rule-4",
    kind: "rule",
    rule: 4,
    ref: "Rule 4",
    title: "The Player's Equipment",
    summary:
      "Your clubs and balls must conform to the equipment rules, you may carry no more than 14 clubs, and there are limits on devices and aids you can use during a round, such as gadgets that measure slope or wind.",
    keywords: ["clubs", "equipment", "14 clubs", "golf ball", "conforming", "rangefinder", "gps", "device", "glove", "aids"],
  },
  {
    id: "rule-5",
    kind: "rule",
    rule: 5,
    ref: "Rule 5",
    title: "Playing the Round",
    summary:
      "When a round starts and finishes, starting on time, practising before and during a round, keeping a prompt pace, and when play stops and restarts — including stopping for lightning.",
    keywords: ["start time", "tee time", "late", "practice", "pace of play", "slow play", "suspension", "lightning", "weather", "round"],
  },
  {
    id: "rule-6",
    kind: "rule",
    rule: 6,
    ref: "Rule 6",
    title: "Playing a Hole",
    summary:
      "Start each hole from inside the teeing area, play the same ball until it's holed unless a Rule lets you change it, and play in the right order. Playing someone else's ball by mistake is a wrong ball.",
    keywords: ["tee box", "teeing ground", "honour", "order of play", "wrong ball", "substitute ball", "holing out", "ready golf"],
  },
  {
    id: "rule-7",
    kind: "rule",
    rule: 7,
    ref: "Rule 7",
    title: "Ball Search: Finding and Identifying Ball",
    summary:
      "You may search for your ball reasonably, including moving grass and bushes enough to find and identify it, and you may lift it to identify it after marking its spot. Accidentally moving it while searching is no penalty — put it back.",
    keywords: ["searching", "looking for ball", "identify", "identification", "ball moved while searching", "find ball"],
  },
  {
    id: "rule-8",
    kind: "rule",
    rule: 8,
    ref: "Rule 8",
    title: "Course Played as It Is Found",
    summary:
      "You must not improve the conditions affecting your stroke — your lie, stance, swing area or line of play — by moving, bending or breaking things, pressing things down or removing them, outside what the Rules allow. Taking a fair stance and grounding the club lightly are fine.",
    keywords: ["improving lie", "improving line", "breaking branches", "stance", "swing", "pressing down", "building stance"],
  },
  {
    id: "rule-9",
    kind: "rule",
    rule: 9,
    ref: "Rule 9",
    title: "Ball Played as It Lies; Ball at Rest Lifted or Moved",
    summary:
      "Play the ball where it lies. Who or what moved a ball at rest decides what happens next: you, your opponent, an outside influence, or natural forces like wind.",
    keywords: ["play it as it lies", "ball moved", "ball at rest", "wind moved ball", "outside influence", "replace ball"],
  },
  {
    id: "rule-10",
    kind: "rule",
    rule: 10,
    ref: "Rule 10",
    title: "Preparing for and Making a Stroke; Advice and Help; Caddies",
    summary:
      "How a stroke must be made (no anchoring the club), who you can take advice from, and what your caddie may and may not do for you.",
    keywords: ["advice", "caddie", "anchoring", "long putter", "double hit", "alignment", "which club", "help"],
  },
  {
    id: "rule-11",
    kind: "rule",
    rule: 11,
    ref: "Rule 11",
    title: "Ball in Motion Accidentally Hits Person, Animal or Object; Deliberate Actions to Affect Ball in Motion",
    summary:
      "If your moving ball accidentally hits a person, animal, equipment or anything else, there's usually no penalty and you play it as it lies. Deliberately stopping or deflecting a moving ball is not allowed.",
    keywords: ["ball hit someone", "ball hit player", "ball hit bag", "deflected", "ball hit tree", "ball hit animal", "hit another ball"],
  },
  {
    id: "rule-12",
    kind: "rule",
    rule: 12,
    ref: "Rule 12",
    title: "Bunkers",
    summary:
      "You may remove loose impediments and movable obstructions in a bunker, but you must not touch the sand with your hand or club to test it, or touch it right in front of or behind the ball, in a practice swing or on your backswing.",
    points: ["Breaching the sand restrictions is the general penalty (two strokes, or loss of hole in match play)."],
    keywords: ["sand", "trap", "sand trap", "grounding club", "rake", "practice swing in bunker", "stones in bunker"],
  },
  {
    id: "rule-13",
    kind: "rule",
    rule: 13,
    ref: "Rule 13",
    title: "Putting Greens",
    summary:
      "On the green you can mark, lift and clean your ball, repair almost any damage (ball marks, shoe damage, old hole plugs), and remove sand and loose soil. You can putt with the flagstick in or out.",
    keywords: ["green", "putting", "flagstick", "pin", "flag", "pitch mark", "ball mark", "spike marks", "repair green", "mark ball"],
  },
  {
    id: "rule-14",
    kind: "rule",
    rule: 14,
    ref: "Rule 14",
    title: "Procedures for Ball: Marking, Lifting and Cleaning; Replacing on Spot; Dropping in Relief Area; Playing from Wrong Place",
    summary:
      "The how-to Rule behind taking relief: marking a spot before lifting, cleaning the ball, replacing it on its spot, dropping correctly in a relief area, and what happens if you play from the wrong place.",
    keywords: ["drop", "dropping", "knee height", "relief area", "mark", "lift", "clean", "replace", "wrong place", "club-length"],
  },
  {
    id: "rule-15",
    kind: "rule",
    rule: 15,
    ref: "Rule 15",
    title: "Relief from Loose Impediments and Movable Obstructions (Including Ball or Ball-Marker Helping or Interfering with Play)",
    summary:
      "Natural loose things (leaves, stones, twigs) and movable artificial things (rakes, bottles, stakes that come out) can be moved without penalty. You can also ask for another ball or ball-marker to be lifted if it gets in your way.",
    keywords: ["loose impediments", "leaves", "twigs", "stones", "movable obstruction", "rake", "can", "bottle", "ball marker in the way"],
  },
  {
    id: "rule-16",
    kind: "rule",
    rule: 16,
    ref: "Rule 16",
    title: "Relief from Abnormal Course Conditions (Including Immovable Obstructions), Dangerous Animal Condition, Embedded Ball",
    summary:
      "Free relief from animal holes, ground under repair, immovable obstructions (cart paths, sprinkler heads) and temporary water, from dangerous animals like a wasps' nest, and for a ball embedded in its own pitch-mark in the general area.",
    keywords: ["free drop", "free relief", "cart path", "path", "sprinkler", "ground under repair", "gur", "casual water", "puddle", "rabbit hole", "embedded", "plugged"],
  },
  {
    id: "rule-17",
    kind: "rule",
    rule: 17,
    ref: "Rule 17",
    title: "Penalty Areas",
    summary:
      "Penalty areas (marked red or yellow) are usually water. You can play the ball as it lies there with no penalty, or take relief outside for one penalty stroke — with an extra lateral option when the area is red.",
    keywords: ["water", "water hazard", "lateral hazard", "hazard", "pond", "lake", "stream", "ditch", "red stakes", "yellow stakes", "penalty area"],
  },
  {
    id: "rule-18",
    kind: "rule",
    rule: 18,
    ref: "Rule 18",
    title: "Stroke-and-Distance Relief, Ball Lost or Out of Bounds, Provisional Ball",
    summary:
      "If your ball is lost or out of bounds, you take stroke-and-distance: one penalty stroke and play again from where you last played. To save time, you can play a provisional ball before going forward to search.",
    keywords: ["lost ball", "out of bounds", "ob", "o.b.", "stroke and distance", "provisional", "reload", "white stakes", "3 minutes"],
  },
  {
    id: "rule-19",
    kind: "rule",
    rule: 19,
    ref: "Rule 19",
    title: "Unplayable Ball",
    summary:
      "You can declare your ball unplayable anywhere except in a penalty area, and take relief for one penalty stroke using one of three options. In a bunker there's an extra option to drop outside it for two penalty strokes.",
    keywords: ["unplayable", "unplayable lie", "bad lie", "in a bush", "in a tree", "gorse", "whins", "two club-lengths"],
  },
  {
    id: "rule-20",
    kind: "rule",
    rule: 20,
    ref: "Rule 20",
    title: "Resolving Rules Issues During Round; Rulings by Referee and Committee",
    summary:
      "What to do when you're unsure of the Rules mid-round. In match play you raise it with your opponent in time; in stroke play you can play a second ball and let the committee decide before you hand in your card.",
    keywords: ["ruling", "dispute", "not sure", "two balls", "second ball", "referee", "committee", "doubt"],
  },
  {
    id: "rule-21",
    kind: "rule",
    rule: 21,
    ref: "Rule 21",
    title: "Other Forms of Individual Stroke Play and Match Play",
    summary:
      "The variations most club and society golf is played in: Stableford, maximum score, par/bogey competitions, and three-ball match play.",
    keywords: ["stableford", "points", "maximum score", "max score", "par competition", "bogey competition", "three-ball", "society format"],
  },
  {
    id: "rule-22",
    kind: "rule",
    rule: 22,
    ref: "Rule 22",
    title: "Foursomes (Also Known as Alternate Shot)",
    summary:
      "Two partners play one ball, taking turns to play strokes and alternating who tees off on each hole. Penalty strokes don't change whose turn it is.",
    keywords: ["foursomes", "alternate shot", "scotch foursomes", "greensomes", "pairs"],
  },
  {
    id: "rule-23",
    kind: "rule",
    rule: 23,
    ref: "Rule 23",
    title: "Four-Ball",
    summary:
      "Two partners each play their own ball, and the better score of the two counts as the side's score on each hole.",
    keywords: ["four-ball", "fourball", "better ball", "best ball", "betterball", "pairs"],
  },
  {
    id: "rule-24",
    kind: "rule",
    rule: 24,
    ref: "Rule 24",
    title: "Team Competitions",
    summary:
      "How team events work, including when a team captain or coach may give advice to players, if the committee allows it.",
    keywords: ["team", "team captain", "inter-club", "team event", "coach", "advice"],
  },
  {
    id: "rule-25",
    kind: "rule",
    rule: 25,
    ref: "Rule 25",
    title: "Modifications for Players with Disabilities",
    summary:
      "Adjustments to the Rules for players who are blind, amputees, use mobility devices, or have an intellectual impairment — so they can play fairly alongside everyone else.",
    keywords: ["disability", "disabled", "blind", "amputee", "mobility device", "buggy", "adaptive golf", "inclusion"],
  },
  {
    id: "definitions",
    kind: "rule",
    rule: 0,
    ref: "Definitions",
    title: "Definitions",
    summary:
      "The Rules lean on defined terms — like general area, loose impediment, relief area, club-length and outside influence. When a word in a Rule matters, its definition settles what it means.",
    keywords: ["definition", "meaning", "what is", "club-length", "relief area", "reference point", "nearest point of complete relief", "general penalty"],
  },

  // ——— Common situations ———
  {
    id: "general-penalty",
    kind: "topic",
    rule: 1,
    ref: "1.3c",
    title: "The general penalty",
    summary:
      "Most breaches carry the 'general penalty': two penalty strokes in stroke play, or loss of the hole in match play. Some breaches cost one stroke, and a few are disqualification.",
    keywords: ["penalty", "penalties", "two strokes", "2 strokes", "loss of hole", "how many shots"],
  },
  {
    id: "out-of-bounds",
    kind: "topic",
    rule: 18,
    ref: "18.2",
    title: "Ball out of bounds",
    summary:
      "A ball is out of bounds only when all of it is beyond the boundary edge (usually the inside line of white stakes or a fence). Take stroke-and-distance: add one penalty stroke and play again from where you last played.",
    points: [
      "From the tee, you may re-tee.",
      "Your club may have adopted the lost-ball alternative local rule — see that entry.",
    ],
    keywords: ["ob", "o.b.", "out of bounds", "white stakes", "fence", "boundary", "over the wall", "out of play"],
  },
  {
    id: "lost-ball",
    kind: "topic",
    rule: 18,
    ref: "18.2",
    title: "Lost ball",
    summary:
      "Your ball is lost if it isn't found within three minutes of starting to search. Take stroke-and-distance: one penalty stroke, and play again from where you last played.",
    points: [
      "If it's known or virtually certain the ball went into a penalty area or an abnormal course condition, use those Rules instead.",
      "Playing a provisional ball first saves walking back.",
    ],
    keywords: ["lost", "can't find", "cannot find ball", "three minutes", "3 minutes", "search time", "stroke and distance"],
  },
  {
    id: "provisional-ball",
    kind: "topic",
    rule: 18,
    ref: "18.3",
    title: "Provisional ball",
    summary:
      "If your ball might be lost outside a penalty area or out of bounds, you may play a provisional ball before going forward to look. Say clearly that it's a provisional. If the original is found on the course in time, abandon the provisional; if not, the provisional becomes your ball in play.",
    keywords: ["provisional", "reload", "play another", "hit another", "announce", "second ball"],
  },
  {
    id: "lost-ball-local-rule",
    kind: "topic",
    rule: 18,
    ref: "Local Rule E-5",
    title: "Lost ball or out of bounds — the two-stroke alternative",
    summary:
      "Where the committee has adopted Model Local Rule E-5 (common in general play, not used in elite events), instead of going back you may drop near where the ball was lost or went out, in the fairway area no nearer the hole, for two penalty strokes. Check your club's local rules first.",
    keywords: ["local rule", "e-5", "e5", "no walking back", "drop in fairway", "two strokes lost ball", "alternative to stroke and distance"],
  },
  {
    id: "penalty-area-relief",
    kind: "topic",
    rule: 17,
    ref: "17.1d",
    title: "Taking relief from a penalty area (water)",
    summary:
      "For one penalty stroke you can: go back and play from where you last played (stroke-and-distance), or drop back on a line from the hole through where the ball last crossed into the area. If the area is red, you can also drop within two club-lengths of where it last crossed, no nearer the hole.",
    points: [
      "You can play it as it lies instead — you may ground your club and move loose impediments in a penalty area.",
      "You need to know, or be virtually certain, the ball is in the area; otherwise it's a lost ball.",
    ],
    keywords: ["water", "in the water", "pond", "lake", "stream", "ditch", "red stakes", "yellow stakes", "lateral", "drop from water", "hazard"],
  },
  {
    id: "unplayable-options",
    kind: "topic",
    rule: 19,
    ref: "19.2",
    title: "Unplayable ball — your three options",
    summary:
      "For one penalty stroke: play again from where you last played; drop back on a line from the hole through your ball's spot; or drop within two club-lengths of the ball, no nearer the hole. You're the only one who can decide your ball is unplayable.",
    keywords: ["unplayable", "two club lengths", "back on the line", "bush", "tree roots", "gorse", "whins", "stuck"],
  },
  {
    id: "unplayable-bunker",
    kind: "topic",
    rule: 19,
    ref: "19.3",
    title: "Unplayable ball in a bunker",
    summary:
      "In a bunker the usual three options apply for one stroke, but any drop near the ball or on the line must stay in the bunker. Or, for two penalty strokes in total, drop outside the bunker back on a line from the hole through the ball.",
    keywords: ["bunker unplayable", "plugged in bunker", "fried egg", "out of bunker", "sand", "trap", "under the lip"],
  },
  {
    id: "embedded-ball",
    kind: "topic",
    rule: 16,
    ref: "16.3",
    title: "Embedded (plugged) ball",
    summary:
      "If your ball is embedded in its own pitch-mark anywhere in the general area (fairway or rough), you get free relief: drop within one club-length of the spot just behind the ball, no nearer the hole. Not in sand.",
    keywords: ["plugged", "embedded", "pitch mark", "plugged lie", "stuck in ground", "wet fairway", "free drop"],
  },
  {
    id: "abnormal-course-conditions",
    kind: "topic",
    rule: 16,
    ref: "16.1",
    title: "Free relief: cart paths, sprinklers, GUR, puddles, animal holes",
    summary:
      "When an abnormal course condition interferes with your lie, stance or swing in the general area, find the nearest point of complete relief and drop within one club-length of it, no nearer the hole — no penalty.",
    points: [
      "Relief isn't available if the condition only gets in the way of your line, or you'd need a clearly unreasonable stroke.",
      "In a bunker or on the green the relief works differently — see Rule 16.1c and 16.1d.",
    ],
    keywords: ["cart path", "path", "sprinkler", "sprinkler head", "ground under repair", "gur", "casual water", "temporary water", "puddle", "rabbit scrape", "animal hole", "immovable obstruction", "free drop", "nearest point of relief"],
  },
  {
    id: "dangerous-animal",
    kind: "topic",
    rule: 16,
    ref: "16.2",
    title: "Dangerous animal condition",
    summary:
      "If a dangerous animal near your ball (snakes, wasps, alligators, fire ants) could seriously injure you, you can take free relief wherever your ball is. If it's in a penalty area the free-relief option stays inside the area, and you can also take penalty relief outside it.",
    keywords: ["wasps", "bees", "nest", "snake", "dangerous animal", "danger"],
  },
  {
    id: "loose-impediments",
    kind: "topic",
    rule: 15,
    ref: "15.1",
    title: "Moving leaves, twigs and stones",
    summary:
      "You may remove loose impediments anywhere, without penalty. But if your ball moves while you're doing it (except on the green or teeing area), you get one penalty stroke and must replace it.",
    keywords: ["leaves", "twigs", "branches", "stones", "pine cones", "worm casts", "loose impediments", "moving stuff"],
  },
  {
    id: "movable-obstructions",
    kind: "topic",
    rule: 15,
    ref: "15.2",
    title: "Moving rakes, bottles and other movable obstructions",
    summary:
      "Artificial things that can be moved easily without damage — rakes, bottles, cans, removable stakes — can be moved anywhere without penalty. If your ball moves while you do it, there's no penalty: put it back.",
    points: ["Exception: don't move the tee-markers when playing from that teeing area."],
    keywords: ["rake", "bottle", "can", "litter", "bag", "movable obstruction", "stake that comes out"],
  },
  {
    id: "drop-procedure",
    kind: "topic",
    rule: 14,
    ref: "14.3",
    title: "How to drop a ball",
    summary:
      "Drop from knee height, letting the ball fall straight down without throwing or spinning it. It must land in and come to rest in the relief area. If it rolls out, drop again; if it rolls out a second time, place it where it first touched the ground.",
    keywords: ["drop", "knee height", "dropping", "re-drop", "redrop", "how to drop", "relief area", "place ball"],
  },
  {
    id: "mark-and-lift",
    kind: "topic",
    rule: 14,
    ref: "14.1",
    title: "Marking and lifting your ball",
    summary:
      "Before lifting a ball that has to be replaced, mark its spot (with a ball-marker or a club held just behind or beside it). Lifting it without marking costs one penalty stroke.",
    keywords: ["mark", "marker", "ball marker", "lift", "pick up ball", "coin"],
  },
  {
    id: "wrong-place",
    kind: "topic",
    rule: 14,
    ref: "14.7",
    title: "Playing from the wrong place",
    summary:
      "Playing from somewhere the Rules don't allow is the general penalty. In stroke play, if it was a serious breach (a big advantage), you must correct it before teeing off at the next hole or you're disqualified.",
    keywords: ["wrong place", "dropped in wrong spot", "wrong drop", "serious breach"],
  },
  {
    id: "ball-moved",
    kind: "topic",
    rule: 9,
    ref: "9.4",
    title: "Your ball moved — by you, someone else, or the wind",
    summary:
      "If you accidentally move your ball at rest, it's one penalty stroke and you replace it — but no penalty when searching, on the green, or while applying a Rule. If another person or an outside influence moves it, no penalty: replace it. If wind or gravity moves it, play it from the new spot.",
    points: ["On the green, if wind moves your ball after you've marked, lifted and replaced it, put it back."],
    keywords: ["ball moved", "accidentally moved", "ball rolled", "wind", "address", "knocked ball", "touched ball"],
  },
  {
    id: "improving-conditions",
    kind: "topic",
    rule: 8,
    ref: "8.1",
    title: "Improving your lie, stance or line",
    summary:
      "Bending or breaking branches, flattening grass, or removing sand or soil (off the green) to help your shot is the general penalty. Fairly taking your stance and lightly grounding your club are allowed.",
    keywords: ["improving lie", "breaking branch", "pressing down", "tamping", "building a stance", "bending", "fluffing"],
  },
  {
    id: "searching",
    kind: "topic",
    rule: 7,
    ref: "7.1–7.4",
    title: "Searching for and identifying your ball",
    summary:
      "You may move long grass and bushes to find your ball, and lift it to identify it once you've marked the spot. If you or anyone accidentally moves it while searching, no penalty — put it back.",
    keywords: ["search", "looking", "rough", "identify", "whose ball", "lift to identify", "accidentally moved while searching"],
  },
  {
    id: "wrong-ball",
    kind: "topic",
    rule: 6,
    ref: "6.3c",
    title: "Playing a wrong ball",
    summary:
      "Hitting a ball that isn't yours is the general penalty. In stroke play you must go on to play your own ball, or you're disqualified; strokes with the wrong ball don't count.",
    keywords: ["wrong ball", "someone else's ball", "played my partner's ball", "mix up balls"],
  },
  {
    id: "teeing-area",
    kind: "topic",
    rule: 6,
    ref: "6.2",
    title: "Teeing off — the teeing area",
    summary:
      "The teeing area runs between the front of the two tee-markers and two club-lengths back. Your ball must be inside it (your feet needn't be). In stroke play, playing from outside costs two strokes and you must replay; in match play your opponent may make you replay.",
    keywords: ["tee box", "tee markers", "teeing ground", "in front of markers", "outside tee", "two club-lengths", "honour"],
  },
  {
    id: "order-of-play",
    kind: "topic",
    rule: 6,
    ref: "6.4",
    title: "Order of play and 'ready golf'",
    summary:
      "In match play the side with the honour tees off first and the ball furthest from the hole is played first. In stroke play there's no penalty for playing out of turn, and 'ready golf' — playing when ready, safely — is encouraged.",
    keywords: ["honour", "who goes first", "furthest from hole", "out of turn", "ready golf"],
  },
  {
    id: "fourteen-clubs",
    kind: "topic",
    rule: 4,
    ref: "4.1b",
    title: "Too many clubs (more than 14)",
    summary:
      "You may start with up to 14 clubs. Carrying more: in stroke play, two penalty strokes for each hole where you breached it, maximum four; in match play, the match is adjusted by one hole per hole, maximum two. Take the extra club out of play as soon as you notice.",
    keywords: ["15 clubs", "too many clubs", "14 clubs", "extra club", "club limit"],
  },
  {
    id: "damaged-club",
    kind: "topic",
    rule: 4,
    ref: "4.1a",
    title: "Damaged or broken club",
    summary:
      "If a club is damaged during the round, you can keep using it, have it repaired, or replace it — unless you damaged it through abuse, like throwing it in anger.",
    keywords: ["broken club", "damaged club", "snapped shaft", "replace club", "bent club"],
  },
  {
    id: "distance-devices",
    kind: "topic",
    rule: 4,
    ref: "4.3",
    title: "Rangefinders and GPS",
    summary:
      "Distance-measuring devices are allowed unless a local rule bans them. Using a function that measures elevation or wind, or that recommends a club, is a breach — switch slope off in competition.",
    keywords: ["rangefinder", "gps", "laser", "watch", "distance device", "slope", "app", "yardage"],
  },
  {
    id: "advice",
    kind: "topic",
    rule: 10,
    ref: "10.2",
    title: "Asking for or giving advice",
    summary:
      "During a round you may only get advice from your caddie or your partner (and their caddie). Asking an opponent or another player what club they hit is a breach; information that's public, like distances or where the hole is, isn't advice.",
    keywords: ["advice", "what club", "which club did you hit", "tips", "help", "caddie advice"],
  },
  {
    id: "double-hit",
    kind: "topic",
    rule: 10,
    ref: "10.1a",
    title: "Double hit",
    summary:
      "If your club accidentally hits the ball more than once in a single stroke, it counts as one stroke with no penalty.",
    keywords: ["double hit", "hit twice", "double chip", "double touch"],
  },
  {
    id: "anchoring",
    kind: "topic",
    rule: 10,
    ref: "10.1b",
    title: "Anchoring the club",
    summary:
      "You must not anchor the club against your body (such as a long putter pressed into your chest or a forearm used as an anchor point) when making a stroke. General penalty.",
    keywords: ["anchoring", "long putter", "belly putter", "broomstick", "anchor"],
  },
  {
    id: "caddie-alignment",
    kind: "topic",
    rule: 10,
    ref: "10.2b",
    title: "Caddie lining you up",
    summary:
      "Once you start taking your stance, your caddie must not stand on or close to the extension of your line of play behind the ball. General penalty.",
    keywords: ["alignment", "lining up", "caddie behind", "standing behind"],
  },
  {
    id: "ball-hits-person",
    kind: "topic",
    rule: 11,
    ref: "11.1",
    title: "Ball hits you, your bag or another player",
    summary:
      "If your ball accidentally hits anyone or anything — including you, your clubs or your trolley — there's no penalty and you play it as it lies.",
    points: [
      "Exception: in stroke play, if you putt from the green and hit another ball at rest on the green, it's two penalty strokes.",
    ],
    keywords: ["hit myself", "hit my bag", "hit trolley", "hit a player", "ball hit person", "ricochet", "hit another ball"],
  },
  {
    id: "bunker-touching-sand",
    kind: "topic",
    rule: 12,
    ref: "12.2b",
    title: "Touching the sand in a bunker",
    summary:
      "Don't test the sand, and don't touch the sand with your club right in front of or behind the ball, in a practice swing, or in your backswing. Leaning on a club to rest, or smoothing sand to care for the course (not to help your shot), is fine.",
    keywords: ["grounding club in bunker", "sand", "practice swing bunker", "touch sand", "rake bunker", "trap"],
  },
  {
    id: "flagstick",
    kind: "topic",
    rule: 13,
    ref: "13.2",
    title: "Flagstick in or out",
    summary:
      "You can putt with the flagstick left in, taken out, or attended. If you leave it in and your ball hits it, there's no penalty.",
    keywords: ["flag", "pin", "flagstick", "putt with flag in", "attend", "tend the flag"],
  },
  {
    id: "repairing-green",
    kind: "topic",
    rule: 13,
    ref: "13.1c",
    title: "Repairing damage on the green",
    summary:
      "You may repair almost any damage on the green — pitch-marks, shoe damage, old hole plugs, animal marks — without penalty. Natural wear, aeration holes and grain are not damage you can fix.",
    keywords: ["pitch mark", "ball mark", "spike mark", "repair", "fix green", "divot tool", "plug"],
  },
  {
    id: "ball-overhanging-hole",
    kind: "topic",
    rule: 13,
    ref: "13.3",
    title: "Ball hanging over the lip of the hole",
    summary:
      "You get a reasonable time to reach the hole and then ten more seconds to see if the ball drops. If it drops after that, you're treated as having holed out with your last stroke but add one penalty stroke.",
    keywords: ["overhanging", "on the lip", "hanging over hole", "10 seconds", "ten seconds", "wait for ball"],
  },
  {
    id: "wrong-green",
    kind: "topic",
    rule: 13,
    ref: "13.1f",
    title: "Ball on the wrong green",
    summary:
      "If your ball is on a putting green other than the one you're playing, or it gets in the way of your stance, you must take free relief: drop within one club-length of the nearest point of complete relief, off that green.",
    keywords: ["wrong green", "other green", "practice green", "next green"],
  },
  {
    id: "pace-of-play",
    kind: "topic",
    rule: 5,
    ref: "5.6b",
    title: "Pace of play",
    summary:
      "Play promptly. It's recommended you take no more than 40 seconds to play a stroke once it's your turn and you can play without interference. Committees can set their own pace-of-play policy.",
    keywords: ["slow play", "pace", "40 seconds", "taking too long", "speed up"],
  },
  {
    id: "practice",
    kind: "topic",
    rule: 5,
    ref: "5.2, 5.5",
    title: "Practising before and during a round",
    summary:
      "In stroke play you must not practise on the competition course on the day of the competition before your round (practice green and range excepted). During a round, no practice strokes — but you can chip or putt on or near the green you've just finished, if it doesn't hold anyone up.",
    keywords: ["practice", "practise", "practice putt", "warm up", "before round", "hit an extra ball"],
  },
  {
    id: "lightning",
    kind: "topic",
    rule: 5,
    ref: "5.7",
    title: "Stopping for lightning or bad weather",
    summary:
      "You may stop play if you reasonably believe there's danger from lightning. If the committee suspends play for a dangerous situation, you must stop immediately.",
    keywords: ["lightning", "thunder", "storm", "weather", "suspended", "siren", "horn", "stop play"],
  },
  {
    id: "scorecard",
    kind: "topic",
    rule: 3,
    ref: "3.3b",
    title: "Signing your scorecard (stroke play)",
    summary:
      "Your marker records and certifies your hole scores, and you check and certify them before handing in. Returning a lower score than you took on any hole means disqualification; a higher score stands. The committee works out handicap strokes and your net total.",
    points: [
      "If a score is too low only because of a penalty you didn't know about, you add that penalty plus two more strokes instead of being disqualified.",
    ],
    keywords: ["scorecard", "card", "sign", "signing", "marker", "wrong score", "attest", "certify", "dq", "disqualified"],
  },
  {
    id: "concessions",
    kind: "topic",
    rule: 3,
    ref: "3.2b",
    title: "Conceding a putt, hole or match",
    summary:
      "In match play you can concede your opponent's next stroke, a hole or the whole match at any time. A concession can't be declined or taken back.",
    keywords: ["concede", "gimme", "given", "that's good", "concession", "pick it up"],
  },
  {
    id: "uncertain-ruling",
    kind: "topic",
    rule: 20,
    ref: "20.1c",
    title: "Not sure what to do? Play two balls",
    summary:
      "In stroke play, if you're unsure how to proceed, you can finish the hole with two balls — say which one you want to count if the Rules allow — and report it to the committee before handing in your card.",
    keywords: ["play two balls", "second ball", "unsure", "doubt", "dispute", "not sure what rule"],
  },
  {
    id: "stableford",
    kind: "topic",
    rule: 21,
    ref: "21.1",
    title: "Stableford scoring",
    summary:
      "You score points on each hole against a fixed score, usually net par: 2 points for a net par, 3 for a net birdie, 1 for a net bogey, and nothing for net double bogey or worse — so you can pick up once you can't score.",
    keywords: ["stableford", "points", "society", "pick up", "net par", "scoring"],
  },
  {
    id: "maximum-score",
    kind: "topic",
    rule: 21,
    ref: "21.2",
    title: "Maximum score",
    summary:
      "Stroke play where your score on each hole is capped at a limit the committee sets (such as double par or net double bogey), so one disaster hole doesn't ruin the round.",
    keywords: ["maximum score", "max score", "capped", "double par", "net double bogey"],
  },
];

// ——— Search ———

/** Popular searches shown before anyone types. */
export const SUGGESTED_SEARCHES = [
  "lost ball",
  "out of bounds",
  "water",
  "unplayable",
  "bunker",
  "free drop",
  "embedded",
  "provisional",
  "flagstick",
  "how to drop",
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Matches "rule 18", "r18", "18", "18.3", "18.3b" — a reference rather than
 * words. Returns the Rule number and the full reference typed, if any.
 */
function parseRef(q: string): { rule: number; sub: string } | null {
  const m = /^(?:rule\s*|r)?(\d{1,2})((?:\.\d+[a-z]?(?:\(\d+\))?)?)$/.exec(q.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const rule = Number(m[1]);
  if (rule < 1 || rule > 25) return null;
  return { rule, sub: `${rule}${m[2] ?? ""}` };
}

export type RuleHit = { entry: RuleEntry; score: number };

/**
 * Search the lookup. Every word typed must appear somewhere in an entry
 * (title, keywords, reference or summary), and where it appears decides the
 * order: title and keywords count most. A rule number on its own ("18",
 * "rule 18", "18.3") lists that Rule first, then the situations inside it.
 *
 * An empty query returns the 25 Rules and the Definitions, in order.
 */
export function searchRules(query: string, entries: RuleEntry[] = RULES): RuleHit[] {
  const q = norm(query);
  if (!q) {
    return entries
      .filter((e) => e.kind === "rule")
      .sort((a, b) => (a.rule || 99) - (b.rule || 99))
      .map((entry) => ({ entry, score: 0 }));
  }

  const ref = parseRef(q);
  if (ref) {
    return entries
      .filter((e) => e.rule === ref.rule)
      .map((entry) => {
        let score = entry.kind === "rule" ? 100 : 50;
        // "18.3" was typed: the situation filed under 18.3 beats Rule 18.
        if (ref.sub.includes(".") && entry.ref.toLowerCase().startsWith(ref.sub)) score += 60;
        return { entry, score };
      })
      .sort((a, b) => b.score - a.score || a.entry.ref.localeCompare(b.entry.ref, undefined, { numeric: true }));
  }

  const words = q.split(" ").filter((w) => w.length > 0);
  const hits: RuleHit[] = [];

  for (const entry of entries) {
    const title = norm(entry.title);
    const keys = entry.keywords.map(norm);
    const keyText = keys.join(" | ");
    const refText = norm(entry.ref);
    const body = norm([entry.summary, ...(entry.points ?? [])].join(" "));

    let score = 0;
    let every = true;
    for (const w of words) {
      let s = 0;
      if (title.split(" ").some((t) => t.startsWith(w))) s = Math.max(s, 12);
      if (keyText.includes(w)) s = Math.max(s, 10);
      if (refText === w || refText.startsWith(`${w}.`)) s = Math.max(s, 8);
      if (body.includes(w)) s = Math.max(s, 3);
      if (s === 0) {
        every = false;
        break;
      }
      score += s;
    }
    if (!every) continue;

    // The whole phrase, not just its words: "lost ball" beats an entry that
    // merely mentions "lost" and "ball" separately.
    if (words.length > 1) {
      if (title.includes(q)) score += 25;
      if (keys.some((k) => k.includes(q))) score += 20;
    }
    if (keys.includes(q)) score += 15;
    // An entry named exactly what was typed is the answer.
    if (title === q) score += 30;
    // Situations answer a search more directly than a whole Rule does.
    if (entry.kind === "topic") score += 2;

    hits.push({ entry, score });
  }

  return hits.sort((a, b) => b.score - a.score);
}
