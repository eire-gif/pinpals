import ActivityKit
import AppIntents
import Foundation

// The leaderboard on the lock screen (Oct 2026, claude/lock-screen-leaderboard.md).
//
// A second Live Activity beside the scoring card (LiveScoreShared.swift):
// while a member's round is live, the top of their game's leaderboard sits
// under the scoring card — positions, names, thru and score, their own row
// marked — or, for matches, the team totals and the matches.
//
// The golf is the website's. The card reads the same payload as the Home
// Screen widgets and the watch's leaderboard (GET /api/widget/live/board,
// src/lib/widget-board.ts), with the scoring card's key, and only picks
// which rows fit. A secret leaderboard shows only the member's own group,
// as everywhere else (widget-data.ts).
//
// Keeping it fresh without a server push (no APNs key yet):
//   - every minute or so while the app's location updates are running for
//     the distance to the green — they keep the app awake with the phone
//     locked (setLocation in the bridge);
//   - after every score saved from the lock screen or the watch;
//   - when the app scores or reopens the round;
//   - the ⟳ button on the card.
// Without location the card still refreshes on each of the others, and says
// what time it's from.
//
// This file is in `_shared`: the widget extension draws the card
// (LiveBoardLiveActivity.swift) and needs the attributes and the refresh
// button's intent; the app runs that intent and the refreshes. Starting and
// ending the card (Activity.request / end) is app-only and lives in the
// extension at the bottom marked so.

// MARK: - The payload (mirrors WidgetPayload in src/lib/widget-board.ts)

struct WTeam: Codable, Hashable { let name: String; let points: String; let side: Int }
struct WMatch: Codable, Hashable { let label: String; let names: String; let status: String; let side: Int; let mine: Bool }
struct WRow: Codable, Hashable {
  let pos: String; let name: String; let thru: String; let score: String; let mine: Bool; let good: Bool
  /// Multi-day championships (0187): places gained (+) or lost (−) since the previous day. Absent on a one-day board.
  let move: Int?
}
struct WBoard: Codable, Hashable { let heading: String; let rows: [WRow] }
struct WMine: Codable, Hashable { let eyebrow: String; let title: String; let big: String; let line1: String; let line2: String }

struct WPayload: Codable {
  let v: Int
  let state: String
  let updatedAt: String
  let url: String
  let eyebrow: String
  let title: String
  let teams: [WTeam]
  let matches: [WMatch]
  let board: WBoard?
  let mine: WMine?

  var isLive: Bool { state == "live" }
  var updated: Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: updatedAt) ?? ISO8601DateFormatter().date(from: updatedAt)
  }
}

// MARK: - The card's data

@available(iOS 16.1, *)
struct LiveBoardAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /** "LEADERBOARD · BIG TEST" */
    var heading: String
    var live: Bool
    /** Up to four leaderboard rows, the member's marked. Empty for matches. */
    var rows: [WRow]
    /** Match day team totals: none, or both sides. */
    var teams: [WTeam]
    /** Up to three matches, the member's among them. */
    var matches: [WMatch]
    /** The member's place when their row isn't in `rows`: "12th · 18 pts · thru 6". */
    var you: String?
    /** The Dynamic Island's corner: "2nd", "2 UP". */
    var short: String?
    /** When the website worked this board out. nil = not loaded yet. */
    var updated: Date?
    /** "Waiting for signal", "Open PinPals to refresh the leaderboard". */
    var notice: String?
  }

  let roundId: Int
  /** Opens the game's leaderboard in the app. */
  let url: String
}

// MARK: - Which rows fit

/**
 * Apple gives a Live Activity about 160 points of height, so the card shows
 * four leaderboard rows — the top four, or the top three and the member's
 * own row when they're further down (or a line saying where they are, when
 * they're below the eight rows the website sends).
 */
@available(iOS 16.1, *)
enum LiveBoardPick {
  static let maxRows = 4
  static let maxMatches = 3

  /** The first `max`, or the first `max - 1` and the member's, when theirs isn't among them. */
  static func pick<T>(_ all: [T], max: Int, mine: (T) -> Bool) -> [T] {
    guard all.count > max else { return all }
    let top = Array(all.prefix(max))
    if top.contains(where: mine) || !all.contains(where: mine) { return top }
    return Array(all.prefix(max - 1)) + Array(all.filter(mine).prefix(1))
  }

