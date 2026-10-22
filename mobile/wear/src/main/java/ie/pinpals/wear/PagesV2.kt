package ie.pinpals.wear

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.CompactChip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Text
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.Dash
import com.google.android.gms.maps.model.Gap
import com.google.maps.android.compose.Circle
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapType
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.max
import com.google.android.gms.maps.model.LatLng as MapLatLng

// Watch v2 (claude/watch-v2.md): the pages around scoring, left to right —
// distances, the hole map, hazards, (scoring), the leaderboard. Laid out for
// a round screen: the key number on the centre line, controls inside the
// safe ring. Mock-ups: the Design canvas "PinPals — watch v2".

private val Gold = Color(0xFFE8C46B)
private val Navy = Color(0xFF0C2038)
private val Muted = Color(0xFFB8C0CC)
private val Comp = Color(0xFFA83A2B)

@Composable
private fun HoleLine(n: Int, par: Int, si: Int? = null) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(22.dp).background(Gold, CircleShape), contentAlignment = Alignment.Center) {
      Text("$n", color = Navy, fontSize = 12.sp, fontWeight = FontWeight.Black)
    }
    Spacer(Modifier.width(5.dp))
    Text("Par $par", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
    si?.let {
      Spacer(Modifier.width(4.dp))
      Text("SI $it", fontSize = 11.sp, color = Muted)
    }
  }
}

@Composable
fun PremiumCard(what: String) {
  Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Text("PREMIUM", color = Gold, fontSize = 11.sp, fontWeight = FontWeight.Black)
    Text(what, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    Text("Part of PinPals Premium.", fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center)
  }
}

@Composable
private fun NotMapped() {
  Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Text("This hole isn't mapped yet", fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, color = Gold)
    Text("Distances appear on courses with mapped greens.", fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center)
  }
}

// MARK: - Distances

