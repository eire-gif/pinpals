import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The lock screen card and Dynamic Island for scoring a round (Oct 2026).
// Data, intents and saving live in _shared/LiveScoreShared.swift.
//
// Apple gives a Live Activity about 160 points of height on the lock screen,
// so the card is three rows:
//   HOLE 7 · PAR 4 · SI 3 •            18 pts · thru 6
//   [ − ]      5       [ + ]   [ ✓ Save ]
//          Net par · 2 pts
//   [Picked up]   Hole 6 · 4 · 3 pts  Undo   [152 yds] [mic]
//
// The last two are links (voice scoring, Oct 2026): the distance to the
// green opens the hole map, the mic opens the round on this hole already
// listening. Both unlock the phone first, as any link from the lock screen
// does. Either is left out when there's nothing behind it (no map for the
// course; voice scoring off).
//
// The number starts at net par in a dimmed colour (as on the app's scoring
// screen) and turns bright once − or + is tapped. Save works either way.

struct LiveScoreLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LiveScoreAttributes.self) { context in
      LiveScoreLockView(attributes: context.attributes, state: context.state)
        .activityBackgroundTint(PP.navy.opacity(0.94))
        .activitySystemActionForegroundColor(PP.cream)
        .widgetURL(URL(string: context.attributes.url))
    } dynamicIsland: { context in
      let a = context.attributes
      let s = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          VStack(alignment: .leading, spacing: 1) {
            Text("HOLE \(s.hole)").font(.system(size: 12, weight: .bold)).tracking(1.1).foregroundStyle(PP.gold)
            Text(LiveScoreText.holeLine(a, s.hole)).font(.system(size: 12)).foregroundStyle(PP.cream.opacity(0.75))
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(a.totalShort(s.strokes))
            .font(.system(size: 15, weight: .heavy, design: .rounded))
            .foregroundStyle(PP.gold)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          if s.finished || (a.allIn(s.strokes) && !s.editing) {
            LiveScoreDoneRow(attributes: a, state: s)
          } else {
            LiveScoreEntryRow(attributes: a, state: s, compact: true)
          }
        }
      } compactLeading: {
        Text("H\(s.hole)").font(.system(size: 14, weight: .bold)).foregroundStyle(PP.cream)
      } compactTrailing: {
        Text(a.totalShort(s.strokes)).font(.system(size: 14, weight: .heavy, design: .rounded)).foregroundStyle(PP.gold)
      } minimal: {
        Text("\(s.hole)").font(.system(size: 14, weight: .bold)).foregroundStyle(PP.gold)
      }
      .widgetURL(URL(string: a.url))
      .keylineTint(PP.gold)
    }
  }
}

enum LiveScoreText {
  /** "Par 4 · SI 3", with a dot per shot the player gets. */
  static func holeLine(_ a: LiveScoreAttributes, _ n: Int) -> String {
    guard let h = a.info(n) else { return "" }
    var line = "Par \(h.par)"
    if let si = h.si { line += " · SI \(si)" }
    if h.shots > 0 { line += " · " + String(repeating: "•", count: min(h.shots, 3)) }
    return line
  }

  /** The number on the card: what was chosen, or net par. */
  static func shown(_ a: LiveScoreAttributes, _ s: LiveScoreAttributes.ContentState) -> Int {
    s.draft ?? a.netPar(s.hole)
  }
}

struct LiveScoreLockView: View {
  let attributes: LiveScoreAttributes
  let state: LiveScoreAttributes.ContentState

  var body: some View {
    let a = attributes
    let s = state
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text(s.finished ? a.course.uppercased() : "HOLE \(s.hole) · \(LiveScoreText.holeLine(a, s.hole).uppercased())")
          .font(.system(size: 12, weight: .bold))
          .tracking(1.1)
          .foregroundStyle(PP.gold)
          .lineLimit(1)
        Spacer(minLength: 8)
        Text(a.total(s.strokes))
          .font(.system(size: 13, weight: .bold))
          .monospacedDigit()
          .foregroundStyle(PP.cream)
          .lineLimit(1)
      }

      if s.finished || (a.allIn(s.strokes) && !s.editing) {
        LiveScoreDoneRow(attributes: a, state: s)
        if !s.finished && (s.undoHole != nil || s.notice != nil) {
          HStack {
            Spacer(minLength: 0)
            LiveScoreFootnote(attributes: a, state: s)
          }
        }
      } else {
        LiveScoreEntryRow(attributes: a, state: s, compact: false)

        HStack(spacing: 8) {
          Button(intent: LiveScorePickedUpIntent(roundId: a.roundId)) {
            Text("NR")
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(PP.cream.opacity(0.8))
              .padding(.horizontal, 12)
              .frame(height: 30)
              .overlay(Capsule().stroke(PP.cream.opacity(0.3), lineWidth: 1))
          }
          .buttonStyle(.plain)
          Spacer(minLength: 4)
          // Gives way first when the row is full: it scales down, the buttons don't.
          LiveScoreFootnote(attributes: a, state: s)
            .layoutPriority(-1)
          LiveScoreLinks(attributes: a, state: s)
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 14)
  }
}

/** −  number  +  Save */
struct LiveScoreEntryRow: View {
  let attributes: LiveScoreAttributes
  let state: LiveScoreAttributes.ContentState
  let compact: Bool

