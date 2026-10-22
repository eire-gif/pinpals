import MapKit
import SwiftUI

// Watch v2 (claude/watch-v2.md): the pages around scoring, left to right —
// distances, the hole map, hazards, (scoring), the leaderboard. Mock-ups:
// the Design canvas "PinPals — watch v2". Navy and gold, numbers big enough
// to read on a course in sunshine.

private let gold = Color("gold")
private let navy = Color("navy")
private let muted = Color.white.opacity(0.62)

/** The hole badge in the top corner: gold disc with the number, then par. */
struct HoleBadge: View {
  let n: Int
  let par: Int
  let si: Int?

  var body: some View {
    HStack(spacing: 5) {
      Text("\(n)")
        .font(.system(size: 14, weight: .heavy, design: .rounded))
        .foregroundStyle(navy)
        .frame(width: 24, height: 24)
        .background(Circle().fill(gold))
      Text("Par \(par)").font(.system(size: 15, weight: .bold, design: .rounded))
      if let si = si {
        Text("SI \(si)").font(.system(size: 12)).foregroundStyle(muted)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Hole \(n), par \(par)")
  }
}

/** Shown in place of the map when paid plans are on and the member isn't Premium. No price, no link (App Store 3.1.1). */
struct PremiumCard: View {
  let what: String

  var body: some View {
    VStack(spacing: 6) {
      Text("PREMIUM")
        .font(.system(size: 11, weight: .heavy))
        .tracking(1.2)
        .foregroundStyle(gold)
      Text(what).font(.headline).multilineTextAlignment(.center)
      Text("Part of PinPals Premium.").font(.footnote).foregroundStyle(muted).multilineTextAlignment(.center)
    }
    .padding(.horizontal, 6)
  }
}

struct NotMappedView: View {
  var body: some View {
    VStack(spacing: 6) {
      Image(systemName: "map").font(.title2).foregroundStyle(gold)
      Text("This hole isn't mapped yet").font(.headline).multilineTextAlignment(.center)
      Text("Distances appear on courses with mapped greens.").font(.footnote).foregroundStyle(muted).multilineTextAlignment(.center)
    }
    .padding(.horizontal, 6)
  }
}

// MARK: - 1 · Distances

struct DistancesPage: View {
  @EnvironmentObject private var model: WatchRoundModel

  var body: some View {
    if let r = model.round, let info = model.holeInfo {
      VStack(alignment: .leading, spacing: 2) {
        HStack {
          HoleBadge(n: info.n, par: info.par, si: info.si)
          Spacer(minLength: 2)
          if r.competition {
            Text("COMP")
              .font(.system(size: 11, weight: .heavy))
              .tracking(1)
              .padding(.horizontal, 7)
              .padding(.vertical, 2)
              .background(Capsule().fill(Color(red: 0.66, green: 0.23, blue: 0.17)))
              .accessibilityLabel("Competition round")
          }
        }
        if let y = WatchDistance.greenYards(r, hole: model.hole, fix: model.fixPoint) {
          yardRow(y.back, "BACK", big: false)
          yardRow(y.centre, "CENTRE", big: true)
          yardRow(y.front, "FRONT", big: false)
          Spacer(minLength: 0)
          footer(r, centre: y.centre, fromTee: y.fromTee)
        } else {
          Spacer(minLength: 0)
          Text("This hole isn't mapped yet").font(.footnote).foregroundStyle(muted)
          Spacer(minLength: 0)
        }
      }
      .padding(.horizontal, 4)
    }
  }

  @ViewBuilder
  private func yardRow(_ yards: Int?, _ label: String, big: Bool) -> some View {
    if let yards = yards {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text("\(yards)")
          .font(.system(size: big ? 58 : 28, weight: big ? .heavy : .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(big ? gold : .white)
          .minimumScaleFactor(0.7)
        Text(label)
          .font(.system(size: 11, weight: .bold))
          .tracking(1)
          .foregroundStyle(big ? gold : muted)
      }
      .accessibilityElement(children: .combine)
      .accessibilityLabel("\(yards) yards to the \(label.lowercased()) of the green")
    }
  }

  @ViewBuilder
  private func footer(_ r: WatchRound, centre: Int, fromTee: Bool) -> some View {
    if r.competition {
      Text("Distance only (Rule 4.3)").font(.system(size: 12)).foregroundStyle(muted)
    } else if r.playsLikeAllowed, model.playsLikeOn, let wind = r.watch?.wind, let point = origin(r) {
      let bearing = WatchDistance.bearing(point, r.spot(model.hole)?.green ?? point)
      let head = WatchWindMaths.headMph(wind, shotBearing: bearing)
      HStack(spacing: 6) {
        Text("Plays ").font(.system(size: 13, weight: .semibold)).foregroundStyle(muted)
          + Text("\(WatchWindMaths.playsLike(centre, headMph: head))").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
        Spacer(minLength: 0)
        Text("\(WatchWindMaths.along(wind, shotBearing: bearing)) \(Int((wind.kmh / WatchWindMaths.kmhPerMph).rounded())) mph")
          .font(.system(size: 12, weight: .semibold))
          .padding(.horizontal, 7)
          .padding(.vertical, 2)
          .background(Capsule().fill(Color.white.opacity(0.14)))
      }
    } else if fromTee {
      Text("From the tee").font(.system(size: 12)).foregroundStyle(muted)
    }
  }

  private func origin(_ r: WatchRound) -> [Double]? {
    WatchDistance.origin(r, hole: model.hole, fix: model.fixPoint)?.point
  }
}

// MARK: - 2 · The hole map

struct HoleMapPage: View {
  @EnvironmentObject private var model: WatchRoundModel
  @State private var position: MapCameraPosition = .automatic
  @State private var target: [Double]?
  @State private var zoom: Double = 0.5
  @State private var framedHole: Int?

  var body: some View {
    if let r = model.round {
      if !r.mapAllowed {
        PremiumCard(what: "Satellite hole maps")
      } else if let spot = r.spot(model.hole), let green = spot.green, green.count == 2,
                let o = WatchDistance.origin(r, hole: model.hole, fix: model.fixPoint) {
        map(r, origin: o.point, green: green)
      } else {
        NotMappedView()
      }
    }
  }

  private func coordinate(_ p: [Double]) -> CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: p[0], longitude: p[1]) }

  private func map(_ r: WatchRound, origin: [Double], green: [Double]) -> some View {
    let aim = target ?? WatchDistance.defaultAim(from: origin, green: green) ?? green
    let toAim = WatchDistance.yards(WatchDistance.metres(origin, aim))
    let aimToGreen = WatchDistance.yards(WatchDistance.metres(aim, green))
    return MapReader { proxy in
      Map(position: $position, interactionModes: []) {
        MapPolyline(coordinates: [coordinate(origin), coordinate(aim), coordinate(green)])
          .stroke(.white, style: StrokeStyle(lineWidth: 2, dash: [4, 4]))
        Annotation("You", coordinate: coordinate(origin), anchor: .center) {
          Circle().fill(Color.blue).frame(width: 12, height: 12).overlay(Circle().stroke(.white, lineWidth: 2))
        }
        if aim != green {
          Annotation("Target", coordinate: coordinate(aim), anchor: .center) {
            Circle().stroke(.white, lineWidth: 2).frame(width: 22, height: 22)
          }
        }
        Annotation("Green", coordinate: coordinate(green), anchor: .bottom) {
          Image(systemName: "flag.fill").font(.system(size: 14)).foregroundStyle(gold)
        }
      }
      .annotationTitles(.hidden)
      .mapStyle(.imagery)
      .onTapGesture { location in
        guard let c = proxy.convert(location, from: .local) else { return }
        target = [c.latitude, c.longitude]
      }
    }
    .overlay(alignment: .topLeading) {
      HoleBadge(n: model.hole, par: r.info(model.hole)?.par ?? 4, si: nil)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Capsule().fill(.black.opacity(0.55)))
        .padding(.leading, 6)
    }
    .overlay(alignment: .bottom) {
      HStack(spacing: 6) {
        if aim != green {
          distanceChip(toAim, "to target", gold: false)
          distanceChip(aimToGreen, "to green", gold: true)
        } else {
          distanceChip(toAim, "to green", gold: true)
        }
      }
      .padding(.bottom, 4)
    }
    .ignoresSafeArea(edges: .bottom)
    .focusable()
    .digitalCrownRotation($zoom, from: 0, through: 1, by: 0.05, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
    .onChange(of: zoom) { _, _ in frame(origin: origin, green: green) }
    .onChange(of: model.hole, initial: true) { _, _ in
      target = nil
      frame(origin: origin, green: green)
    }
    .onChange(of: model.fixPoint) { _, _ in
      if framedHole != model.hole { frame(origin: origin, green: green) }
    }
  }

  /** The hole turned to run up the screen, its length filling it; the Crown zooms in toward the green. */
  private func frame(origin: [Double], green: [Double]) {
    framedHole = model.hole
    let length = max(80, WatchDistance.metres(origin, green))
    let centre = [origin[0] + (green[0] - origin[0]) * (0.5 + zoom * 0.35), origin[1] + (green[1] - origin[1]) * (0.5 + zoom * 0.35)]
    let distance = max(150, length * (3.2 - 2.4 * zoom))
    position = .camera(MapCamera(centerCoordinate: coordinate(centre), distance: distance, heading: WatchDistance.bearing(origin, green), pitch: 0))
  }

  private func distanceChip(_ yards: Int, _ label: String, gold isGold: Bool) -> some View {
    VStack(spacing: 0) {
      Text("\(yards)").font(.system(size: 19, weight: .heavy, design: .rounded)).monospacedDigit().foregroundStyle(isGold ? gold : .white)
      Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(muted)
    }
    .padding(.horizontal, 7)
    .padding(.vertical, 3)
    .background(RoundedRectangle(cornerRadius: 8).fill(.black.opacity(0.62)))
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(yards) yards \(label)")
  }
}

// MARK: - 3 · Hazards

struct HazardsPage: View {
  @EnvironmentObject private var model: WatchRoundModel

