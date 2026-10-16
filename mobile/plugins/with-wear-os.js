const { withSettingsGradle } = require("expo/config-plugins");

/**
 * PinPals for Wear OS (Oct 2026, claude/wear-os.md): adds the watch app in
 * mobile/wear to the Android project that `expo prebuild` / EAS generates,
 * as the Gradle project `:wear`. Nothing is copied: it builds from mobile/wear.
 *
 * The phone app's build doesn't change: EAS still builds `:app` unless an
 * eas.json profile asks for `:wear` (wear-preview, wear-production).
 */
module.exports = function withWearOs(config) {
  return withSettingsGradle(config, (config) => {
    const line = "include ':wear'\nproject(':wear').projectDir = new File(rootDir, '../wear')";
    if (!config.modResults.contents.includes("include ':wear'")) {
      config.modResults.contents += `\n// PinPals for Wear OS (plugins/with-wear-os.js)\n${line}\n`;
    }
    return config;
  });
};
