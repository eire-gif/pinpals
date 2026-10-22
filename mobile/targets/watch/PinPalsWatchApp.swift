import SwiftUI

// PinPals for Apple Watch (Oct 2026). See claude/apple-watch.md and
// claude/watch-v2.md.
//
// Pages, swiped left and right (WatchPage):
//   - distances: front, centre and back of the green, "plays like" with the wind;
//   - the hole map: satellite, a target to tap, the Crown zooms;
//   - hazards still in play;
//   - scoring: the group's scores, or on your own the hole page — the score
//     (− / +, or turn the Digital Crown), Save;
//   - the leaderboard;
//   - the card: the total and standing, Undo, Picked up, and every hole to
//     go back and change one.
// Nothing to set up on the watch: opening a live round on the iPhone puts it
// here, and finishing it there takes it away.

@main
struct PinPalsWatchApp: App {
  @StateObject private var model = WatchRoundModel.shared
  @Environment(\.scenePhase) private var phase

  init() {
    WatchLink.shared.activate()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(model)
        .onChange(of: phase, initial: true) { _, now in
          switch now {
          case .active: model.becameActive()
          // Wrist down is .inactive: keep the GPS warm for the next glance.
          case .background: model.wentInactive()
          default: break
          }
        }
    }
  }
}

struct RootView: View {
  @EnvironmentObject private var model: WatchRoundModel

  var body: some View {
    Group {
      if let round = model.round {
        if round.isFinished {
          FinishedView(round: round)
        } else {
          TabView(selection: $model.page) {
            DistancesPage().tag(WatchPage.distances)
            HoleMapPage().tag(WatchPage.map)
            HazardsPage().tag(WatchPage.hazards)
            ScorePage().tag(WatchPage.score)
            BoardPage().tag(WatchPage.board)
            CardView().tag(WatchPage.card)
          }
          .tabViewStyle(.page)
          .overlay {
            if let alert = model.alert {
              AlertBanner(alert: alert) { model.dismissAlert() }
                .transition(.opacity)
            }
          }
        }
      } else {
        NoRoundView()
      }
    }
    .tint(Color("gold"))
  }
}

// MARK: - The hole

struct HoleView: View {
  @EnvironmentObject private var model: WatchRoundModel
  @State private var crown: Double = 4

  var body: some View {
    if let round = model.round, let info = model.holeInfo {
      VStack(spacing: 4) {
        header(info)
        if round.allIn && model.draft == nil {
          allIn(round)
        } else {
          scoreRow
          Text(round.describe(model.shown, model.hole))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
          Button {
            model.save()
          } label: {
            Text("Save").font(.headline).frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(Color("gold"))
          .foregroundStyle(Color("navy"))
        }
        footer(round)
      }
      .padding(.horizontal, 2)
    }
  }

  private func header(_ info: WatchHole) -> some View {
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: 1) {
        Text("HOLE \(info.n)")
          .font(.system(size: 14, weight: .bold, design: .rounded))
          .foregroundStyle(Color("gold"))
        HStack(spacing: 3) {
          Text("Par \(info.par)" + (info.si.map { " · SI \($0)" } ?? ""))
            .font(.caption2)
            .foregroundStyle(.secondary)
          ForEach(0..<max(0, min(info.shots, 3)), id: \.self) { _ in
            Circle().fill(Color("gold")).frame(width: 4, height: 4)
          }
        }
      }
      Spacer(minLength: 2)
      if let yards = model.distance {
        VStack(alignment: .trailing, spacing: 0) {
          Text("\(yards)")
            .font(.system(size: 24, weight: .semibold, design: .rounded))
            .monospacedDigit()
          Text(model.distanceFrom == "tee" ? "yds from tee" : "yds to green")
            .font(.system(size: 10))
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
      }
    }
  }

