import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The leaderboard card on the lock screen (Oct 2026, claude/lock-screen-leaderboard.md).
// Data, picking rows and refreshing live in _shared/LiveBoardShared.swift.
//
// It sits under the scoring card (lower relevance, so the scoring card keeps
// the Dynamic Island) and fits Apple's ~160 points:
//
//   🏆 LEADERBOARD · BIG TEST             ● LIVE 14:32  (⟳)
//   1st   Ciarán Byrne          14   +3
//   2nd   Eire · You             12   +1      ← their row lit up
//   T3    Ruth Daly              13    E
//   T3    Tom Walsh              11    E
//
// or, for matches, the team totals and the matches with who's up.
// The time is when the website worked the board out, so a board that
// couldn't refresh (no signal) says how old it is.

struct LiveBoardLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: LiveBoardAttributes.self) { context in
      LiveBoardLockView(attributes: context.attributes, state: context.state, stale: context.isStale)
        .activityBackgroundTint(PP.navy.opacity(0.94))
        .activitySystemActionForegroundColor(PP.cream)
        .widgetURL(URL(string: context.attributes.url))
    } dynamicIsland: { context in
      let s = context.state
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text(s.heading)
            .font(.system(size: 11, weight: .bold))
            .tracking(1.1)
            .foregroundStyle(PP.gold)
            .lineLimit(1)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if let short = s.short {
            Text(short)
              .font(.system(size: 15, weight: .heavy, design: .rounded))
              .foregroundStyle(PP.gold)
              .padding(.trailing, 4)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          LiveBoardBody(state: s, maxRows: 3, maxMatches: 2)
        }
      } compactLeading: {
        Image(systemName: "list.number").font(.system(size: 13, weight: .bold)).foregroundStyle(PP.gold)
      } compactTrailing: {
        Text(s.short ?? "–").font(.system(size: 14, weight: .heavy, design: .rounded)).foregroundStyle(PP.cream)
      } minimal: {
        Text(s.short ?? "–").font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundStyle(PP.gold)
          .minimumScaleFactor(0.6)
      }
      .widgetURL(URL(string: context.attributes.url))
      .keylineTint(PP.gold)
    }
  }
}

struct LiveBoardLockView: View {
  let attributes: LiveBoardAttributes
  let state: LiveBoardAttributes.ContentState
  let stale: Bool

