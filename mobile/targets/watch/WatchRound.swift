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

  func neighbour(of n: Int, by step: Int) -> Int? {
    let order = holes.map(\.n)
    guard let i = order.firstIndex(of: n) else { return nil }
    let j = i + step
    return order.indices.contains(j) ? order[j] : nil
  }
}

// MARK: - The distance to the green

enum WatchDistance {
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
