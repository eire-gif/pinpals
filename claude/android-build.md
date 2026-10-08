# Android build (Oct 2026)

Goal: an Android version of the PinPals app on Google Play by ~19 Dec 2026.
The Play developer account waits for the CRO company registration (an
Organization account skips Google's 12-testers-for-14-days rule), so
everything below is done first and the Play steps come last.

## Already in place

- Expo / React Native: the same code runs on Android. No rewrite.
- `mobile/app.json` → `android.package` is `ie.pinpals.app` (same as iOS;
  permanent once on Play), adaptive icons, location / microphone permissions.
- Push code already creates the Android notification channel
  (`mobile/src/lib/push.ts`).
- `eas.json` → `preview` profile builds an installable `.apk`.

## Changed in this PR

- **App links narrowed.** Android previously claimed *every*
  `www.pinpals.ie` link — including Stripe returns and `/auth/app-session`.
  It now claims only paths iOS claims (`mobile/app.json` intentFilters).
  Android can't exclude by query string, so `/dashboard/orders/*` and
  `/dashboard/payouts/return` stay on the website. Guarded by
  `src/app/.well-known/app-links.test.ts`.
- **`/.well-known/assetlinks.json`** added to the website. Empty until the
  signing fingerprints are known (see below), which is harmless.
- **`mobile/app.config.ts`** picks up Firebase's `google-services.json`
  from the EAS file variable `GOOGLE_SERVICES_JSON` when it exists.

## Steps

1. **First Android build (no Play account needed).** In the Codespace:
   ```
   git pull && cd mobile
   eas build --platform android --profile preview
   ```
   EAS asks to generate an Android keystore — answer **yes**. EAS stores the
   signing key in the cloud (that is the "keep the key safe" step done).
   Output: an `.apk` link.
2. **Run it** on the Android Studio emulator (drag the `.apk` onto it), on a
   Firebase Test Lab device, or on a borrowed Android phone.
3. **Push notifications (Firebase).** Using the PinPals business email:
   create a Firebase project → add Android app `ie.pinpals.app` → download
   `google-services.json` →
   `eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json`
   (all three environments). Then Project settings → Service accounts →
   generate a key → `eas credentials -p android` → Google Service Account →
   FCM V1 → upload. Rebuild.
4. **App-link fingerprint.** `eas credentials -p android` shows the keystore
   SHA-256. Add it to `SHA256_CERT_FINGERPRINTS` in
   `src/app/.well-known/assetlinks.json/route.ts`.
5. **Android polish** — items never checked on a device: card shadows,
   keyboard over the comments sheet, hardware back button, small and tall
   screens, links from emails opening the right screen.
6. **When the CRO arrives:** apply for D-U-N-S the same day → Google Play
   Organization account → upload a `production` build
   (`eas build -p android --profile production`, an `.aab`) → enrol in Play
   App Signing → add Play's app-signing SHA-256 to `assetlinks.json` and to
   Firebase.

Plan B: no CRO number by ~end of October → personal Play account and start
the 12-tester, 14-day closed test; transfer the app to the Organization
account later.

## Fonts on Android (Oct 2026)

First Android build showed every label cut short ("Ho…", "Phot",
"Revie"). Cause: fonts loaded at runtime by `useFonts`, so Android measured
text in the system font and drew it in Public Sans, which is wider. Fixed by
embedding the five font files with the `expo-font` plugin (`android.fonts`
in `mobile/app.json`) and skipping runtime loading on Android
(`mobile/src/app/_layout.tsx`). Needs a new native Android build.

## Fingerprint warning — iOS needs one new build

`runtimeVersion` is `fingerprint`, and the fingerprint hashes the whole app
config, Android sections included. These Android changes moved the **iOS**
fingerprint too (19aac67… → new). So the next iOS change must go out as a new
TestFlight build (`eas build -p ios --profile production`), not
`eas update` — an update published now would never reach existing TestFlight
installs. After that build, `eas update` works again as before.

After Android ships, `eas update` needs `--platform all` (or no platform
flag) instead of `--platform ios`.
