package ie.pinpals.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import kotlin.math.abs

// PinPals for Wear OS (Oct 2026): the screens. Pages, swiped left and right
// (Pages in RoundModel.kt; watch v2, claude/watch-v2.md):
//   - distances, the hole map, hazards (PagesV2.kt);
//   - scoring: the group's scores, or on your own the hole page — the score
//     (− / +, or turn the crown or bezel), Save;
//   - the leaderboard (PagesV2.kt);
//   - the card: the total and standing, Undo, Picked up, and every hole to go
//     back and change one.

private val Gold = Color(0xFFE8C46B)
private val Navy = Color(0xFF0C2038)
private val Muted = Color(0xFFB8C0CC)

private val PinPalsColors = Colors(
  primary = Gold,
  primaryVariant = Gold,
  onPrimary = Navy,
  secondary = Gold,
  onSecondary = Navy,
  surface = Color(0xFF1B2A40),
  onSurface = Color.White,
  onSurfaceVariant = Muted,
)

@Composable
fun PinPalsWearApp() {
  MaterialTheme(colors = PinPalsColors) {
    val screen by RoundModel.screen.collectAsStateWithLifecycle()
    Scaffold(
      modifier = Modifier.background(Color.Black),
      timeText = { TimeText() },
    ) {
      val round = screen.round
      when {
        round == null -> Message(
          title = "PinPals",
          body = "Open a live round on your phone and score it here, with your distance to the green.",
        )
        round.finished -> Message(title = round.course, body = round.summary ?: round.total)
        else -> {
          RoundPages(screen)
          screen.alert?.let { AlertOverlay(it) }
        }
      }
    }
  }
}

@Composable
private fun RoundPages(screen: Screen) {
  val pager = rememberPagerState(initialPage = screen.page, pageCount = { Pages.COUNT })
  // The model moves the page (Save, a hole picked from the card)…
  LaunchedEffect(screen.page) {
    if (pager.currentPage != screen.page) pager.animateScrollToPage(screen.page)
  }
  // …and so does a swipe.
  LaunchedEffect(pager) {
    snapshotFlow { pager.settledPage }.collect { RoundModel.setPage(it) }
  }
  HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
    val visible = pager.currentPage == page
    when (page) {
      Pages.DISTANCES -> DistancesPage(screen)
      Pages.MAP -> MapPage(screen, visible)
      Pages.HAZARDS -> HazardsPage(screen)
      Pages.SCORE -> if (screen.round?.group != null) GroupPage(screen, visible) else HolePage(screen, visible)
      Pages.BOARD -> BoardPage(screen, visible)
      else -> CardPage(screen)
    }
  }
}

// MARK: - The hole

@Composable
private fun HolePage(screen: Screen, visible: Boolean) {
  val round = screen.round ?: return
  val info = screen.holeInfo ?: return
  val focus = remember { FocusRequester() }
  val turned = remember { mutableFloatStateOf(0f) }
  LaunchedEffect(visible) {
    if (visible) runCatching { focus.requestFocus() }
  }

  Column(
    modifier = Modifier
      .fillMaxSize()
      .padding(horizontal = 18.dp, vertical = 22.dp)
      // The crown or bezel: one notch-ish of turn per stroke.
      .onRotaryScrollEvent { event ->
        turned.floatValue += event.verticalScrollPixels
        if (abs(turned.floatValue) >= 48f) {
          RoundModel.step(if (turned.floatValue > 0) 1 else -1, click = true)
          turned.floatValue = 0f
        }
        true
      }
      .focusRequester(focus)
      .focusable(),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.SpaceBetween,
  ) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Column(modifier = Modifier.weight(1f)) {
        Text("HOLE ${info.n}", color = Gold, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(
            "Par ${info.par}" + (info.si?.let { " · SI $it" } ?: ""),
            color = Muted,
            fontSize = 11.sp,
          )
          repeat(info.shots.coerceIn(0, 3)) {
            Spacer(Modifier.width(3.dp))
            Box(Modifier.size(4.dp).background(Gold, CircleShape))
          }
        }
      }
      screen.distance?.let { yards ->
        Column(horizontalAlignment = Alignment.End) {
          Text("$yards", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
          Text(if (screen.distanceFrom == "tee") "yds from tee" else "yds to green", fontSize = 9.sp, color = Muted)
        }
      }
    }

    if (round.allIn && screen.draft == null) {
      Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(round.total, fontWeight = FontWeight.SemiBold, color = Gold)
        Text(
          "All in. Finish on your phone to get your card certified.",
          fontSize = 11.sp,
          color = Muted,
          textAlign = TextAlign.Center,
        )
      }
    } else {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Button(
          onClick = { RoundModel.step(-1) },
          colors = ButtonDefaults.secondaryButtonColors(),
          modifier = Modifier.size(ButtonDefaults.SmallButtonSize).semantics { contentDescription = "One less" },
        ) { Text("−", fontSize = 20.sp) }
        Text(
          "${screen.shown}",
          fontSize = 40.sp,
          fontWeight = FontWeight.Bold,
          color = if (screen.isSuggestion) Color.White.copy(alpha = 0.45f) else Color.White,
          textAlign = TextAlign.Center,
          modifier = Modifier.width(64.dp).semantics { contentDescription = "${screen.shown} strokes" },
        )
        Button(
          onClick = { RoundModel.step(1) },
          colors = ButtonDefaults.secondaryButtonColors(),
          modifier = Modifier.size(ButtonDefaults.SmallButtonSize).semantics { contentDescription = "One more" },
        ) { Text("+", fontSize = 20.sp) }
      }
      Text(round.describe(screen.shown, screen.hole), fontSize = 11.sp, color = Muted, maxLines = 1)
      CompactChip(
        onClick = { RoundModel.save() },
        label = { Text("Save", fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
        colors = ChipDefaults.primaryChipColors(),
        modifier = Modifier.fillMaxWidth(0.7f),
      )
    }

    Footer(screen, round)
  }
}

