package ie.pinpals.wear

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

// Watch v2 (claude/watch-v2.md): the GPS with the wrist down.
//
// While a live round is open, a foreground location service keeps the
// member's position coming with the screen off, so the distance is right at
// the next glance instead of catching up. It shows as an Ongoing Activity:
// the PinPals icon on the watch face, one tap back into the round. It starts
// only from the open app (Android won't start location in the background) and
// stops when the round finishes or goes, or after six hours at most.

class RoundService : Service() {
  private val client by lazy { LocationServices.getFusedLocationProviderClient(this) }

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      val l = result.lastLocation ?: return
      if (!l.hasAccuracy() || l.accuracy > 40f) return
      RoundModel.located(l.latitude, l.longitude)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  @SuppressLint("MissingPermission")
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    RoundModel.init(this)
    val notification = notification()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Not allowed from here (no location permission, or the app went to the background first).
      running = false
      stopSelf()
      return START_NOT_STICKY
    }
    if (!running) {
      val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5_000L)
        .setMinUpdateDistanceMeters(3f)
        .build()
      try {
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        running = true
      } catch (e: SecurityException) {
        stopSelf()
        return START_NOT_STICKY
      }
    }
    // A round that's never finished mustn't drain the battery overnight.
    android.os.Handler(Looper.getMainLooper()).postDelayed({ stopSelf() }, MAX_MS)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    try {
      client.removeLocationUpdates(callback)
    } catch (e: Exception) {
      // Already gone.
    }
    super.onDestroy()
  }

  private fun notification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Live round", NotificationManager.IMPORTANCE_LOW))
    }
    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("PinPals")
      .setContentText("Live round")
      .setCategory(NotificationCompat.CATEGORY_WORKOUT)
      .setOngoing(true)
      .setContentIntent(open)
    OngoingActivity.Builder(applicationContext, NOTIFICATION_ID, builder)
      .setStaticIcon(R.mipmap.ic_launcher)
      .setTouchIntent(open)
      .setStatus(Status.Builder().addTemplate("Live round").build())
      .build()
      .apply(applicationContext)
    return builder.build()
  }

  companion object {
    private const val CHANNEL = "live_round"
    private const val NOTIFICATION_ID = 7
    private const val MAX_MS = 6 * 3600 * 1000L

    @Volatile
    var running = false
      private set

    /** From the open app: keep the GPS going for this round. */
    fun start(context: Context) {
      try {
        context.startForegroundService(Intent(context, RoundService::class.java))
      } catch (e: Exception) {
        // Android said no (background start): the app's own GPS still runs while it's open.
      }
    }

    /** The round changed: stop once it's finished or gone. Never starts (see start). */
    fun follow(context: Context, round: Round?) {
      if (round == null || round.finished) context.stopService(Intent(context, RoundService::class.java))
    }
  }
}
