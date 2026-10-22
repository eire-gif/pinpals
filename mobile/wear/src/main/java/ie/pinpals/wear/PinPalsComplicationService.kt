package ie.pinpals.wear

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.RangedValueComplicationData
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

// Watch v2 (claude/watch-v2.md): PinPals on any watch face with a
// complication slot. Ranged value: the yards to the centre, its ring filling
// as you walk from tee to green; short text where the slot is small. Nothing
// shown when no round is live. Tapping it opens the app on the round.

class PinPalsComplicationService : SuspendingComplicationDataSourceService() {
  private fun plain(s: String) = PlainComplicationText.Builder(s).build()

  private fun tap(): PendingIntent = PendingIntent.getActivity(
    this,
    0,
    Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
  )

  override suspend fun onComplicationRequest(request: ComplicationRequest): ComplicationData =
    build(request.complicationType, Glance.read(this))

  override fun getPreviewData(type: ComplicationType): ComplicationData =
    build(type, GlanceData(live = true, hole = 7, par = 4, yards = 398, line = "16 pts · thru 6", progress = 0.2f))

  private fun build(type: ComplicationType, g: GlanceData): ComplicationData {
    if (!g.live) return NoDataComplicationData()
    val big = g.yards?.toString() ?: "P${g.par}"
    val described = plain(if (g.yards != null) "Hole ${g.hole}, ${g.yards} yards to the green" else "Hole ${g.hole}, par ${g.par}")
    return when (type) {
      ComplicationType.RANGED_VALUE ->
        RangedValueComplicationData.Builder(g.progress, 0f, 1f, described)
          .setText(plain(big))
          .setTitle(plain("H${g.hole}"))
          .setTapAction(tap())
          .build()
      ComplicationType.SHORT_TEXT ->
        ShortTextComplicationData.Builder(plain(big), described)
          .setTitle(plain("H${g.hole}"))
          .setTapAction(tap())
          .build()
      else -> NoDataComplicationData()
    }
  }
}
