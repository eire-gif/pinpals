import ActivityKit
import AppIntents
import Foundation

// Scoring from the lock screen (Oct 2026): the PinPals Live Activity.
//
// This file is in `_shared`, so @bacons/apple-targets compiles it into BOTH
// the app and the widget extension:
//   - the widget extension draws the card (LiveScoreLiveActivity.swift) and
//     needs the attributes and the intents its buttons run;
//   - the app needs the same intents, because a LiveActivityIntent runs in
//     the APP's process (launched in the background, phone still locked) —
//     which is where ActivityKit lets us update the card — and it needs the
//     bridge the app's JavaScript starts and updates the card through
//     (modules/live-activity calls PinPalsLiveActivityBridge by name).
//
// Golf here is deliberately tiny: the app works out each hole's par and the
// player's shots (live-scoring.ts) and hands them over when the card starts.
// The card adds strokes, counts Stableford points and moves to the next hole.
// Positions and match status come from the app, and are cleared as soon as a
// score goes in from the lock screen so they're never shown stale.
//
// Voice scoring (Oct 2026, claude/voice-scoring.md) adds two links to the
// card — a mic that opens the round on the card's hole already listening, and
// the distance to the green, which opens the hole map. The distance comes
// from location updates the app's JavaScript started (lock-screen-location.ts):
// each fix arrives here (setLocation), and the sum is done against the hole
// the card is on now, which may have moved on from the lock screen.
//
// Saving: every score is kept in the App Group first, then sent to
// POST /api/widget/live/score with a key for this member and round. No
// signal → it stays queued, is retried on the next tap, and the app sends it
// too the next time it opens (takePending). A score is never lost to a
// links-course sea fog.

let liveScoreAppGroup = "group.ie.pinpals.app"

// MARK: - The card's data

struct LiveScoreHole: Codable, Hashable {
  /** Hole number. */
  let n: Int
  let par: Int
  /** Stroke index; nil when the card hasn't got it (then no shots are given). */
  let si: Int?
  /** The player's shots on this hole (from their playing handicap). */
  let shots: Int
}

@available(iOS 16.1, *)
struct LiveScoreAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /** The hole on the card now. */
    var hole: Int
    /** Strokes chosen with − / + but not saved yet. nil = showing net par. */
    var draft: Int?
    /** Saved scores, hole number → strokes. 0 = picked up. */
    var strokes: [String: Int]
    /** "Hole 7 saved · 5 · 2 pts", after a save from the lock screen. */
    var saved: String?
    /** The hole Undo goes back to. */
    var undoHole: Int?
    /** From the app: "2nd of 4", "2 UP". Cleared by a lock screen save. */
    var status: String?
    /** Scores saved on the phone, not yet sent. */
    var waiting: Int
    /** A problem the player needs to act on ("Open PinPals…"). */
    var notice: String?
    var finished: Bool
    /** Undo after the last hole: show the − / + row again although every hole has a score. */
    var editing: Bool
    /** Yards to the centre of the green: from the member when they're on the hole, else the hole's length from the tee. nil = no map. */
    var distance: Int? = nil
    /** "you" or "tee": where `distance` is measured from. */
    var distanceFrom: String? = nil
  }

  let roundId: Int
  let course: String
  /** "points" (Stableford), "stroke" or "match". */
  let format: String
  let holes: [LiveScoreHole]
  /** Opens this round in the app. */
  let url: String
  /** The mic: append the hole number. Opens the round on that hole, listening. nil = voice scoring off. */
  let voiceUrl: String?
  /** The distance: append the hole number. Opens the hole map. nil = hole maps off or no club. */
  let mapUrl: String?
}

@available(iOS 16.1, *)
extension LiveScoreAttributes {
  func info(_ n: Int) -> LiveScoreHole? { holes.first { $0.n == n } }

  /** What a hole's number starts at: par plus the player's shots, as in the app. */
  func netPar(_ n: Int) -> Int {
    guard let h = info(n) else { return 4 }
    return h.par + h.shots
  }

  /** Stableford points; picked up (0 or nil) scores none. */
  func points(_ strokes: Int?, _ n: Int) -> Int {
    guard let h = info(n), let s = strokes, s > 0 else { return 0 }
    return max(0, h.par + h.shots + 2 - s)
  }

