package ie.pinpals.wear

import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester

// Watch v2 (claude/watch-v2.md): what the Tile and the complication show.
// The model writes a small summary each time the hole, score or distance
// changes; the Tile and complication read it. Wear OS limits how often they
// may be refreshed, so this asks only on a new hole or score, a 5-yard
// change, or a minute gone by.

data class GlanceData(
  val live: Boolean,
  val hole: Int,
  val par: Int,
  val yards: Int?,
  val line: String,
  /** Tee to green, 0 to 1. */
  val progress: Float,
)

object Glance {
  private const val PREFS = "pinpals_glance"
  private var last: GlanceData? = null
  private var lastAsked = 0L

  fun read(context: Context): GlanceData {
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    // A summary older than six hours is a round someone forgot to finish.
    val fresh = System.currentTimeMillis() - p.getLong("at", 0L) < 6 * 3600 * 1000L
    return GlanceData(
      live = fresh && p.getBoolean("live", false),
      hole = p.getInt("hole", 0),
      par = p.getInt("par", 0),
      yards = p.getInt("yards", -1).takeIf { it >= 0 },
      line = p.getString("line", "") ?: "",
      progress = p.getFloat("progress", 0f),
    )
  }

  fun update(context: Context, s: Screen) {
    val r = s.round
    val info = s.holeInfo
    val data = if (r != null && !r.finished && info != null) {
      var progress = 0f
      val spot = r.spot(s.hole)
      val y = s.distance
      val tee = spot?.tee
      val green = spot?.green
      if (y != null && tee != null && green != null) {
        val length = Distance.metres(tee, green) / Distance.METRES_PER_YARD
        if (length > 0) progress = (1 - y / length).toFloat().coerceIn(0f, 1f)
      }
      GlanceData(true, info.n, info.par, y, r.status ?: r.total, progress)
    } else {
      GlanceData(false, 0, 0, null, "", 0f)
    }
    val before = last
    last = data
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putBoolean("live", data.live)
      .putInt("hole", data.hole)
      .putInt("par", data.par)
      .putInt("yards", data.yards ?: -1)
      .putString("line", data.line)
      .putFloat("progress", data.progress)
      .putLong("at", System.currentTimeMillis())
      .apply()
    val now = System.currentTimeMillis()
    val worth = before == null || before.live != data.live || before.hole != data.hole || before.line != data.line ||
      (before.yards != null && data.yards != null && (kotlin.math.abs(before.yards - data.yards) >= 5 || now - lastAsked > 60_000)) ||
      (before.yards == null) != (data.yards == null)
    if (worth) {
      lastAsked = now
      changed(context)
    }
  }

  fun changed(context: Context) {
    try {
      TileService.getUpdater(context).requestUpdate(PinPalsTileService::class.java)
      ComplicationDataSourceUpdateRequester.create(context, ComponentName(context, PinPalsComplicationService::class.java)).requestUpdateAll()
    } catch (e: Exception) {
      // Not on a face or in the Tiles: nothing to refresh.
    }
  }
}
