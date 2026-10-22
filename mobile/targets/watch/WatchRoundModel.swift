import CoreLocation
import Foundation
import SwiftUI
import WatchKit

// PinPals for Apple Watch (Oct 2026): what the watch shows and what its
// buttons do. Same rules as the lock screen card (LiveScoreEngine in
// targets/widget/_shared/LiveScoreShared.swift): the number starts at net
// par, − / + (or the Digital Crown) changes it, Save keeps it and moves on to
// the next hole with no score, Undo goes back to the hole just saved.
//
// Watch v2 (claude/watch-v2.md) adds the pages before and after scoring —
// distances, the hole map, hazards, the group's scores, the leaderboard —
// the round as a golf workout, and the face complications.

/** The pages, left to right. */
enum WatchPage {
  static let distances = 0
  static let map = 1
  static let hazards = 2
  static let score = 3
  static let board = 4
  static let card = 5
}

/** A birdie (or better) by someone in the group, shown for a few seconds. */
struct WatchAlert: Equatable {
  let title: String
  let line: String
}

@MainActor
final class WatchRoundModel: ObservableObject {
  static let shared = WatchRoundModel()

  @Published private(set) var round: WatchRound?
  /** The hole on screen. */
  @Published private(set) var hole: Int = 1
  /** Strokes chosen but not saved yet. nil = showing net par (or the saved score). */
  @Published private(set) var draft: Int?
  /** "Hole 7 · 5 · 2 pts", after a save. */
  @Published private(set) var saved: String?
  /** The hole Undo goes back to. */
  @Published private(set) var undoHole: Int?
  /** Scores kept on the watch, not sent yet. */
  @Published private(set) var waiting = 0
  /** Something the member needs to act on. */
  @Published private(set) var notice: String?
  @Published private(set) var distance: Int?
  /** "you" or "tee": where `distance` is measured from. */
  @Published private(set) var distanceFrom: String?
  /** The page on screen (WatchPage). */
  @Published var page = WatchPage.distances
  /** Where the member is, for the distance pages; nil without a recent fix. */
  @Published private(set) var fixPoint: [Double]?
  /** The group page: strokes chosen but not saved, by player id. */
  @Published private(set) var groupDrafts: [Int: Int] = [:]
  /** The group page: the row the Digital Crown changes. */
  @Published var groupSelected: Int?
  @Published private(set) var board: WatchBoard?
  @Published private(set) var boardNote: String?
  @Published private(set) var alert: WatchAlert?
  /** "Plays like" can be switched off on the watch (on unless the member says otherwise). */
  @Published var playsLikeOn: Bool = UserDefaults.standard.object(forKey: "playsLikeOn") as? Bool ?? true {
    didSet { UserDefaults.standard.set(playsLikeOn, forKey: "playsLikeOn") }
  }

  private var fix: (lat: Double, lng: Double, at: Date)?
  private var sending = false
  private var active = false
  /** An older position says nothing about where the member is now. */
  private let fixLifetime: TimeInterval = 10 * 60

  private init() {
    round = WatchStore.loadRound()
    if let r = round {
      hole = r.startHole
      waiting = WatchStore.pending(roundId: r.roundId).count
    }
    WatchLocation.shared.onFix = { [weak self] lat, lng in
      Task { @MainActor in self?.located(lat, lng) }
    }
  }

  // MARK: What's on screen

  /** The number shown for the hole on screen. */
  var shown: Int {
    if let d = draft { return d }
    if let s = round?.score(hole), s > 0 { return s }
    return round?.netPar(hole) ?? 4
  }

  /** Shown dimmed: net par, not something the member chose. */
  var isSuggestion: Bool { draft == nil && (round?.score(hole) ?? 0) == 0 }

  var holeInfo: WatchHole? { round?.info(hole) }

  // MARK: From the iPhone