  func allIn(_ strokes: [String: Int]) -> Bool {
    holes.allSatisfy { strokes[String($0.n)] != nil }
  }

  /** "Net par · 2 pts", "Bogey", "Picked up · 0 pts". */
  func describe(_ strokes: Int?, _ n: Int) -> String {
    guard let h = info(n) else { return "" }
    guard let s = strokes, s > 0 else { return format == "points" ? "Picked up · NR · 0 pts" : "Picked up · No return" }
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

  /** The saved line: "5 · 2 pts", "picked up". */
  func short(_ strokes: Int?, _ n: Int) -> String {
    guard let s = strokes, s > 0 else { return "NR" }
    guard format == "points" else { return "\(s)" }
    let p = points(s, n)
    return "\(s) · \(p) \(p == 1 ? "pt" : "pts")"
  }

  /** "18 pts · thru 6", "Net +2 · thru 6", "Thru 6". */
  func total(_ strokes: [String: Int]) -> String {
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

  /** "18 pts", "+2", "6": for the Dynamic Island's small corner. */
  func totalShort(_ strokes: [String: Int]) -> String {
    switch format {
    case "points": return "\(strokes.reduce(0) { $0 + points($1.value, Int($1.key) ?? 0) }) pts"
    default: return "Thru \(strokes.count)"
    }
  }

  /** The next hole after `n` with no score, going round the card. */
  func nextHole(after n: Int, strokes: [String: Int]) -> Int? {
    let order = holes.map(\.n)
    guard let i = order.firstIndex(of: n) else { return order.first { strokes[String($0)] == nil } }
    let rest = Array(order[(i + 1)...]) + Array(order[..<i])
    return rest.first { strokes[String($0)] == nil }
  }
}

// MARK: - Saving: the App Group queue and the website

enum LiveScoreStore {
  struct Config: Codable {
    var api: String
    var token: String
    var playerId: Int?
  }

  struct Pending: Codable {
    var roundId: Int
    var playerId: Int?
    var hole: Int
    /** nil = picked up. */
    var strokes: Int?
    var clear: Bool
    var at: Double
  }

  enum Outcome { case sent, retry, unauthorized, finished, rejected }

  private static let lock = NSLock()
  private static let pendingKey = "liveScorePending"
  private static func configKey(_ roundId: Int) -> String { "liveScoreConfig.\(roundId)" }
  private static var defaults: UserDefaults? { UserDefaults(suiteName: liveScoreAppGroup) }

  static func config(_ roundId: Int) -> Config? {
    guard let data = defaults?.data(forKey: configKey(roundId)) else { return nil }
    return try? JSONDecoder().decode(Config.self, from: data)
  }

  static func setConfig(_ c: Config, roundId: Int) {
    if let data = try? JSONEncoder().encode(c) { defaults?.set(data, forKey: configKey(roundId)) }
  }

  static func forget(roundId: Int) {
    defaults?.removeObject(forKey: configKey(roundId))
    defaults?.removeObject(forKey: geometryKey(roundId))
    defaults?.removeObject(forKey: shownKey(roundId))
  }

  // MARK: What the card was last told to show

  private static func shownKey(_ roundId: Int) -> String { "liveScoreShown.\(roundId)" }

  @available(iOS 16.1, *)
  static func setShown(_ state: LiveScoreAttributes.ContentState, roundId: Int) {
    if let data = try? JSONEncoder().encode(state) { defaults?.set(data, forKey: shownKey(roundId)) }
  }

  @available(iOS 16.1, *)
  static func shown(_ roundId: Int) -> LiveScoreAttributes.ContentState? {
    guard let data = defaults?.data(forKey: shownKey(roundId)) else { return nil }
    return try? JSONDecoder().decode(LiveScoreAttributes.ContentState.self, from: data)
  }

  // MARK: Greens and the member's last position, for the distance

  /** A hole's green centre and tee as [lat, lng]; nil where it isn't mapped. */
  struct Spot: Codable {
    let n: Int
    let green: [Double]?
    let tee: [Double]?
  }

  struct Fix: Codable {
    let lat: Double
    let lng: Double
    let at: Double
  }

  private static func geometryKey(_ roundId: Int) -> String { "liveScoreGeometry.\(roundId)" }
  private static let fixKey = "liveScoreLastFix"
  /** An older position says nothing about where the member is now. */
  private static let fixLifetime: Double = 10 * 60

  static func setGeometry(_ spots: [Spot], roundId: Int) {
    if let data = try? JSONEncoder().encode(spots) { defaults?.set(data, forKey: geometryKey(roundId)) }
  }

  static func geometry(_ roundId: Int) -> [Spot] {
    guard let data = defaults?.data(forKey: geometryKey(roundId)) else { return [] }
    return (try? JSONDecoder().decode([Spot].self, from: data)) ?? []
  }

  static func setFix(_ fix: Fix) {
    if let data = try? JSONEncoder().encode(fix) { defaults?.set(data, forKey: fixKey) }
  }

  static func lastFix() -> Fix? {
    guard let data = defaults?.data(forKey: fixKey), let fix = try? JSONDecoder().decode(Fix.self, from: data) else { return nil }
    return Date().timeIntervalSince1970 - fix.at < fixLifetime ? fix : nil
  }

  private static func readPending() -> [Pending] {
    guard let data = defaults?.data(forKey: pendingKey) else { return [] }
    return (try? JSONDecoder().decode([Pending].self, from: data)) ?? []
  }

  private static func writePending(_ items: [Pending]) {
    if items.isEmpty {
      defaults?.removeObject(forKey: pendingKey)
    } else if let data = try? JSONEncoder().encode(Array(items.suffix(80))) {
      defaults?.set(data, forKey: pendingKey)
    }
  }

  /** Keep a score to send; a newer score for the same hole replaces a waiting one. */
  static func enqueue(roundId: Int, hole: Int, strokes: Int?, clear: Bool) {
    lock.lock(); defer { lock.unlock() }
    var items = readPending().filter { !($0.roundId == roundId && $0.hole == hole) }
    items.append(Pending(roundId: roundId, playerId: config(roundId)?.playerId, hole: hole, strokes: strokes, clear: clear, at: Date().timeIntervalSince1970))
    writePending(items)
  }

  static func waiting(roundId: Int) -> Int {
    lock.lock(); defer { lock.unlock() }
    return readPending().filter { $0.roundId == roundId }.count
  }

  /** Everything waiting, removed from here: the app sends it instead. */
  static func takeAll() -> [Pending] {
    lock.lock(); defer { lock.unlock() }
    let items = readPending()
    writePending([])
    return items
  }

  /** Clears one entry, unless a newer score for that hole replaced it meanwhile. */
  private static func done(_ p: Pending) {
    lock.lock(); defer { lock.unlock() }
    writePending(readPending().filter { !($0.roundId == p.roundId && $0.hole == p.hole && $0.at == p.at) })
  }

  private static func dropRound(_ roundId: Int) {
    lock.lock(); defer { lock.unlock() }
    writePending(readPending().filter { $0.roundId != roundId })
  }

  static func clearEverything() {
    lock.lock(); defer { lock.unlock() }
    writePending([])
    guard let d = defaults else { return }
    for key in d.dictionaryRepresentation().keys where key.hasPrefix("liveScoreConfig.") || key.hasPrefix("liveScoreGeometry.") || key.hasPrefix("liveScoreShown.") {
      d.removeObject(forKey: key)
    }
    d.removeObject(forKey: fixKey)
  }

  /** Sends this round's waiting scores, oldest first. Stops at the first that can't go. */
  private static func queued(_ roundId: Int) -> [Pending] {
    lock.lock(); defer { lock.unlock() }
    return readPending().filter { $0.roundId == roundId }.sorted { $0.at < $1.at }
  }

  static func flush(roundId: Int) async -> Outcome {
    let items = queued(roundId)
    guard !items.isEmpty else { return .sent }
    guard let c = config(roundId), let url = URL(string: c.api) else { return .unauthorized }
    var rejected = false
    for p in items {
      switch await send(p, token: c.token, url: url) {
      case .sent: done(p)
      // The website said this score can never be accepted (not your round,
      // a hole off the card): drop it rather than retry forever, and say so.
      case .rejected:
        done(p)
        rejected = true
      case .retry: return .retry
      case .unauthorized: return .unauthorized
      case .finished:
        dropRound(roundId)
        return .finished
      }
    }
    return rejected ? .rejected : .sent
  }

  private static func send(_ p: Pending, token: String, url: URL) async -> Outcome {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
    request.httpMethod = "POST"
    request.setValue("LiveScore \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: Any] = ["hole": p.hole, "strokes": p.strokes.map { $0 as Any } ?? NSNull(), "clear": p.clear]
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      switch (response as? HTTPURLResponse)?.statusCode ?? 0 {
      case 200: return .sent
      case 401: return .unauthorized
      case 409: return .finished
      case 400, 403: return .rejected
      default: return .retry
      }
    } catch {
      return .retry
    }
  }
}

// MARK: - The distance to the green

enum LiveScoreDistance {
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
  static func measure(roundId: Int, hole n: Int) -> (Int?, String?) {
    guard let spot = LiveScoreStore.geometry(roundId).first(where: { $0.n == n }), let green = spot.green, green.count == 2 else { return (nil, nil) }
    if let fix = LiveScoreStore.lastFix() {
      let d = metres([fix.lat, fix.lng], green)
      if d <= onHoleMetres { return (Int((d / metresPerYard).rounded()), "you") }
    }
    if let tee = spot.tee, tee.count == 2 { return (Int((metres(tee, green) / metresPerYard).rounded()), "tee") }
    return (nil, nil)
  }

  @available(iOS 16.1, *)
  static func apply(_ s: inout LiveScoreAttributes.ContentState, roundId: Int) {
    let (d, from) = measure(roundId: roundId, hole: s.hole)
    s.distance = d
    s.distanceFrom = from
  }
}

// MARK: - What the buttons do

@available(iOS 17.0, *)
enum LiveScoreEngine {
  static func activity(_ roundId: Int) -> Activity<LiveScoreAttributes>? {
    // An ended card can stay on screen for a while (and in this list); only a
    // running one can be updated.
    Activity<LiveScoreAttributes>.activities.first {
      $0.attributes.roundId == roundId && ($0.activityState == .active || $0.activityState == .stale)
    }
  }

  /**
   * What the card shows now: the state last sent to it, kept in the App
   * Group. Not `a.content.state`, which can lag a moment behind an update —
   * reading it to change one thing (the distance, the waiting count) and
   * sending it back put the old hole and total back on the card, so scores
   * entered in the app (by hand or by voice) never stuck on the lock screen.
   */
  static func current(_ a: Activity<LiveScoreAttributes>) -> LiveScoreAttributes.ContentState {
    LiveScoreStore.shown(a.attributes.roundId) ?? a.content.state
  }

  /** Every change to the card goes through here, so `current` is always the latest. */
  static func push(_ a: Activity<LiveScoreAttributes>, _ s: LiveScoreAttributes.ContentState) async {
    LiveScoreStore.setShown(s, roundId: a.attributes.roundId)
    await a.update(ActivityContent(state: s, staleDate: nil, relevanceScore: relevance))
  }

  /** Above the leaderboard card (LiveBoardEngine uses 50): this one keeps the Dynamic Island and the top of the lock screen. */
  static let relevance: Double = 100

  /** − / +: change the number shown, 1 to 15. */
  static func step(roundId: Int, delta: Int) async {
    guard let a = activity(roundId) else { return }
    var s = LiveScoreEngine.current(a)
    guard !s.finished else { return }
    let now = s.draft ?? a.attributes.netPar(s.hole)
    s.draft = min(15, max(1, now + delta))
    s.saved = nil
    await push(a, s)
  }

  /** Save (the number shown) or Picked up, then on to the next hole with no score. */
  static func save(roundId: Int, pickedUp: Bool) async {
    guard let a = activity(roundId) else { return }
    let attrs = a.attributes
    var s = LiveScoreEngine.current(a)
    guard !s.finished else { return }
    let hole = s.hole
    let value: Int? = pickedUp ? nil : (s.draft ?? attrs.netPar(hole))
    s.strokes[String(hole)] = value ?? 0
    // Short: it shares the bottom row with the distance and the mic.
    s.saved = "Hole \(hole) · \(attrs.short(value, hole))"
    s.undoHole = hole
    s.draft = nil
    s.status = nil
    s.editing = false
    s.hole = attrs.nextHole(after: hole, strokes: s.strokes) ?? hole
    LiveScoreDistance.apply(&s, roundId: roundId)
    LiveScoreStore.enqueue(roundId: roundId, hole: hole, strokes: value, clear: false)
    s.waiting = LiveScoreStore.waiting(roundId: roundId)
    // Show it straight away; the send can take a moment on a weak signal.
    await push(a, s)

    let outcome = await LiveScoreStore.flush(roundId: roundId)
    var latest = LiveScoreEngine.current(a)
    latest.waiting = LiveScoreStore.waiting(roundId: roundId)
    switch outcome {
    case .unauthorized: latest.notice = "Open PinPals to keep scoring here"
    case .rejected:
      latest.notice = "A score wasn't accepted. Check it in PinPals"
      latest.saved = nil
    case .finished:
      latest.finished = true
      latest.notice = nil
      latest.status = "This round has finished"
    default: latest.notice = nil
    }
    await push(a, latest)
    // Where that leaves them (claude/lock-screen-leaderboard.md).
    await LiveBoardEngine.refresh(roundId: roundId, every: 10)
  }

  /** Back to the hole just saved, showing what was saved, to change it. */
  static func undo(roundId: Int) async {
    guard let a = activity(roundId) else { return }
    var s = LiveScoreEngine.current(a)
    guard let back = s.undoHole, !s.finished else { return }
    let had = s.strokes[String(back)]
    s.hole = back
    LiveScoreDistance.apply(&s, roundId: roundId)
    s.draft = (had ?? 0) > 0 ? had : nil
    s.undoHole = nil
    s.saved = nil
    s.editing = true
    await push(a, s)
  }

  /** Tries the queue again (the app calls this when it wakes). */
  static func retry(roundId: Int) async {
    guard let a = activity(roundId) else { return }
    _ = await LiveScoreStore.flush(roundId: roundId)
    var s = LiveScoreEngine.current(a)
    s.waiting = LiveScoreStore.waiting(roundId: roundId)
    await push(a, s)
  }
}

@available(iOS 17.0, *)
struct LiveScoreStepIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Change your score"
  // Lock screen buttons only, not Shortcuts actions.
  static var isDiscoverable: Bool = false
  @Parameter(title: "Round") var roundId: Int
  @Parameter(title: "Change") var delta: Int

  init() {}
  init(roundId: Int, delta: Int) {
    self.roundId = roundId
    self.delta = delta
  }

  func perform() async throws -> some IntentResult {
    await LiveScoreEngine.step(roundId: roundId, delta: delta)
    return .result()
  }
}

@available(iOS 17.0, *)
struct LiveScoreSaveIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Save your score"
  // Lock screen buttons only, not Shortcuts actions.
  static var isDiscoverable: Bool = false
  @Parameter(title: "Round") var roundId: Int

