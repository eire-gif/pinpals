package ie.pinpals.liveactivity

import android.content.Context
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

// PinPals for Wear OS (Oct 2026): the phone's side. See claude/wear-os.md.
//
// Android has no lock screen scoring card, but JavaScript makes the same calls
// as on iPhone (lock-screen.ts: start, update, setGeometry, end). Here they
// keep one merged "live round" and put it on the Wear OS Data Layer at
// /pinpals/round, which Wear OS copies to the watch — even when the watch app
// isn't open, and later if the watch is out of reach. The watch sends its
// scores to the website itself; nothing comes back this way.
//
// Same JSON as the Apple Watch gets (modules/live-activity/ios/PinPalsWatchLink.swift).

class PinPalsLiveActivityModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("PinPalsLiveActivity")

    OnCreate {
      context?.let { WearLink.watch(it) }
    }

    /** A watch with PinPals on it (checked when the app starts and whenever that changes). */
    Function("isSupported") {
      WearLink.hasWatch
    }

    /** null on success, otherwise a short reason — as on iPhone. */
    Function("start") { json: String ->
      WearLink.started(context, json)
    }

    Function("update") { json: String ->
      WearLink.updated(context, json)
    }

    Function("end") { json: String ->
      WearLink.ended(context, json)
    }

    Function("setGeometry") { json: String ->
      WearLink.geometry(context, json)
    }

    /** The phone's own GPS isn't used for the watch: it has its own. */
    Function("setLocation") { _: String ->
      "not running"
    }

    /** Lock screen scores waiting to send: there's no lock screen card on Android. */
    Function("takePending") {
      "[]"
    }
  }
}

object WearLink {
  private const val PATH = "/pinpals/round"
  private const val CAPABILITY = "pinpals_wear"
  /** These keys are the watch's business; the card's links stay behind. */
  private val keep = setOf("roundId", "course", "format", "holes", "api", "token", "playerId", "hole", "strokes", "status", "watch")

  @Volatile
  var hasWatch = false
    private set
  private var round: JSONObject? = null
  private var watching = false

  /** Finds out whether a watch has PinPals, and keeps finding out. */
  @Synchronized
  fun watch(context: Context) {
    if (watching) return
    watching = true
    try {
      val client = Wearable.getCapabilityClient(context)
      client.getCapability(CAPABILITY, CapabilityClient.FILTER_ALL)
        .addOnSuccessListener { info -> hasWatch = info.nodes.isNotEmpty() }
      client.addListener({ info: CapabilityInfo ->
        val had = hasWatch
        hasWatch = info.nodes.isNotEmpty()
        // PinPals just went onto the watch mid-round: send it over.
        if (hasWatch && !had) push(context)
      }, CAPABILITY)
    } catch (e: Exception) {
      // No Google Play services (or no Wear OS app on the phone): no watch.
    }
  }

  private fun id(o: JSONObject?): Int? = if (o != null && o.has("roundId") && !o.isNull("roundId")) o.optInt("roundId") else null

  @Synchronized
  fun started(context: Context?, json: String): String? {
    val input = parse(json) ?: return "bad input"
    val next = JSONObject()
    for (k in input.keys()) if (k in keep && !input.isNull(k)) next.put(k, input.get(k))
    // The same round again (the app reopened): keep its greens.
    round?.let { have -> if (id(have) == id(next) && have.has("spots")) next.put("spots", have.get("spots")) }
    round = next
    push(context)
    return if (hasWatch) null else "no watch"
  }

  @Synchronized
  fun updated(context: Context?, json: String): String? {
    val input = parse(json) ?: return "bad input"
    val have = round ?: return "not running"
    if (id(have) != id(input)) return "not running"
    for (k in input.keys()) {
      if (k !in keep) continue
      // "status": null clears the standing; a missing key leaves it.
      if (input.isNull(k)) have.remove(k) else have.put(k, input.get(k))
    }
    push(context)
    return null
  }

  @Synchronized
  fun geometry(context: Context?, json: String): String? {
    val input = parse(json) ?: return "bad input"
    val have = round ?: return "not running"
    if (id(have) != id(input)) return "not running"
    have.put("spots", input.optJSONArray("holes") ?: org.json.JSONArray())
    push(context)
    return null
  }

  @Synchronized
  fun ended(context: Context?, json: String): String? {
    val input = parse(json) ?: JSONObject()
    val roundId = id(input)
    val immediate = input.optBoolean("immediate", false)
    if (roundId == null || immediate) {
      // Signed out, or the round was deleted: nothing left on the watch.
      if (roundId == null || id(round) == roundId) {
        round = null
        clear(context)
      }
      return null
    }
    val have = round ?: return null
    if (id(have) != roundId) return null
    have.put("finished", true)
    if (input.has("summary") && !input.isNull("summary")) have.put("summary", input.getString("summary"))
    push(context)
    return null
  }

  private fun parse(json: String): JSONObject? = try {
    JSONObject(json)
  } catch (e: Exception) {
    null
  }

  private fun push(context: Context?) {
    val ctx = context ?: return
    val have = round ?: return
    val now = System.currentTimeMillis()
    have.put("sentAt", now)
    put(ctx) {
      putString("round", have.toString())
      putLong("sentAt", now)
    }
  }

  private fun clear(context: Context?) {
    val ctx = context ?: return
    put(ctx) {
      putBoolean("cleared", true)
      putLong("sentAt", System.currentTimeMillis())
    }
  }

  private fun put(context: Context, fill: com.google.android.gms.wearable.DataMap.() -> Unit) {
    try {
      val request = PutDataMapRequest.create(PATH).apply { dataMap.fill() }
        .asPutDataRequest()
        .setUrgent()
      Wearable.getDataClient(context).putDataItem(request)
    } catch (e: Exception) {
      // No Google Play services: no watch to tell.
    }
  }
}