  var body: some View {
    if let r = model.round {
      let ahead = WatchDistance.hazardsAhead(r, hole: model.hole, fix: model.fixPoint)
      ScrollView {
        VStack(alignment: .leading, spacing: 5) {
          Text("HAZARDS · \(model.hole)")
            .font(.system(size: 13, weight: .heavy))
            .tracking(1)
            .foregroundStyle(gold)
          if ahead.isEmpty {
            Text(r.spot(model.hole)?.green == nil ? "This hole isn't mapped yet." : "Nothing mapped between you and the green.")
              .font(.footnote)
              .foregroundStyle(muted)
              .padding(.top, 6)
          }
          ForEach(Array(ahead.enumerated()), id: \.offset) { _, item in
            HStack(spacing: 8) {
              Circle().fill(colour(item.hazard.k)).frame(width: 11, height: 11)
              Text(item.hazard.l).font(.system(size: 15, weight: .semibold)).lineLimit(1)
              Spacer(minLength: 2)
              Text("\(item.yards)").font(.system(size: 19, weight: .heavy, design: .rounded)).monospacedDigit()
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white.opacity(0.08)))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(item.hazard.l), \(item.yards) yards")
          }
        }
      }
    }
  }

  private func colour(_ kind: String) -> Color {
    switch kind {
    case "water": return Color(red: 0.31, green: 0.54, blue: 0.72)
    case "trees": return Color(red: 0.25, green: 0.5, blue: 0.3)
    case "green_bunker", "fairway_bunker": return Color(red: 0.85, green: 0.8, blue: 0.64)
    default: return gold
    }
  }
}