  func apply(_ incoming: WatchRound) {
    let same = round?.roundId == incoming.roundId
    if same, let have = round?.sentAt, let new = incoming.sentAt, new < have { return }
    var next = incoming
    // Scores saved here and not yet home still count.
    for p in WatchStore.pending(roundId: incoming.roundId) {
      if p.clear { next.strokes.removeValue(forKey: String(p.hole)) } else { next.strokes[String(p.hole)] = p.strokes ?? 0 }
    }
    for g in WatchStore.groupPending(roundId: incoming.roundId) {
      next.applyGroup(hole: g.hole, scores: g.scores)
    }
    if same, let before = round { birdies(before: before, after: next) }
    round = next
    WatchStore.saveRound(next)
    if !same {
      draft = nil
      saved = nil
      undoHole = nil
      notice = nil
      groupDrafts = [:]
      groupSelected = nil
      board = nil
      page = WatchPage.distances
      hole = next.startHole
    } else if draft == nil && groupDrafts.isEmpty {
      // Scored on the iPhone: follow it, unless the member is mid-change here.
      hole = next.startHole
    }
    if next.isFinished {
      notice = nil
      WatchStore.drop(roundId: next.roundId)
    }
    waiting = WatchStore.pending(roundId: next.roundId).count + WatchStore.groupPending(roundId: next.roundId).count
    updateLocation()
    measure()
    WatchWorkout.shared.follow(round: next, active: active)
    if waiting > 0 { Task { await flush() } }
  }

  /** Signed out or the round was deleted on the iPhone. */
  func clear() {
    round = nil
    draft = nil
    saved = nil
    undoHole = nil
    notice = nil
    waiting = 0
    distance = nil
    groupDrafts = [:]
    board = nil
    WatchStore.clearEverything()
    WatchLocation.shared.stop()
    WatchWorkout.shared.follow(round: nil, active: active)
    WatchGlance.write(nil, hole: nil, yards: nil)
  }

  // MARK: The buttons

  /** − / + and the Digital Crown: 1 to 15. */
  func step(_ delta: Int) {
    setDraft(shown + delta)
  }

  /** `click`: false for the Digital Crown, which has its own tick. */
  func setDraft(_ value: Int, click: Bool = true) {
    guard let r = round, !r.isFinished else { return }
    let v = min(15, max(1, value))
    // The crown lines itself up with the number on each new hole: not a change.
    guard v != shown else { return }
    draft = v
    saved = nil
    if click { WKInterfaceDevice.current().play(.click) }
  }

  /** Save (the number shown) or Picked up, then on to the next hole with no score. */
  func save(pickedUp: Bool = false) {
    guard var r = round, !r.isFinished else { return }
    let h = hole
    let value: Int? = pickedUp ? nil : shown
    r.strokes[String(h)] = value ?? 0
    round = r
    WatchStore.saveRound(r)
    saved = "Hole \(h) · \(r.short(value, h))"
    undoHole = h
    draft = nil
    notice = nil
    hole = r.nextHole(after: h) ?? h
    page = WatchPage.score
    groupDrafts = [:]
    WatchStore.enqueue(WatchPending(roundId: r.roundId, playerId: r.playerId, hole: h, strokes: value, clear: false, at: Date().timeIntervalSince1970))
    waiting = WatchStore.pending(roundId: r.roundId).count + WatchStore.groupPending(roundId: r.roundId).count
    WKInterfaceDevice.current().play(.success)
    measure()
    Task { await flush() }
  }

  /** Back to the hole just saved, showing what was saved, to change it. */
  func undo() {
    guard let back = undoHole, let r = round, !r.isFinished else { return }
    go(to: back)
    undoHole = nil
  }

  /** Open a hole from the card (or the arrows) to score or change it. */
  func go(to n: Int) {
    guard let r = round, r.info(n) != nil else { return }
    hole = n
    let had = r.score(n)
    draft = (had ?? 0) > 0 ? had : nil
    groupDrafts = [:]
    saved = nil
    page = WatchPage.score
    measure()
  }

  // MARK: Sending