@Composable
private fun Footer(screen: Screen, round: Round) {
  val notice = screen.notice
  val saved = screen.saved
  when {
    notice != null -> Text(notice, fontSize = 10.sp, color = Color(0xFFFFA94D), textAlign = TextAlign.Center, maxLines = 2)
    saved != null -> Text(saved, fontSize = 10.sp, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
    screen.waiting > 0 -> Text("${screen.waiting} waiting for signal", fontSize = 10.sp, color = Muted)
    else -> Text(round.status ?: round.total, fontSize = 10.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

// MARK: - The card

@Composable
private fun CardPage(screen: Screen) {
  val round = screen.round ?: return
  val list = rememberScalingLazyListState()
  ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
    item {
      Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Text(round.course, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, maxLines = 2)
        Text(round.total, color = Gold, fontSize = 13.sp)
        round.status?.let { Text(it, color = Muted, fontSize = 11.sp) }
      }
    }
    screen.undoHole?.let { back ->
      item {
        Chip(
          onClick = { RoundModel.undo() },
          label = { Text("Change hole $back") },
          colors = ChipDefaults.secondaryChipColors(),
          modifier = Modifier.fillMaxWidth(),
        )
      }
    }
    if (!round.allIn || screen.draft != null) {
      item {
        Chip(
          onClick = { RoundModel.save(pickedUp = true) },
          label = { Text("Picked up on ${screen.hole}") },
          colors = ChipDefaults.secondaryChipColors(),
          modifier = Modifier.fillMaxWidth(),
        )
      }
    }
    if (round.extras?.wind != null && round.playsLikeAllowed) {
      item {
        Chip(
          onClick = { RoundModel.setPlaysLike(!screen.playsLikeOn) },
          label = { Text("Plays like") },
          secondaryLabel = { Text(if (screen.playsLikeOn) "On" else "Off") },
          colors = ChipDefaults.secondaryChipColors(),
          modifier = Modifier.fillMaxWidth(),
        )
      }
    }
    item { Text("CARD", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp)) }
    items(round.holes, key = { it.n }) { h ->
      val s = round.score(h.n)
      Chip(
        onClick = { RoundModel.goTo(h.n) },
        label = { Text("${h.n}   Par ${h.par}") },
        secondaryLabel = {
          Text(
            when {
              s == null -> "–"
              s > 0 -> round.short(s, h.n)
              else -> "Picked up"
            }
          )
        },
        colors = if (h.n == screen.hole) ChipDefaults.primaryChipColors() else ChipDefaults.secondaryChipColors(),
        modifier = Modifier.fillMaxWidth(),
      )
    }
    item { Spacer(Modifier.height(12.dp)) }
  }
}

// MARK: - No round, round finished

@Composable
private fun Message(title: String, body: String) {
  Column(
    modifier = Modifier.fillMaxSize().padding(horizontal = 22.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Text("⛳", fontSize = 22.sp)
    Text(title, fontWeight = FontWeight.SemiBold, color = Gold, textAlign = TextAlign.Center, maxLines = 2)
    Spacer(Modifier.height(4.dp))
    Text(body, fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center)
  }
}