  private var scoreRow: some View {
    HStack {
      StepButton(symbol: "minus", label: "One less") { model.step(-1) }
      Spacer(minLength: 0)
      Text("\(model.shown)")
        .font(.system(size: 44, weight: .bold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(model.isSuggestion ? Color.white.opacity(0.45) : Color.white)
        .frame(minWidth: 56)
        .focusable(true)
        .digitalCrownRotation($crown, from: 1, through: 15, by: 1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
        .onChange(of: crown) { _, value in
          model.setDraft(Int(value.rounded()), click: false)
        }
        .onChange(of: model.shown, initial: true) { _, value in
          if Int(crown.rounded()) != value { crown = Double(value) }
        }
        .accessibilityLabel("\(model.shown) strokes")
      Spacer(minLength: 0)
      StepButton(symbol: "plus", label: "One more") { model.step(1) }
    }
  }

  private func allIn(_ round: WatchRound) -> some View {
    VStack(spacing: 3) {
      Image(systemName: "checkmark.circle.fill")
        .font(.title2)
        .foregroundStyle(Color("gold"))
      Text(round.total).font(.headline)
      Text("All in. Finish on your iPhone to get your card certified.")
        .font(.caption2)
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
    }
  }

  @ViewBuilder
  private func footer(_ round: WatchRound) -> some View {
    if let notice = model.notice {
      Text(notice)
        .font(.caption2)
        .foregroundStyle(.orange)
        .multilineTextAlignment(.center)
        .lineLimit(2)
    } else if let saved = model.saved {
      HStack(spacing: 4) {
        Text(saved).font(.caption2).lineLimit(1)
        if model.undoHole != nil {
          Button("Undo") { model.undo() }
            .font(.caption2.weight(.semibold))
            .buttonStyle(.plain)
            .foregroundStyle(Color("gold"))
        }
      }
    } else if model.waiting > 0 {
      Text("\(model.waiting) waiting for signal")
        .font(.caption2)
        .foregroundStyle(.secondary)
    } else {
      Text(round.status ?? round.total)
        .font(.caption2)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }
}

struct StepButton: View {
  let symbol: String
  let label: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 18, weight: .bold))
        .frame(width: 40, height: 40)
        .background(Circle().fill(Color.white.opacity(0.16)))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(label)
  }
}

// MARK: - The card

struct CardView: View {
  @EnvironmentObject private var model: WatchRoundModel

  var body: some View {
    if let round = model.round {
      List {
        Section {
          VStack(alignment: .leading, spacing: 2) {
            Text(round.course).font(.headline).lineLimit(2)
            Text(round.total).foregroundStyle(Color("gold"))
            if let status = round.status {
              Text(status).font(.footnote).foregroundStyle(.secondary)
            }
          }
          .listRowBackground(Color.clear)
        }
        Section {
          if let back = model.undoHole {
            Button {
              model.undo()
            } label: {
              Label("Change hole \(back)", systemImage: "arrow.uturn.backward")
            }
          }
          if !round.allIn || model.draft != nil {
            Button {
              model.save(pickedUp: true)
            } label: {
              Label("NR on \(model.hole)", systemImage: "hand.raised")
            }
          }
          if round.watch?.wind != nil && round.playsLikeAllowed {
            Toggle("Plays like", isOn: $model.playsLikeOn)
          }
        }
        Section("Card") {
          ForEach(round.holes, id: \.n) { h in
            Button {
              model.go(to: h.n)
            } label: {
              HStack {
                Text("\(h.n)").font(.body.weight(.semibold)).frame(width: 26, alignment: .leading)
                Text("Par \(h.par)").font(.footnote).foregroundStyle(.secondary)
                Spacer()
                Text(scoreText(round, h.n))
                  .font(.footnote.weight(.semibold))
                  .foregroundStyle(round.score(h.n) == nil ? Color.secondary : Color.white)
              }
            }
          }
        }
      }
    }
  }

  private func scoreText(_ round: WatchRound, _ n: Int) -> String {
    guard let s = round.score(n) else { return "–" }
    return s > 0 ? round.short(s, n) : "P/U"
  }
}

// MARK: - No round, round finished

struct NoRoundView: View {
  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "flag.fill")
        .font(.title2)
        .foregroundStyle(Color("gold"))
      Text("PinPals").font(.headline)
      Text("Open a live round on your iPhone and score it here, with your distance to the green.")
        .font(.footnote)
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 4)
  }
}

struct FinishedView: View {
  let round: WatchRound

  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "trophy.fill")
        .font(.title2)
        .foregroundStyle(Color("gold"))
      Text(round.course).font(.headline).multilineTextAlignment(.center).lineLimit(2)
      Text(round.summary ?? round.total)
        .font(.footnote)
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 4)
  }
}
