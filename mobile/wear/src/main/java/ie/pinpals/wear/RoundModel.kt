package ie.pinpals.wear

import android.content.Context
import android.os.VibrationEffect
import android.os.VibratorManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// PinPals for Wear OS (Oct 2026): what the watch shows and what its buttons
// do. Same rules as the iPhone lock screen card and the Apple Watch: the
// number starts at net par, − / + (or turning the crown or bezel) changes it,
// Save keeps it and moves on to the next hole with no score, Undo goes back
// to the hole just saved.
//
// Watch v2 (claude/watch-v2.md) adds the pages around scoring — distances,
// the hole map, hazards, the group's scores, the leaderboard — keeps the GPS
// going wrist-down while a round is on (RoundService), and feeds the Tile and
// the complication.

/** The pages, left to right. */
object Pages {
  const val DISTANCES = 0
  const val MAP = 1
  const val HAZARDS = 2
  const val SCORE = 3
  const val BOARD = 4
  const val CARD = 5
  const val COUNT = 6
}

/** A birdie (or better) by someone in the group, shown for a few seconds. */
data class Alert(val title: String, val line: String)

data class BoardRow(val pos: String, val name: String, val thru: String, val score: String, val mine: Boolean)

/** The leaderboard (GET /api/widget/live/board → src/lib/widget-board.ts). */
data class Board(
  val final: Boolean,
  val title: String,
  val teams: List<Pair<String, String>>,
  val rows: List<BoardRow>,
  val big: String?,
  val line1: String?,
  val line2: String?,
) {
  companion object {
    fun parse(json: String): Board? = try {
      val o = org.json.JSONObject(json)
      val rows = o.optJSONObject("board")?.optJSONArray("rows")?.let { a ->
        (0 until a.length()).map { i ->
          val r = a.getJSONObject(i)
          BoardRow(r.optString("pos"), r.optString("name"), r.optString("thru"), r.optString("score"), r.optBoolean("mine", false))
        }
      } ?: emptyList()
      val teams = o.optJSONArray("teams")?.let { a -> (0 until a.length()).map { a.getJSONObject(it).let { t -> t.optString("name") to t.optString("points") } } } ?: emptyList()
      val mine = o.optJSONObject("mine")
      Board(
        final = o.optString("state") == "final",
        title = o.optString("title"),
        teams = teams,
        rows = rows,
        big = mine?.optString("big"),
        line1 = mine?.optString("line1"),
        line2 = mine?.optString("line2"),
      )
    } catch (e: Exception) {
      null
    }
  }
}

data class Screen(
  val round: Round? = null,
  /** The hole on screen. */
  val hole: Int = 1,
  /** Strokes chosen but not saved yet. null = net par (or the saved score). */
  val draft: Int? = null,
  /** "Hole 7 · 5 · 2 pts", after a save. */
  val saved: String? = null,
  /** The hole Undo goes back to. */
  val undoHole: Int? = null,
  /** Scores kept on the watch, not sent yet. */
  val waiting: Int = 0,
  /** Something the member needs to act on. */
  val notice: String? = null,
  val distance: Int? = null,
  /** "you" or "tee": where [distance] is measured from. */
  val distanceFrom: String? = null,
  /** The page on screen (Pages). */
  val page: Int = Pages.DISTANCES,
  /** Where the member is, for the distance pages; null without a recent fix. */
  val fix: LatLng? = null,
  /** The group page: strokes chosen but not saved, by player id. */
  val groupDrafts: Map<Int, Int> = emptyMap(),
  /** The group page: the row the crown changes (null = the first). */
  val groupSelected: Int? = null,
  val board: Board? = null,
  val boardNote: String? = null,
  val alert: Alert? = null,
  /** "Plays like" can be switched off on the watch. */
  val playsLikeOn: Boolean = true,
) {
  /** The number shown for a player on the group page. */
  fun groupShown(p: GroupPlayer): Int {
    groupDrafts[p.id]?.let { return it }
    val r = round ?: return 4
    val saved = if (p.me) r.score(hole) else p.strokes[hole]
    if (saved != null && saved > 0) return saved
    val info = r.info(hole) ?: return 4
    return info.par + r.shots(p, hole)
  }

  fun groupIsSuggestion(p: GroupPlayer): Boolean {
    if (groupDrafts.containsKey(p.id)) return false
    val saved = if (p.me) round?.score(hole) else p.strokes[hole]
    return (saved ?: 0) == 0
  }

  fun groupSelectedPlayer(): GroupPlayer? {
    val g = round?.group ?: return null
    return g.firstOrNull { it.id == groupSelected } ?: g.firstOrNull()
  }

  val holeInfo: Hole? get() = round?.info(hole)

  /** The number shown for the hole on screen. */
  val shown: Int
    get() = draft ?: round?.score(hole)?.takeIf { it > 0 } ?: round?.netPar(hole) ?: 4

  /** Shown dimmed: net par, not something the member chose. */
  val isSuggestion: Boolean get() = draft == null && (round?.score(hole) ?: 0) == 0
}