  /** "PINPALS · BIG TEST" → "LEADERBOARD · BIG TEST"; "PINPALS" → "LEADERBOARD". */
  static func heading(_ eyebrow: String) -> String {
    let parts = eyebrow.components(separatedBy: " · ").filter { $0.uppercased() != "PINPALS" && !$0.isEmpty }
    return (["LEADERBOARD"] + parts).joined(separator: " · ")
  }

  /** Names come from members; keep the card well inside ActivityKit's 4 KB. */
  static func clip(_ text: String, _ max: Int = 40) -> String {
    text.count > max ? String(text.prefix(max - 1)) + "…" : text
  }

  static func state(_ p: WPayload, now: Date) -> LiveBoardAttributes.ContentState {
    var s = LiveBoardAttributes.ContentState(
      heading: heading(p.eyebrow), live: p.isLive, rows: [], teams: Array(p.teams.prefix(2)), matches: [],
      you: nil, short: p.mine?.big, updated: p.updated ?? now, notice: nil
    )
    if p.state == "none" {
      s.notice = "No game in play"
      return s
    }
    if !p.matches.isEmpty {
      // Team totals take a row's room.
      s.matches = pick(p.matches, max: s.teams.isEmpty ? maxMatches : maxMatches - 1, mine: { $0.mine })
        .map { WMatch(label: $0.label, names: clip($0.names), status: $0.status, side: $0.side, mine: $0.mine) }
      return s
    }
    let rows = p.board?.rows ?? []
    s.rows = pick(rows, max: maxRows, mine: { $0.mine })
    if !s.rows.contains(where: { $0.mine }), let m = p.mine, m.big != "–" {
      // Below the rows sent: the top three, then where they are.
      s.rows = Array(rows.prefix(maxRows - 1))
      s.you = m.line1.isEmpty ? m.big : "\(m.big) · \(m.line1)"
    }
    s.rows = s.rows.map { WRow(pos: $0.pos, name: clip($0.name), thru: $0.thru, score: $0.score, mine: $0.mine, good: $0.good, move: $0.move) }
    return s
  }

  /** Before the first board arrives: the card's frame with a word in it. */
  static func loading() -> LiveBoardAttributes.ContentState {
    LiveBoardAttributes.ContentState(
      heading: "LEADERBOARD", live: true, rows: [], teams: [], matches: [], you: nil, short: nil, updated: nil,
      notice: "Getting the leaderboard…"
    )
  }
}

// MARK: - What the app remembers about it (the App Group)

enum LiveBoardStore {
  private static var defaults: UserDefaults? { UserDefaults(suiteName: liveScoreAppGroup) }
  private static func k(_ name: String, _ roundId: Int) -> String { "liveBoard\(name).\(roundId)" }
  private static let prefixes = ["liveBoardWanted.", "liveBoardStarted.", "liveBoardTried.", "liveBoardLast.", "liveBoardShown.", "liveBoardApi."]

  /** The app says the round has others on it (or is part of a day): a leaderboard is worth showing. */
  static func wanted(_ roundId: Int) -> Bool { defaults?.bool(forKey: k("Wanted", roundId)) ?? false }
  static func setWanted(_ on: Bool, roundId: Int) { defaults?.set(on, forKey: k("Wanted", roundId)) }

  /**
   * The card was put up for this round. With no card running now, the member
   * swiped it away: it stays away for this round rather than coming back on
   * every score.
   */
  static func started(_ roundId: Int) -> Bool { defaults?.bool(forKey: k("Started", roundId)) ?? false }
  static func setStarted(_ roundId: Int) { defaults?.set(true, forKey: k("Started", roundId)) }

  /** When the board was last asked for (seconds since 1970). */
  static func lastTry(_ roundId: Int) -> Double { defaults?.double(forKey: k("Tried", roundId)) ?? 0 }
  static func setLastTry(_ at: Double, roundId: Int) { defaults?.set(at, forKey: k("Tried", roundId)) }

  /** GET /api/widget/live/board, from the app; else worked out from the scoring address. */
  static func api(_ roundId: Int) -> URL? {
    if let s = defaults?.string(forKey: k("Api", roundId)), let url = URL(string: s) { return url }
    guard let score = LiveScoreStore.config(roundId)?.api, score.hasSuffix("/score") else { return nil }
    return URL(string: String(score.dropLast("/score".count)) + "/board")
  }
  static func setApi(_ api: String, roundId: Int) { defaults?.set(api, forKey: k("Api", roundId)) }

