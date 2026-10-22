import Foundation
import WatchConnectivity

// PinPals for Apple Watch (Oct 2026): keeping scores and getting them home.
//
// Every score is kept on the watch first, then sent:
//   1. to the iPhone when it's in reach (Bluetooth or Wi-Fi). The iPhone
//      puts it in the same queue as the lock screen card and sends it, so it
//      also shows on the card straight away (applyWatchScore in
//      targets/widget/_shared/LiveScoreShared.swift). Once the iPhone says
//      it has it, it's the iPhone's to send.
//   2. otherwise straight to POST /api/widget/live/score, the lock screen's
//      route, with the member's key for this round — for a watch on Wi-Fi or
//      with its own mobile data.
// Neither → it stays on the watch and goes on the next save or when the app
// opens. A score is never lost to a links-course sea fog.

struct WatchPending: Codable, Hashable {
  let roundId: Int
  let playerId: Int?
  let hole: Int
  /** nil = picked up. */
  let strokes: Int?
  let clear: Bool
  let at: Double
}

enum WatchOutcome { case sent, retry, unauthorized, finished, rejected }

// MARK: Watch v2 — the group's scores (POST /api/widget/live/scores)

struct WatchGroupScore: Codable, Hashable {
  let player_id: Int
  /** nil = picked up. */
  let strokes: Int?
}

/** One hole's scores for the rest of the group, waiting to go. */
struct WatchGroupPending: Codable, Hashable {
  let roundId: Int
  let hole: Int
  let scores: [WatchGroupScore]
  let at: Double
}

extension WatchRound {
  /** Lays group scores over the round, as saved here before they've gone. */
  mutating func applyGroup(hole: Int, scores: [WatchGroupScore]) {
    guard var group = watch?.group else { return }
    for s in scores {
      if let i = group.firstIndex(where: { $0.id == s.player_id }) { group[i].strokes[String(hole)] = s.strokes ?? 0 }
    }
    watch?.group = group
  }
}

enum WatchStore {
  private static let lock = NSLock()
  private static let roundKey = "watchRound"
  private static let pendingKey = "watchPending"
  private static let groupKey = "watchGroupPending"
  private static var defaults: UserDefaults { .standard }

  static func loadRound() -> WatchRound? {
    guard let data = defaults.data(forKey: roundKey) else { return nil }
    return try? JSONDecoder().decode(WatchRound.self, from: data)
  }

  static func saveRound(_ round: WatchRound?) {
    if let round = round, let data = try? JSONEncoder().encode(round) {
      defaults.set(data, forKey: roundKey)
    } else {
      defaults.removeObject(forKey: roundKey)
    }
  }

  private static func read() -> [WatchPending] {
    guard let data = defaults.data(forKey: pendingKey) else { return [] }
    return (try? JSONDecoder().decode([WatchPending].self, from: data)) ?? []
  }

  private static func write(_ items: [WatchPending]) {
    if items.isEmpty {
      defaults.removeObject(forKey: pendingKey)
    } else if let data = try? JSONEncoder().encode(Array(items.suffix(80))) {
      defaults.set(data, forKey: pendingKey)
    }
  }

  /** Keep a score to send; a newer score for the same hole replaces a waiting one. */
  static func enqueue(_ p: WatchPending) {
    lock.lock(); defer { lock.unlock() }
    var items = read().filter { !($0.roundId == p.roundId && $0.hole == p.hole) }
    items.append(p)
    write(items)
  }

  static func pending(roundId: Int?) -> [WatchPending] {
    lock.lock(); defer { lock.unlock() }
    guard let roundId = roundId else { return [] }
    return read().filter { $0.roundId == roundId }.sorted { $0.at < $1.at }
  }

  /** Clears one entry, unless a newer score for that hole replaced it meanwhile. */
  static func done(_ p: WatchPending) {
    lock.lock(); defer { lock.unlock() }
    write(read().filter { !($0.roundId == p.roundId && $0.hole == p.hole && $0.at == p.at) })
  }

  static func drop(roundId: Int) {
    lock.lock(); defer { lock.unlock() }
    write(read().filter { $0.roundId != roundId })
    writeGroup(readGroup().filter { $0.roundId != roundId })
  }

