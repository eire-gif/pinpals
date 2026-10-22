package ie.pinpals.wear

import android.annotation.SuppressLint
import android.content.Context
import android.os.Looper
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.tasks.await

// PinPals for Wear OS (Oct 2026): the round from the phone, and the GPS.
//
// The phone app (modules/live-activity/android) puts the live round on the
// Data Layer at /pinpals/round. Wear OS keeps the latest copy on both sides
// and wakes this service when it changes, even with the app closed. When the
// app opens it also reads the copy already there.

const val ROUND_PATH = "/pinpals/round"

private fun handle(context: Context, map: DataMap) {
  if (map.getBoolean("cleared", false)) {
    RoundModel.clear(context)
    return
  }
  val json = map.getString("round") ?: return
  val round = Round.parse(json) ?: return
  RoundModel.apply(context, round)
}

class RoundListenerService : WearableListenerService() {
  override fun onDataChanged(events: DataEventBuffer) {
    // Copy out first: the buffer is released when this returns.
    val maps = events
      .filter { it.type == DataEvent.TYPE_CHANGED && it.dataItem.uri.path == ROUND_PATH }
      .map { DataMapItem.fromDataItem(it.dataItem).dataMap }
    maps.forEach { handle(applicationContext, it) }
  }
}

object PhoneLink {
  /** The round the phone last sent, for when the app opens. */
  suspend fun catchUp(context: Context) {
    try {
      val items = Wearable.getDataClient(context).dataItems.await()
      try {
        val latest = items
          .filter { it.uri.path == ROUND_PATH }
          .map { DataMapItem.fromDataItem(it).dataMap }
          .maxByOrNull { it.getLong("sentAt", 0L) }
        latest?.let { handle(context, it) }
      } finally {
        items.release()
      }
    } catch (e: Exception) {
      // No phone paired yet, or Google Play services busy: the listener will catch up.
    }
  }
}

/** The watch's own GPS (or the phone's, when Wear OS borrows it), while the app's open. */
class WatchLocation(context: Context) {
  private val client = LocationServices.getFusedLocationProviderClient(context)
  private var running = false

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      val l = result.lastLocation ?: return
      // A rough fix (indoors, just woken) would put the member on the wrong hole.
      if (!l.hasAccuracy() || l.accuracy > 40f) return
      RoundModel.located(l.latitude, l.longitude)
    }
  }

  @SuppressLint("MissingPermission")
  fun start() {
    if (running) return
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 3_000L)
      .setMinUpdateDistanceMeters(3f)
      .build()
    try {
      client.requestLocationUpdates(request, callback, Looper.getMainLooper())
      running = true
    } catch (e: SecurityException) {
      // Location not allowed: the hole's length from the tee instead.
    }
  }

  fun stop() {
    if (!running) return
    client.removeLocationUpdates(callback)
    running = false
  }
}
