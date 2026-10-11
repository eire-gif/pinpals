/**
 * PinPals Home Screen widgets (Oct 2026): your match, a match day, or a
 * leaderboard, in small, medium and large. Built by @bacons/apple-targets
 * at `eas build` time; the Swift lives next to this file.
 *
 * The App Group is how the app hands the widget its key (src/lib/widgets.ts);
 * it mirrors ios.entitlements in app.json.
 */
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "PinPalsWidgets",
  displayName: "PinPals",
  bundleIdentifier: ".widgets",
  // containerBackground and the widget layout APIs used here are iOS 17+.
  deploymentTarget: "17.0",
  colors: {
    $widgetBackground: "#0c2038",
    $accent: "#e8c46b",
  },
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