  init() {}
  init(roundId: Int) { self.roundId = roundId }

  func perform() async throws -> some IntentResult {
    await LiveScoreEngine.save(roundId: roundId, pickedUp: false)
    return .result()
  }
}

@available(iOS 17.0, *)
struct LiveScorePickedUpIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Picked up (NR)"
  // Lock screen buttons only, not Shortcuts actions.
  static var isDiscoverable: Bool = false
  @Parameter(title: "Round") var roundId: Int

  init() {}
  init(roundId: Int) { self.roundId = roundId }

  func perform() async throws -> some IntentResult {
    await LiveScoreEngine.save(roundId: roundId, pickedUp: true)
    return .result()
  }
}

@available(iOS 17.0, *)
struct LiveScoreUndoIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Change the last score"
  // Lock screen buttons only, not Shortcuts actions.
  static var isDiscoverable: Bool = false
  @Parameter(title: "Round") var roundId: Int

  init() {}
  init(roundId: Int) { self.roundId = roundId }

  func perform() async throws -> some IntentResult {
    await LiveScoreEngine.undo(roundId: roundId)
    return .result()
  }
}

// MARK: - The bridge the app's JavaScript calls (modules/live-activity)

/**
 * Called by name from the PinPalsLiveActivity Expo module, which can't see
 * this file's types (it's a separate pod). Every method takes and returns
 * strings, so the call crosses with plain performSelector. Each returns nil
 * on success or a short reason.
 */
