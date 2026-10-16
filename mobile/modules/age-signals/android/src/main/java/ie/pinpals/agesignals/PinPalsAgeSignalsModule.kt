package ie.pinpals.agesignals

import com.google.android.play.agesignals.AgeSignalsManagerFactory
import com.google.android.play.agesignals.AgeSignalsRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// App store age signals, Android half (junior members, claude/junior-members.md).
//
// Asks Google Play's Age Signals API what Play knows about the person's
// age. The answer goes to the database (report_store_age_signal) from
// JavaScript (lib/store-age.ts): an upper bound under 18 on an 18+ account
// flags it for review.
//
// Every failure — no Play Store, outside a covered region, an API error —
// resolves to null. It never rejects: a missing signal just means nothing
// is reported.
//
// Result: null, or { status, lowerBound, upperBound } where the bounds may be
// null (Play's own convention: null upper bound = 18 or over).
class PinPalsAgeSignalsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PinPalsAgeSignals")

    AsyncFunction("requestAgeRange") { promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      try {
        AgeSignalsManagerFactory.create(context)
          .checkAgeSignals(AgeSignalsRequest.builder().build())
          .addOnSuccessListener { result ->
            try {
              promise.resolve(
                mapOf(
                  "status" to statusName(result.userStatus()),
                  "lowerBound" to result.ageLower(),
                  "upperBound" to result.ageUpper()
                )
              )
            } catch (e: Throwable) {
              promise.resolve(null)
            }
          }
          .addOnFailureListener { promise.resolve(null) }
      } catch (e: Throwable) {
        promise.resolve(null)
      }
    }
  }

  // The status is sent as Play names it (VERIFIED, SUPERVISED, …) — or its
  // number, if this library version models it as int constants. The
  // database only keeps it for staff to read; the bounds are what count.
  // Not matched against AgeSignalsVerificationStatus here so that a change of
  // that class's package between beta versions can't break the build.
  private fun statusName(status: Any?): String = status?.toString()?.take(40) ?: "none"
}
