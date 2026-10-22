const fs = require("fs");
const path = require("path");

/**
 * PinPals for Apple Watch (Oct 2026): score your own ball and see the
 * distance to the green from your wrist. Built by @bacons/apple-targets at
 * `eas build` time as a watchOS app bundled inside the iPhone app; the Swift
 * lives next to this file. See claude/apple-watch.md.
 *
 * Not reachable with `eas update`: watch changes need a new iOS build.
 *
 * The Info.plist is written here (the plugin keeps an existing one) so the
 * watch app carries the iPhone app's version — App Store Connect rejects a
 * watch app whose version doesn't match its iPhone app — and the location
 * wording the watch shows when it first asks.
 *
 * Watch v2 (claude/watch-v2.md): the round runs as a golf workout (HealthKit,
 * and the workout-processing background mode, so the GPS keeps going with
 * the wrist down), and the App Group carries the round to the face
 * complications (targets/watch-widget).
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleShortVersionString</key>
  <string>${config.version}</string>
  <key>WKApplication</key>
  <true/>
  <key>NSLocationWhenInUseUsageDescription</key>
  <string>PinPals uses your location to show your distance to the green on your watch during a live round.</string>
  <key>NSHealthShareUsageDescription</key>
  <string>PinPals reads your heart rate and energy during a round so it can save the round as a golf workout.</string>
  <key>NSHealthUpdateUsageDescription</key>
  <string>PinPals saves your live round to Health as a golf workout, which also keeps your distance to the green up to date with your wrist down.</string>
  <key>WKBackgroundModes</key>
  <array>
    <string>workout-processing</string>
  </array>
</dict>
</plist>
`;
  try {
    fs.writeFileSync(path.join(__dirname, "Info.plist"), plist);
  } catch {
    // Read-only checkout: the plugin writes a blank one and the version defaults.
  }

  return {
    type: "watch",
    name: "PinPalsWatch",
    displayName: "PinPals",
    // A watch app's bundle id must start with its iPhone app's.
    bundleIdentifier: ".watchkitapp",
    // SwiftUI toolbars and onChange(of:) with two values are watchOS 10+.
    deploymentTarget: "10.0",
    icon: "../../assets/images/icon.png",
    frameworks: ["SwiftUI", "WatchConnectivity", "CoreLocation", "MapKit", "HealthKit", "WidgetKit"],
    entitlements: {
      "com.apple.developer.healthkit": true,
      // Shared with the face complications (targets/watch-widget); the same
      // group as the iPhone app and its widgets, in app.json.
      "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
    },
    colors: {
      $accent: "#e8c46b",
      navy: "#0c2038",
      gold: "#e8c46b",
    },
  };
};