  /** The last board that came back, to put the card up with at once next time. */
  static func last(_ roundId: Int) -> WPayload? {
    guard let data = defaults?.data(forKey: k("Last", roundId)) else { return nil }
    return try? JSONDecoder().decode(WPayload.self, from: data)
  }
  static func setLast(_ data: Data, roundId: Int) { defaults?.set(data, forKey: k("Last", roundId)) }

  /** What the card was last told to show (an activity's own state can lag a moment behind an update). */
  @available(iOS 16.1, *)
  static func shown(_ roundId: Int) -> LiveBoardAttributes.ContentState? {
    guard let data = defaults?.data(forKey: k("Shown", roundId)) else { return nil }
    return try? JSONDecoder().decode(LiveBoardAttributes.ContentState.self, from: data)
  }
  @available(iOS 16.1, *)
  static func setShown(_ s: LiveBoardAttributes.ContentState, roundId: Int) {
    if let data = try? JSONEncoder().encode(s) { defaults?.set(data, forKey: k("Shown", roundId)) }
  }

  private static let lock = NSLock()
  private static var inFlight = Set<Int>()

  /** True when it's time to ask again (not asked in the last `every` seconds, nothing on its way); marks it asked. */
  static func claim(_ roundId: Int, every: Double) -> Bool {
    lock.lock(); defer { lock.unlock() }
    let now = Date().timeIntervalSince1970
    if inFlight.contains(roundId) || now - lastTry(roundId) < every { return false }
    inFlight.insert(roundId)
    setLastTry(now, roundId: roundId)
    return true
  }

  static func release(_ roundId: Int) {
    lock.lock(); defer { lock.unlock() }
    inFlight.remove(roundId)
  }

  static func forget(roundId: Int) {
    for p in prefixes { defaults?.removeObject(forKey: p + String(roundId)) }
  }

  static func clearEverything() {
    guard let d = defaults else { return }
    for key in d.dictionaryRepresentation().keys where prefixes.contains(where: { key.hasPrefix($0) }) {
      d.removeObject(forKey: key)
    }
  }
}

// MARK: - Refreshing it (runs in the app's process)

@available(iOS 17.0, *)
enum LiveBoardEngine {
  /** Below the scoring card: it keeps the Dynamic Island and the top of the lock screen (LiveScoreEngine uses 100). */
  static let relevance: Double = 50
  /** Past this with no refresh, the card greys its time to say it may be behind. */
  static let staleAfter: Double = 10 * 60

  static func activity(_ roundId: Int) -> Activity<LiveBoardAttributes>? {
    Activity<LiveBoardAttributes>.activities.first {
      $0.attributes.roundId == roundId && ($0.activityState == .active || $0.activityState == .stale)
    }
  }

  static func current(_ a: Activity<LiveBoardAttributes>) -> LiveBoardAttributes.ContentState {
    LiveBoardStore.shown(a.attributes.roundId) ?? a.content.state
  }

  /** `fresh` = a new board from the website: good for `staleAfter`. A notice on an old board leaves it as stale as it was. */
  static func content(_ s: LiveBoardAttributes.ContentState, fresh: Bool = true) -> ActivityContent<LiveBoardAttributes.ContentState> {
    let base = fresh ? Date() : (s.updated ?? Date())
    return ActivityContent(state: s, staleDate: base.addingTimeInterval(staleAfter), relevanceScore: relevance)
  }

  static func push(_ a: Activity<LiveBoardAttributes>, _ s: LiveBoardAttributes.ContentState, fresh: Bool = true) async {
    // Ended meanwhile (the round finished mid-fetch): nothing to show, nothing to keep.
    guard a.activityState == .active || a.activityState == .stale else { return }
    LiveBoardStore.setShown(s, roundId: a.attributes.roundId)
    await a.update(content(s, fresh: fresh))
  }

