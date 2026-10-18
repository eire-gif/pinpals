/**
 * Game formats — every way to play, explained in plain English (Oct 2026).
 *
 * One file, byte-identical with mobile/src/lib/game-formats.ts (the test in
 * src/lib/game-formats.test.ts fails if they drift), drawn by the app's
 * Menu → Play → Game formats and the website's /formats.
 *
 * Handicap allowances follow the World Handicap System's recommended
 * allowances (Appendix C), which Golf Ireland uses. Where WHS has no figure —
 * side games, Waltz, Yellow Ball and the like — we say the organiser sets it
 * rather than invent one. The figures that live scoring actually plays off
 * are in lib/live-scoring.ts (app); keep the two in agreement.
 *
 * Pure data and pure functions: no React, no imports, so both projects can
 * load it as is.
 */

export type FormatCategory = "individual" | "matchplay" | "pairs" | "team" | "side";

/** A picture drawn on the format's page, where one explains it better than words. */
export type FormatVisual = "points" | "alternate" | "scramble";

export type GameFormat = {
  /** URL slug — /formats/<id> on the site, /formats/<id> in the app. */
  id: string;
  name: string;
  /** Two characters for the tile. */
  code: string;
  category: FormatCategory;
  /** Other names it goes by, for search and the page. */
  aka?: string[];
  /** Misspellings and loose terms — found by search, never shown. */
  searchAlso?: string[];
  /** One line under the name in the list. */
  blurb: string;
  /** Who plays: "1+", "2", "Pairs", "Teams of 4". */
  players: string;
  /** How it's scored, in a few words. */
  scoring: string;
  /** The handicap allowance, in words. */
  allowance: string;
  /** Who wins, in a few words. */
  winner: string;
  /** A sentence or two above the steps. */
  intro: string;
  /** How it works, in order. */
  steps: string[];
  /** A worked example, where one helps. */
  example?: string;
  /** Good to know. */
  tips?: string[];
  /** How ties are settled, where it matters. */
  ties?: string;
  /** Close relations, by id. */
  related?: string[];
  /** Can be played in PinPals live scoring today. */
  live?: boolean;
  /** One of the most played formats in Irish golf — shown up top. */
  popular?: boolean;
  visual?: FormatVisual;
};

export const FORMAT_CATEGORIES: { id: FormatCategory; label: string; title: string; kicker: string }[] = [
  { id: "individual", label: "Individual", title: "Individual — strokes & points", kicker: "EVERY PLAYER FOR THEMSELVES" },
  { id: "matchplay", label: "Matchplay", title: "Matchplay", kicker: "HOLE BY HOLE" },
  { id: "pairs", label: "Pairs", title: "Pairs", kicker: "TWO OF YOU" },
  { id: "team", label: "Team", title: "Team formats", kicker: "THREE OR FOUR TOGETHER" },
  { id: "side", label: "Side games", title: "Side games", kicker: "A LITTLE SOMETHING ON IT" },
];

/** The countback most Irish clubs use for individual competitions. */
const COUNTBACK =
  "Level at the top? Compare the back nine, then the last six, then the last three, then the 18th. In stroke play, half, a third, a sixth and an eighteenth of the handicap come off each in turn.";