object RoundModel {
  private val _screen = MutableStateFlow(Screen())
  val screen: StateFlow<Screen> = _screen.asStateFlow()

  private lateinit var app: Context
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val sending = Mutex()
  private var fix: Pair<LatLng, Long>? = null
  /** An older position says nothing about where the member is now. */
  private const val FIX_LIFETIME_MS = 10 * 60 * 1000L

  private fun prefs() = app.getSharedPreferences("pinpals_watch_settings", Context.MODE_PRIVATE)

  private fun waitingFor(roundId: Int?): Int = Store.pending(app, roundId).size + Store.groupPending(app, roundId).size

  fun init(context: Context) {
    if (::app.isInitialized) return
    app = context.applicationContext
    val round = Store.loadRound(app)
    _screen.value = Screen(
      round = round,
      hole = round?.startHole ?: 1,
      waiting = waitingFor(round?.roundId),
      playsLikeOn = prefs().getBoolean("playsLikeOn", true),
    )
  }

  // MARK: From the phone

  fun apply(context: Context, incoming: Round) {
    init(context)
    val now = _screen.value
    val same = now.round?.roundId == incoming.roundId
    if (same && now.round != null && incoming.sentAt < now.round.sentAt) return
    // Scores saved here and not yet home still count.
    var next = incoming
    for (p in Store.pending(app, incoming.roundId)) {
      next = if (p.clear) next.withoutScore(p.hole) else next.withScore(p.hole, p.strokes)
    }
    for (g in Store.groupPending(app, incoming.roundId)) next = next.withGroupScores(g.hole, g.scores)
    Store.saveRound(app, next)
    if (next.finished) Store.drop(app, next.roundId)
    val waiting = waitingFor(next.roundId)
    val alert = if (same) now.round?.let { birdie(it, next) } else null
    _screen.update {
      val base = if (same) it else Screen(playsLikeOn = it.playsLikeOn)
      // Scored on the phone: follow it, unless the member is mid-change here.
      val hole = if (!same || (it.draft == null && it.groupDrafts.isEmpty())) next.startHole else it.hole
      measured(base.copy(round = next, hole = hole, waiting = waiting, notice = if (next.finished) null else base.notice, alert = alert ?: base.alert))
    }
    if (alert != null) showAlert(alert)
    RoundService.follow(app, next)
    if (waiting > 0) flush()
  }

  /** Signed out or the round was deleted on the phone. */
  fun clear(context: Context) {
    init(context)
    Store.clearEverything(app)
    _screen.value = Screen(playsLikeOn = _screen.value.playsLikeOn)
    RoundService.follow(app, null)
    Glance.changed(app)
  }

  // MARK: The buttons

  fun step(delta: Int, click: Boolean = true) = setDraft(_screen.value.shown + delta, click)

  /** [click]: false for the crown, which ticks by itself. */
  fun setDraft(value: Int, click: Boolean = true) {
    val s = _screen.value
    val r = s.round ?: return
    if (r.finished) return
    val v = value.coerceIn(1, 15)
    if (v == s.shown) return
    _screen.value = s.copy(draft = v, saved = null)
    if (click) buzz(VibrationEffect.EFFECT_CLICK)
  }