  /**
   * Fetches the board and puts it on the card, unless it was asked for in
   * the last `every` seconds. Does nothing when there's no card for the round.
   */
  static func refresh(roundId: Int, every: Double) async {
    guard activity(roundId) != nil, LiveBoardStore.claim(roundId, every: every) else { return }
    defer { LiveBoardStore.release(roundId) }
    guard let token = LiveScoreStore.config(roundId)?.token, let url = LiveBoardStore.api(roundId) else { return }

    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    request.setValue("LiveScore \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    var next: LiveBoardAttributes.ContentState?
    var fresh = false
    var body: Data?
    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 200, let payload = try? JSONDecoder().decode(WPayload.self, from: data) {
        body = data
        next = LiveBoardPick.state(payload, now: Date())
        fresh = true
      } else if let a = activity(roundId) {
        var s = current(a)
        if status == 401 {
          // The key's run out (18 hours): opening the round in the app renews it.
          s.notice = "Open PinPals to refresh the leaderboard"
          next = s
        } else if s.updated == nil {
          // Something went wrong on the way: don't leave it saying "Getting…".
          s.notice = "Couldn't load the leaderboard. Tap ⟳"
          next = s
        }
      }
    } catch {
      // No signal: keep what's there; only a card still loading says so.
      if let a = activity(roundId) {
        var s = current(a)
        if s.updated == nil {
          s.notice = "Waiting for signal"
          next = s
        }
      }
    }
    // The round may have finished while this was on its way.
    guard let s = next, let a = activity(roundId) else { return }
    if let body = body { LiveBoardStore.setLast(body, roundId: roundId) }
    await push(a, s, fresh: fresh)
  }

  /** Any leaderboard card still up (active or stale). */
  static var running: [Activity<LiveBoardAttributes>] {
    Activity<LiveBoardAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
  }
}

@available(iOS 17.0, *)
struct LiveBoardRefreshIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Refresh the leaderboard"
  // Lock screen button only, not a Shortcuts action.
  static var isDiscoverable: Bool = false
  @Parameter(title: "Round") var roundId: Int

  init() {}
  init(roundId: Int) { self.roundId = roundId }

  func perform() async throws -> some IntentResult {
    await LiveBoardEngine.refresh(roundId: roundId, every: 5)
    return .result()
  }
}

// MARK: - Starting and ending the card (the app only)

// Starting a Live Activity isn't something an extension may do, and this file
// is compiled into the widget extension too.
@available(iOS 17.0, *)
@available(iOSApplicationExtension, unavailable)
extension LiveBoardEngine {
  /**
   * The app opened the round (so it's in front, where a card may be
   * started): put the leaderboard up if the round has others on it — at once,
   * from the last board seen if there is one — then fetch a fresh one.
   */
  static func begin(roundId: Int, url: String, every: Double) {
    guard LiveBoardStore.wanted(roundId) else { return }
    if activity(roundId) == nil {
      // Swiped away earlier in this round: leave it gone.
      guard !LiveBoardStore.started(roundId) else { return }
      let first = LiveBoardStore.last(roundId).map { LiveBoardPick.state($0, now: Date()) } ?? LiveBoardPick.loading()
      do {
        _ = try Activity<LiveBoardAttributes>.request(
          attributes: LiveBoardAttributes(roundId: roundId, url: url), content: content(first), pushType: nil
        )
        LiveBoardStore.setStarted(roundId)
        LiveBoardStore.setShown(first, roundId: roundId)
      } catch {
        return
      }
    }
    Task { await refresh(roundId: roundId, every: every) }
  }

  /** A round's card goes with its scoring card. roundId nil = every one (sign-out). */
  static func end(roundId: Int?, immediate: Bool) {
    for a in Activity<LiveBoardAttributes>.activities where roundId == nil || a.attributes.roundId == roundId {
      var s = current(a)
      s.live = false
      s.notice = nil
      // Finished: the final board stays on the lock screen with the final score for a while.
      let policy: ActivityUIDismissalPolicy = immediate ? .immediate : .after(Date().addingTimeInterval(15 * 60))
      let ending = ActivityContent(state: s, staleDate: nil, relevanceScore: relevance)
      Task { await a.end(ending, dismissalPolicy: policy) }
      LiveBoardStore.forget(roundId: a.attributes.roundId)
    }
    if roundId == nil { LiveBoardStore.clearEverything() }
  }

  /** Starting one round's cards ends any other round's. */
  static func endOthers(keeping roundId: Int) {
    for a in Activity<LiveBoardAttributes>.activities where a.attributes.roundId != roundId {
      Task { await a.end(nil, dismissalPolicy: .immediate) }
      LiveBoardStore.forget(roundId: a.attributes.roundId)
    }
  }
}