export const GAME_FORMATS: GameFormat[] = [
  // ---------------------------------------------------------------- Individual
  {
    id: "stroke-play",
    name: "Stroke Play (Medal)",
    code: "SP",
    category: "individual",
    aka: ["Medal"],
    searchAlso: ["Strokeplay", "Gross and net"],
    blurb: "Count every shot. Lowest net score wins.",
    players: "1+",
    scoring: "Strokes",
    allowance: "95% of course handicap",
    winner: "Lowest net score",
    intro: "The original and the strictest. Every shot counts and you must hole out on every hole — there's nowhere to hide a bad one.",
    steps: [
      "Play all 18 holes, holing out on each one.",
      "Add up every stroke, penalties included, for your gross score.",
      "Take off your playing handicap for your net score.",
      "Lowest net score wins. Many competitions also give a prize for the best gross.",
    ],
    example: "Gross 92, playing handicap 19 → net 73. On a par 72, that's one over net par.",
    tips: ["A medal round counts for your handicap when the competition is set up as an acceptable score for handicap.", "Your marker records your score hole by hole — check it before you sign, not on the 18th."],
    ties: COUNTBACK,
    related: ["stableford", "maximum-score", "par-bogey"],
    live: true,
    popular: true,
  },
  {
    id: "stableford",
    name: "Stableford",
    code: "SF",
    category: "individual",
    aka: ["Points"],
    searchAlso: ["Stapleford"],
    blurb: "Points per hole against your handicap.",
    players: "1+",
    scoring: "Points",
    allowance: "95% of course handicap",
    winner: "Most points",
    intro: "The most played format in Irish golf. You score points on each hole, so a disaster costs you a point or two, not your whole round.",
    steps: [
      "Your handicap gives you extra shots on the hardest holes — the ones with the lowest stroke index.",
      "Take those shots off your score on each hole to get your net score.",
      "Net par earns 2 points. Better earns more, worse earns less.",
      "Once you can't score a point, pick up and move on.",
      "Add up the points. Playing to your handicap is 36.",
    ],
    example: "Hole 7, par 4, stroke index 5. Playing handicap 18 means one extra shot on every hole, so a 5 is a net 4 — net par — and earns 2 points.",
    tips: ["Picking up when you can't score speeds the whole field up — a society of 40 will thank you.", "Fourball better-ball Stableford uses 85% of handicap, not 95%."],
    ties: COUNTBACK,
    related: ["modified-stableford", "fourball-better-ball", "team-stableford"],
    live: true,
    popular: true,
    visual: "points",
  },
  {
    id: "par-bogey",
    name: "Par / Bogey",
    code: "PB",
    category: "individual",
    aka: ["Bogey competition", "Par competition", "Against par"],
    blurb: "Win, halve or lose each hole against par.",
    players: "1+",
    scoring: "Holes won and lost",
    allowance: "95% of course handicap",
    winner: "Best result against the course",
    intro: "Matchplay against the course itself. Every hole, your net score takes on par.",
    steps: [
      "Take your handicap shots on the holes they fall on.",
      "Net birdie or better wins the hole (+). Net par halves it (0). Anything worse loses it (−).",
      "Once you've lost a hole, pick up.",
      "Add the pluses and minuses. \"2 up\" beats \"all square\", which beats \"1 down\".",
    ],
    tips: ["A Stableford card converts easily: 3+ points is a win, 2 a halve, 0–1 a loss."],
    ties: COUNTBACK,
    related: ["stableford", "singles-matchplay"],
  },
  {
    id: "maximum-score",
    name: "Maximum Score",
    code: "MX",
    category: "individual",
    aka: ["Max score"],
    blurb: "Stroke play with a cap on each hole.",
    players: "1+",
    scoring: "Strokes, capped",
    allowance: "95% of course handicap",
    winner: "Lowest net score",
    intro: "Stroke play without the blow-up hole. The committee sets a most-you-can-take on each hole, and once you reach it you pick up.",
    steps: [
      "Before the round the committee sets the cap — net double bogey, twice par, or a fixed number.",
      "Play each hole as stroke play.",
      "Reach the cap and pick up: you score the cap for that hole.",
      "Add up and take off your handicap. Lowest net wins.",
    ],
    tips: ["It counts for handicap, like a medal, and it's a lot quicker on a busy day."],
    ties: COUNTBACK,
    related: ["stroke-play", "stableford"],
  },
  {
    id: "modified-stableford",
    name: "Modified Stableford",
    code: "MS",
    category: "individual",
    aka: ["Pro Stableford"],
    blurb: "Bonus for birdies, minus for big numbers.",
    players: "1+",
    scoring: "Points, plus and minus",
    allowance: "Usually off scratch — the organiser decides",
    winner: "Most points",
    intro: "Stableford turned aggressive, as played on tour. Birdies pay well and bogeys cost you, so it rewards going for it.",
    steps: [
      "Score each hole: albatross +8, eagle +5, birdie +2, par 0, bogey −1, double bogey or worse −3.",
      "Usually played on gross scores; some societies use net.",
      "Add up the points — a total below zero is possible.",
    ],
    tips: ["Agree the points table on the first tee — some versions use +3 for eagle and −2 for double bogey."],
    related: ["stableford", "skins"],
  },
  {
    id: "eclectic",
    name: "Eclectic",
    code: "EC",
    category: "individual",
    aka: ["Ringer score", "Best-ball of your own rounds"],
    blurb: "Your best score on each hole over a season.",
    players: "1+",
    scoring: "Best score per hole",
    allowance: "Set by the club — often a share of handicap",
    winner: "Lowest eclectic total",
    intro: "Your dream round, built from your real ones. Over a run of rounds, you keep your best score on each hole.",
    steps: [
      "Play a series of rounds — a month, a season, or a set number of competitions.",
      "On each hole, keep the lowest score you've had on it.",
      "Your eclectic card is those 18 best scores added up.",
      "Take off the handicap allowance the club sets. Lowest net wins.",
    ],
    tips: ["A great one for a society's season-long table."],
    related: ["stroke-play"],
  },
  {
    id: "flag",
    name: "Flag Competition",
    code: "FL",
    category: "individual",
    aka: ["Tombstone"],
    blurb: "Play until your strokes run out — plant a flag.",
    players: "1+",
    scoring: "How far you get",
    allowance: "Par plus 95% of course handicap",
    winner: "Furthest round the course",
    intro: "A race against your own handicap. You get a fixed number of shots, and wherever the last one stops, you plant your flag.",
    steps: [
      "Your allowance is the course par plus your playing handicap — par 72 and handicap 18 gives you 90 shots.",
      "Play until you've used them all.",
      "Plant your flag (or a tee with your name) where your last shot finished.",
      "Still have shots after the 18th? Carry on down the 1st and beyond.",
      "Whoever's flag is furthest round the course wins.",
    ],
    tips: ["Mark the flag clearly — on a busy day, there'll be a lot of them on the 18th green."],
    related: ["stroke-play"],
  },
  {
    id: "three-club",
    name: "Three-Club Challenge",
    code: "3C",
    category: "individual",
    aka: ["Three clubs and a putter"],
    blurb: "Any format, but only three clubs and a putter.",
    players: "1+",
    scoring: "Any format",
    allowance: "As the format played",
    winner: "As the format played",
    intro: "A twist you can put on any format. It brings back feel shots, punch shots and imagination — and it's quick.",
    steps: [
      "Pick three clubs plus a putter. Nothing else goes in the bag.",
      "Play the round as any format — usually Stableford.",
      "No borrowing a partner's club.",
    ],
    tips: ["A popular choice: driver or fairway wood, a 7-iron, and a wedge."],
    related: ["stableford"],
  },

  // ---------------------------------------------------------------- Matchplay
  {
    id: "singles-matchplay",
    name: "Singles Matchplay",
    code: "SM",
    category: "matchplay",
    aka: ["Matchplay", "Head to head"],
    blurb: "One v one. Win the most holes.",
    players: "2",
    scoring: "Holes won",
    allowance: "100% of the difference in course handicaps",
    winner: "Most holes won",
    intro: "Golf at its most personal. You don't count your total — each hole is a fresh contest, won, lost or halved.",
    steps: [
      "The lower handicap plays off scratch. The other player gets the full difference, as shots on the lowest stroke-index holes.",
      "Lower net score wins the hole. The same score halves it.",
      "Keep score as holes up or down — \"2 up\", \"all square\".",
      "The match is over once someone is more holes up than there are holes left — \"3 & 2\" means three up with two to play.",
    ],
    example: "Course handicaps 8 and 14 → the 14 gets 6 shots, on stroke index 1–6.",
    tips: ["You can concede a putt, a hole or the match at any time — but you can't take it back."],
    ties: "All square after 18? Play extra holes until someone wins one, unless the competition says otherwise.",
    related: ["fourball-matchplay", "foursomes-matchplay", "par-bogey"],
    live: true,
  },
  {
    id: "fourball-matchplay",
    name: "Fourball Matchplay",
    code: "FM",
    category: "matchplay",
    aka: ["Better-ball matchplay", "Four-ball"],
    blurb: "Pairs, own ball, better score counts.",
    players: "4 — two pairs",
    scoring: "Holes won",
    allowance: "90% of course handicap, off the lowest",
    winner: "Most holes won",
    intro: "Two against two, everyone playing their own ball. Only the better net score of each pair counts on each hole.",
    steps: [
      "Each player's handicap is 90% of their course handicap. The lowest of the four plays off scratch, the others get the difference.",
      "All four play their own ball on every hole.",
      "Each pair's better net score is its score for the hole. Lower wins.",
      "Scored like singles: holes up or down, \"2 & 1\" and so on.",
    ],
    tips: ["Once your partner's safe, you can afford to attack the pin."],
    related: ["fourball-better-ball", "singles-matchplay", "ryder-cup"],
    live: true,
  },
  {
    id: "foursomes-matchplay",
    name: "Foursomes Matchplay",
    code: "FS",
    category: "matchplay",
    aka: ["Alternate shot matchplay"],
    blurb: "Pairs share one ball, alternate shots.",
    players: "4 — two pairs",
    scoring: "Holes won",
    allowance: "50% of each pair's combined course handicaps — the higher pair gets the difference",
    winner: "Most holes won",
    intro: "The Ryder Cup's most nervous format. Each pair plays one ball, taking turns, against another pair doing the same.",
    steps: [
      "Each pair's handicap is half its combined course handicaps. The pair with the higher one gets the difference, as shots.",
      "One partner drives the odd holes, the other the even holes.",
      "Take turns hitting the ball until it's holed.",
      "Lower net score wins the hole.",
    ],
    example: "Pair A: 6 + 12 = 18, so 9. Pair B: 10 + 20 = 30, so 15. Pair B gets 6 shots.",
    related: ["foursomes", "greensomes-matchplay", "ryder-cup"],
    live: true,
  },
  {
    id: "greensomes-matchplay",
    name: "Greensomes Matchplay",
    code: "GM",
    category: "matchplay",
    aka: ["Canadian foursomes matchplay"],
    blurb: "Both drive, pick one, then alternate.",
    players: "4 — two pairs",
    scoring: "Holes won",
    allowance: "60% of the lower + 40% of the higher, then the difference",
    winner: "Most holes won",
    intro: "Foursomes with a safety net. Both partners tee off, the pair picks the better drive, then they alternate.",
    steps: [
      "Each pair's handicap is 60% of the lower course handicap plus 40% of the higher. The higher pair gets the difference.",
      "Both partners tee off. Choose the better drive.",
      "The player whose drive wasn't chosen plays the second shot, then you alternate until it's holed.",
      "Lower net score wins the hole.",
    ],
    related: ["greensomes", "foursomes-matchplay"],
    live: true,
  },
  {
    id: "ryder-cup",
    name: "Ryder Cup Team Match",
    code: "RC",
    category: "matchplay",
    aka: ["Team matchplay", "Match day", "Blues v Golds"],
    blurb: "Sessions of singles, fourballs & foursomes.",
    players: "8+ — two teams",
    scoring: "Points per match",
    allowance: "As each match's format",
    winner: "Team with most points",
    intro: "Split the society into two teams and play a series of matches. Every match won is a point for your side — the classic golf-trip finale.",
    steps: [
      "Pick two captains and two teams of equal size.",
      "Play sessions: usually foursomes and fourballs, then singles to finish.",
      "Each match is worth 1 point to the winning team. A halved match is half a point each.",
      "Add up the points. The team with more wins the trophy.",
    ],
    tips: ["On PinPals, Match Day Fun keeps the team score live on everyone's phone and lock screen."],
    related: ["singles-matchplay", "fourball-matchplay", "foursomes-matchplay"],
    live: true,
    popular: true,
  },

  // ---------------------------------------------------------------- Pairs
  {
    id: "fourball-better-ball",
    name: "Fourball Better Ball",
    code: "BB",
    category: "pairs",
    aka: ["Better ball", "Best ball", "Fourball Stableford", "Fourball strokeplay"],
    blurb: "Own ball each; the better score counts.",
    players: "Pairs",
    scoring: "Points or strokes",
    allowance: "85% of course handicap",
    winner: "Best pair score",
    intro: "Two of you, each with your own ball. On every hole the better of your two scores is the pair's score — usually played as Stableford.",
    steps: [
      "Each player gets 85% of their course handicap.",
      "Both of you play every hole with your own ball.",
      "The better net score (or more Stableford points) of the two is the pair's score for that hole.",
      "Add up the pair's scores. Best total wins.",
    ],
    example: "On the 4th you score 2 points and your partner 3. The pair scores 3.",
    tips: ["Once one of you has a good score in, the other can pick up and save time."],
    ties: COUNTBACK,
    related: ["fourball-matchplay", "aggregate-pairs", "team-stableford"],
    popular: true,
  },
  {
    id: "foursomes",
    name: "Foursomes",
    code: "FO",
    category: "pairs",
    aka: ["Alternate shot", "Scotch foursomes"],
    blurb: "One ball, alternate shots, alternate tees.",
    players: "Pairs",
    scoring: "Points or strokes",
    allowance: "50% of the pair's combined course handicaps",
    winner: "Best pair score",
    intro: "Two players, one ball, taking turns. The purest test of a partnership — and of patience.",
    steps: [
      "Before you start, decide who drives the odd holes. Your partner drives the even holes.",
      "After the drive you take turns hitting the same ball until it's holed.",
      "Penalty strokes don't change the order — the next shot is still your partner's.",
      "One score per hole for the pair. Play it as stroke play, Stableford or matchplay.",
    ],
    example: "Course handicaps 10 and 22 → the pair plays off 16.",
    tips: ["Check which par 3s land on odd and even holes — pick the order to suit whoever's better with the irons."],
    ties: COUNTBACK,
    related: ["scotch-foursomes", "greensomes", "chapman", "foursomes-matchplay"],
    live: true,
    popular: true,
    visual: "alternate",
  },
  {
    id: "scotch-foursomes",
    name: "Scotch Foursomes",
    code: "SC",
    category: "pairs",
    aka: ["Foursomes", "Alternate shot"],
    blurb: "Another name for foursomes — alternate shots.",
    players: "Pairs",
    scoring: "Points or strokes",
    allowance: "50% of the pair's combined course handicaps",
    winner: "Best pair score",
    intro: "In Ireland and Britain, Scotch foursomes is simply foursomes: one ball, alternate shots, alternate tees. Some clubs use the name for a version where both players drive — check the competition rules.",
    steps: [
      "Partners take turns to drive — one the odd holes, one the even.",
      "Then alternate shots with the one ball until it's holed.",
      "If your club plays the both-drive version, it's played as greensomes from the tee.",
    ],
    tips: ["PinPals plays it as foursomes, with the pair off half its combined course handicaps."],
    related: ["foursomes", "greensomes"],
    live: true,
  },
  {
    id: "greensomes",
    name: "Greensomes",
    code: "GR",
    category: "pairs",
    aka: ["Canadian foursomes"],
    blurb: "Both tee off, choose the best, then alternate.",
    players: "Pairs",
    scoring: "Points or strokes",
    allowance: "60% of the lower + 40% of the higher course handicap",
    winner: "Best pair score",
    intro: "The friendlier foursomes. Two drives to choose from takes the sting out of a bad tee shot.",
    steps: [
      "Both partners tee off.",
      "Choose the better drive. Pick up the other ball.",
      "The player whose drive wasn't chosen plays the second shot.",
      "Alternate from there until the ball is holed.",
    ],
    example: "Course handicaps 8 and 20 → 4.8 + 8 = 12.8, so the pair plays off 13.",
    ties: COUNTBACK,
    related: ["foursomes", "gruesomes", "chapman", "greensomes-matchplay"],
    live: true,
    popular: true,
  },
  {
    id: "gruesomes",
    name: "Gruesomes",
    code: "GU",
    category: "pairs",
    aka: ["Bloodsome", "Bloodsomes"],
    blurb: "Opponents pick your worst drive. Brutal.",
    players: "Pairs",
    scoring: "Points, strokes or holes",
    allowance: "Set by the organiser — often as greensomes",
    winner: "Best pair score",
    intro: "Greensomes turned upside down. Both of you drive, but the other side decides which ball you play — and they won't pick the good one.",
    steps: [
      "Both partners tee off.",
      "Your opponents choose which drive you must play — usually the worse one.",
      "The player whose drive wasn't chosen plays the next shot.",
      "Alternate from there until it's holed.",
    ],
    tips: ["Best played as matchplay between two pairs, so there's always someone choosing."],
    related: ["greensomes", "foursomes"],
  },
  {
    id: "chapman",
    name: "Chapman / Pinehurst",
    code: "CH",
    category: "pairs",
    aka: ["Pinehurst", "American foursomes"],
    blurb: "Both drive, swap balls, pick one, alternate.",
    players: "Pairs",
    scoring: "Points or strokes",
    allowance: "60% of the lower + 40% of the higher course handicap",
    winner: "Best pair score",
    intro: "Every player hits at least two shots on every hole, so nobody's a passenger.",
    steps: [
      "Both partners tee off.",
      "Swap: each plays a second shot with the other's ball.",
      "Choose the better of the two balls after the second shots.",
      "Alternate from there — the player who didn't hit that ball's second shot goes next.",
    ],
    related: ["greensomes", "foursomes"],
  },
  {
    id: "aggregate-pairs",
    name: "Aggregate Pairs",
    code: "AG",
    category: "pairs",
    aka: ["Combined pairs", "Aggregate Stableford"],
    blurb: "Add both scores together on every hole.",
    players: "Pairs",
    scoring: "Combined points or strokes",
    allowance: "Usually 95% each — the organiser decides",
    winner: "Best combined total",
    intro: "Better ball's harder cousin. Both scores count on every hole, so you need two good cards, not one.",
    steps: [
      "Each player plays their own ball off their own handicap.",
      "Add both net scores (or both Stableford scores) together on each hole.",
      "The pair's total is the sum over 18 holes.",
    ],
    tips: ["Nowhere to hide — a pairs' Stableford total of 72 means both played to handicap."],
    related: ["fourball-better-ball", "team-stableford"],
  },
  {
    id: "patsome",
    name: "Patsome",
    code: "PA",
    category: "pairs",
    aka: ["Six-six-six", "Mixed format"],
    blurb: "Six holes each of fourball, greensomes, foursomes.",
    players: "Pairs",
    scoring: "Points or strokes",
    allowance: "Set by the organiser",
    winner: "Best pair score",
    intro: "Three formats in one round, getting harder as you go — a favourite for mixed and society days.",
    steps: [
      "Holes 1–6: fourball better ball — own ball, better score counts.",
      "Holes 7–12: greensomes — both drive, pick one, alternate.",
      "Holes 13–18: foursomes — alternate drives and shots.",
      "Add the pair's scores from all three sections.",
    ],
    related: ["fourball-better-ball", "greensomes", "foursomes"],
  },

  // ---------------------------------------------------------------- Team
  {
    id: "texas-scramble",
    name: "Texas Scramble",
    code: "TS",
    category: "team",
    aka: ["Scramble", "Texas"],
    blurb: "All tee off, play the best shot every time.",
    players: "Teams of 2–4",
    scoring: "Net strokes",
    allowance: "4s: 25% / 20% / 15% / 10%. 3s: 30% / 20% / 10%. 2s: 35% / 15%",
    winner: "Lowest net team score",
    intro: "The society classic. Everyone plays, the best shot counts, and nobody has a bad day.",
    steps: [
      "Everyone in the team tees off.",
      "Choose the best ball. Everyone plays from within a club-length of it — no nearer the hole, and in the same kind of ground (fairway stays fairway, bunker stays bunker). On the green, within a putter-head.",
      "Repeat every shot until the ball's holed. One team score per hole.",
      "Each player must have a set number of drives used — usually 3 or 4 each over 18 holes.",
    ],
    example: "Course handicaps 6, 12, 18 and 24 → 1.5 + 2.4 + 2.7 + 2.4 = 9. The team plays off 9.",
    tips: ["PinPals tracks drives used and warns you when someone's running short. Live scoring takes teams of two or four.", "Shares go lowest handicap to highest: the 25% is always the best player's."],
    ties: "Level? Most clubs use the countback on the back nine, then the last six, three and one — taking off half, a third, a sixth and an eighteenth of the team handicap in turn.",
    related: ["florida-scramble", "ambrose", "shamble", "waltz"],
    live: true,
    popular: true,
    visual: "scramble",
  },
  {
    id: "florida-scramble",
    name: "Florida Scramble",
    code: "FD",
    category: "team",
    aka: ["Step-aside scramble"],
    blurb: "Scramble — but the chosen player sits out.",
    players: "Teams of 3–4",
    scoring: "Net strokes",
    allowance: "Set by the organiser — often as Texas scramble",
    winner: "Lowest net team score",
    intro: "A scramble where a good shot earns you a rest. It keeps the best player from carrying the team.",
    steps: [
      "Everyone tees off. Choose the best ball.",
      "The player whose shot was chosen sits out the next shot.",
      "Everyone else plays from there, choose again, and the new chosen player sits out.",
      "Continue until the ball's holed.",
    ],
    related: ["texas-scramble", "ambrose"],
  },
  {
    id: "ambrose",
    name: "Ambrose",
    code: "AM",
    category: "team",
    aka: ["Australian scramble"],
    blurb: "Scramble with a team handicap off the total.",
    players: "Teams of 2–4",
    scoring: "Net strokes",
    allowance: "Combined handicaps ÷ 8 for a four, ÷ 6 for a three, ÷ 4 for a pair",
    winner: "Lowest net team score",
    intro: "A scramble by another name, popular in Australia — the difference is how the team handicap is worked out.",
    steps: [
      "Play as a scramble: everyone tees off, pick the best, all play from there.",
      "Add the team's handicaps together.",
      "Divide by 8 for a team of four, 6 for a three, or 4 for a pair. That's the team handicap.",
      "Take it off the team's gross score.",
    ],
    related: ["texas-scramble", "florida-scramble"],
  },
  {
    id: "shamble",
    name: "Shamble",
    code: "SH",
    category: "team",
    aka: ["Bramble", "Texas shamble"],
    blurb: "Best drive, then everyone plays their own ball.",
    players: "Teams of 2–4",
    scoring: "Best one or two scores",
    allowance: "Set by the organiser",
    winner: "Lowest net team score",
    intro: "Half scramble, half proper golf. The team shares the best drive, then each player is on their own.",
    steps: [
      "Everyone tees off. Choose the best drive.",
      "Everyone places a ball there and plays it into the hole.",
      "The best one or two scores count for the team — agree which before you start.",
    ],
    related: ["texas-scramble", "team-stableford"],
  },
  {
    id: "team-stableford",
    name: "Team Stableford",
    code: "TB",
    category: "team",
    aka: ["Best 2 from 4", "Best two of four", "Society Stableford"],
    blurb: "Best two points of four count on each hole.",
    players: "Teams of 4",
    scoring: "Points",
    allowance: "Best 1 of 4: 75%. Best 2 of 4: 85%. Best 3 of 4: 100%",
    winner: "Most team points",
    intro: "Everyone plays their own ball and their own Stableford. On each hole, the best scores in the team are added together.",
    steps: [
      "All four play their own ball off their allowance.",
      "On each hole, take the best two Stableford scores in the team (or one, or three — agree first).",
      "Add them up for the team's score for that hole.",
      "Most team points over 18 holes wins.",
    ],
    tips: ["Popular for a big society: everyone keeps their own score, and a bad hole rarely costs the team."],
    ties: COUNTBACK,
    related: ["stableford", "fourball-better-ball", "waltz"],
  },
  {
    id: "waltz",
    name: "Waltz (1-2-3)",
    code: "WZ",
    category: "team",
    aka: ["Cha Cha Cha", "1-2-3", "Rumba"],
    blurb: "1, then 2, then 3 scores count, in turn.",
    players: "Teams of 3–4",
    scoring: "Points",
    allowance: "Set by the organiser",
    winner: "Most team points",
    intro: "A team Stableford in three-four time. How many scores count changes from hole to hole.",
    steps: [
      "Everyone plays their own ball and scores Stableford points.",
      "Hole 1: the best one score counts. Hole 2: the best two. Hole 3: the best three.",
      "Repeat the 1-2-3 pattern for the rest of the round.",
      "Add up the team's counting scores.",
    ],
    related: ["team-stableford", "yellow-ball"],
  },
  {
    id: "yellow-ball",
    name: "Yellow Ball / Lone Ranger",
    code: "YB",
    category: "team",
    aka: ["Lone Ranger", "Money ball", "Pink ball"],
    blurb: "Each hole one player's score must count.",
    players: "Teams of 4",
    scoring: "Points or strokes",
    allowance: "Set by the organiser",
    winner: "Best team score",
    intro: "Everyone takes a turn carrying the team. A yellow ball passes round the group, and its score always counts.",
    steps: [
      "Players take turns with the yellow ball — one hole each, in rotation.",
      "On each hole the team score is the yellow ball's score plus the best of the other three.",
      "Lose the yellow ball and, in most versions, the team loses that part of the score — or the whole bonus.",
    ],
    tips: ["Many societies give a separate prize for the team that brings the yellow ball home."],
    related: ["team-stableford", "waltz"],
  },
  {
    id: "am-am",
    name: "Am-Am / Pro-Am",
    code: "AA",
    category: "team",
    aka: ["Pro-Am", "Am-Am"],
    blurb: "Best one or two scores of the team count.",
    players: "Teams of 4",
    scoring: "Points",
    allowance: "Usually 85% for best 2 of 4 — the organiser decides",
    winner: "Most team points",
    intro: "A team Stableford for open days. In a Pro-Am one of the four is a professional; in an Am-Am everyone's an amateur.",
    steps: [
      "Teams of four, everyone on their own ball.",
      "On each hole the best one or two Stableford scores count — the entry sheet says which.",
      "The professional usually plays off scratch and counts gross.",
      "Add the counting scores for the team total.",
    ],
    related: ["team-stableford", "fourball-better-ball"],
  },

  // ---------------------------------------------------------------- Side games
  {
    id: "skins",
    name: "Skins",
    code: "SK",
    category: "side",
    aka: ["Skins game", "Carry-overs"],
    blurb: "Win a hole outright to take the skin.",
    players: "2–4",
    scoring: "Skins won",
    allowance: "Full shots, or none — agree on the 1st tee",
    winner: "Most skins",
    intro: "Every hole has a prize. Win it outright and it's yours; tie and it rolls on to the next hole, getting bigger.",
    steps: [
      "Agree what each hole's skin is worth.",
      "The lowest score on a hole, on its own, wins the skin.",
      "Any tie for lowest and the skin carries over to the next hole.",
      "Skins still carried at the 18th are settled with a play-off — or split.",
    ],
    related: ["nassau", "modified-stableford"],
  },
  {
    id: "nassau",
    name: "Nassau",
    code: "NS",
    category: "side",
    aka: ["Front, back and total"],
    blurb: "Three bets: front nine, back nine, overall.",
    players: "2–4",
    scoring: "Three matches",
    allowance: "As matchplay",
    winner: "Each of the three matches",
    intro: "Three matches in one round, so a bad front nine never ends your day.",
    steps: [
      "Play as matchplay — singles or better ball.",
      "Match 1 is holes 1–9. Match 2 is holes 10–18. Match 3 is all 18.",
      "Each is settled on its own.",
      "Optional \"presses\": a side two down can start a new side match for the remaining holes.",
    ],
    related: ["skins", "singles-matchplay"],
  },
  {
    id: "wolf",
    name: "Wolf",
    code: "WF",
    category: "side",
    blurb: "Rotating Wolf picks a partner — or goes alone.",
    players: "4",
    scoring: "Points",
    allowance: "Full shots, or none — agree first",
    winner: "Most points",
    intro: "Shifting alliances, hole by hole. One player is the Wolf, and the Wolf decides who's on whose side.",
    steps: [
      "Set a playing order. The Wolf rotates each hole and tees off first.",
      "After each other player's drive, the Wolf can claim them as partner — but must decide before the next one hits.",
      "Or go Lone Wolf, one against three, for double points.",
      "Better ball of each side wins the hole and its points.",
    ],
    tips: ["On the last two holes, the player who's last in points is usually the Wolf."],
    related: ["sixes", "vegas"],
  },
  {
    id: "bingo-bango-bongo",
    name: "Bingo Bango Bongo",
    code: "BG",
    category: "side",
    aka: ["Bingle Bangle Bungle"],
    blurb: "First on, closest, first in. A point each.",
    players: "3–4",
    scoring: "Points",
    allowance: "None needed",
    winner: "Most points",
    intro: "Three points on every hole, and a bad golfer can win any of them. Order of play matters — farthest from the hole always plays first.",
    steps: [
      "Bingo: first ball on the green.",
      "Bango: once all balls are on the green, whoever is closest to the hole.",
      "Bongo: first ball in the hole.",
      "One point each. Most points after 18 wins.",
    ],
    related: ["dots", "nearest-pin"],
  },
  {
    id: "snake",
    name: "Snake",
    code: "SN",
    category: "side",
    blurb: "Three-putt and you hold the snake.",
    players: "2–4",
    scoring: "Who holds it at the end",
    allowance: "None needed",
    winner: "Anyone but the snake holder",
    intro: "A putting side game with a sting. The snake passes to whoever three-putts most recently.",
    steps: [
      "The first player to three-putt takes the snake.",
      "It passes to the next person who three-putts.",
      "Whoever holds the snake after the 18th pays out — or buys the round.",
    ],
    tips: ["Some groups let the snake's value grow every time it changes hands."],
    related: ["dots", "skins"],
  },
  {
    id: "sixes",
    name: "Sixes (Round Robin)",
    code: "6S",
    category: "side",
    aka: ["Round robin", "Hollywood"],
    blurb: "Partners change every six holes.",
    players: "4",
    scoring: "Three short matches",
    allowance: "As fourball",
    winner: "Most matches won",
    intro: "Everyone partners everyone. Three six-hole better-ball matches, with new teams for each.",
    steps: [
      "Holes 1–6: A and B against C and D.",
      "Holes 7–12: A and C against B and D.",
      "Holes 13–18: A and D against B and C.",
      "Each six-hole match is better-ball matchplay. Count the matches you win.",
    ],
    related: ["wolf", "fourball-matchplay"],
  },
  {
    id: "vegas",
    name: "Vegas",
    code: "VG",
    category: "side",
    aka: ["Las Vegas"],
    blurb: "Pair scores form a two-digit number.",
    players: "4 — two pairs",
    scoring: "Points",
    allowance: "Full shots, or none — agree first",
    winner: "Most points",
    intro: "A pairs game that punishes a blow-up hole hard, because your scores become one number.",
    steps: [
      "On each hole, put each pair's two scores together, lower first: a 4 and a 5 make 45.",
      "The difference between the two pairs' numbers is the points won: 45 v 56 is 11 points.",
      "Optional: a birdie flips the other pair's number, high first.",
      "Most points after 18 wins.",
    ],
    tips: ["A 10 or more goes first: a 4 and a 10 make 104. Ouch."],
    related: ["wolf", "nines"],
  },
  {
    id: "nines",
    name: "Nines",
    code: "9P",
    category: "side",
    aka: ["Nine-point", "5-3-1"],
    blurb: "Nine points shared out on every hole.",
    players: "3",
    scoring: "Points",
    allowance: "Full shots, or none — agree first",
    winner: "Most points",
    intro: "The best game for a three-ball. Nine points go out on every hole, depending on where you finish.",
    steps: [
      "Lowest score gets 5 points, middle 3, highest 1.",
      "Two tie for lowest: 4 each and 1 to the third. Two tie for highest: 5 to the winner, 2 each to the others.",
      "All three tie: 3 points each.",
      "Most points after 18 wins.",
    ],
    related: ["vegas", "skins"],
  },
  {
    id: "rabbit",
    name: "Rabbit",
    code: "RB",
    category: "side",
    blurb: "Win a hole to catch the rabbit; hold it at 9 & 18.",
    players: "2–4",
    scoring: "Who holds it",
    allowance: "Full shots, or none — agree first",
    winner: "Rabbit holder after the 9th and 18th",
    intro: "A chase round the course. The rabbit starts loose, and you catch it by winning a hole outright.",
    steps: [
      "Win a hole outright and you catch the rabbit.",
      "When someone else wins a hole outright, the rabbit is set free — catch it again by winning the next one.",
      "Whoever holds the rabbit after the 9th wins the front nine. It's loose again for the back.",
      "Whoever holds it after the 18th wins the back nine.",
    ],
    related: ["skins", "snake"],
  },
  {
    id: "hammer",
    name: "Hammer",
    code: "HM",
    category: "side",
    blurb: "Double the stakes mid-hole. Accept or concede.",
    players: "2 sides",
    scoring: "Holes won, doubled",
    allowance: "As matchplay",
    winner: "Most points",
    intro: "Matchplay with nerve. At any point in a hole, a side can drop the hammer and double what it's worth.",
    steps: [
      "Play matchplay, with each hole worth one point to start.",
      "At any moment, a side can \"hammer\" — doubling the hole's value.",
      "The other side either accepts, or concedes the hole at its value before the hammer.",
      "Once accepted, they can hammer back.",
    ],
    related: ["nassau", "skins"],
  },
  {
    id: "dots",
    name: "Dots (Sandies, Greenies)",
    code: "DT",
    category: "side",
    aka: ["Junk", "Garbage", "Trash"],
    blurb: "Points for the good bits of every hole.",
    players: "2–4",
    scoring: "Points",
    allowance: "None needed",
    winner: "Most dots",
    intro: "Little rewards scattered round the course, played alongside whatever else you're playing.",
    steps: [
      "Greenie: on a par 3, closest to the pin in one, and you make par or better.",
      "Sandy: par or better after being in a bunker on the hole.",
      "Barkie: par or better after hitting a tree.",
      "Chippie: holing out from off the green. Birdies usually earn a dot too.",
      "Agree the list on the 1st tee. Most dots wins.",
    ],
    related: ["bingo-bango-bongo", "snake", "nearest-pin"],
  },
  {
    id: "nearest-pin",
    name: "Nearest the Pin & Long Drive",
    code: "NP",
    category: "side",
    aka: ["Closest to the pin", "NTP", "Longest drive"],
    blurb: "Prizes on the par 3s and a chosen fairway.",
    players: "Any",
    scoring: "Measured",
    allowance: "None",
    winner: "Closest, and longest",
    intro: "The two prizes at almost every society outing, played alongside the main competition.",
    steps: [
      "Nearest the pin: on a chosen par 3, the tee shot that finishes on the green closest to the hole wins.",
      "Longest drive: on a chosen hole, the longest drive that finishes on the fairway wins.",
      "Mark the leader with a marker or card, with name and distance, for the groups behind.",
    ],
    tips: ["On PinPals, the society organiser can set which holes in the event — the hole map measures the distances."],
    related: ["dots", "bingo-bango-bongo"],
    popular: true,
  },
];

