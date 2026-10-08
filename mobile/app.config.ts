import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Dynamic layer over app.json (Oct 2026, Android build).
 *
 * app.json stays the source of truth for everything. This file exists for one
 * thing app.json cannot do: point Android at Firebase's `google-services.json`
 * without committing it. Android push notifications go through Firebase Cloud
 * Messaging, and the Expo push token mint fails without that file.
 *
 * The file is held by EAS as a secret file variable:
 *
 *   eas env:create --name GOOGLE_SERVICES_JSON --type file \
 *     --value ./google-services.json --environment production \
 *     --environment preview --environment development
 *
 * Until it exists the Android build still works — registerForPush() in
 * src/lib/push.ts returns { ok: false, reason: "failed" } and the app carries
 * on without push, by design. iOS is unaffected either way.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  return {
    ...(config as ExpoConfig),
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
