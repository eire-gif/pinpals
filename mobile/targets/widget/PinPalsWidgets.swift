import SwiftUI
import WidgetKit

// PinPals Home Screen widgets (Oct 2026).
//
// The widget never does golf: the website works the scoreboard out
// (src/lib/widget-board.ts) and this file only lays out the strings it
// sends. The app puts the member's widget key in the shared App Group
// (mobile/src/lib/widgets.ts); the widget fetches GET /api/widget/live with
// it every few minutes while a game is live, and whenever the app scores.

let appGroup = "group.ie.pinpals.app"

// MARK: - The payload (mirrors WidgetPayload in widget-board.ts)

struct WTeam: Codable, Hashable { let name: String; let points: String; let side: Int }
struct WMatch: Codable, Hashable { let label: String; let names: String; let status: String; let side: Int; let mine: Bool }
struct WRow: Codable, Hashable { let pos: String; let name: String; let thru: String; let score: String; let mine: Bool; let good: Bool }
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

// MARK: - Timeline

struct LiveEntry: TimelineEntry {
  let date: Date
  let payload: WPayload?
  /** Set when there's nothing to draw: not signed in, or no connection yet. */
  let message: String?
}

struct LiveProvider: TimelineProvider {
  func placeholder(in context: Context) -> LiveEntry {
    LiveEntry(date: Date(), payload: Sample.matchDay, message: nil)
  }

  func getSnapshot(in context: Context, completion: @escaping (LiveEntry) -> Void) {
    if context.isPreview {
      completion(LiveEntry(date: Date(), payload: Sample.matchDay, message: nil))
      return
    }
    Task { completion(await Loader.entry()) }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<LiveEntry>) -> Void) {
    Task {
      let entry = await Loader.entry()
      // While a game is live ask again soon; otherwise check in now and then
      // for the next game. iOS treats these as hints and spaces them out.
      let minutes = (entry.payload?.isLive ?? false) ? 5.0 : 30.0
      completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(minutes * 60))))
    }
  }
}

enum Loader {
  static let lastKey = "widgetLastPayload"

  static func entry() async -> LiveEntry {
    let defaults = UserDefaults(suiteName: appGroup)
    guard
      let token = defaults?.string(forKey: "widgetToken"), !token.isEmpty,
      let api = defaults?.string(forKey: "widgetApi"), let url = URL(string: api)
    else {
      return LiveEntry(date: Date(), payload: nil, message: "Open PinPals and sign in to see your games here.")
    }

    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
    request.setValue("Widget \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    do {
      let (data, response) = try await URLSession.shared.data(for: request)
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 401 {
        return LiveEntry(date: Date(), payload: nil, message: "Open PinPals to refresh this widget.")
      }
      if status == 200, let payload = try? JSONDecoder().decode(WPayload.self, from: data) {
        defaults?.set(data, forKey: lastKey)
        return LiveEntry(date: Date(), payload: payload, message: nil)
      }
    } catch {
      // No signal on the course: fall through to the last scoreboard.
    }
    if let data = defaults?.data(forKey: lastKey), let payload = try? JSONDecoder().decode(WPayload.self, from: data) {
      return LiveEntry(date: Date(), payload: payload, message: nil)
    }
    return LiveEntry(date: Date(), payload: nil, message: "Couldn't reach PinPals. It'll try again shortly.")
  }
}

// MARK: - Look

enum PP {
  static let navy = Color(red: 12 / 255, green: 32 / 255, blue: 56 / 255)
  static let navyLift = Color(red: 24 / 255, green: 58 / 255, blue: 104 / 255)
  static let gold = Color(red: 232 / 255, green: 196 / 255, blue: 107 / 255)
  static let goldDeep = Color(red: 211 / 255, green: 165 / 255, blue: 63 / 255)
  static let blue = Color(red: 30 / 255, green: 78 / 255, blue: 140 / 255)
  static let cream = Color(red: 247 / 255, green: 243 / 255, blue: 234 / 255)
  static let ink = Color(red: 14 / 255, green: 21 / 255, blue: 32 / 255)
  static let live = Color(red: 63 / 255, green: 191 / 255, blue: 95 / 255)
  static let good = Color(red: 143 / 255, green: 220 / 255, blue: 159 / 255)
  static let line = Color.white.opacity(0.12)
  static let mineRow = Color.white.opacity(0.10)

  static func side(_ n: Int) -> Color { n == 1 ? blue : n == 2 ? goldDeep : Color.white.opacity(0.18) }
  static func sideText(_ n: Int) -> Color { n == 2 ? ink : cream }
}

struct Background: View {
  var body: some View {
    ZStack(alignment: .top) {
      PP.navy
      Ellipse()
        .fill(PP.navyLift.opacity(0.55))
        .frame(height: 150)
        .scaleEffect(x: 1.6, y: 1)
        .offset(y: -70)
    }
  }
}