  var body: some View {
    let s = state
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .center, spacing: 6) {
        Image(systemName: "trophy.fill").font(.system(size: 11, weight: .bold)).foregroundStyle(PP.gold)
        Text(s.heading)
          .font(.system(size: 12, weight: .bold))
          .tracking(1.1)
          .foregroundStyle(PP.gold)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
        Spacer(minLength: 6)
        LiveBoardWhen(state: s, stale: stale)
        Button(intent: LiveBoardRefreshIntent(roundId: attributes.roundId)) {
          Image(systemName: "arrow.clockwise")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(PP.cream)
            .frame(width: 28, height: 28)
            .background(Circle().fill(Color.white.opacity(0.14)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Refresh the leaderboard")
      }
      LiveBoardBody(state: s, maxRows: LiveBoardPick.maxRows, maxMatches: LiveBoardPick.maxMatches)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

/** ● LIVE 14:32, or FINAL. Greyed when the board hasn't refreshed for a while. */
struct LiveBoardWhen: View {
  let state: LiveBoardAttributes.ContentState
  let stale: Bool

  var body: some View {
    HStack(spacing: 4) {
      if state.live {
        Circle().fill(stale ? PP.cream.opacity(0.4) : PP.live).frame(width: 6, height: 6)
        Text("LIVE").font(.system(size: 10.5, weight: .bold)).tracking(1.1).foregroundStyle(stale ? PP.cream.opacity(0.5) : PP.good)
      } else {
        Text("FINAL").font(.system(size: 10.5, weight: .bold)).tracking(1.1).foregroundStyle(PP.cream.opacity(0.6))
      }
      if let at = state.updated {
        Text(at, style: .time)
          .font(.system(size: 11, weight: .semibold))
          .monospacedDigit()
          .foregroundStyle(PP.cream.opacity(stale ? 0.45 : 0.7))
          .lineLimit(1)
      }
    }
    .fixedSize()
  }
}

/** The rows (or matches), then where the member is or what's wrong. */
struct LiveBoardBody: View {
  let state: LiveBoardAttributes.ContentState
  let maxRows: Int
  let maxMatches: Int

  var body: some View {
    let s = state
    VStack(alignment: .leading, spacing: 2) {
      if !s.matches.isEmpty {
        if s.teams.count == 2 { LiveBoardTeams(teams: s.teams) }
        ForEach(Array(LiveBoardPick.pick(s.matches, max: maxMatches, mine: { $0.mine }).enumerated()), id: \.offset) { _, m in
          LiveBoardMatchRow(m: m)
        }
      } else {
        // The member's row stays in when fewer rows fit (the Dynamic Island).
        ForEach(Array(LiveBoardPick.pick(s.rows, max: maxRows, mine: { $0.mine }).enumerated()), id: \.offset) { _, r in
          LiveBoardRowView(r: r)
        }
      }
      if let notice = s.notice {
        Text(notice)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(PP.gold)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
          .padding(.top, s.rows.isEmpty && s.matches.isEmpty ? 4 : 0)
      } else if let you = s.you {
        HStack(spacing: 6) {
          Text("You").font(.system(size: 12, weight: .bold)).foregroundStyle(PP.gold)
          Text(you).font(.system(size: 12, weight: .semibold)).foregroundStyle(PP.cream.opacity(0.85)).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.top, 1)
      }
    }
  }
}

struct LiveBoardRowView: View {
  let r: WRow

  var body: some View {
    HStack(spacing: 8) {
      Text(r.pos)
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(PP.gold)
        .frame(width: 30, alignment: .leading)
      if let m = r.move { MoveMark(move: m) }
      Text(r.name)
        .font(.system(size: 14, weight: r.mine ? .bold : .semibold))
        .foregroundStyle(PP.cream)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 4)
      Text(r.thru)
        .font(.system(size: 12.5))
        .monospacedDigit()
        .foregroundStyle(PP.cream.opacity(0.7))
        .frame(width: 34, alignment: .trailing)
      Text(r.score)
        .font(.system(size: 15, weight: .heavy, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(r.good ? PP.good : PP.cream)
        .frame(width: 40, alignment: .trailing)
    }
    .padding(.vertical, 2)
    .padding(.horizontal, 6)
    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(r.mine ? PP.mineRow : Color.clear))
    .padding(.horizontal, -6)
    .accessibilityElement(children: .combine)
  }
}

struct LiveBoardTeams: View {
  let teams: [WTeam]

  var body: some View {
    HStack(spacing: 8) {
      ForEach(teams, id: \.self) { t in
        HStack(spacing: 6) {
          Text(t.name.uppercased()).font(.system(size: 11, weight: .bold)).tracking(1).lineLimit(1)
          Spacer(minLength: 2)
          Text(t.points).font(.system(size: 17, weight: .heavy, design: .rounded)).monospacedDigit()
        }
        .foregroundStyle(PP.sideText(t.side))
        .padding(.horizontal, 10)
        .frame(height: 28)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(PP.side(t.side)))
      }
    }
    .padding(.bottom, 2)
  }
}

struct LiveBoardMatchRow: View {
  let m: WMatch

  var body: some View {
    HStack(spacing: 8) {
      Text("\(m.label) · \(m.names)")
        .font(.system(size: 13, weight: m.mine ? .bold : .semibold))
        .foregroundStyle(PP.cream)
        .lineLimit(1)
        .truncationMode(.tail)
      Spacer(minLength: 4)
      Pill(text: m.status, side: m.side)
    }
    .padding(.vertical, 2)
    .padding(.horizontal, 6)
    .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(m.mine ? PP.mineRow : Color.clear))
    .padding(.horizontal, -6)
  }
}