  func flush() async {
    guard !sending, let r = round, !r.isFinished else { return }
    sending = true
    defer { sending = false }
    var outcome = await WatchSender.flush(r)
    if outcome == .sent || outcome == .rejected {
      let group = await WatchSender.flushGroup(r)
      if group != .sent { outcome = group == .rejected && outcome == .rejected ? .rejected : group }
    }
    waiting = WatchStore.pending(roundId: r.roundId).count + WatchStore.groupPending(roundId: r.roundId).count
    switch outcome {
    case .unauthorized:
      notice = "Open PinPals on your iPhone to keep scoring here"
    case .rejected:
      notice = "A score wasn't accepted. Check it in PinPals"
      saved = nil
      WKInterfaceDevice.current().play(.failure)
    case .finished:
      if var done = round, done.roundId == r.roundId {
        done.finished = true
        done.summary = "This round has finished"
        round = done
        WatchStore.saveRound(done)
      }
      notice = nil
    case .sent, .retry:
      notice = nil
    }
  }

  // MARK: The app and the distance

  func becameActive() {
    active = true
    WatchLink.shared.activate()
    updateLocation()
    WatchWorkout.shared.follow(round: round, active: true)
    Task { await flush() }
    if page == WatchPage.board { Task { await loadBoard() } }
  }

  func wentInactive() {
    active = false
    // A round running as a golf workout keeps the app (and the GPS) going
    // with the wrist down, so the distance is right at the next glance.
    if !WatchWorkout.shared.running { WatchLocation.shared.stop() }
  }

  /** GPS while the app is open (or running a round workout) on a live round with mapped greens. */
  private func updateLocation() {
    let mapped = round?.spots?.contains { $0.green != nil } ?? false
    if active || WatchWorkout.shared.running, let r = round, !r.isFinished, mapped {
      WatchLocation.shared.start()
    } else {
      WatchLocation.shared.stop()
    }
  }

  private func located(_ lat: Double, _ lng: Double) {
    fix = (lat, lng, Date())
    let before = distance
    let beforeFrom = distanceFrom
    measure()
    // Walking changes it every few seconds; a yard or two either way isn't worth a redraw.
    if let b = before, let d = distance, abs(d - b) < 2, beforeFrom == distanceFrom { distance = b }
  }

  private func measure() {
    guard let r = round else {
      distance = nil
      distanceFrom = nil
      fixPoint = nil
      return
    }
    var at: [Double]? = nil
    if let f = fix, Date().timeIntervalSince(f.at) < fixLifetime { at = [f.lat, f.lng] }
    if fixPoint != at { fixPoint = at }
    let (d, from) = WatchDistance.measure(r, hole: hole, from: at)
    distance = d
    distanceFrom = from
    WatchGlance.write(r, hole: hole, yards: d)
  }

  // MARK: Watch v2 — the group's scores

  /** The number shown for a player on the hole on screen. */
  func groupShown(_ p: WatchPlayer) -> Int {
    if let d = groupDrafts[p.id] { return d }
    if p.me, let s = round?.score(hole), s > 0 { return s }
    if !p.me, let s = p.strokes[String(hole)], s > 0 { return s }
    guard let info = round?.info(hole) else { return 4 }
    return info.par + (round?.shots(p, hole) ?? 0)
  }

  /** Dimmed: nobody has chosen or saved this one yet. */
  func groupIsSuggestion(_ p: WatchPlayer) -> Bool {
    if groupDrafts[p.id] != nil { return false }
    let saved = p.me ? round?.score(hole) : p.strokes[String(hole)]
    return (saved ?? 0) == 0
  }

  func setGroupDraft(_ playerId: Int, _ value: Int, click: Bool = true) {
    guard let r = round, !r.isFinished, let p = r.group?.first(where: { $0.id == playerId }) else { return }
    let v = min(15, max(1, value))
    guard v != groupShown(p) else { return }
    groupDrafts[playerId] = v
    saved = nil
    if click { WKInterfaceDevice.current().play(.click) }
  }

