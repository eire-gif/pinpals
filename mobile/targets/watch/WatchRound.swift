import Foundation

// PinPals for Apple Watch (Oct 2026): the round the iPhone hands the watch.
//
// The iPhone sends the live round it's showing on the lock screen card
// (modules/live-activity/ios/PinPalsWatchLink.swift) as one JSON string in
// the watch's application context — always the latest, delivered even when
// the watch app isn't open. The golf here mirrors the lock screen card
// (targets/widget/_shared/LiveScoreShared.swift): net par to start, Stableford
// points, the next hole with no score. Keep the two in step.

struct WatchHole: Codable, Hashable {
  /** Hole number. */
  let n: Int
  let par: Int
  /** Stroke index; nil when the card hasn't got it. */
  let si: Int?
  /** The player's shots on this hole (from their playing handicap). */
  let shots: Int
}

/** A hole's green centre and tee as [lat, lng]; nil where it isn't mapped. */
struct WatchSpot: Codable, Hashable {
  let n: Int
  let green: [Double]?
  let tee: [Double]?
  /** Watch v2: front and back of the green, and the hole's hazards (lock-screen-rules.ts). */
  var front: [Double]?
  var back: [Double]?
  var hz: [WatchHazard]?
}

/** A hazard or marker: its kind ("water", "fairway_bunker"…), a name, and where. */
struct WatchHazard: Codable, Hashable {
  let k: String
  let l: String
  let p: [Double]
}

// MARK: - Watch v2: what else the iPhone sends (lock-screen-rules.ts WatchExtras)

/** One player on the group page. */
struct WatchPlayer: Codable, Hashable {
  let id: Int
  let name: String
  let me: Bool
  /** Shots received on each hole, in the card's order. */
  let shots: [Int]
  /** Saved scores, hole number → strokes. 0 = picked up. */
  var strokes: [String: Int]
}

struct WatchWind: Codable, Hashable {
  let kmh: Double
  /** Where it blows FROM, degrees from north. */
  let from: Double
  let at: String
}

struct WatchPremium: Codable, Hashable {
  let map: Bool
  let playsLike: Bool
}

struct WatchExtras: Codable, Hashable {
  /** nil = no group page (a shared card, or on your own). */
  var group: [WatchPlayer]?
  /** Competition mode: distances only (Rule 4.3). */
  let competition: Bool
  let premium: WatchPremium
  /** nil when unknown, and always in a competition. */
  let wind: WatchWind?
  /** GET /api/widget/live/board. */
  let board: String?
}

struct WatchRound: Codable, Hashable {
  let roundId: Int
  let course: String
  /** "points" (Stableford), "stroke" or "match". */
  let format: String
  let holes: [WatchHole]
  /** POST /api/widget/live/score, and the member's key for this round. */
  var api: String?
  var token: String?
  var playerId: Int?
  /** The hole the iPhone is on. */
  var hole: Int
  /** Saved scores, hole number → strokes. 0 = picked up. */
  var strokes: [String: Int]
  /** From the app: "2nd of 4", "2 UP". */
  var status: String?
  var spots: [WatchSpot]?
  var finished: Bool?
  /** The final line once finished. */
  var summary: String?
  /** When the iPhone sent this (seconds since 1970). */
  var sentAt: Double?
  /** Watch v2. nil from an iPhone app older than v2. */
  var watch: WatchExtras?
}

extension WatchRound {
  func info(_ n: Int) -> WatchHole? { holes.first { $0.n == n } }

  var isFinished: Bool { finished == true }

  /** What a hole's number starts at: par plus the player's shots, as in the app. */
  func netPar(_ n: Int) -> Int {
    guard let h = info(n) else { return 4 }
    return h.par + h.shots
  }

  func score(_ n: Int) -> Int? { strokes[String(n)] }

  /** Stableford points; picked up (0 or nil) scores none. */
  func points(_ s: Int?, _ n: Int) -> Int {
    guard let h = info(n), let s = s, s > 0 else { return 0 }
    return max(0, h.par + h.shots + 2 - s)
  }

  var allIn: Bool { holes.allSatisfy { strokes[String($0.n)] != nil } }

  /** "Net par · 2 pts", "Bogey", "Picked up". */
  func describe(_ s: Int?, _ n: Int) -> String {
    guard let h = info(n) else { return "" }
    guard let s = s, s > 0 else { return format == "points" ? "Picked up · NR · 0 pts" : "Picked up · No return" }
    let net = h.shots > 0
    let diff = s - (h.par + h.shots)
    let word: String
    switch diff {
    case ...(-3): word = net ? "Net albatross" : "Albatross"
    case -2: word = net ? "Net eagle" : "Eagle"
    case -1: word = net ? "Net birdie" : "Birdie"
    case 0: word = net ? "Net par" : "Par"
    case 1: word = net ? "Net bogey" : "Bogey"
    case 2: word = net ? "Net double" : "Double bogey"
    default: word = net ? "Net +\(diff)" : "+\(diff)"
    }
    guard format == "points" else { return word }
    let p = points(s, n)
    return "\(word) · \(p) \(p == 1 ? "pt" : "pts")"
  }

