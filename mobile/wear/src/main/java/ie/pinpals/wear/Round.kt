package ie.pinpals.wear

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

// PinPals for Wear OS (Oct 2026): the round the phone hands the watch.
//
// The phone app sends the live round it's showing as one JSON string on the
// Data Layer path /pinpals/round (modules/live-activity/android). The golf
// here is the same as the iPhone lock screen card and the Apple Watch
// (targets/widget/_shared/LiveScoreShared.swift, targets/watch/WatchRound.swift):
// net par to start, Stableford points, the next hole with no score. Keep the
// three in step.

data class Hole(
  val n: Int,
  val par: Int,
  /** Stroke index; null when the card hasn't got it. */
  val si: Int?,
  /** The player's shots on this hole (from their playing handicap). */
  val shots: Int,
)

/** A hole's green centre and tee; null where it isn't mapped. Watch v2: the front and back of the green, and its hazards. */
data class Spot(
  val n: Int,
  val green: LatLng?,
  val tee: LatLng?,
  val front: LatLng? = null,
  val back: LatLng? = null,
  val hazards: List<Hazard> = emptyList(),
)

data class LatLng(val lat: Double, val lng: Double)

/** A hazard or marker: its kind ("water", "fairway_bunker"…), a name, and where. */
data class Hazard(val kind: String, val label: String, val at: LatLng)

// Watch v2 (claude/watch-v2.md): what else the phone sends (lock-screen-rules.ts WatchExtras).

data class GroupPlayer(
  val id: Int,
  val name: String,
  val me: Boolean,
  /** Shots received on each hole, in the card's order. */
  val shots: List<Int>,
  /** Saved scores, hole number → strokes. 0 = picked up. */
  val strokes: Map<Int, Int>,
)

data class Wind(val kmh: Double, val from: Double)

data class Extras(
  /** null = no group page (a shared card, or on your own). */
  val group: List<GroupPlayer>?,
  /** Competition mode: distances only (Rule 4.3). */
  val competition: Boolean,
  val premiumMap: Boolean,
  val premiumPlaysLike: Boolean,
  /** null when unknown, and always in a competition. */
  val wind: Wind?,
  /** GET /api/widget/live/board. */
  val board: String?,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    group?.let { g ->
      put("group", JSONArray().apply {
        g.forEach { p ->
          put(JSONObject().apply {
            put("id", p.id); put("name", p.name); put("me", p.me)
            put("shots", JSONArray().apply { p.shots.forEach { put(it) } })
            put("strokes", JSONObject().apply { p.strokes.forEach { (k, v) -> put(k.toString(), v) } })
          })
        }
      })
    }
    put("competition", competition)
    put("premium", JSONObject().put("map", premiumMap).put("playsLike", premiumPlaysLike))
    wind?.let { put("wind", JSONObject().put("kmh", it.kmh).put("from", it.from)) }
    board?.let { put("board", it) }
  }

  companion object {
    fun parse(o: JSONObject?): Extras? {
      if (o == null) return null
      val group = o.optJSONArray("group")?.let { a ->
        (0 until a.length()).map { i ->
          val p = a.getJSONObject(i)
          val strokes = mutableMapOf<Int, Int>()
          p.optJSONObject("strokes")?.let { s -> s.keys().forEach { k -> k.toIntOrNull()?.let { strokes[it] = s.getInt(k) } } }
          GroupPlayer(
            id = p.getInt("id"),
            name = p.optString("name", "Player"),
            me = p.optBoolean("me", false),
            shots = p.optJSONArray("shots")?.let { sh -> (0 until sh.length()).map { sh.optInt(it, 0) } } ?: emptyList(),
            strokes = strokes,
          )
        }
      }
      val premium = o.optJSONObject("premium")
      val wind = o.optJSONObject("wind")?.let { Wind(it.optDouble("kmh", 0.0), it.optDouble("from", 0.0)) }
      return Extras(
        group = group,
        competition = o.optBoolean("competition", false),
        premiumMap = premium?.optBoolean("map", true) ?: true,
        premiumPlaysLike = premium?.optBoolean("playsLike", true) ?: true,
        wind = wind,
        board = if (o.has("board") && !o.isNull("board")) o.optString("board") else null,
      )
    }
  }
}