struct Eyebrow: View {
  let text: String
  let live: Bool
  var body: some View {
    HStack(spacing: 6) {
      Text(text)
        .font(.system(size: 10.5, weight: .bold))
        .tracking(1.4)
        .foregroundStyle(PP.gold)
        .lineLimit(1)
      Spacer(minLength: 4)
      if live {
        HStack(spacing: 4) {
          Circle().fill(PP.live).frame(width: 6, height: 6)
          Text("LIVE").font(.system(size: 10.5, weight: .bold)).tracking(1.2).foregroundStyle(PP.good)
        }
      } else {
        Text("FINAL").font(.system(size: 10.5, weight: .bold)).tracking(1.2).foregroundStyle(PP.cream.opacity(0.6))
      }
    }
  }
}

struct Pill: View {
  let text: String
  let side: Int
  var body: some View {
    Text(text)
      .font(.system(size: 12, weight: .bold))
      .monospacedDigit()
      .foregroundStyle(PP.sideText(side))
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .background(Capsule().fill(PP.side(side)))
      .lineLimit(1)
      .fixedSize()
  }
}

// MARK: - Sizes

struct SmallView: View {
  let payload: WPayload
  var body: some View {
    if let m = payload.mine {
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 5) {
          Text(m.eyebrow).font(.system(size: 10, weight: .bold)).tracking(1.3).foregroundStyle(PP.gold).lineLimit(1)
          if payload.isLive { Circle().fill(PP.live).frame(width: 6, height: 6) }
        }
        Text(m.title).font(.system(size: 15, weight: .bold, design: .serif)).foregroundStyle(PP.cream).lineLimit(1)
        Spacer(minLength: 0)
        Text(m.big)
          .font(.system(size: 40, weight: .heavy, design: .rounded))
          .foregroundStyle(PP.gold)
          .minimumScaleFactor(0.5)
          .lineLimit(1)
        Text(m.line1).font(.system(size: 13, weight: .semibold)).foregroundStyle(PP.cream).lineLimit(1).minimumScaleFactor(0.8)
        if !m.line2.isEmpty {
          Text(m.line2).font(.system(size: 11)).foregroundStyle(PP.cream.opacity(0.65)).lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else {
      NoGameView(payload: payload)
    }
  }
}

struct TeamsRow: View {
  let teams: [WTeam]
  let tall: Bool
  var body: some View {
    HStack(spacing: 8) {
      ForEach(teams, id: \.self) { t in
        VStack(alignment: t.side == 1 ? .leading : .trailing, spacing: 0) {
          Text(t.name.uppercased()).font(.system(size: 9.5, weight: .bold)).tracking(1.1).lineLimit(1)
          Text(t.points).font(.system(size: tall ? 30 : 24, weight: .heavy, design: .rounded)).monospacedDigit()
        }
        .foregroundStyle(PP.sideText(t.side))
        .frame(maxWidth: .infinity, alignment: t.side == 1 ? .leading : .trailing)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(PP.side(t.side)))
      }
    }
  }
}

struct MatchRow: View {
  let m: WMatch
  var body: some View {
    HStack(spacing: 8) {
      Text("\(m.label) · \(m.names)")
        .font(.system(size: 12.5, weight: .semibold))
        .foregroundStyle(PP.cream)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 4)
      Pill(text: m.status, side: m.side)
    }
    .padding(.vertical, 3)
    .padding(.horizontal, m.mine ? 6 : 0)
    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(m.mine ? PP.mineRow : Color.clear))
    .padding(.horizontal, m.mine ? -6 : 0)
  }
}

