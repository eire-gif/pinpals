/**
 * Watch v2 (claude/watch-v2.md): PinPals on the watch face — complications
 * (circular, corner, rectangular, inline) and the Smart Stack card during a
 * live round. Built by @bacons/apple-targets at `eas build` time as a watchOS
 * WidgetKit extension inside the watch app (targets/watch); the Swift lives
 * next to this file.
 *
 * The watch app writes the round's summary into the App Group
 * (WatchGlance.swift); this reads it. Not reachable with `eas update`.
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch-widget",
  name: "PinPalsComplications",
  displayName: "PinPals",
  // An extension inside the watch app: its id starts with the watch app's.
  bundleIdentifier: ".watchkitapp.complications",
  deploymentTarget: "10.0",
  colors: {
    $accent: "#e8c46b",
    navy: "#0c2038",
    gold: "#e8c46b",
  },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
