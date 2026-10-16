import ExpoModulesCore
import Foundation
import UIKit
import WatchConnectivity

// PinPals for Apple Watch (Oct 2026): the iPhone's side. See claude/apple-watch.md.
//
// The watch scores the same round, under the same rules, as the lock screen
// card, so it rides on the card's calls: everything JavaScript tells the card
// (start, update, setGeometry, end — lock-screen.ts) is also merged into one
// "live round" and handed to the watch as its application context, which
// watchOS delivers even when the watch app isn't open. Only the latest
// matters, so nothing piles up.
//
// Scores coming back from the watch go into the card's own queue in the App
// Group (applyWatchScore on PinPalsLiveActivityBridge, called by name like
// the rest), so they're sent, retried and shown on the lock screen exactly as
// if they'd been tapped there.

final class PinPalsWatchLink: NSObject, WCSessionDelegate {
  static let shared = PinPalsWatchLink()

  private let lock = NSLock()
  /** The live round as the watch sees it; nil = none. */
  private var round: [String: Any]?

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    if session.delegate == nil { session.delegate = self }
    if session.activationState == .notActivated { session.activate() }
  }

  /** A paired watch with PinPals on it. */
  var available: Bool {
    guard WCSession.isSupported() else { return false }
    let session = WCSession.default
    return session.activationState == .activated && session.isPaired && session.isWatchAppInstalled
  }

  // MARK: From JavaScript (alongside the card)

  /** These keys are the watch's business; links and the rest stay with the card. */
  private static let keep: Set<String> = ["roundId", "course", "format", "holes", "api", "token", "playerId", "hole", "strokes", "status"]

  private static func parse(_ json: String) -> [String: Any]? {
    guard let data = json.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private static func id(_ value: Any?) -> Int? { (value as? NSNumber)?.intValue }

  func started(_ json: String) {
    guard let input = Self.parse(json) else { return }
    var next: [String: Any] = [:]
    for (k, v) in input where Self.keep.contains(k) && !(v is NSNull) { next[k] = v }
    lock.lock()
    // The same round again (the app reopened): keep its greens.
    if let have = round, Self.id(have["roundId"]) == Self.id(next["roundId"]), let spots = have["spots"] { next["spots"] = spots }
    round = next
    lock.unlock()
    push()
  }

  func updated(_ json: String) {
    guard let input = Self.parse(json) else { return }
    lock.lock()
    guard var have = round, Self.id(have["roundId"]) == Self.id(input["roundId"]) else { lock.unlock(); return }
    for (k, v) in input where Self.keep.contains(k) {
      // "status": null clears the standing; a missing key leaves it.
      if v is NSNull { have.removeValue(forKey: k) } else { have[k] = v }
    }
    round = have
    lock.unlock()
    push()
  }

  func geometry(_ json: String) {
    guard let input = Self.parse(json) else { return }
    lock.lock()
    guard var have = round, Self.id(have["roundId"]) == Self.id(input["roundId"]) else { lock.unlock(); return }
    have["spots"] = input["holes"] ?? []
    round = have
    lock.unlock()
    push()
  }

  func ended(_ json: String) {
    let input = Self.parse(json) ?? [:]
    let roundId = Self.id(input["roundId"])
    let immediate = (input["immediate"] as? Bool) == true
    lock.lock()
    if roundId == nil || immediate {
      // Signed out, or the round was deleted: nothing left on the watch.
      let ours = roundId == nil || Self.id(round?["roundId"]) == roundId
      if ours { round = nil }
      lock.unlock()
      if ours { clearWatch() }
      return
    }
    guard var have = round, Self.id(have["roundId"]) == roundId else { lock.unlock(); return }
    have["finished"] = true
    if let summary = input["summary"] as? String { have["summary"] = summary }
    round = have
    lock.unlock()
    push()
  }

  // MARK: To the watch

  private func push() {
    guard available else { return }
    lock.lock()
    guard var context = round else { lock.unlock(); return }
    context["sentAt"] = Date().timeIntervalSince1970
    lock.unlock()
    guard let data = try? JSONSerialization.data(withJSONObject: context),
          let json = String(data: data, encoding: .utf8) else { return }
    let session = WCSession.default
    try? session.updateApplicationContext(["round": json])
    // Open on the wrist: straight there, without waiting for watchOS.
    if session.isReachable { session.sendMessage(["round": json], replyHandler: nil, errorHandler: nil) }
  }

  private func clearWatch() {
    guard available else { return }
    let session = WCSession.default
    let message: [String: Any] = ["cleared": true, "sentAt": Date().timeIntervalSince1970]
    try? session.updateApplicationContext(message)
    if session.isReachable { session.sendMessage(message, replyHandler: nil, errorHandler: nil) }
  }

  // MARK: From the watch

  private func takeScore(_ message: [String: Any]) -> Bool {
    guard (message["kind"] as? String) == "score",
          let data = try? JSONSerialization.data(withJSONObject: message),
          let json = String(data: data, encoding: .utf8) else { return false }
    // Sending can outlast a background wake-up: ask for a little longer.
    var task = UIBackgroundTaskIdentifier.invalid
    task = UIApplication.shared.beginBackgroundTask(withName: "PinPalsWatchScore") {
      UIApplication.shared.endBackgroundTask(task)
      task = .invalid
    }
    let result = LiveActivityBridgeCall.call("applyWatchScore:", json)
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
    }
    return result == nil
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    let ok = takeScore(message)
    replyHandler(["ok": ok])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    _ = takeScore(userInfo)
  }

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    if activationState == .activated { push() }
  }

  /** PinPals just went onto the watch, or a different watch was paired. */
  func sessionWatchStateDidChange(_ session: WCSession) {
    push()
  }

  func sessionDidBecomeInactive(_ session: WCSession) {}

  func sessionDidDeactivate(_ session: WCSession) {
    // Switched to another watch: start again for that one.
    session.activate()
  }
}

/**
 * Starts talking to the watch as the app launches — including when the watch
 * wakes the iPhone in the background to hand over a score, before any
 * JavaScript has run.
 */
public class PinPalsWatchAppDelegate: BaseExpoAppDelegateSubscriber, ExpoAppDelegateSubscriberProtocol {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    PinPalsWatchLink.shared.activate()
    return true
  }
}