data class Round(
  val roundId: Int,
  val course: String,
  /** "points" (Stableford), "stroke" or "match". */
  val format: String,
  val holes: List<Hole>,
  /** POST /api/widget/live/score, and the member's key for this round. */
  val api: String?,
  val token: String?,
  val playerId: Int?,
  /** The hole the phone is on. */
  val hole: Int,
  /** Saved scores, hole number → strokes. 0 = picked up. */
  val strokes: Map<Int, Int>,
  /** From the app: "2nd of 4", "2 UP". */
  val status: String?,
  val spots: List<Spot>,
  val finished: Boolean,
  val summary: String?,
  /** When the phone sent this (ms since 1970). */
  val sentAt: Long,
  /** Watch v2; null from a phone app older than v2. */
  val extras: Extras? = null,
) {
  val competition: Boolean get() = extras?.competition ?: false
  val mapAllowed: Boolean get() = extras?.premiumMap ?: true
  val playsLikeAllowed: Boolean get() = (extras?.premiumPlaysLike ?: true) && !competition
  val group: List<GroupPlayer>? get() = extras?.group?.takeIf { it.size > 1 }

  fun spot(n: Int): Spot? = spots.firstOrNull { it.n == n }

  /** A player's shots on hole [n] (from their position on the card). */
  fun shots(p: GroupPlayer, n: Int): Int {
    val i = holes.indexOfFirst { it.n == n }
    return if (i >= 0 && i < p.shots.size) p.shots[i] else 0
  }

  /** Lays group scores over the round, as saved here before they've gone. */
  fun withGroupScores(hole: Int, scores: List<GroupScore>): Round {
    val g = extras?.group ?: return this
    val next = g.map { p ->
      val s = scores.firstOrNull { it.playerId == p.id } ?: return@map p
      p.copy(strokes = p.strokes + (hole to (s.strokes ?: 0)))
    }
    return copy(extras = extras.copy(group = next))
  }

  fun info(n: Int): Hole? = holes.firstOrNull { it.n == n }

  /** What a hole's number starts at: par plus the player's shots, as in the app. */
  fun netPar(n: Int): Int = info(n)?.let { it.par + it.shots } ?: 4

  fun score(n: Int): Int? = strokes[n]

  /** Stableford points; picked up (0 or null) scores none. */
  fun points(s: Int?, n: Int): Int {
    val h = info(n) ?: return 0
    if (s == null || s <= 0) return 0
    return max(0, h.par + h.shots + 2 - s)
  }

  val allIn: Boolean get() = holes.all { strokes.containsKey(it.n) }

  /** "Net par · 2 pts", "Bogey", "Picked up". */
  fun describe(s: Int?, n: Int): String {
    val h = info(n) ?: return ""
    if (s == null || s <= 0) return if (format == "points") "Picked up · 0 pts" else "Picked up"
    val net = h.shots > 0
    val diff = s - (h.par + h.shots)
    val word = when {
      diff <= -3 -> if (net) "Net albatross" else "Albatross"
      diff == -2 -> if (net) "Net eagle" else "Eagle"
      diff == -1 -> if (net) "Net birdie" else "Birdie"
      diff == 0 -> if (net) "Net par" else "Par"
      diff == 1 -> if (net) "Net bogey" else "Bogey"
      diff == 2 -> if (net) "Net double" else "Double bogey"
      else -> if (net) "Net +$diff" else "+$diff"
    }
    if (format != "points") return word
    val p = points(s, n)
    return "$word · $p ${if (p == 1) "pt" else "pts"}"
  }

  /** "5 · 2 pts", "picked up". */
  fun short(s: Int?, n: Int): String {
    if (s == null || s <= 0) return "picked up"
    if (format != "points") return "$s"
    val p = points(s, n)
    return "$s · $p ${if (p == 1) "pt" else "pts"}"
  }

  /** "18 pts · thru 6", "Net +2 · thru 6", "Thru 6". */
  val total: String
    get() {
      val thru = strokes.size
      if (thru == 0) return "Hole ${holes.firstOrNull()?.n ?: 1} next"
      return when (format) {
        "points" -> "${strokes.entries.sumOf { points(it.value, it.key) }} pts · thru $thru"
        "stroke" -> {
          // A picked-up hole counts net double bogey, as on the app's card.
          val net = strokes.entries.sumOf { (n, s) ->
            val np = netPar(n)
            (if (s > 0) s else np + 2) - np
          }
          "Net ${if (net == 0) "E" else if (net > 0) "+$net" else "$net"} · thru $thru"
        }
        else -> "Thru $thru"
      }
    }

  /** The next hole after [n] with no score, going round the card. */
  fun nextHole(after: Int): Int? {
    val order = holes.map { it.n }
    val i = order.indexOf(after)
    if (i < 0) return order.firstOrNull { !strokes.containsKey(it) }
    val rest = order.subList(i + 1, order.size) + order.subList(0, i)
    return rest.firstOrNull { !strokes.containsKey(it) }
  }

  /** Where to start: the phone's hole, or the next one without a score. */
  val startHole: Int
    get() = if (!strokes.containsKey(hole) && info(hole) != null) hole else nextHole(after = hole) ?: hole

  fun neighbour(n: Int, step: Int): Int? {
    val order = holes.map { it.n }
    val j = order.indexOf(n) + step
    return if (order.indexOf(n) >= 0 && j in order.indices) order[j] else null
  }

  fun withScore(n: Int, s: Int?): Round = copy(strokes = strokes + (n to (s ?: 0)))

  fun withoutScore(n: Int): Round = copy(strokes = strokes - n)

  fun toJson(): String {
    val o = JSONObject()
    o.put("roundId", roundId)
    o.put("course", course)
    o.put("format", format)
    o.put("holes", JSONArray().apply {
      holes.forEach { h ->
        put(JSONObject().apply {
          put("n", h.n); put("par", h.par); put("shots", h.shots)
          if (h.si != null) put("si", h.si)
        })
      }
    })
    api?.let { o.put("api", it) }
    token?.let { o.put("token", it) }
    playerId?.let { o.put("playerId", it) }
    o.put("hole", hole)
    o.put("strokes", JSONObject().apply { strokes.forEach { (k, v) -> put(k.toString(), v) } })
    status?.let { o.put("status", it) }
    o.put("spots", JSONArray().apply {
      spots.forEach { s ->
        put(JSONObject().apply {
          put("n", s.n)
          s.green?.let { put("green", JSONArray().put(it.lat).put(it.lng)) }
          s.tee?.let { put("tee", JSONArray().put(it.lat).put(it.lng)) }
          s.front?.let { put("front", JSONArray().put(it.lat).put(it.lng)) }
          s.back?.let { put("back", JSONArray().put(it.lat).put(it.lng)) }
          if (s.hazards.isNotEmpty()) {
            put("hz", JSONArray().apply {
              s.hazards.forEach { h -> put(JSONObject().put("k", h.kind).put("l", h.label).put("p", JSONArray().put(h.at.lat).put(h.at.lng))) }
            })
          }
        })
      }
    })
    o.put("finished", finished)
    summary?.let { o.put("summary", it) }
    o.put("sentAt", sentAt)
    extras?.let { o.put("watch", it.toJson()) }
    return o.toString()
  }

  companion object {
    private fun JSONObject.intOrNull(key: String): Int? = if (has(key) && !isNull(key)) optInt(key) else null
    private fun JSONObject.stringOrNull(key: String): String? = if (has(key) && !isNull(key)) optString(key) else null

    private fun pair(a: JSONArray?): LatLng? =
      if (a != null && a.length() == 2) LatLng(a.getDouble(0), a.getDouble(1)) else null

    /** null when the JSON isn't a round. */
    fun parse(json: String): Round? = try {
      val o = JSONObject(json)
      val holes = o.getJSONArray("holes").let { a ->
        (0 until a.length()).map { i ->
          val h = a.getJSONObject(i)
          Hole(h.getInt("n"), h.getInt("par"), h.intOrNull("si"), h.optInt("shots", 0))
        }
      }
      val strokes = mutableMapOf<Int, Int>()
      o.optJSONObject("strokes")?.let { s -> s.keys().forEach { k -> k.toIntOrNull()?.let { strokes[it] = s.getInt(k) } } }
      val spots = o.optJSONArray("spots")?.let { a ->
        (0 until a.length()).map { i ->
          val s = a.getJSONObject(i)
          val hz = s.optJSONArray("hz")?.let { h ->
            (0 until h.length()).mapNotNull { j ->
              val x = h.optJSONObject(j) ?: return@mapNotNull null
              val at = pair(x.optJSONArray("p")) ?: return@mapNotNull null
              Hazard(x.optString("k", "other"), x.optString("l", "Hazard"), at)
            }
          } ?: emptyList()
          Spot(s.getInt("n"), pair(s.optJSONArray("green")), pair(s.optJSONArray("tee")), pair(s.optJSONArray("front")), pair(s.optJSONArray("back")), hz)
        }
      } ?: emptyList()
      val sentAt = o.optDouble("sentAt", 0.0)
      Round(
        roundId = o.getInt("roundId"),
        course = o.optString("course", "Live round"),
        format = o.optString("format", "points"),
        holes = holes,
        api = o.stringOrNull("api"),
        token = o.stringOrNull("token"),
        playerId = o.intOrNull("playerId"),
        hole = o.optInt("hole", holes.firstOrNull()?.n ?: 1),
        strokes = strokes,
        status = o.stringOrNull("status"),
        spots = spots,
        finished = o.optBoolean("finished", false),
        summary = o.stringOrNull("summary"),
        // The phone sends ms; older or iPhone-style seconds are scaled up.
        sentAt = if (sentAt in 1.0..1e11) (sentAt * 1000).toLong() else sentAt.toLong(),
        extras = Extras.parse(o.optJSONObject("watch")),
      )
    } catch (e: Exception) {
      null
    }
  }
}