  /** Save all: every row as shown (net par for any not touched), then the next hole. */
  func saveGroup() {
    guard var r = round, !r.isFinished, let group = r.group else { return }
    let h = hole
    var others: [WatchGroupScore] = []
    var mine: Int?
    for p in group {
      let v = groupShown(p)
      if p.me { mine = v } else { others.append(WatchGroupScore(player_id: p.id, strokes: v)) }
    }
    if !others.isEmpty {
      r.applyGroup(hole: h, scores: others)
      WatchStore.enqueueGroup(WatchGroupPending(roundId: r.roundId, hole: h, scores: others, at: Date().timeIntervalSince1970))
    }
    round = r
    WatchStore.saveRound(r)
    groupDrafts = [:]
    if let v = mine {
      // Your own ball goes the way it always has: via the iPhone's lock screen queue.
      draft = v
      save()
    } else {
      hole = r.nextHole(after: h) ?? h
      saved = "Hole \(h) saved"
      WKInterfaceDevice.current().play(.success)
      measure()
      Task { await flush() }
    }
  }

  /** A birdie or better by someone else in the group, since the last update: a tap on the wrist. */
  private func birdies(before: WatchRound, after: WatchRound) {
    guard let was = before.group, let now = after.group else { return }
    for p in now where !p.me {
      let old = was.first { $0.id == p.id }?.strokes ?? [:]
      for (key, s) in p.strokes where s > 0 && old[key] != s {
        guard let n = Int(key), let info = after.info(n), s <= info.par - 1 else { continue }
        let word = s <= info.par - 3 ? "Albatross!" : s == info.par - 2 ? "Eagle!" : "Birdie!"
        showAlert(WatchAlert(title: word, line: "\(p.name) · hole \(n)"))
        return
      }
    }
  }

  private func showAlert(_ a: WatchAlert) {
    alert = a
    let device = WKInterfaceDevice.current()
    device.play(.notification)
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { device.play(.notification) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
      if self?.alert == a { self?.alert = nil }
    }
  }

  func dismissAlert() { alert = nil }

  // MARK: Watch v2 — the leaderboard

  private var boardLoadedAt: Date?

  /** The leaderboard, at most once a minute unless `force`. */
  func loadBoard(force: Bool = false) async {
    guard let r = round, let url = r.watch?.board.flatMap(URL.init(string:)), let token = r.token else {
      boardNote = "Update PinPals on your iPhone to see the leaderboard here"
      return
    }
    if !force, let at = boardLoadedAt, Date().timeIntervalSince(at) < 60 { return }
    boardLoadedAt = Date()
    switch await WatchBoardLoader.load(url: url, token: token) {
    case .loaded(let b):
      board = b
      boardNote = nil
    case .unauthorized:
      boardNote = "Open PinPals on your iPhone to see the leaderboard"
    case .failed:
      if board == nil { boardNote = "No signal for the leaderboard just now" }
    }
  }
}

// MARK: - GPS

final class WatchLocation: NSObject, CLLocationManagerDelegate {
  static let shared = WatchLocation()

  var onFix: ((Double, Double) -> Void)?
  private let manager = CLLocationManager()
  private var wanted = false

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = 3
    manager.activityType = .fitness
  }

  func start() {
    wanted = true
    switch manager.authorizationStatus {
    case .notDetermined: manager.requestWhenInUseAuthorization()
    case .authorizedWhenInUse, .authorizedAlways: manager.startUpdatingLocation()
    default: break
    }
  }

  func stop() {
    wanted = false
    manager.stopUpdatingLocation()
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    if wanted, status == .authorizedWhenInUse || status == .authorizedAlways {
      manager.startUpdatingLocation()
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    // A rough fix (indoors, just woken) would put the member on the wrong hole.
    guard let l = locations.last, l.horizontalAccuracy >= 0, l.horizontalAccuracy <= 40 else { return }
    onFix?(l.coordinate.latitude, l.coordinate.longitude)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
