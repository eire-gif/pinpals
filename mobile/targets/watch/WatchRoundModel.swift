import CoreLocation
import Foundation
import SwiftUI
import WatchKit

// PinPals for Apple Watch (Oct 2026): what the watch shows and what its
// buttons do. Same rules as the lock screen card (LiveScoreEngine in
// targets/widget/_shared/LiveScoreShared.swift): the number starts at net
// par, − / + (or the Digital Crown) changes it, Save keeps it and moves on to
// the next hole with no score, Undo goes back to the hole just saved.

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
  /** The page on screen: 0 the hole, 1 the card. */
  @Published var page = 0

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
    round = next
    WatchStore.saveRound(next)
    if !same {
      draft = nil
      saved = nil
      undoHole = nil
      notice = nil
      page = 0
      hole = next.startHole
    } else if draft == nil {
      // Scored on the iPhone: follow it, unless the member is mid-change here.
      hole = next.startHole
    }
    if next.isFinished {
      notice = nil
      WatchStore.drop(roundId: next.roundId)
    }
    waiting = WatchStore.pending(roundId: next.roundId).count
    updateLocation()
    measure()
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
    WatchStore.clearEverything()
    WatchLocation.shared.stop()
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
    page = 0
    WatchStore.enqueue(WatchPending(roundId: r.roundId, playerId: r.playerId, hole: h, strokes: value, clear: false, at: Date().timeIntervalSince1970))
    waiting = WatchStore.pending(roundId: r.roundId).count
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
    saved = nil
    page = 0
    measure()
  }

  // MARK: Sending

  func flush() async {
    guard !sending, let r = round, !r.isFinished else { return }
    sending = true
    defer { sending = false }
    let outcome = await WatchSender.flush(r)
    waiting = WatchStore.pending(roundId: r.roundId).count
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
    Task { await flush() }
  }

  func wentInactive() {
    active = false
    WatchLocation.shared.stop()
  }

  /** GPS only while the app is open on a live round with mapped greens. */
  private func updateLocation() {
    let mapped = round?.spots?.contains { $0.green != nil } ?? false
    if active, let r = round, !r.isFinished, mapped {
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
      return
    }
    var at: [Double]? = nil
    if let f = fix, Date().timeIntervalSince(f.at) < fixLifetime { at = [f.lat, f.lng] }
    let (d, from) = WatchDistance.measure(r, hole: hole, from: at)
    distance = d
    distanceFrom = from
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