// MARK: - The distance to the green

object Distance {
  fun bearing(a: LatLng, b: LatLng): Double {
    val la1 = Math.toRadians(a.lat)
    val la2 = Math.toRadians(b.lat)
    val dLng = Math.toRadians(b.lng - a.lng)
    val y = sin(dLng) * cos(la2)
    val x = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dLng)
    return (Math.toDegrees(kotlin.math.atan2(y, x)) + 360) % 360
  }

  fun yards(metres: Double): Int = (metres / METRES_PER_YARD).roundToInt()

  /** Where distances are measured from on hole [n]: the member when on the hole, else the tee. */
  fun origin(round: Round, n: Int, fix: LatLng?): Pair<LatLng, Boolean>? {
    val spot = round.spot(n) ?: return null
    val green = spot.green ?: return null
    if (fix != null && metres(fix, green) <= ON_HOLE_METRES) return fix to false
    val tee = spot.tee ?: return null
    return tee to true
  }

  data class GreenYards(val front: Int?, val centre: Int, val back: Int?, val fromTee: Boolean)

  fun greenYards(round: Round, n: Int, fix: LatLng?): GreenYards? {
    val spot = round.spot(n) ?: return null
    val green = spot.green ?: return null
    val (o, fromTee) = origin(round, n, fix) ?: return null
    return GreenYards(spot.front?.let { yards(metres(o, it)) }, yards(metres(o, green)), spot.back?.let { yards(metres(o, it)) }, fromTee)
  }

  /** Hazards still in play, nearest first (hole-geo.ts hazardsAheadM — markers and doglegs left out). */
  fun hazardsAhead(round: Round, n: Int, fix: LatLng?): List<Pair<Hazard, Int>> {
    val spot = round.spot(n) ?: return emptyList()
    val green = spot.green ?: return emptyList()
    val (o, _) = origin(round, n, fix) ?: return emptyList()
    val toGreen = metres(o, green)
    return spot.hazards
      .filter { !it.kind.startsWith("marker_") && it.kind != "dogleg" }
      .filter { metres(it.at, green) < toGreen }
      .map { it to yards(metres(o, it.at)) }
      .sortedBy { it.second }
  }

  /** Where the target starts: a drive (210 m) toward the green, or null within a drive (hole-geo.ts defaultAim). */
  fun defaultAim(from: LatLng, green: LatLng): LatLng? {
    val d = metres(from, green)
    if (d <= 240) return null
    val t = min(210.0, d - 80) / d
    return LatLng(from.lat + (green.lat - from.lat) * t, from.lng + (green.lng - from.lng) * t)
  }

  /** Further than this from the green, the member isn't on the hole: show its length from the tee (hole-geo.ts ON_HOLE_RADIUS_M). */
  const val ON_HOLE_METRES = 750.0
  const val METRES_PER_YARD = 0.9144

  fun metres(a: LatLng, b: LatLng): Double {
    val r = 6_371_000.0
    val lat1 = Math.toRadians(a.lat)
    val lat2 = Math.toRadians(b.lat)
    val dLat = Math.toRadians(b.lat - a.lat)
    val dLng = Math.toRadians(b.lng - a.lng)
    val h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
    return 2 * r * asin(min(1.0, sqrt(h)))
  }

  /** Yards and where from ("you" / "tee") for hole [n], or nulls when the hole isn't mapped. */
  fun measure(round: Round, n: Int, fix: LatLng?): Pair<Int?, String?> {
    val spot = round.spots.firstOrNull { it.n == n } ?: return null to null
    val green = spot.green ?: return null to null
    if (fix != null) {
      val d = metres(fix, green)
      if (d <= ON_HOLE_METRES) return (d / METRES_PER_YARD).roundToInt() to "you"
    }
    val tee = spot.tee ?: return null to null
    return (metres(tee, green) / METRES_PER_YARD).roundToInt() to "tee"
  }
}