@Composable
fun DistancesPage(screen: Screen) {
  val r = screen.round ?: return
  val info = screen.holeInfo ?: return
  val y = Distance.greenYards(r, screen.hole, screen.fix)
  Column(
    Modifier.fillMaxSize().padding(top = 26.dp, bottom = 18.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.SpaceBetween,
  ) {
    HoleLine(info.n, info.par, info.si)
    if (y == null) {
      Text("This hole isn't mapped yet", fontSize = 12.sp, color = Muted)
    } else {
      Column(horizontalAlignment = Alignment.CenterHorizontally) {
        y.back?.let { Text("$it", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Muted, modifier = Modifier.semantics { contentDescription = "$it yards to the back" }) }
        Text(
          "${y.centre}",
          fontSize = 58.sp,
          fontWeight = FontWeight.Black,
          color = Gold,
          modifier = Modifier.semantics { contentDescription = "${y.centre} yards to the centre of the green" },
        )
        y.front?.let { Text("$it", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = Muted, modifier = Modifier.semantics { contentDescription = "$it yards to the front" }) }
      }
    }
    Footer(screen, r, y)
  }
}

@Composable
private fun Footer(screen: Screen, r: Round, y: Distance.GreenYards?) {
  val chip = Modifier.background(Color.White.copy(alpha = 0.12f), RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 3.dp)
  val wind = r.extras?.wind
  val origin = Distance.origin(r, screen.hole, screen.fix)?.first
  val green = r.spot(screen.hole)?.green
  when {
    r.competition -> Text("COMP · distance only", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.background(Comp, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 3.dp))
    y != null && r.playsLikeAllowed && screen.playsLikeOn && wind != null && origin != null && green != null -> {
      val bearing = Distance.bearing(origin, green)
      val head = WindMaths.headMph(wind, bearing)
      val mph = (wind.kmh / WindMaths.KMH_PER_MPH).toInt()
      Text("Plays ${WindMaths.playsLike(y.centre, head)} · ${WindMaths.along(wind, bearing)} $mph mph", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color.White, modifier = chip)
    }
    y?.fromTee == true -> Text("From the tee", fontSize = 11.sp, color = Muted)
    else -> Spacer(Modifier.height(1.dp))
  }
}

// MARK: - The hole map

@Composable
fun MapPage(screen: Screen, visible: Boolean) {
  val r = screen.round ?: return
  if (!r.mapAllowed) return PremiumCard("Satellite hole maps")
  if (!BuildConfig.MAPS_READY) return PremiumlessNote()
  val green = r.spot(screen.hole)?.green
  val origin = Distance.origin(r, screen.hole, screen.fix)?.first
  if (green == null || origin == null) return NotMapped()

  var target by remember(screen.hole) { mutableStateOf<LatLng?>(null) }
  var zoomExtra by remember(screen.hole) { mutableFloatStateOf(0f) }
  val aim = target ?: Distance.defaultAim(origin, green) ?: green
  val camera = rememberCameraPositionState()
  val widthPx = LocalConfiguration.current.screenWidthDp * 2f
  LaunchedEffect(screen.hole, zoomExtra, origin == green) {
    val length = max(80.0, Distance.metres(origin, green))
    val t = 0.5 + zoomExtra * 0.17
    val centre = MapLatLng(origin.lat + (green.lat - origin.lat) * t, origin.lng + (green.lng - origin.lng) * t)
    // Metres per pixel at zoom z: 156543·cos(lat)/2^z. Fit the hole's length into the screen, then the crown zooms in.
    val z = (ln(156543.03 * cos(Math.toRadians(origin.lat)) * widthPx / (length * 1.4)) / ln(2.0)).toFloat() + zoomExtra
    camera.position = CameraPosition.Builder().target(centre).zoom(z.coerceIn(13f, 20f)).bearing(Distance.bearing(origin, green).toFloat()).build()
  }
  val focus = remember { FocusRequester() }
  LaunchedEffect(visible) { if (visible) runCatching { focus.requestFocus() } }
  val turned = remember { mutableFloatStateOf(0f) }

  Box(
    Modifier
      .fillMaxSize()
      .onRotaryScrollEvent { e ->
        turned.floatValue += e.verticalScrollPixels
        if (abs(turned.floatValue) >= 48f) {
          zoomExtra = (zoomExtra + if (turned.floatValue > 0) 0.25f else -0.25f).coerceIn(0f, 2.5f)
          turned.floatValue = 0f
        }
        true
      }
      .focusRequester(focus)
      .focusable()
  ) {
    GoogleMap(
      modifier = Modifier.fillMaxSize(),
      cameraPositionState = camera,
      properties = MapProperties(mapType = MapType.SATELLITE),
      uiSettings = MapUiSettings(
        compassEnabled = false,
        mapToolbarEnabled = false,
        myLocationButtonEnabled = false,
        rotationGesturesEnabled = false,
        scrollGesturesEnabled = false,
        tiltGesturesEnabled = false,
        zoomControlsEnabled = false,
        zoomGesturesEnabled = false,
      ),
      onMapClick = { p -> target = LatLng(p.latitude, p.longitude) },
    ) {
      val o = MapLatLng(origin.lat, origin.lng)
      val a = MapLatLng(aim.lat, aim.lng)
      val g = MapLatLng(green.lat, green.lng)
      Polyline(points = listOf(o, a, g), color = Color.White, width = 4f, pattern = listOf(Dash(14f), Gap(10f)))
      Circle(center = o, radius = 4.0, fillColor = Color(0xFF4AA3FF), strokeColor = Color.White, strokeWidth = 3f)
      if (aim != green) Circle(center = a, radius = 9.0, fillColor = Color.Transparent, strokeColor = Color.White, strokeWidth = 4f)
      Circle(center = g, radius = 3.0, fillColor = Gold, strokeColor = Navy, strokeWidth = 2f)
    }
    val toAim = Distance.yards(Distance.metres(origin, aim))
    val aimToGreen = Distance.yards(Distance.metres(aim, green))
    Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 22.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      if (aim != green) {
        MapChip(toAim, "to target", Color.White)
        MapChip(aimToGreen, "to green", Gold)
      } else {
        MapChip(toAim, "to green", Gold)
      }
    }
    Row(Modifier.align(Alignment.TopCenter).padding(top = 20.dp).background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp)) {
      HoleLine(screen.hole, r.info(screen.hole)?.par ?: 4)
    }
  }
}