export function categoryOf(id: FormatCategory) {
  return FORMAT_CATEGORIES.find((c) => c.id === id) ?? FORMAT_CATEGORIES[0];
}

export function formatById(id: string): GameFormat | undefined {
  return GAME_FORMATS.find((f) => f.id === id);
}

export function formatsIn(category: FormatCategory): GameFormat[] {
  return GAME_FORMATS.filter((f) => f.category === category);
}

/** The most played, in the order they appear above. */
export function popularFormats(): GameFormat[] {
  return GAME_FORMATS.filter((f) => f.popular);
}

export function relatedFormats(format: GameFormat): GameFormat[] {
  return (format.related ?? []).map(formatById).filter((f): f is GameFormat => Boolean(f));
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Search by name, other names, the one-liner and the explanation. Every word
 * typed must appear somewhere; a name match ranks above a match in the text.
 */
export function searchFormats(query: string): GameFormat[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (words.length === 0) return GAME_FORMATS.slice();
  const scored: { f: GameFormat; score: number; i: number }[] = [];
  GAME_FORMATS.forEach((f, i) => {
    const name = norm([f.name, ...(f.aka ?? []), ...(f.searchAlso ?? [])].join(" "));
    const text = norm([f.blurb, f.intro, categoryOf(f.category).label, f.scoring, ...f.steps].join(" "));
    // The whole phrase in a name ("cha cha cha") beats its words scattered.
    let score = name.includes(words.join(" ")) ? 20 : 0;
    for (const w of words) {
      if (name.includes(w)) score += name.split(" ").some((t) => t.startsWith(w)) ? 10 : 6;
      else if (text.includes(w)) score += 1;
      else return;
    }
    scored.push({ f, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.f);
}