  /** "5 · 2 pts", "picked up". */
  func short(_ s: Int?, _ n: Int) -> String {
    guard let s = s, s > 0 else { return "NR" }
    guard format == "points" else { return "\(s)" }
    let p = points(s, n)
    return "\(s) · \(p) \(p == 1 ? "pt" : "pts")"
  }

  /** "18 pts · thru 6", "Net +2 · thru 6", "Thru 6". */
  var total: String {
    let thru = strokes.count
    if thru == 0 { return "Hole \(holes.first?.n ?? 1) next" }
    switch format {
    case "points":
      let pts = strokes.reduce(0) { $0 + points($1.value, Int($1.key) ?? 0) }
      return "\(pts) pts · thru \(thru)"
    case "stroke":
      // A picked-up hole counts net double bogey, as on the app's card.
      let net = strokes.reduce(0) { sum, entry in
        let np = netPar(Int(entry.key) ?? 0)
        return sum + (entry.value > 0 ? entry.value : np + 2) - np
      }
      return "Net \(net == 0 ? "E" : net > 0 ? "+\(net)" : "\(net)") · thru \(thru)"
    default:
      return "Thru \(thru)"
    }
  }

  /** The next hole after `n` with no score, going round the card. */
  func nextHole(after n: Int) -> Int? {
    let order = holes.map(\.n)
    guard let i = order.firstIndex(of: n) else { return order.first { strokes[String($0)] == nil } }
    let rest = Array(order[(i + 1)...]) + Array(order[..<i])
    return rest.first { strokes[String($0)] == nil }
  }

  /** Where to start: the iPhone's hole, or the next one without a score. */
  var startHole: Int {
    if strokes[String(hole)] == nil, info(hole) != nil { return hole }
    return nextHole(after: hole) ?? hole
  }

  var competition: Bool { watch?.competition ?? false }
  var mapAllowed: Bool { watch?.premium.map ?? true }
  var playsLikeAllowed: Bool { (watch?.premium.playsLike ?? true) && !competition }
  var group: [WatchPlayer]? {
    guard let g = watch?.group, g.count > 1 else { return nil }
    return g
  }
  func spot(_ n: Int) -> WatchSpot? { spots?.first { $0.n == n } }
  /** A player's shots on hole `n` (from their position on the card). */
  func shots(_ p: WatchPlayer, _ n: Int) -> Int {
    guard let i = holes.firstIndex(where: { $0.n == n }), p.shots.indices.contains(i) else { return 0 }
    return p.shots[i]
  }

  func neighbour(of n: Int, by step: Int) -> Int? {
    let order = holes.map(\.n)
    guard let i = order.firstIndex(of: n) else { return nil }
    let j = i + step
    return order.indices.contains(j) ? order[j] : nil
  }
}

// MARK: - The distance to the green