// The app only: starting a Live Activity isn't something an extension may do,
// and this file is compiled into the widget extension too.
@available(iOSApplicationExtension, unavailable)
@objc(PinPalsLiveActivityBridge)
public class PinPalsLiveActivityBridge: NSObject {
  struct StartInput: Decodable {
    let roundId: Int
    let course: String
    let format: String
    let holes: [LiveScoreHole]
    let url: String
    let api: String
    let token: String
    let playerId: Int?
    let hole: Int
    let strokes: [String: Int]
    let status: String?
    let voiceUrl: String?
    let mapUrl: String?
    /** The leaderboard card (claude/lock-screen-leaderboard.md): wanted when the round has others on it. */
    let board: Bool?
    /** GET /api/widget/live/board. */
    let boardApi: String?
    /** Where a tap on the leaderboard card goes; else the round. */
    let boardUrl: String?
  }

  /** Puts the leaderboard card up beside the scoring card (or refreshes it), when the app says it's wanted. */
  private static func startBoard(_ roundId: Int, wanted: Bool?, api: String?, url: String) {
    guard #available(iOS 17.0, *) else { return }
    if let api = api { LiveBoardStore.setApi(api, roundId: roundId) }
    if let wanted = wanted { LiveBoardStore.setWanted(wanted, roundId: roundId) }
    if wanted == false {
      LiveBoardEngine.end(roundId: roundId, immediate: true)
      return
    }
    LiveBoardEngine.begin(roundId: roundId, url: url, every: 15)
  }

