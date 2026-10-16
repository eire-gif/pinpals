import ExpoModulesCore
import Foundation

// The JavaScript side of the lock screen scoring card (Oct 2026).
//
// The card's types and the code that starts it live in the APP target
// (mobile/targets/widget/_shared/LiveScoreShared.swift), because the card's
// buttons run there too. This module is a separate pod and can't see those
// types, so it calls the app's PinPalsLiveActivityBridge class by name. Every
// bridge method takes and returns strings, which keeps the call simple.
//
// On a build without the bridge (or iOS before 17) every call quietly
// reports "unsupported".

public class PinPalsLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PinPalsLiveActivity")

    Function("isSupported") { () -> Bool in
      LiveActivityBridgeCall.call("isSupported", nil) == "1"
    }

    /** nil on success, otherwise a short reason. */
    Function("start") { (json: String) -> String? in
      LiveActivityBridgeCall.call("start:", json)
    }

    Function("update") { (json: String) -> String? in
      LiveActivityBridgeCall.call("update:", json)
    }

    Function("end") { (json: String) -> String? in
      LiveActivityBridgeCall.call("end:", json)
    }

    /** Each hole's green and tee, for the card's distance (voice scoring, Oct 2026). */
    Function("setGeometry") { (json: String) -> String? in
      LiveActivityBridgeCall.call("setGeometry:", json)
    }

    /** A new position; "not running" = no card, stop the updates. */
    Function("setLocation") { (json: String) -> String? in
      LiveActivityBridgeCall.call("setLocation:", json)
    }

    /** JSON array of scores saved on the lock screen and not sent yet. */
    Function("takePending") { () -> String in
      LiveActivityBridgeCall.call("takePending", nil) ?? "[]"
    }
  }
}

enum LiveActivityBridgeCall {
  /** Calls a class method on PinPalsLiveActivityBridge that returns an NSString (or nil). */
  static func call(_ selectorName: String, _ argument: String?) -> String? {
    guard let bridge = NSClassFromString("PinPalsLiveActivityBridge") as AnyObject? else { return "unsupported" }
    let selector = NSSelectorFromString(selectorName)
    guard bridge.responds(to: selector) else { return "unsupported" }
    let result = argument == nil ? bridge.perform(selector) : bridge.perform(selector, with: argument! as NSString)
    return result?.takeUnretainedValue() as? String
  }
}