enum WatchDistance {
  static func bearing(_ a: [Double], _ b: [Double]) -> Double {
    let la1 = a[0] * .pi / 180, la2 = b[0] * .pi / 180, dLng = (b[1] - a[1]) * .pi / 180
    let y = sin(dLng) * cos(la2)
    let x = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dLng)
    return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
  }

  static func yards(_ metres: Double) -> Int { Int((metres / metresPerYard).rounded()) }

  /** Where distances are measured from on hole `n`: the member when on the hole, else the tee. */
  static func origin(_ round: WatchRound, hole n: Int, fix: [Double]?) -> (point: [Double], fromTee: Bool)? {
    guard let spot = round.spot(n), let green = spot.green, green.count == 2 else { return nil }
    if let fix = fix, metres(fix, green) <= onHoleMetres { return (fix, false) }
    if let tee = spot.tee, tee.count == 2 { return (tee, true) }
    return nil
  }

  /** Front, centre and back in yards (front and back nil where unmapped). */
  static func greenYards(_ round: WatchRound, hole n: Int, fix: [Double]?) -> (front: Int?, centre: Int, back: Int?, fromTee: Bool)? {
    guard let spot = round.spot(n), let green = spot.green, let o = origin(round, hole: n, fix: fix) else { return nil }
    let f = spot.front.flatMap { $0.count == 2 ? yards(metres(o.point, $0)) : nil }
    let b = spot.back.flatMap { $0.count == 2 ? yards(metres(o.point, $0)) : nil }
    return (f, yards(metres(o.point, green)), b, o.fromTee)
  }

  /**
   * Hazards still in play, nearest first: those nearer the green than the
   * member is (hole-geo.ts hazardsAheadM — markers and doglegs left out).
   */
  static func hazardsAhead(_ round: WatchRound, hole n: Int, fix: [Double]?) -> [(hazard: WatchHazard, yards: Int)] {
    guard let spot = round.spot(n), let green = spot.green, let o = origin(round, hole: n, fix: fix) else { return [] }
    let toGreen = metres(o.point, green)
    return (spot.hz ?? [])
      .filter { $0.p.count == 2 && !$0.k.hasPrefix("marker_") && $0.k != "dogleg" }
      .filter { metres($0.p, green) < toGreen }
      .map { ($0, yards(metres(o.point, $0.p))) }
      .sorted { $0.1 < $1.1 }
  }

  /** A point `distance` metres from `from` on `bearing` (hole-geo.ts destination). */
  static func destination(_ from: [Double], bearing: Double, metres distance: Double) -> [Double] {
    let r = 6_371_000.0, d = distance / r, b = bearing * .pi / 180
    let la = from[0] * .pi / 180, lo = from[1] * .pi / 180
    let la2 = asin(sin(la) * cos(d) + cos(la) * sin(d) * cos(b))
    let lo2 = lo + atan2(sin(b) * sin(d) * cos(la), cos(d) - sin(la) * sin(la2))
    return [la2 * 180 / .pi, lo2 * 180 / .pi]
  }

  /** Where the target starts: a drive (210 m) toward the green, or nil when the green is within a drive (hole-geo.ts defaultAim). */
  static func defaultAim(from: [Double], green: [Double]) -> [Double]? {
    let d = metres(from, green)
    guard d > 240 else { return nil }
    let t = min(210, d - 80) / d
    return [from[0] + (green[0] - from[0]) * t, from[1] + (green[1] - from[1]) * t]
  }
}

// MARK: - Plays like (wind.ts — keep the two in step)

enum WatchWindMaths {
  static let kmhPerMph = 1.609344

  /** Head (+) or tail (−) wind along a shot played on `shotBearing`, in mph. */
  static func headMph(_ wind: WatchWind, shotBearing: Double) -> Double {
    let mph = wind.kmh / kmhPerMph
    guard mph >= 3 else { return 0 }
    var rel = (wind.from - shotBearing + 180).truncatingRemainder(dividingBy: 360)
    if rel < 0 { rel += 360 }
    rel -= 180
    return mph * cos(rel * .pi / 180)
  }

  /** 1% per mph into, half that behind; capped −15% / +30% (wind.ts playsLikeM). */
  static func playsLike(_ distance: Int, headMph: Double) -> Int {
    let pct = headMph >= 0 ? 0.01 * headMph : 0.005 * headMph
    return Int((Double(distance) * (1 + max(-0.15, min(0.3, pct)))).rounded())
  }

  /** "Into you", "Behind you", "Across", "Calm" — never used in a competition. */
  static func along(_ wind: WatchWind, shotBearing: Double) -> String {
    let mph = wind.kmh / kmhPerMph
    guard mph >= 3 else { return "Calm" }
    let head = headMph(wind, shotBearing: shotBearing)
    var rel = (wind.from - shotBearing + 180).truncatingRemainder(dividingBy: 360)
    if rel < 0 { rel += 360 }
    let cross = mph * sin((rel - 180) * .pi / 180)
    if abs(head) >= abs(cross) * 0.58 { return head > 0 ? "Into" : "Behind" }
    return "Across"
  }
}

// v1: the centre of the green, for the score page and the lock screen.
extension WatchDistance {
  /** Further than this from the green, the member isn't on the hole: show its length from the tee (hole-geo.ts ON_HOLE_RADIUS_M). */
  static let onHoleMetres = 750.0
  static let metresPerYard = 0.9144

  static func metres(_ a: [Double], _ b: [Double]) -> Double {
    let r = 6_371_000.0
    let lat1 = a[0] * .pi / 180, lat2 = b[0] * .pi / 180
    let dLat = (b[0] - a[0]) * .pi / 180, dLng = (b[1] - a[1]) * .pi / 180
    let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * r * asin(min(1, sqrt(h)))
  }

  /** Yards and where from ("you" / "tee") for hole `n`, or nils when the hole isn't mapped. */
  static func measure(_ round: WatchRound, hole n: Int, from fix: [Double]?) -> (Int?, String?) {
    guard let spot = round.spots?.first(where: { $0.n == n }), let green = spot.green, green.count == 2 else { return (nil, nil) }
    if let fix = fix {
      let d = metres(fix, green)
      if d <= onHoleMetres { return (Int((d / metresPerYard).rounded()), "you") }
    }
    if let tee = spot.tee, tee.count == 2 { return (Int((metres(tee, green) / metresPerYard).rounded()), "tee") }
    return (nil, nil)
  }
}