  /** Save (the number shown) or Picked up, then on to the next hole with no score. */
  fun save(pickedUp: Boolean = false) {
    val s = _screen.value
    val r = s.round ?: return
    if (r.finished) return
    val h = s.hole
    val value: Int? = if (pickedUp) null else s.shown
    val next = r.withScore(h, value)
    Store.saveRound(app, next)
    Store.enqueue(app, Pending(next.roundId, h, value, clear = false, at = System.currentTimeMillis()))
    _screen.value = measured(
      s.copy(
        round = next,
        saved = "Hole $h · ${next.short(value, h)}",
        undoHole = h,
        draft = null,
        notice = null,
        hole = next.nextHole(after = h) ?: h,
        page = Pages.SCORE,
        groupDrafts = emptyMap(),
        waiting = waitingFor(next.roundId),
      )
    )
    buzz(VibrationEffect.EFFECT_HEAVY_CLICK)
    flush()
  }

  /** Back to the hole just saved, showing what was saved, to change it. */
  fun undo() {
    val back = _screen.value.undoHole ?: return
    goTo(back)
    _screen.update { it.copy(undoHole = null) }
  }

  /** Open a hole from the card to score or change it. */
  fun goTo(n: Int) {
    val s = _screen.value
    val r = s.round ?: return
    if (r.info(n) == null) return
    val had = r.score(n)
    _screen.value = measured(s.copy(hole = n, draft = had?.takeIf { it > 0 }, groupDrafts = emptyMap(), saved = null, page = Pages.SCORE))
  }

  fun setPage(page: Int) {
    _screen.update { it.copy(page = page) }
  }

  // MARK: Sending

  fun flush() {
    scope.launch {
      if (!sending.tryLock()) return@launch
      try {
        val r = _screen.value.round ?: return@launch
        if (r.finished) return@launch
        val outcome = Sender.flush(app, r)
        val waiting = waitingFor(r.roundId)
        if (waiting > 0) Sender.schedule(app)
        _screen.update {
          when (outcome) {
            Outcome.UNAUTHORIZED -> it.copy(waiting = waiting, notice = "Open PinPals on your phone to keep scoring here")
            Outcome.REJECTED -> it.copy(waiting = waiting, notice = "A score wasn't accepted. Check it in PinPals", saved = null)
            Outcome.FINISHED -> {
              val done = it.round?.takeIf { cur -> cur.roundId == r.roundId }?.copy(finished = true, summary = "This round has finished")
              if (done != null) Store.saveRound(app, done)
              it.copy(round = done ?: it.round, waiting = 0, notice = null)
            }
            Outcome.SENT, Outcome.RETRY -> it.copy(waiting = waiting, notice = null)
          }
        }
        if (outcome == Outcome.REJECTED) buzz(VibrationEffect.EFFECT_DOUBLE_CLICK)
      } finally {
        sending.unlock()
      }
    }
  }

  // MARK: The distance

  fun located(lat: Double, lng: Double) {
    fix = LatLng(lat, lng) to System.currentTimeMillis()
    _screen.update { before ->
      val after = measured(before)
      // Walking changes it every few seconds; a yard or two isn't worth a redraw.
      val b = before.distance
      val a = after.distance
      if (b != null && a != null && kotlin.math.abs(a - b) < 2 && before.distanceFrom == after.distanceFrom) before else after
    }
  }

  /** GPS is wanted while the app's open on a live round with mapped greens. */
  fun wantsLocation(): Boolean {
    val r = _screen.value.round ?: return false
    return !r.finished && r.spots.any { it.green != null }
  }

  private fun measured(s: Screen): Screen {
    val r = s.round ?: return s.copy(distance = null, distanceFrom = null, fix = null)
    val at = fix?.takeIf { System.currentTimeMillis() - it.second < FIX_LIFETIME_MS }?.first
    val (d, from) = Distance.measure(r, s.hole, at)
    val next = s.copy(distance = d, distanceFrom = from, fix = at)
    if (::app.isInitialized) Glance.update(app, next)
    return next
  }

  // MARK: Watch v2 — the group's scores

  fun selectGroupPlayer(id: Int) {
    _screen.update { it.copy(groupSelected = id) }
  }

  fun stepGroup(delta: Int, click: Boolean = true) {
    val s = _screen.value
    val p = s.groupSelectedPlayer() ?: return
    setGroupDraft(p.id, s.groupShown(p) + delta, click)
  }

