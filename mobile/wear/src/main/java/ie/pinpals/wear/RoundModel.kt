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
  /** 0 the hole, 1 the card. */
  val page: Int = 0,
) {
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

  fun init(context: Context) {
    if (::app.isInitialized) return
    app = context.applicationContext
    val round = Store.loadRound(app)
    _screen.value = Screen(
      round = round,
      hole = round?.startHole ?: 1,
      waiting = Store.pending(app, round?.roundId).size,
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
    Store.saveRound(app, next)
    if (next.finished) Store.drop(app, next.roundId)
    val waiting = Store.pending(app, next.roundId).size
    _screen.update {
      val base = if (same) it else Screen()
      // Scored on the phone: follow it, unless the member is mid-change here.
      val hole = if (!same || it.draft == null) next.startHole else it.hole
      measured(base.copy(round = next, hole = hole, waiting = waiting, notice = if (next.finished) null else base.notice))
    }
    if (waiting > 0) flush()
  }

  /** Signed out or the round was deleted on the phone. */
  fun clear(context: Context) {
    init(context)
    Store.clearEverything(app)
    _screen.value = Screen()
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
        page = 0,
        waiting = Store.pending(app, next.roundId).size,
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
    _screen.value = measured(s.copy(hole = n, draft = had?.takeIf { it > 0 }, saved = null, page = 0))
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
        val waiting = Store.pending(app, r.roundId).size
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
    val r = s.round ?: return s.copy(distance = null, distanceFrom = null)
    val at = fix?.takeIf { System.currentTimeMillis() - it.second < FIX_LIFETIME_MS }?.first
    val (d, from) = Distance.measure(r, s.hole, at)
    return s.copy(distance = d, distanceFrom = from)
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