  static func clearEverything() {
    lock.lock(); defer { lock.unlock() }
    write([])
    writeGroup([])
    defaults.removeObject(forKey: roundKey)
  }

  // The group's scores: a newer save for the same hole replaces a waiting one.

  private static func readGroup() -> [WatchGroupPending] {
    guard let data = defaults.data(forKey: groupKey) else { return [] }
    return (try? JSONDecoder().decode([WatchGroupPending].self, from: data)) ?? []
  }

  private static func writeGroup(_ items: [WatchGroupPending]) {
    if items.isEmpty {
      defaults.removeObject(forKey: groupKey)
    } else if let data = try? JSONEncoder().encode(Array(items.suffix(40))) {
      defaults.set(data, forKey: groupKey)
    }
  }

  static func enqueueGroup(_ p: WatchGroupPending) {
    lock.lock(); defer { lock.unlock() }
    var items = readGroup().filter { !($0.roundId == p.roundId && $0.hole == p.hole) }
    items.append(p)
    writeGroup(items)
  }

  static func groupPending(roundId: Int?) -> [WatchGroupPending] {
    lock.lock(); defer { lock.unlock() }
    guard let roundId = roundId else { return [] }
    return readGroup().filter { $0.roundId == roundId }.sorted { $0.at < $1.at }
  }

  static func doneGroup(_ p: WatchGroupPending) {
    lock.lock(); defer { lock.unlock() }
    writeGroup(readGroup().filter { !($0.roundId == p.roundId && $0.hole == p.hole && $0.at == p.at) })
  }
}

enum WatchSender {
  /** Sends this round's waiting scores, oldest first. Stops at the first that can't go. */
  static func flush(_ round: WatchRound) async -> WatchOutcome {
    let items = WatchStore.pending(roundId: round.roundId)
    guard !items.isEmpty else { return .sent }
    var rejected = false
    for p in items {
      if await WatchLink.shared.handToPhone(p, round: round) {
        WatchStore.done(p)
        continue
      }
      guard let api = round.api, let token = round.token, let url = URL(string: api) else { return .retry }
      switch await post(p, token: token, url: url) {
      case .sent: WatchStore.done(p)
      // The website said this score can never be accepted (not your round,
      // a hole off the card): drop it rather than retry forever, and say so.
      case .rejected:
        WatchStore.done(p)
        rejected = true
      case .retry: return .retry
      case .unauthorized: return .unauthorized
      case .finished:
        WatchStore.drop(roundId: round.roundId)
        return .finished
      }
    }
    return rejected ? .rejected : .sent
  }

  /**
   * The rest of the group's scores, oldest hole first, straight to the
   * website (the watch uses the iPhone's connection when it's near). They
   * aren't the lock screen card's business, so they don't go via the iPhone.
   */
  static func flushGroup(_ round: WatchRound) async -> WatchOutcome {
    let items = WatchStore.groupPending(roundId: round.roundId)
    guard !items.isEmpty else { return .sent }
    guard let api = round.api, api.hasSuffix("/score"), let token = round.token, let url = URL(string: api + "s") else { return .retry }
    var rejected = false
    for p in items {
      var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
      request.httpMethod = "POST"
      request.setValue("LiveScore \(token)", forHTTPHeaderField: "Authorization")
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      let scores: [[String: Any]] = p.scores.map { ["player_id": $0.player_id, "strokes": $0.strokes.map { $0 as Any } ?? NSNull()] }
      request.httpBody = try? JSONSerialization.data(withJSONObject: ["hole": p.hole, "scores": scores])
      let status: Int
      do {
        let (_, response) = try await URLSession.shared.data(for: request)
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
      } catch {
        return .retry
      }
      switch status {
      case 200: WatchStore.doneGroup(p)
      case 401: return .unauthorized
      case 409:
        WatchStore.drop(roundId: round.roundId)
        return .finished
      case 400, 403:
        WatchStore.doneGroup(p)
        rejected = true
      default: return .retry
      }
    }
    return rejected ? .rejected : .sent
  }