@Composable
private fun PremiumlessNote() {
  Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Text("Map coming soon", fontWeight = FontWeight.SemiBold, color = Gold, textAlign = TextAlign.Center)
    Text("Swipe for distances and hazards.", fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center)
  }
}

@Composable
private fun MapChip(yards: Int, label: String, color: Color) {
  Column(
    Modifier.background(Color.Black.copy(alpha = 0.62f), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 2.dp).semantics { contentDescription = "$yards yards $label" },
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text("$yards", fontSize = 18.sp, fontWeight = FontWeight.Black, color = color)
    Text(label, fontSize = 9.sp, color = Muted)
  }
}

// MARK: - Hazards

@Composable
fun HazardsPage(screen: Screen) {
  val r = screen.round ?: return
  val ahead = Distance.hazardsAhead(r, screen.hole, screen.fix)
  val list = rememberScalingLazyListState()
  ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
    item { Text("HAZARDS · ${screen.hole}", color = Gold, fontSize = 13.sp, fontWeight = FontWeight.Black) }
    if (ahead.isEmpty()) {
      item {
        Text(
          if (r.spot(screen.hole)?.green == null) "This hole isn't mapped yet." else "Nothing mapped between you and the green.",
          fontSize = 12.sp,
          color = Muted,
          textAlign = TextAlign.Center,
        )
      }
    }
    items(ahead) { (h, yards) ->
      Row(
        Modifier
          .fillMaxWidth()
          .background(Color.White.copy(alpha = 0.08f), RoundedCornerShape(14.dp))
          .padding(horizontal = 12.dp, vertical = 9.dp)
          .semantics { contentDescription = "${h.label}, $yards yards" },
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Box(Modifier.size(11.dp).background(hazardColour(h.kind), CircleShape))
        Spacer(Modifier.width(8.dp))
        Text(h.label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text("$yards", fontSize = 18.sp, fontWeight = FontWeight.Black)
      }
    }
  }
}

private fun hazardColour(kind: String): Color = when (kind) {
  "water" -> Color(0xFF4F8AB8)
  "trees" -> Color(0xFF3F804D)
  "green_bunker", "fairway_bunker" -> Color(0xFFD8CDA3)
  else -> Gold
}

// MARK: - The group's scores

@Composable
fun GroupPage(screen: Screen, visible: Boolean) {
  val r = screen.round ?: return
  val group = r.group ?: return
  val info = screen.holeInfo ?: return
  val focus = remember { FocusRequester() }
  val turned = remember { mutableFloatStateOf(0f) }
  LaunchedEffect(visible) { if (visible) runCatching { focus.requestFocus() } }
  val selected = screen.groupSelectedPlayer()

  Column(
    Modifier
      .fillMaxSize()
      .padding(horizontal = 30.dp, vertical = 20.dp)
      .onRotaryScrollEvent { e ->
        turned.floatValue += e.verticalScrollPixels
        if (abs(turned.floatValue) >= 48f) {
          RoundModel.stepGroup(if (turned.floatValue > 0) 1 else -1)
          turned.floatValue = 0f
        }
        true
      }
      .focusRequester(focus)
      .focusable(),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.SpaceBetween,
  ) {
    Text("Hole ${info.n} · Par ${info.par}", fontSize = 13.sp, fontWeight = FontWeight.Bold)
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
      group.take(4).forEach { p ->
        val isSel = selected?.id == p.id
        Row(
          Modifier
            .fillMaxWidth()
            .background(if (isSel) Gold.copy(alpha = 0.16f) else Color.White.copy(alpha = 0.08f), RoundedCornerShape(12.dp))
            .border(2.dp, if (isSel) Gold else Color.Transparent, RoundedCornerShape(12.dp))
            .clickable { RoundModel.selectGroupPlayer(p.id) }
            .padding(horizontal = 10.dp, vertical = 4.dp)
            .semantics { contentDescription = "${if (p.me) "You" else p.name}, ${screen.groupShown(p)}" },
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(if (p.me) "You" else p.name, fontSize = 14.sp, fontWeight = if (p.me) FontWeight.Bold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
          val shots = r.shots(p, info.n)
          if (shots > 0) Text("•".repeat(shots.coerceAtMost(3)), fontSize = 10.sp, color = Gold)
          Spacer(Modifier.width(4.dp))
          Text(
            "${screen.groupShown(p)}",
            fontSize = 19.sp,
            fontWeight = FontWeight.Black,
            color = if (screen.groupIsSuggestion(p)) Color.White.copy(alpha = 0.42f) else if (p.me) Gold else Color.White,
          )
        }
      }
    }
    CompactChip(
      onClick = { RoundModel.saveGroup() },
      label = { Text("Save all", fontWeight = FontWeight.Bold, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center) },
      colors = ChipDefaults.primaryChipColors(),
      modifier = Modifier.fillMaxWidth(0.6f),
    )
  }
}

