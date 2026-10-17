import ExpoModulesCore
import Foundation
#if canImport(DeclaredAgeRange)
import DeclaredAgeRange
#endif

// App store age signals, iPhone half (junior members, claude/junior-members.md).
//
// Asks Apple's Declared Age Range for the person's age range against our
// gates (13, 16, 18). The system may show its own "share your age range?"
// sheet the first time; in some regions it answers without asking. The
// answer goes to the database (report_store_age_signal) from JavaScript
// (lib/store-age.ts): an upper bound under 18 on an 18+ account flags it
// for review.
//
// Needs iOS 26 and the com.apple.developer.declared-age-range entitlement.
// NOT yet in app.json: switch on "Declared Age Range" for ie.pinpals.app in
// the Apple Developer portal first, then add
//   "com.apple.developer.declared-age-range": true
// to expo.ios.entitlements. Added before the App ID has it, the signing step
// of every iOS build would fail. Without it, the request throws and this
// resolves nil — harmless.
// Anything else — an older iOS, an SDK without the framework, no window to
// present from, an error — resolves to nil. It never throws into
// JavaScript: a missing signal just means nothing is reported.
//
// Result: nil, or ["status": "sharing", "lowerBound": Int?, "upperBound": Int?]
// or ["status": "declined"]. A nil lowerBound means under 13; a nil
// upperBound means 18 or over (Apple's convention).

public class PinPalsAgeSignalsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PinPalsAgeSignals")

    AsyncFunction("requestAgeRange") { (promise: Promise) in
#if canImport(DeclaredAgeRange)
      if #available(iOS 26.0, *) {
        Task { @MainActor in
          guard let controller = self.appContext?.utilities?.currentViewController() else {
            promise.resolve(nil)
            return
          }
          do {
            let response = try await AgeRangeService.shared.requestAgeRange(ageGates: 13, 16, 18, in: controller)
            switch response {
            case let .sharing(range):
              var out: [String: Any] = ["status": "sharing"]
              if let lower = range.lowerBound { out["lowerBound"] = lower }
              if let upper = range.upperBound { out["upperBound"] = upper }
              promise.resolve(out)
            case .declinedSharing:
              promise.resolve(["status": "declined"])
            @unknown default:
              promise.resolve(nil)
            }
          } catch {
            promise.resolve(nil)
          }
        }
        return
      }
#endif
      promise.resolve(nil)
    }
  }
}