  private static func post(_ p: WatchPending, token: String, url: URL) async -> WatchOutcome {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
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

// MARK: - Watch v2: the leaderboard (GET /api/widget/live/board, src/lib/widget-board.ts)

struct WatchBoardRow: Codable, Hashable {
  let pos: String
  let name: String
  let thru: String
  let score: String
  let mine: Bool
}

struct WatchBoardTable: Codable, Hashable {
  let heading: String
  let rows: [WatchBoardRow]
}

struct WatchBoardMine: Codable, Hashable {
  let eyebrow: String
  let title: String
  let big: String
  let line1: String
  let line2: String
}

struct WatchBoardTeam: Codable, Hashable {
  let name: String
  let points: String
}

struct WatchBoard: Codable, Hashable {
  let state: String
  let eyebrow: String
  let title: String
  let teams: [WatchBoardTeam]?
  let board: WatchBoardTable?
  let mine: WatchBoardMine?
}

enum WatchBoardResult { case loaded(WatchBoard), unauthorized, failed }

enum WatchBoardLoader {
  static func load(url: URL, token: String) async -> WatchBoardResult {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    request.setValue("LiveScore \(token)", forHTTPHeaderField: "Authorization")
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 401 { return .unauthorized }
      guard status == 200, let board = try? JSONDecoder().decode(WatchBoard.self, from: data) else { return .failed }
      return .loaded(board)
    } catch {
      return .failed
    }
  }
}

// MARK: - Talking to the iPhone

/** Resumes a continuation once, whichever of reply, error or timeout comes first. */
private final class ResumeOnce: @unchecked Sendable {
  private let lock = NSLock()
  private var done = false
  private let continuation: CheckedContinuation<Bool, Never>

  init(_ continuation: CheckedContinuation<Bool, Never>) { self.continuation = continuation }

  func resume(_ value: Bool) {
    lock.lock()
    if done { lock.unlock(); return }
    done = true
    lock.unlock()
    continuation.resume(returning: value)
  }
}

final class WatchLink: NSObject, WCSessionDelegate {
  static let shared = WatchLink()

  func activate() {
    guard WCSession.isSupported() else { return }
    let session = WCSession.default
    session.delegate = self
    if session.activationState != .activated { session.activate() }
  }

  /** true once the iPhone has the score in its own queue. */
  func handToPhone(_ p: WatchPending, round: WatchRound) async -> Bool {
    guard WCSession.isSupported() else { return false }
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return false }
    var message: [String: Any] = [
      "kind": "score",
      "roundId": p.roundId,
      "hole": p.hole,
      "clear": p.clear,
      "at": p.at,
    ]
    if let s = p.strokes { message["strokes"] = s }
    if let playerId = p.playerId ?? round.playerId { message["playerId"] = playerId }
    if let api = round.api { message["api"] = api }
    if let token = round.token { message["token"] = token }
    return await withCheckedContinuation { continuation in
      let once = ResumeOnce(continuation)
      session.sendMessage(message, replyHandler: { reply in
        once.resume((reply["ok"] as? Bool) == true)
      }, errorHandler: { _ in
        once.resume(false)
      })
      // A sleepy iPhone can take a while to answer; past this, send it ourselves.
      DispatchQueue.global().asyncAfter(deadline: .now() + 8) { once.resume(false) }
    }
  }

  // MARK: WCSessionDelegate

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    let context = session.receivedApplicationContext
    if !context.isEmpty { handle(context) }
  }

  func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
    handle(applicationContext)
  }

  /** The iPhone also messages the round straight over when the watch app is open. */
  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    handle(message)
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    guard session.isReachable else { return }
    Task { @MainActor in await WatchRoundModel.shared.flush() }
  }

  private func handle(_ context: [String: Any]) {
    if (context["cleared"] as? Bool) == true {
      Task { @MainActor in WatchRoundModel.shared.clear() }
      return
    }
    guard let json = context["round"] as? String, let data = json.data(using: .utf8),
          let round = try? JSONDecoder().decode(WatchRound.self, from: data) else { return }
    Task { @MainActor in WatchRoundModel.shared.apply(round) }
  }
}
