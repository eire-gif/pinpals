import SwiftUI
import WidgetKit

// Watch v2 (claude/watch-v2.md): PinPals on the watch face and in the Smart
// Stack. Reads the round summary the watch app keeps in the App Group
// (targets/watch/WatchGlance.swift — keep the two structs in step). Tapping
// any of them opens the watch app on the round.
//
// Apple doesn't let an app replace the watch face, so this is how PinPals
// sits on the member's own face: the hole and distance, the points, and the
// standing — and nothing but the flag when no round is live.

private let appGroup = "group.ie.pinpals.app"
private let glanceKey = "watchGlance"
private let gold = Color("gold")

struct GlanceData: Codable {
  let live: Bool
  let course: String
  let hole: Int
  let par: Int
  let yards: Int?
  let line: String
  let progress: Double?
  let at: Double
}

struct GlanceEntry: TimelineEntry {
  let date: Date
  let data: GlanceData?
  /** Smart Stack: high while a round is live, so it comes to the top. */
  var relevance: TimelineEntryRelevance? {
    guard let d = data, d.live else { return TimelineEntryRelevance(score: 0) }
    return TimelineEntryRelevance(score: 100, duration: 15 * 60)
  }
}

struct GlanceProvider: TimelineProvider {
  private func read() -> GlanceData? {
    guard let raw = UserDefaults(suiteName: appGroup)?.data(forKey: glanceKey),
          let d = try? JSONDecoder().decode(GlanceData.self, from: raw) else { return nil }
    // A summary older than six hours is a round someone forgot to finish.
    if Date().timeIntervalSince1970 - d.at > 6 * 3600 { return nil }
    return d
  }

  func placeholder(in context: Context) -> GlanceEntry {
    GlanceEntry(date: Date(), data: GlanceData(live: true, course: "Portmarnock", hole: 7, par: 4, yards: 398, line: "16 pts · thru 6", progress: 0.2, at: 0))
  }

  func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
    completion(context.isPreview ? placeholder(in: context) : GlanceEntry(date: Date(), data: read()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
    let data = read()
    // The watch app asks for a refresh as things change; this is the fallback.
    let next = Date().addingTimeInterval(data?.live == true ? 10 * 60 : 60 * 60)
    completion(Timeline(entries: [GlanceEntry(date: Date(), data: data)], policy: .after(next)))
  }
}

struct GlanceView: View {
  @Environment(\.widgetFamily) private var family
  let entry: GlanceEntry

  var body: some View {
    content.containerBackground(for: .widget) { Color.clear }
  }

  @ViewBuilder
  private var content: some View {
    let d = entry.data.flatMap { $0.live ? $0 : nil }
    switch family {
    case .accessoryCircular:
      if let d = d {
        Gauge(value: d.progress ?? 0) {
          Text("\(d.hole)")
        } currentValueLabel: {
          VStack(spacing: -2) {
            Text("\(d.hole)").font(.system(size: 9, weight: .heavy)).foregroundStyle(gold)
            Text(d.yards.map { "\($0)" } ?? "P\(d.par)").font(.system(size: 15, weight: .heavy, design: .rounded)).minimumScaleFactor(0.6)
          }
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(gold)
        .accessibilityLabel(d.yards.map { "Hole \(d.hole), \($0) yards to the green" } ?? "Hole \(d.hole), par \(d.par)")
      } else {
        flag
      }
    case .accessoryCorner:
      if let d = d {
        Text(d.yards.map { "\($0)" } ?? "\(d.hole)")
          .font(.system(size: 20, weight: .heavy, design: .rounded))
          .widgetCurvesContent()
          .widgetLabel { Text("Hole \(d.hole) · Par \(d.par)") }
      } else {
        flag.widgetLabel { Text("PinPals") }
      }
    case .accessoryInline:
      if let d = d {
        Text(d.yards.map { "Hole \(d.hole) · \($0) yds" } ?? "Hole \(d.hole) · Par \(d.par)")
      } else {
        Text("PinPals")
      }
    default:
      if let d = d {
        VStack(alignment: .leading, spacing: 1) {
          Text("PINPALS · HOLE \(d.hole)").font(.system(size: 11, weight: .heavy)).foregroundStyle(gold)
          if let y = d.yards {
            Text("\(y) to centre · Par \(d.par)").font(.system(size: 15, weight: .bold)).lineLimit(1).minimumScaleFactor(0.8)
          } else {
            Text("Par \(d.par)").font(.system(size: 15, weight: .bold))
          }
          Text(d.line).font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        HStack(spacing: 6) {
          flag
          VStack(alignment: .leading) {
            Text("PinPals").font(.headline)
            Text("No live round").font(.footnote).foregroundStyle(.secondary)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var flag: some View {
    Image(systemName: "flag.fill").font(.system(size: 18, weight: .bold)).foregroundStyle(gold).accessibilityLabel("PinPals")
  }
}

@main
struct PinPalsComplications: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "PinPalsRound", provider: GlanceProvider()) { entry in
      GlanceView(entry: entry)
    }
    .configurationDisplayName("PinPals round")
    .description("The hole, your distance to the green and how you stand, during a live round.")
    .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryRectangular, .accessoryInline])
  }
}