// MARK: - The leaderboard

@Composable
fun BoardPage(screen: Screen, visible: Boolean) {
  LaunchedEffect(visible) {
    while (visible) {
      RoundModel.loadBoard()
      kotlinx.coroutines.delay(60_000)
    }
  }
  val b = screen.board
  val list = rememberScalingLazyListState()
  ScalingLazyColumn(state = list, modifier = Modifier.fillMaxSize()) {
    item {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(7.dp).background(Color(0xFF7FD18B), CircleShape))
        Spacer(Modifier.width(5.dp))
        Text(if (b?.final == true) "FINAL" else "LIVE", fontSize = 11.sp, fontWeight = FontWeight.Black, color = Color(0xFF7FD18B))
      }
    }
    when {
      b != null -> {
        item { Text(b.title, fontSize = 16.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 2) }
        if (b.teams.size == 2) {
          item {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
              b.teams.forEach { (name, pts) ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                  Text(name.uppercase(), fontSize = 10.sp, color = Muted, fontWeight = FontWeight.Black)
                  Text(pts, fontSize = 20.sp, color = Gold, fontWeight = FontWeight.Black)
                }
              }
            }
          }
        }
        if (b.rows.isNotEmpty()) {
          items(b.rows) { row ->
            Row(
              Modifier
                .fillMaxWidth()
                .background(if (row.mine) Color.White.copy(alpha = 0.14f) else Color.Transparent, RoundedCornerShape(10.dp))
                .padding(horizontal = 10.dp, vertical = 5.dp),
              verticalAlignment = Alignment.CenterVertically,
            ) {
              Text(row.pos, color = Gold, fontWeight = FontWeight.Black, fontSize = 14.sp, modifier = Modifier.width(28.dp))
              Text(if (row.mine) "You" else row.name, fontSize = 14.sp, fontWeight = if (row.mine) FontWeight.Bold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
              Text(row.thru, fontSize = 12.sp, color = Muted)
              Spacer(Modifier.width(6.dp))
              Text(row.score, fontSize = 15.sp, fontWeight = FontWeight.Black, color = if (row.mine) Gold else Color.White)
            }
          }
        } else if (b.big != null) {
          item {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
              Text(b.big, fontSize = 36.sp, fontWeight = FontWeight.Black, color = Gold)
              b.line1?.let { Text(it, fontSize = 12.sp) }
              b.line2?.let { Text(it, fontSize = 12.sp, color = Muted) }
            }
          }
        }
      }
      screen.boardNote != null -> item { Text(screen.boardNote, fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center) }
      else -> item { Text("Loading…", fontSize = 12.sp, color = Muted) }
    }
    item { Spacer(Modifier.height(12.dp)) }
  }
}

// MARK: - Birdie tap

@Composable
fun AlertOverlay(alert: Alert) {
  Column(
    Modifier
      .fillMaxSize()
      .background(Navy)
      .clickable { RoundModel.dismissAlert() }
      .semantics { contentDescription = "${alert.title} ${alert.line}. Tap to dismiss." },
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Box(Modifier.size(40.dp).background(Gold, CircleShape), contentAlignment = Alignment.Center) {
      Text("⚑", color = Navy, fontSize = 20.sp, fontWeight = FontWeight.Black)
    }
    Spacer(Modifier.height(6.dp))
    Text(alert.title, fontSize = 26.sp, fontWeight = FontWeight.Bold)
    Text(alert.line, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
  }
}