// MARK: - 4 · The group's scores

struct GroupScorePage: View {
  @EnvironmentObject private var model: WatchRoundModel
  @State private var crown: Double = 4

  var body: some View {
    if let r = model.round, let group = r.group, let info = model.holeInfo {
      VStack(spacing: 4) {
        HStack {
          HoleBadge(n: info.n, par: info.par, si: nil)
          Spacer(minLength: 0)
        }
        rows(group, info: info)
        HStack(spacing: 6) {
          StepButton(symbol: "minus", label: "One less for \(selectedName(group))") { step(group, -1) }
          Button {
            model.saveGroup()
          } label: {
            Text("Save all").font(.system(size: 16, weight: .heavy)).frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(gold)
          .foregroundStyle(navy)
          StepButton(symbol: "plus", label: "One more for \(selectedName(group))") { step(group, 1) }
        }
        if let notice = model.notice {
          Text(notice).font(.caption2).foregroundStyle(.orange).lineLimit(2).multilineTextAlignment(.center)
        } else if let saved = model.saved {
          Text(saved).font(.caption2).foregroundStyle(muted).lineLimit(1)
        }
      }
      .padding(.horizontal, 2)
      .focusable(group.count <= 4)
      .digitalCrownRotation($crown, from: 1, through: 15, by: 1, sensitivity: .low, isContinuous: false, isHapticFeedbackEnabled: true)
      .onChange(of: crown) { _, value in
        if let p = selected(group) { model.setGroupDraft(p.id, Int(value.rounded()), click: false) }
      }
      .onChange(of: model.groupSelected, initial: true) { _, _ in alignCrown(group) }
      .onChange(of: model.hole) { _, _ in
        model.groupSelected = group.first?.id
        alignCrown(group)
      }
    }
  }

  @ViewBuilder
  private func rows(_ group: [WatchPlayer], info: WatchHole) -> some View {
    let list = VStack(spacing: 3) {
      ForEach(group, id: \.id) { p in
        let isSelected = (model.groupSelected ?? group.first?.id) == p.id
        Button {
          model.groupSelected = p.id
        } label: {
          HStack(spacing: 6) {
            Text(p.me ? "You" : p.name).font(.system(size: 15, weight: p.me ? .bold : .semibold)).lineLimit(1)
            Spacer(minLength: 2)
            let shots = model.round?.shots(p, info.n) ?? 0
            if shots > 0 {
              Text(String(repeating: "•", count: min(shots, 3))).font(.system(size: 11)).foregroundStyle(gold)
            }
            Text("\(model.groupShown(p))")
              .font(.system(size: 21, weight: .heavy, design: .rounded))
              .monospacedDigit()
              .foregroundStyle(model.groupIsSuggestion(p) ? Color.white.opacity(0.42) : (p.me ? gold : .white))
              .frame(minWidth: 22, alignment: .trailing)
          }
          .padding(.horizontal, 9)
          .padding(.vertical, 5)
          .background(
            RoundedRectangle(cornerRadius: 12)
              .fill(isSelected ? gold.opacity(0.16) : Color.white.opacity(0.07))
              .overlay(RoundedRectangle(cornerRadius: 12).stroke(isSelected ? gold : .clear, lineWidth: 2))
          )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(p.me ? "You" : p.name), \(model.groupShown(p))")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
      }
    }
    if group.count > 4 {
      ScrollView { list }
    } else {
      list
    }
  }

  private func selected(_ group: [WatchPlayer]) -> WatchPlayer? {
    let id = model.groupSelected ?? group.first?.id
    return group.first { $0.id == id }
  }

  private func selectedName(_ group: [WatchPlayer]) -> String {
    guard let p = selected(group) else { return "" }
    return p.me ? "you" : p.name
  }

  private func step(_ group: [WatchPlayer], _ delta: Int) {
    guard let p = selected(group) else { return }
    model.setGroupDraft(p.id, model.groupShown(p) + delta)
    alignCrown(group)
  }

  private func alignCrown(_ group: [WatchPlayer]) {
    guard let p = selected(group) else { return }
    let v = Double(model.groupShown(p))
    if crown != v { crown = v }
  }
}

/** The score page: the group's when there is one, else your own (v1). */
struct ScorePage: View {
  @EnvironmentObject private var model: WatchRoundModel

  var body: some View {
    if model.round?.group != nil {
      GroupScorePage()
    } else {
      HoleView()
    }
  }
}

// MARK: - 5 · The leaderboard

struct BoardPage: View {
  @EnvironmentObject private var model: WatchRoundModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 5) {
          Circle().fill(Color(red: 0.5, green: 0.82, blue: 0.55)).frame(width: 7, height: 7)
          Text(model.board?.state == "final" ? "FINAL" : "LIVE")
            .font(.system(size: 11, weight: .heavy))
            .tracking(1.2)
            .foregroundStyle(Color(red: 0.5, green: 0.82, blue: 0.55))
        }
        if let b = model.board {
          Text(b.title).font(.system(size: 17, weight: .bold, design: .serif)).lineLimit(2)
          if let teams = b.teams, teams.count == 2 {
            HStack {
              ForEach(teams, id: \.name) { t in
                VStack(alignment: .leading, spacing: 0) {
                  Text(t.name.uppercased()).font(.system(size: 10, weight: .heavy)).foregroundStyle(muted)
                  Text(t.points).font(.system(size: 22, weight: .heavy, design: .rounded)).foregroundStyle(gold)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
              }
            }
          }
          if let table = b.board, !table.rows.isEmpty {
            ForEach(Array(table.rows.enumerated()), id: \.offset) { _, row in
              HStack(spacing: 6) {
                Text(row.pos).font(.system(size: 14, weight: .heavy)).foregroundStyle(gold).frame(width: 26, alignment: .leading)
                Text(row.mine ? "You" : row.name).font(.system(size: 14, weight: row.mine ? .bold : .semibold)).lineLimit(1)
                Spacer(minLength: 2)
                Text(row.thru).font(.system(size: 13)).foregroundStyle(muted).monospacedDigit()
                Text(row.score).font(.system(size: 15, weight: .heavy)).monospacedDigit().foregroundStyle(row.mine ? gold : .white)
                  .frame(minWidth: 28, alignment: .trailing)
              }
              .padding(.horizontal, 6)
              .padding(.vertical, 5)
              .background(RoundedRectangle(cornerRadius: 10).fill(row.mine ? Color.white.opacity(0.14) : .clear))
              .accessibilityElement(children: .combine)
            }
          } else if let mine = b.mine {
            Text(mine.big).font(.system(size: 40, weight: .heavy, design: .rounded)).foregroundStyle(gold)
            Text(mine.line1).font(.footnote)
            Text(mine.line2).font(.footnote).foregroundStyle(muted)
          }
        } else if let note = model.boardNote {
          Text(note).font(.footnote).foregroundStyle(muted).padding(.top, 6)
        } else {
          ProgressView().padding(.top, 10)
        }
      }
      .padding(.horizontal, 2)
    }
    .task(id: model.page == WatchPage.board) {
      guard model.page == WatchPage.board else { return }
      while !Task.isCancelled {
        await model.loadBoard()
        try? await Task.sleep(nanoseconds: 60_000_000_000)
      }
    }
  }
}

// MARK: - Birdie tap

struct AlertBanner: View {
  let alert: WatchAlert
  let dismiss: () -> Void

  var body: some View {
    Button(action: dismiss) {
      VStack(spacing: 2) {
        Image(systemName: "flag.fill").font(.system(size: 18)).foregroundStyle(navy)
          .frame(width: 34, height: 34).background(Circle().fill(gold))
        Text(alert.title).font(.system(size: 22, weight: .bold, design: .serif))
        Text(alert.line).font(.system(size: 14, weight: .semibold)).multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(LinearGradient(colors: [Color(red: 0.09, green: 0.25, blue: 0.13), navy], startPoint: .top, endPoint: .bottom))
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(alert.title) \(alert.line). Tap to dismiss.")
  }
}
