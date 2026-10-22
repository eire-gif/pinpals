import Foundation
import HealthKit

// Watch v2 (claude/watch-v2.md): the round as a golf workout.
//
// A workout session is what lets a watch app keep running with the wrist
// down, so the GPS stays warm and the distance is right at the next glance
// instead of catching up for a few seconds. The round is saved to Health as
// a golf workout as a bonus. It starts the first time the member opens the
// watch app on a live round, and ends when the round finishes or goes.
//
// Health asks once, the first time. Said no? The watch works exactly as
// before: GPS while the app is open.

final class WatchWorkout: NSObject, HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
  static let shared = WatchWorkout()

  private let store = HKHealthStore()
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private var roundId: Int?
  /** The round this watch has already ended a workout for: not started again. */
  private var endedRound: Int?
  private(set) var running = false

  /** Called whenever the round changes or the app opens. */
  func follow(round: WatchRound?, active: Bool) {
    guard let r = round, !r.isFinished else {
      stop()
      return
    }
    if roundId != nil, roundId != r.roundId { stop() }
    // Start only with the member looking at the watch: Health may need to ask.
    guard active, session == nil, endedRound != r.roundId else { return }
    start(r.roundId)
  }

  private func start(_ id: Int) {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    roundId = id
    let share: Set<HKSampleType> = [HKObjectType.workoutType(), HKQuantityType(.activeEnergyBurned), HKQuantityType(.distanceWalkingRunning)]
    let read: Set<HKObjectType> = [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)]
    store.requestAuthorization(toShare: share, read: read) { [weak self] ok, _ in
      guard ok else { return }
      DispatchQueue.main.async { self?.begin(id) }
    }
  }

  private func begin(_ id: Int) {
    guard session == nil, roundId == id else { return }
    let config = HKWorkoutConfiguration()
    config.activityType = .golf
    config.locationType = .outdoor
    do {
      let s = try HKWorkoutSession(healthStore: store, configuration: config)
      let b = s.associatedWorkoutBuilder()
      b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
      s.delegate = self
      b.delegate = self
      session = s
      builder = b
      let now = Date()
      s.startActivity(with: now)
      b.beginCollection(withStart: now) { _, _ in }
      running = true
    } catch {
      session = nil
      builder = nil
      running = false
    }
  }

  func stop() {
    guard let s = session else {
      roundId = nil
      return
    }
    endedRound = roundId
    let b = builder
    session = nil
    builder = nil
    roundId = nil
    running = false
    s.end()
    let now = Date()
    b?.endCollection(withEnd: now) { _, _ in
      b?.finishWorkout { _, _ in }
    }
  }

  // MARK: HKWorkoutSessionDelegate

  func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
    if toState == .ended || toState == .stopped { running = false }
  }

  func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    running = false
  }

  // MARK: HKLiveWorkoutBuilderDelegate

  func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {}

  func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