  var body: some View {
    let a = attributes
    let s = state
    let value = LiveScoreText.shown(a, s)
    let size: CGFloat = compact ? 40 : 46
    HStack(spacing: compact ? 8 : 10) {
      Button(intent: LiveScoreStepIntent(roundId: a.roundId, delta: -1)) {
        Image(systemName: "minus")
          .font(.system(size: 18, weight: .bold))
          .foregroundStyle(PP.cream)
          .frame(width: size, height: size)
          .background(Circle().fill(Color.white.opacity(0.14)))
      }
      .buttonStyle(.plain)
      .accessibilityLabel("One fewer stroke")

      VStack(spacing: 0) {
        Text("\(value)")
          .font(.system(size: compact ? 30 : 36, weight: .heavy, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(s.draft == nil ? PP.cream.opacity(0.55) : PP.cream)
        Text(a.describe(value, s.hole))
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(PP.gold)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      .frame(maxWidth: .infinity)

      Button(intent: LiveScoreStepIntent(roundId: a.roundId, delta: 1)) {
        Image(systemName: "plus")
          .font(.system(size: 18, weight: .bold))
          .foregroundStyle(PP.cream)
          .frame(width: size, height: size)
          .background(Circle().fill(Color.white.opacity(0.14)))
      }
      .buttonStyle(.plain)
      .accessibilityLabel("One more stroke")

      Button(intent: LiveScoreSaveIntent(roundId: a.roundId)) {
        HStack(spacing: 5) {
          Image(systemName: "checkmark").font(.system(size: 14, weight: .heavy))
          Text("Save").font(.system(size: 16, weight: .heavy))
        }
        .foregroundStyle(PP.navy)
        .padding(.horizontal, compact ? 14 : 16)
        .frame(height: size)
        .background(Capsule().fill(PP.gold))
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Save \(value) for hole \(s.hole)")
    }
  }
}

/** Bottom right: the last save with Undo, or what's waiting, or the app's standing. */
struct LiveScoreFootnote: View {
  let attributes: LiveScoreAttributes
  let state: LiveScoreAttributes.ContentState

  var body: some View {
    let s = state
    if let notice = s.notice {
      Text(notice).font(.system(size: 12, weight: .semibold)).foregroundStyle(PP.gold).lineLimit(1).minimumScaleFactor(0.8)
    } else if let saved = s.saved {
      HStack(spacing: 6) {
        Image(systemName: s.waiting > 0 ? "icloud.slash" : "checkmark.circle.fill")
          .font(.system(size: 12, weight: .bold))
          .foregroundStyle(s.waiting > 0 ? PP.gold : PP.good)
        Text(saved).font(.system(size: 12, weight: .semibold)).foregroundStyle(PP.cream.opacity(0.9)).lineLimit(1).minimumScaleFactor(0.75)
        if s.undoHole != nil {
          Button(intent: LiveScoreUndoIntent(roundId: attributes.roundId)) {
            Text("Undo").font(.system(size: 12, weight: .bold)).underline().foregroundStyle(PP.cream)
              .frame(minHeight: 30)
          }
          .buttonStyle(.plain)
        }
      }
    } else if s.waiting > 0 {
      Text(s.waiting == 1 ? "1 score waiting for signal" : "\(s.waiting) scores waiting for signal")
        .font(.system(size: 12, weight: .semibold)).foregroundStyle(PP.gold).lineLimit(1)
    } else if let status = s.status {
      Text(status).font(.system(size: 12, weight: .semibold)).foregroundStyle(PP.cream.opacity(0.8)).lineLimit(1)
    }
  }
}

/** The distance to the green (opens the hole map) and the mic (opens the round, listening). */
struct LiveScoreLinks: View {
  let attributes: LiveScoreAttributes
  let state: LiveScoreAttributes.ContentState

  var body: some View {
    let s = state
    HStack(spacing: 6) {
      if let d = s.distance, let base = attributes.mapUrl, let url = URL(string: base + String(s.hole)) {
        let fromYou = s.distanceFrom == "you"
        Link(destination: url) {
          HStack(spacing: 4) {
            Image(systemName: fromYou ? "location.fill" : "flag.fill")
              .font(.system(size: 10, weight: .bold))
              .foregroundStyle(fromYou ? PP.good : PP.gold)
            Text("\(d) yds")
              .font(.system(size: 13, weight: .bold))
              .monospacedDigit()
              .foregroundStyle(PP.cream)
              .lineLimit(1)
              .fixedSize()
          }
          .padding(.horizontal, 10)
          .frame(height: 30)
          .background(Capsule().fill(Color.white.opacity(0.14)))
        }
        .accessibilityLabel(fromYou ? "\(d) yards to the centre of the green. Open the hole map" : "Hole \(s.hole), \(d) yards from the tee. Open the hole map")
      }
      if let base = attributes.voiceUrl, let url = URL(string: base + String(s.hole)) {
        Link(destination: url) {
          Image(systemName: "mic.fill")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(PP.navy)
            .frame(width: 30, height: 30)
            .background(Circle().fill(PP.gold))
        }
        .accessibilityLabel("Say the scores for hole \(s.hole)")
      }
    }
  }
}

/** Every hole in, or the round finished. */
struct LiveScoreDoneRow: View {
  let attributes: LiveScoreAttributes
  let state: LiveScoreAttributes.ContentState

  var body: some View {
    let s = state
    HStack(spacing: 10) {
      Image(systemName: "flag.checkered").font(.system(size: 20, weight: .bold)).foregroundStyle(PP.gold)
      VStack(alignment: .leading, spacing: 2) {
        Text(s.finished ? "Round finished" : "All \(attributes.holes.count) holes in")
          .font(.system(size: 17, weight: .bold, design: .serif))
          .foregroundStyle(PP.cream)
        Text(s.finished ? (s.status ?? attributes.total(s.strokes)) : (s.waiting > 0 ? "Sending when there's signal" : "Open PinPals to finish and get your card certified"))
          .font(.system(size: 12))
          .foregroundStyle(PP.cream.opacity(0.75))
          .lineLimit(2)
      }
      Spacer(minLength: 0)
    }
  }
}