struct MatchesView: View {
  let payload: WPayload
  let maxMatches: Int
  let tall: Bool
  var body: some View {
    VStack(alignment: .leading, spacing: tall ? 8 : 5) {
      Eyebrow(text: payload.eyebrow, live: payload.isLive)
      if !payload.teams.isEmpty { TeamsRow(teams: payload.teams, tall: tall) }
      else { Text(payload.title).font(.system(size: 15, weight: .bold, design: .serif)).foregroundStyle(PP.cream).lineLimit(1) }
      VStack(spacing: tall ? 4 : 1) {
        ForEach(Array(payload.matches.prefix(maxMatches).enumerated()), id: \.offset) { i, m in
          if i > 0 && !m.mine && !payload.matches[i - 1].mine { Divider().overlay(PP.line) }
          MatchRow(m: m)
        }
      }
      Spacer(minLength: 0)
      if tall { Updated(payload: payload) }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct BoardView: View {
  let payload: WPayload
  let maxRows: Int
  let tall: Bool
  var body: some View {
    VStack(alignment: .leading, spacing: tall ? 6 : 3) {
      Eyebrow(text: payload.eyebrow, live: payload.isLive)
      Text(payload.title)
        .font(.system(size: tall ? 20 : 15, weight: .bold, design: .serif))
        .foregroundStyle(PP.cream)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      if let board = payload.board {
        if tall {
          HStack(spacing: 8) {
            Text("POS").frame(width: 26, alignment: .leading)
            Text("NAME")
            Spacer()
            Text("THRU").frame(width: 34, alignment: .trailing)
            Text(board.heading).frame(width: 38, alignment: .trailing)
          }
          .font(.system(size: 9.5, weight: .bold))
          .tracking(1.1)
          .foregroundStyle(PP.cream.opacity(0.6))
          Divider().overlay(PP.line)
        }
        VStack(spacing: tall ? 3 : 1) {
          ForEach(Array(board.rows.prefix(maxRows).enumerated()), id: \.offset) { _, r in
            HStack(spacing: 8) {
              Text(r.pos).font(.system(size: 13, weight: .bold)).foregroundStyle(PP.gold).frame(width: 26, alignment: .leading)
              Text(r.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(PP.cream).lineLimit(1)
              Spacer(minLength: 4)
              Text(r.thru).font(.system(size: 12.5)).monospacedDigit().foregroundStyle(PP.cream.opacity(0.75)).frame(width: 34, alignment: .trailing)
              Text(r.score)
                .font(.system(size: 15, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(r.good ? PP.good : PP.cream)
                .frame(width: 38, alignment: .trailing)
            }
            .padding(.vertical, tall ? 4 : 2)
            .padding(.horizontal, 6)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(r.mine ? PP.mineRow : Color.clear))
            .padding(.horizontal, -6)
          }
        }
      }
      Spacer(minLength: 0)
      if tall { Updated(payload: payload) }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct Updated: View {
  let payload: WPayload
  var body: some View {
    HStack {
      Spacer()
      if let d = payload.updated {
        (Text("Updated ") + Text(d, style: .relative) + Text(" ago"))
          .font(.system(size: 11))
          .foregroundStyle(PP.cream.opacity(0.6))
      }
    }
  }
}

struct NoGameView: View {
  let payload: WPayload?
  var message: String? = nil
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("PINPALS").font(.system(size: 10.5, weight: .bold)).tracking(1.4).foregroundStyle(PP.gold)
      Spacer(minLength: 0)
      Image(systemName: "flag.fill").foregroundStyle(PP.gold)
      Text(message == nil ? "No game in play" : "PinPals Live")
        .font(.system(size: 15, weight: .bold, design: .serif))
        .foregroundStyle(PP.cream)
      Text(message ?? "Start a round, match or scramble and it shows here.")
        .font(.system(size: 11.5))
        .foregroundStyle(PP.cream.opacity(0.7))
        .lineLimit(3)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct LiveWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: LiveEntry

  var body: some View {
    content
      .containerBackground(for: .widget) { Background() }
      .widgetURL(URL(string: entry.payload?.url ?? "pinpals://live"))
  }

  @ViewBuilder var content: some View {
    if let p = entry.payload, p.state != "none" {
      let isMatches = !p.matches.isEmpty
      switch family {
      case .systemSmall:
        SmallView(payload: p)
      case .systemLarge:
        if isMatches { MatchesView(payload: p, maxMatches: 7, tall: true) } else { BoardView(payload: p, maxRows: 7, tall: true) }
      default:
        if isMatches { MatchesView(payload: p, maxMatches: p.teams.isEmpty ? 4 : 3, tall: false) } else { BoardView(payload: p, maxRows: 3, tall: false) }
      }
    } else {
      NoGameView(payload: entry.payload, message: entry.message)
    }
  }
}

// MARK: - The widget

struct PinPalsLiveWidget: Widget {
  let kind = "PinPalsLive"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: LiveProvider()) { entry in
      LiveWidgetView(entry: entry)
    }
    .configurationDisplayName("PinPals Live")
    .description("Your match, match day or leaderboard, live.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

@main
struct PinPalsWidgetBundle: WidgetBundle {
  var body: some Widget {
    PinPalsLiveWidget()
  }
}

// MARK: - Preview data (the widget gallery, before a game is loaded)

enum Sample {
  static let matchDay = WPayload(
    v: 1, state: "live", updatedAt: "", url: "pinpals://live",
    eyebrow: "PINPALS · BIG TEST", title: "Portmarnock Links",
    teams: [WTeam(name: "Blues", points: "3½", side: 1), WTeam(name: "Golds", points: "2½", side: 2)],
    matches: [
      WMatch(label: "M1", names: "Eire & Tom v Ciarán & Ruth", status: "2 UP · 11", side: 1, mine: true),
      WMatch(label: "M2", names: "Niamh v Darragh", status: "1 UP · 9", side: 2, mine: false),
      WMatch(label: "M3", names: "Geoff & Bill v Sean & Pat", status: "AS · 10", side: 0, mine: false),
    ],
    board: nil,
    mine: WMine(eyebrow: "YOUR MATCH", title: "Match 1", big: "2 UP", line1: "Blues · thru 11", line2: "Eire & Tom v Ciarán & Ruth")
  )
}