  struct GeometryInput: Decodable {
    let roundId: Int
    let holes: [LiveScoreStore.Spot]
  }

  struct LocationInput: Decodable {
    let lat: Double
    let lng: Double
    let accuracy: Double?
  }

  struct UpdateInput: Decodable {
    let roundId: Int
    let hole: Int
    let strokes: [String: Int]
    let status: String?
    let token: String?
    let api: String?
    let playerId: Int?
    let board: Bool?
    let boardApi: String?
    let boardUrl: String?
  }

  struct EndInput: Decodable {
    let roundId: Int?
    let summary: String?
    let immediate: Bool?
  }

  private static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
    guard let data = json.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  /** "1" when this phone can show the card with working buttons (iOS 17+, Live Activities on). */
  @objc public static func isSupported() -> NSString {
    if #available(iOS 17.0, *) {
      return ActivityAuthorizationInfo().areActivitiesEnabled ? "1" : "0"
    }
    return "0"
  }

  /** Starts the card for a round, or refreshes it if it's already up. Ends any other round's card. */
  @objc public static func start(_ json: String) -> NSString? {
    guard #available(iOS 17.0, *) else { return "unsupported" }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" }
    guard let input = decode(StartInput.self, json) else { return "bad input" }
    LiveScoreStore.setConfig(.init(api: input.api, token: input.token, playerId: input.playerId), roundId: input.roundId)

    let waiting = LiveScoreStore.waiting(roundId: input.roundId)
    var state = LiveScoreAttributes.ContentState(
      hole: input.hole, draft: nil, strokes: input.strokes, saved: nil, undoHole: nil,
      status: input.status, waiting: waiting, notice: nil, finished: false, editing: false
    )
    LiveScoreDistance.apply(&state, roundId: input.roundId)

    for other in Activity<LiveScoreAttributes>.activities where other.attributes.roundId != input.roundId {
      Task { await other.end(nil, dismissalPolicy: .immediate) }
    }
    LiveBoardEngine.endOthers(keeping: input.roundId)
    if let existing = LiveScoreEngine.activity(input.roundId) {
      LiveScoreStore.setShown(state, roundId: input.roundId)
      Task { [state] in await LiveScoreEngine.push(existing, state) }
      startBoard(input.roundId, wanted: input.board, api: input.boardApi, url: input.boardUrl ?? input.url)
      return nil
    }
    let attributes = LiveScoreAttributes(
      roundId: input.roundId, course: input.course, format: input.format, holes: input.holes, url: input.url,
      voiceUrl: input.voiceUrl, mapUrl: input.mapUrl
    )
    do {
      _ = try Activity<LiveScoreAttributes>.request(
        attributes: attributes, content: ActivityContent(state: state, staleDate: nil, relevanceScore: LiveScoreEngine.relevance), pushType: nil
      )
      LiveScoreStore.setShown(state, roundId: input.roundId)
      startBoard(input.roundId, wanted: input.board, api: input.boardApi, url: input.boardUrl ?? input.url)
      return nil
    } catch {
      return error.localizedDescription as NSString
    }
  }

  /** The app scored (or reloaded the round): show its card on the lock screen. */
  @objc public static func update(_ json: String) -> NSString? {
    guard #available(iOS 17.0, *) else { return "unsupported" }
    guard let input = decode(UpdateInput.self, json) else { return "bad input" }
    if let token = input.token, let api = input.api {
      LiveScoreStore.setConfig(.init(api: api, token: token, playerId: input.playerId), roundId: input.roundId)
    }
    guard let a = LiveScoreEngine.activity(input.roundId) else {
      // The scoring card was swiped away but the leaderboard's still up: keep
      // that one going (and the location updates that refresh it).
      guard LiveBoardEngine.activity(input.roundId) != nil else { return "not running" }
      Task { await LiveBoardEngine.refresh(roundId: input.roundId, every: 15) }
      return nil
    }
    // The app scored or reloaded: the leaderboard too, if it's been a little while.
    startBoard(input.roundId, wanted: input.board, api: input.boardApi, url: input.boardUrl ?? a.attributes.url)
    var s = LiveScoreEngine.current(a)
    s.hole = input.hole
    LiveScoreDistance.apply(&s, roundId: input.roundId)
    s.strokes = input.strokes
    s.status = input.status
    s.draft = nil
    s.saved = nil
    s.undoHole = nil
    s.notice = nil
    s.editing = false
    s.waiting = LiveScoreStore.waiting(roundId: input.roundId)
    LiveScoreStore.setShown(s, roundId: input.roundId)
    Task { [s] in
      await LiveScoreEngine.push(a, s)
      await LiveScoreEngine.retry(roundId: input.roundId)
    }
    return nil
  }

  /** The round finished (or was deleted, or the member signed out): take the card down. */
  @objc public static func end(_ json: String) -> NSString? {
    guard #available(iOS 17.0, *) else { return "unsupported" }
    let input = decode(EndInput.self, json) ?? EndInput(roundId: nil, summary: nil, immediate: true)
    let immediate = input.immediate ?? false
    for a in Activity<LiveScoreAttributes>.activities where input.roundId == nil || a.attributes.roundId == input.roundId {
      var s = LiveScoreEngine.current(a)
      s.finished = true
      s.status = input.summary ?? a.attributes.total(s.strokes)
      s.notice = nil
      s.saved = nil
      let content = ActivityContent(state: s, staleDate: nil, relevanceScore: LiveScoreEngine.relevance)
      // Finished: the final total stays on the lock screen for a little while.
      let policy: ActivityUIDismissalPolicy = immediate ? .immediate : .after(Date().addingTimeInterval(15 * 60))
      Task { await a.end(content, dismissalPolicy: policy) }
      LiveScoreStore.forget(roundId: a.attributes.roundId)
    }
    // The leaderboard card goes with it (the final board stays as long as the final score).
    LiveBoardEngine.end(roundId: input.roundId, immediate: immediate)
    if input.roundId == nil { LiveScoreStore.clearEverything() }
    return nil
  }

  /** Where each hole's green and tee are, for the card's distance. Stored in the App Group; the card recalculates. */
  @objc public static func setGeometry(_ json: String) -> NSString? {
    guard let input = decode(GeometryInput.self, json) else { return "bad input" }
    LiveScoreStore.setGeometry(input.holes, roundId: input.roundId)
    guard #available(iOS 17.0, *) else { return "unsupported" }
    guard let a = LiveScoreEngine.activity(input.roundId) else { return "not running" }
    var s = LiveScoreEngine.current(a)
    LiveScoreDistance.apply(&s, roundId: input.roundId)
    LiveScoreStore.setShown(s, roundId: input.roundId)
    Task { [s] in await LiveScoreEngine.push(a, s) }
    return nil
  }

  /**
   * A new position from the app's location updates (running in the
   * background while the phone is locked). "not running" tells the app to
   * stop them: there's no card to show a distance on.
   */
  @objc public static func setLocation(_ json: String) -> NSString? {
    guard #available(iOS 17.0, *) else { return "unsupported" }
    guard let input = decode(LocationInput.self, json) else { return "bad input" }
    LiveScoreStore.setFix(.init(lat: input.lat, lng: input.lng, at: Date().timeIntervalSince1970))
    let running = Activity<LiveScoreAttributes>.activities.filter {
      ($0.activityState == .active || $0.activityState == .stale) && !LiveScoreEngine.current($0).finished
    }
    let boards = LiveBoardEngine.running
    guard !running.isEmpty || !boards.isEmpty else { return "not running" }
    // These fixes keep the app awake with the phone locked: the leaderboard
    // cards refresh on them, about once a minute (claude/lock-screen-leaderboard.md).
    for b in boards {
      let roundId = b.attributes.roundId
      Task { await LiveBoardEngine.refresh(roundId: roundId, every: 60) }
    }
    for a in running {
      var s = LiveScoreEngine.current(a)
      let before = s.distance
      let beforeFrom = s.distanceFrom
      LiveScoreDistance.apply(&s, roundId: a.attributes.roundId)
      // Walking changes it every few seconds; a yard or two either way isn't worth redrawing.
      let moved = abs((s.distance ?? 0) - (before ?? 0)) >= 2 || (s.distance == nil) != (before == nil)
      if moved || s.distanceFrom != beforeFrom {
        LiveScoreStore.setShown(s, roundId: a.attributes.roundId)
        Task { [s] in await LiveScoreEngine.push(a, s) }
      }
    }
    return nil
  }

  struct WatchScoreInput: Decodable {
    let roundId: Int
    let hole: Int
    /** nil = picked up. */
    let strokes: Int?
    let clear: Bool?
    let playerId: Int?
    let api: String?
    let token: String?
  }

  /**
   * A score saved on the Apple Watch (claude/apple-watch.md), handed over by
   * PinPalsWatchLink. It joins the lock screen's queue — so it's sent,
   * retried and drained by the app the same way — and shows on the card at
   * once. nil = the phone has it now; the watch stops trying.
   */
  @objc public static func applyWatchScore(_ json: String) -> NSString? {
    guard let input = decode(WatchScoreInput.self, json) else { return "bad input" }
    // The watch's key came from this phone; it's only needed when the card
    // never started here (Live Activities off).
    if LiveScoreStore.config(input.roundId) == nil {
      guard let api = input.api, let token = input.token else { return "no key" }
      LiveScoreStore.setConfig(.init(api: api, token: token, playerId: input.playerId), roundId: input.roundId)
    }
    let clear = input.clear ?? false
    LiveScoreStore.enqueue(roundId: input.roundId, hole: input.hole, strokes: input.strokes, clear: clear)

    if #available(iOS 17.0, *), let a = LiveScoreEngine.activity(input.roundId) {
      Task {
        var s = LiveScoreEngine.current(a)
        let attrs = a.attributes
        if clear {
          s.strokes.removeValue(forKey: String(input.hole))
        } else {
          s.strokes[String(input.hole)] = input.strokes ?? 0
          s.saved = "Hole \(input.hole) · \(attrs.short(input.strokes, input.hole))"
        }
        // Undo on the card goes back to its own saves, not the watch's.
        s.undoHole = nil
        s.status = nil
        if s.hole == input.hole, s.draft == nil {
          s.hole = attrs.nextHole(after: input.hole, strokes: s.strokes) ?? input.hole
          LiveScoreDistance.apply(&s, roundId: input.roundId)
        }
        s.waiting = LiveScoreStore.waiting(roundId: input.roundId)
        await LiveScoreEngine.push(a, s)
        await LiveScoreEngine.retry(roundId: input.roundId)
        await LiveBoardEngine.refresh(roundId: input.roundId, every: 10)
      }
    } else {
      Task { _ = await LiveScoreStore.flush(roundId: input.roundId) }
    }
    return nil
  }

  /** Scores saved on the lock screen that haven't reached the website yet, as JSON — handed to the app to send. */
  @objc public static func takePending() -> NSString {
    let items = LiveScoreStore.takeAll()
    guard let data = try? JSONEncoder().encode(items), let text = String(data: data, encoding: .utf8) else { return "[]" }
    return text as NSString
  }
}
