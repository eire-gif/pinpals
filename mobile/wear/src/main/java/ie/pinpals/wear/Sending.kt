package ie.pinpals.wear

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

// PinPals for Wear OS (Oct 2026): keeping scores and getting them home.
//
// Every score is kept on the watch first, then sent to
// POST /api/widget/live/score — the iPhone lock screen's route — with the
// member's key for this round. Wear OS sends it over the phone's connection
// when the phone is near, or the watch's own Wi-Fi or mobile data. No signal
// → it stays on the watch, and WorkManager sends it as soon as there's a
// connection, even with the app closed. A score is never lost to a
// links-course sea fog.

data class Pending(
  val roundId: Int,
  val hole: Int,
  /** null = picked up. */
  val strokes: Int?,
  val clear: Boolean,
  val at: Long,
)

enum class Outcome { SENT, RETRY, UNAUTHORIZED, FINISHED, REJECTED }

object Store {
  private const val PREFS = "pinpals_watch"
  private const val ROUND = "round"
  private const val PENDING = "pending"
  private val lock = Any()

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun loadRound(context: Context): Round? = prefs(context).getString(ROUND, null)?.let { Round.parse(it) }

  fun saveRound(context: Context, round: Round?) {
    prefs(context).edit().apply {
      if (round == null) remove(ROUND) else putString(ROUND, round.toJson())
    }.apply()
  }

  private fun read(context: Context): List<Pending> {
    val json = prefs(context).getString(PENDING, null) ?: return emptyList()
    return try {
      val a = JSONArray(json)
      (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        Pending(
          roundId = o.getInt("roundId"),
          hole = o.getInt("hole"),
          strokes = if (o.isNull("strokes")) null else o.getInt("strokes"),
          clear = o.optBoolean("clear", false),
          at = o.getLong("at"),
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun write(context: Context, items: List<Pending>) {
    val a = JSONArray()
    items.takeLast(80).forEach { p ->
      a.put(JSONObject().apply {
        put("roundId", p.roundId)
        put("hole", p.hole)
        put("strokes", p.strokes ?: JSONObject.NULL)
        put("clear", p.clear)
        put("at", p.at)
      })
    }
    prefs(context).edit().putString(PENDING, a.toString()).commit()
  }

  /** Keep a score to send; a newer score for the same hole replaces a waiting one. */
  fun enqueue(context: Context, p: Pending) = synchronized(lock) {
    write(context, read(context).filterNot { it.roundId == p.roundId && it.hole == p.hole } + p)
  }

  fun pending(context: Context, roundId: Int?): List<Pending> = synchronized(lock) {
    if (roundId == null) emptyList() else read(context).filter { it.roundId == roundId }.sortedBy { it.at }
  }

  /** Clears one entry, unless a newer score for that hole replaced it meanwhile. */
  fun done(context: Context, p: Pending) = synchronized(lock) {
    write(context, read(context).filterNot { it.roundId == p.roundId && it.hole == p.hole && it.at == p.at })
  }

  fun drop(context: Context, roundId: Int) = synchronized(lock) {
    write(context, read(context).filterNot { it.roundId == roundId })
  }

  fun clearEverything(context: Context) = synchronized(lock) {
    prefs(context).edit().remove(PENDING).remove(ROUND).commit()
  }
}

object Sender {
  /** Sends this round's waiting scores, oldest first. Stops at the first that can't go. */
  suspend fun flush(context: Context, round: Round): Outcome {
    val items = Store.pending(context, round.roundId)
    if (items.isEmpty()) return Outcome.SENT
    val api = round.api ?: return Outcome.RETRY
    val token = round.token ?: return Outcome.UNAUTHORIZED
    var rejected = false
    for (p in items) {
      when (post(p, api, token)) {
        Outcome.SENT -> Store.done(context, p)
        // The website said this score can never be accepted (not your round,
        // a hole off the card): drop it rather than retry forever, and say so.
        Outcome.REJECTED -> {
          Store.done(context, p)
          rejected = true
        }
        Outcome.RETRY -> return Outcome.RETRY
        Outcome.UNAUTHORIZED -> return Outcome.UNAUTHORIZED
        Outcome.FINISHED -> {
          Store.drop(context, round.roundId)
          return Outcome.FINISHED
        }
      }
    }
    return if (rejected) Outcome.REJECTED else Outcome.SENT
  }

  private suspend fun post(p: Pending, api: String, token: String): Outcome = withContext(Dispatchers.IO) {
    var connection: HttpURLConnection? = null
    try {
      connection = (URL(api).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 10_000
        readTimeout = 10_000
        doOutput = true
        useCaches = false
        setRequestProperty("Authorization", "LiveScore $token")
        setRequestProperty("Content-Type", "application/json")
      }
      val body = JSONObject().apply {
        put("hole", p.hole)
        put("strokes", p.strokes ?: JSONObject.NULL)
        put("clear", p.clear)
      }
      connection.outputStream.use { it.write(body.toString().toByteArray()) }
      when (connection.responseCode) {
        200 -> Outcome.SENT
        401 -> Outcome.UNAUTHORIZED
        409 -> Outcome.FINISHED
        400, 403 -> Outcome.REJECTED
        else -> Outcome.RETRY
      }
    } catch (e: Exception) {
      Outcome.RETRY
    } finally {
      connection?.disconnect()
    }
  }

  /** Sends whatever's waiting as soon as there's a connection, app open or not. */
  fun schedule(context: Context) {
    val request = OneTimeWorkRequestBuilder<FlushWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork("pinpals-flush", ExistingWorkPolicy.REPLACE, request)
  }
}

class FlushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val round = Store.loadRound(applicationContext) ?: return Result.success()
    return when (Sender.flush(applicationContext, round)) {
      Outcome.RETRY -> Result.retry()
      // Key expired: the phone renews it when the round is opened there.
      else -> Result.success()
    }
  }
}
