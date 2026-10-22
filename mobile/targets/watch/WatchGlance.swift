import Foundation
import WidgetKit

// Watch v2 (claude/watch-v2.md): what the face complications and the Smart
// Stack show (targets/watch-widget). The watch app writes a small summary of
// the round into the App Group each time the hole, score or distance changes;
// the complication reads it. WidgetKit limits how often a complication may be
// refreshed, so this asks only on a new hole or score, a 5-yard change, or a
// minute gone by.

struct WatchGlanceData: Codable, Equatable {
  /** false = no live round: the complication shows the PinPals flag. */
  let live: Bool
  let course: String
  let hole: Int
  let par: Int
  /** Yards to the centre of the green; nil when the hole isn't mapped. */
  let yards: Int?
  /** "18 pts · thru 6", or the standing. */
  let line: String
  /** Tee to green, 0 to 1, for the Wear-style progress ring. */
  let progress: Double?
  let at: Double
}

enum WatchGlance {
  static let appGroup = "group.ie.pinpals.app"
  static let key = "watchGlance"
  static let kind = "PinPalsRound"

  private static var last: WatchGlanceData?
  private static var lastReload = Date.distantPast

  @MainActor
  static func write(_ round: WatchRound?, hole: Int?, yards: Int?) {
    let data: WatchGlanceData
    if let r = round, !r.isFinished, let n = hole, let info = r.info(n) {
      var progress: Double? = nil
      if let y = yards, let spot = r.spot(n), let tee = spot.tee, let green = spot.green, tee.count == 2, green.count == 2 {
        let length = WatchDistance.metres(tee, green) / WatchDistance.metresPerYard
        if length > 0 { progress = max(0, min(1, 1 - Double(y) / length)) }
      }
      data = WatchGlanceData(live: true, course: r.course, hole: n, par: info.par, yards: yards, line: r.status ?? r.total, progress: progress, at: Date().timeIntervalSince1970)
    } else {
      data = WatchGlanceData(live: false, course: "", hole: 0, par: 0, yards: nil, line: "", progress: nil, at: Date().timeIntervalSince1970)
    }
    let before = last
    last = data
    if let encoded = try? JSONEncoder().encode(data) {
      UserDefaults(suiteName: appGroup)?.set(encoded, forKey: key)
    }
    let changed: Bool = {
      guard let b = before else { return true }
      if b.live != data.live || b.hole != data.hole || b.line != data.line { return true }
      if let x = b.yards, let y = data.yards { return abs(x - y) >= 5 || Date().timeIntervalSince(lastReload) > 60 }
      return b.yards != data.yards
    }()
    guard changed else { return }
    lastReload = Date()
    WidgetCenter.shared.reloadTimelines(ofKind: kind)
  }
}