  fun setGroupDraft(playerId: Int, value: Int, click: Boolean = true) {
    val s = _screen.value
    val r = s.round ?: return
    if (r.finished) return
    val p = r.group?.firstOrNull { it.id == playerId } ?: return
    val v = value.coerceIn(1, 15)
    if (v == s.groupShown(p)) return
    _screen.value = s.copy(groupDrafts = s.groupDrafts + (playerId to v), saved = null)
    if (click) buzz(VibrationEffect.EFFECT_CLICK)
  }

  /** Save all: every row as shown (net par for any not touched), then the next hole. */
  fun saveGroup() {
    val s = _screen.value
    val r = s.round ?: return
    if (r.finished) return
    val group = r.group ?: return
    val h = s.hole
    var mine: Int? = null
    val others = mutableListOf<GroupScore>()
    for (p in group) {
      val v = s.groupShown(p)
      if (p.me) mine = v else others.add(GroupScore(p.id, v))
    }
    var next = r
    if (others.isNotEmpty()) {
      next = next.withGroupScores(h, others)
      Store.enqueueGroup(app, GroupPending(r.roundId, h, others, System.currentTimeMillis()))
    }
    Store.saveRound(app, next)
    val own = mine
    if (own != null) {
      // Your own ball, the same way as ever.
      _screen.value = s.copy(round = next, draft = own, groupDrafts = emptyMap())
      save()
    } else {
      _screen.value = measured(
        s.copy(round = next, groupDrafts = emptyMap(), hole = next.nextHole(after = h) ?: h, saved = "Hole $h saved", waiting = waitingFor(r.roundId))
      )
      buzz(VibrationEffect.EFFECT_HEAVY_CLICK)
      flush()
    }
  }

  /** A birdie or better by someone else in the group since the last update. */
  private fun birdie(before: Round, after: Round): Alert? {
    val was = before.group ?: return null
    val now = after.group ?: return null
    for (p in now) {
      if (p.me) continue
      val old = was.firstOrNull { it.id == p.id }?.strokes ?: emptyMap()
      for ((n, s) in p.strokes) {
        if (s <= 0 || old[n] == s) continue
        val info = after.info(n) ?: continue
        if (s > info.par - 1) continue
        val word = when {
          s <= info.par - 3 -> "Albatross!"
          s == info.par - 2 -> "Eagle!"
          else -> "Birdie!"
        }
        return Alert(word, "${p.name} · hole $n")
      }
    }
    return null
  }

  private fun showAlert(a: Alert) {
    try {
      val vm = app.getSystemService(VibratorManager::class.java) ?: return
      vm.defaultVibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 120, 120, 120), -1))
    } catch (e: Exception) {
      // No vibration on this watch.
    }
    scope.launch {
      kotlinx.coroutines.delay(5_000)
      _screen.update { if (it.alert == a) it.copy(alert = null) else it }
    }
  }

  fun dismissAlert() {
    _screen.update { it.copy(alert = null) }
  }

  fun setPlaysLike(on: Boolean) {
    prefs().edit().putBoolean("playsLikeOn", on).apply()
    _screen.update { it.copy(playsLikeOn = on) }
  }

  // MARK: Watch v2 — the leaderboard

  private var boardAt = 0L

  /** At most once a minute unless [force]. */
  fun loadBoard(force: Boolean = false) {
    val r = _screen.value.round ?: return
    val url = r.extras?.board
    val token = r.token
    if (url == null || token == null) {
      _screen.update { it.copy(boardNote = "Update PinPals on your phone to see the leaderboard here") }
      return
    }
    if (!force && System.currentTimeMillis() - boardAt < 60_000) return
    boardAt = System.currentTimeMillis()
    scope.launch {
      val (code, body) = Sender.getJson(url, token)
      val board = body?.let { Board.parse(it) }
      _screen.update {
        when {
          board != null -> it.copy(board = board, boardNote = null)
          code == 401 -> it.copy(boardNote = "Open PinPals on your phone to see the leaderboard")
          it.board == null -> it.copy(boardNote = "No signal for the leaderboard just now")
          else -> it
        }
      }
    }
  }

  private fun buzz(effect: Int) {
    try {
      val vm = app.getSystemService(VibratorManager::class.java) ?: return
      vm.defaultVibrator.vibrate(VibrationEffect.createPredefined(effect))
    } catch (e: Exception) {
      // No vibration on this watch.
    }
  }
}
