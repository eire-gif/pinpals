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

// Watch v2 (claude/watch-v2.md): the rest of the group's scores, one hole at
// a time, to POST /api/widget/live/scores. strokes null = picked up.
data class GroupScore(val playerId: Int, val strokes: Int?)

data class GroupPending(val roundId: Int, val hole: Int, val scores: List<GroupScore>, val at: Long)

object Store {
  private const val PREFS = "pinpals_watch"
  private const val ROUND = "round"
  private const val PENDING = "pending"
  private const val GROUP = "groupPending"
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
    writeGroup(context, readGroup(context).filterNot { it.roundId == roundId })
  }

  fun clearEverything(context: Context) = synchronized(lock) {
    prefs(context).edit().remove(PENDING).remove(GROUP).remove(ROUND).commit()
  }

  // The group's scores: a newer save for the same hole replaces a waiting one.

  private fun readGroup(context: Context): List<GroupPending> {
    val json = prefs(context).getString(GROUP, null) ?: return emptyList()
    return try {
      val a = JSONArray(json)
      (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        val sc = o.getJSONArray("scores")
        GroupPending(
          roundId = o.getInt("roundId"),
          hole = o.getInt("hole"),
          scores = (0 until sc.length()).map { j ->
            val x = sc.getJSONObject(j)
            GroupScore(x.getInt("player_id"), if (x.isNull("strokes")) null else x.getInt("strokes"))
          },
          at = o.getLong("at"),
        )
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun writeGroup(context: Context, items: List<GroupPending>) {
    val a = JSONArray()
    items.takeLast(40).forEach { p ->
      a.put(JSONObject().apply {
        put("roundId", p.roundId)
        put("hole", p.hole)
        put("scores", scoresJson(p.scores))
        put("at", p.at)
      })
    }
    prefs(context).edit().putString(GROUP, a.toString()).commit()
  }

  fun scoresJson(scores: List<GroupScore>): JSONArray = JSONArray().apply {
    scores.forEach { put(JSONObject().put("player_id", it.playerId).put("strokes", it.strokes ?: JSONObject.NULL)) }
  }

  fun enqueueGroup(context: Context, p: GroupPending) = synchronized(lock) {
    writeGroup(context, readGroup(context).filterNot { it.roundId == p.roundId && it.hole == p.hole } + p)
  }

  fun groupPending(context: Context, roundId: Int?): List<GroupPending> = synchronized(lock) {
    if (roundId == null) emptyList() else readGroup(context).filter { it.roundId == roundId }.sortedBy { it.at }
  }

  fun doneGroup(context: Context, p: GroupPending) = synchronized(lock) {
    writeGroup(context, readGroup(context).filterNot { it.roundId == p.roundId && it.hole == p.hole && it.at == p.at })
  }
}

object Sender {
  /** Sends this round's waiting scores, oldest first. Stops at the first that can't go. */
  suspend fun flush(context: Context, round: Round): Outcome {
    val items = Store.pending(context, round.roundId)
    if (items.isEmpty()) return flushGroup(context, round)
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
    if (!rejected) return flushGroup(context, round)
    val group = flushGroup(context, round)
    return if (group == Outcome.SENT) Outcome.REJECTED else group
  }

  /** The rest of the group's scores, oldest hole first. */
  private suspend fun flushGroup(context: Context, round: Round): Outcome {
    val items = Store.groupPending(context, round.roundId)
    if (items.isEmpty()) return Outcome.SENT
    val api = round.api?.takeIf { it.endsWith("/score") }?.let { it + "s" } ?: return Outcome.RETRY
    val token = round.token ?: return Outcome.UNAUTHORIZED
    var rejected = false
    for (p in items) {
      val body = JSONObject().put("hole", p.hole).put("scores", Store.scoresJson(p.scores))
      when (postJson(api, token, body)) {
        Outcome.SENT -> Store.doneGroup(context, p)
        Outcome.REJECTED -> {
          Store.doneGroup(context, p)
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

  private suspend fun postJson(api: String, token: String, body: JSONObject): Outcome = withContext(Dispatchers.IO) {
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

  /** GET with the round's key: the leaderboard. null on no signal; "401" on an expired key. */
  suspend fun getJson(url: String, token: String): Pair<Int, String?> = withContext(Dispatchers.IO) {
    var connection: HttpURLConnection? = null
    try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 10_000
        readTimeout = 10_000
        useCaches = false
        setRequestProperty("Authorization", "LiveScore $token")
      }
      val code = connection.responseCode
      code to if (code == 200) connection.inputStream.bufferedReader().use { it.readText() } else null
    } catch (e: Exception) {
      0 to null
    } finally {
      connection?.disconnect()
    }
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
