# Native modules waiting for a new build

Anything in `mobile/modules` is compiled into the app and is part of the
runtime fingerprint (`runtimeVersion.policy: "fingerprint"` in app.json).
Adding a module there changes the fingerprint, and `eas update` then
publishes to a runtime no phone has — installed apps silently stop getting
updates.

So native modules that aren't in a released build yet wait here. Move one
into `mobile/modules` in the same change as a new `eas build`.

- `age-signals` — Apple Declared Age Range / Google Play Age Signals for
  junior members. Steps: claude/junior-members.md, "To ship" 4.