// MARK: - Plays like (wind.ts — keep the copies in step)

object WindMaths {
  const val KMH_PER_MPH = 1.609344

  private fun rel(w: Wind, shotBearing: Double): Double = ((((w.from - shotBearing + 180) % 360) + 360) % 360) - 180

  /** Head (+) or tail (−) wind along the shot, mph. */
  fun headMph(w: Wind, shotBearing: Double): Double {
    val mph = w.kmh / KMH_PER_MPH
    if (mph < 3) return 0.0
    return mph * cos(Math.toRadians(rel(w, shotBearing)))
  }

  /** 1% per mph into, half that behind; capped −15% / +30% (wind.ts playsLikeM). */
  fun playsLike(distance: Int, headMph: Double): Int {
    val pct = if (headMph >= 0) 0.01 * headMph else 0.005 * headMph
    return (distance * (1 + pct.coerceIn(-0.15, 0.3))).roundToInt()
  }

  fun along(w: Wind, shotBearing: Double): String {
    val mph = w.kmh / KMH_PER_MPH
    if (mph < 3) return "Calm"
    val r = Math.toRadians(rel(w, shotBearing))
    val head = mph * cos(r)
    val cross = mph * sin(r)
    return if (kotlin.math.abs(head) >= kotlin.math.abs(cross) * 0.58) (if (head > 0) "Into" else "Behind") else "Across"
  }
}
