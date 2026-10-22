package ie.pinpals.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

// Watch v2 (claude/watch-v2.md): the PinPals Tile, one swipe from the watch
// face. During a live round: the hole, the yards to the centre, how you
// stand, and "Score hole", which opens the app. Otherwise a line saying how to
// get a round on the watch. Reads Glance (the model keeps it current).

class PinPalsTileService : TileService() {
  private val gold = 0xFFE8C46B.toInt()
  private val muted = 0xFFB8C0CC.toInt()
  private val white = 0xFFFFFFFF.toInt()
  private val navy = 0xFF0C2038.toInt()

  override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
    val g = Glance.read(this)
    val layout = if (g.live) live(g) else idle()
    val tile = TileBuilders.Tile.Builder()
      .setResourcesVersion(RESOURCES)
      // The model asks for a fresh one as things change; this is the fallback.
      .setFreshnessIntervalMillis(if (g.live) 10 * 60 * 1000L else 0L)
      .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout))
      .build()
    return Futures.immediateFuture(tile)
  }

  override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
    Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion(RESOURCES).build())

  private fun text(value: String, size: Float, color: Int, bold: Boolean = false): LayoutElementBuilders.Text =
    LayoutElementBuilders.Text.Builder()
      .setText(value)
      .setMaxLines(1)
      .setFontStyle(
        LayoutElementBuilders.FontStyle.Builder()
          .setSize(sp(size))
          .setColor(argb(color))
          .setWeight(if (bold) LayoutElementBuilders.FONT_WEIGHT_BOLD else LayoutElementBuilders.FONT_WEIGHT_NORMAL)
          .build()
      )
      .build()

  private fun gap(height: Float) = LayoutElementBuilders.Spacer.Builder().setHeight(dp(height)).build()

  private val openApp: ModifiersBuilders.Clickable
    get() = ModifiersBuilders.Clickable.Builder()
      .setId("open")
      .setOnClick(
        ActionBuilders.LaunchAction.Builder()
          .setAndroidActivity(
            ActionBuilders.AndroidActivity.Builder()
              .setPackageName(packageName)
              .setClassName(MainActivity::class.java.name)
              .build()
          )
          .build()
      )
      .build()

  private fun frame(content: LayoutElementBuilders.LayoutElement): LayoutElementBuilders.LayoutElement =
    LayoutElementBuilders.Box.Builder()
      .setWidth(expand())
      .setHeight(expand())
      .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(openApp).build())
      .addContent(content)
      .build()

  private fun live(g: GlanceData): LayoutElementBuilders.LayoutElement {
    val button = LayoutElementBuilders.Box.Builder()
      .setWidth(dp(112f))
      .setHeight(dp(40f))
      .setModifiers(
        ModifiersBuilders.Modifiers.Builder()
          .setBackground(ModifiersBuilders.Background.Builder().setColor(argb(gold)).setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(20f)).build()).build())
          .setClickable(openApp)
          .build()
      )
      .addContent(text("Score hole", 15f, navy, bold = true))
      .build()
    val column = LayoutElementBuilders.Column.Builder()
      .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
      .addContent(text("PINPALS", 11f, gold, bold = true))
      .addContent(gap(2f))
      .addContent(text("Hole ${g.hole} · Par ${g.par}", 15f, white, bold = true))
      .addContent(gap(2f))
      .addContent(text(g.yards?.toString() ?: "–", 48f, gold, bold = true))
      .addContent(text(if (g.yards != null) "yds to centre" else "not mapped", 12f, muted))
      .addContent(gap(4f))
      .addContent(text(g.line, 13f, white))
      .addContent(gap(8f))
      .addContent(button)
      .build()
    return frame(column)
  }

  private fun idle(): LayoutElementBuilders.LayoutElement {
    val column = LayoutElementBuilders.Column.Builder()
      .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
      .addContent(text("PINPALS", 12f, gold, bold = true))
      .addContent(gap(6f))
      .addContent(text("No live round", 15f, white, bold = true))
      .addContent(gap(4f))
      .addContent(text("Open one on your phone", 12f, muted))
      .build()
    return frame(column)
  }

  private companion object {
    const val RESOURCES = "1"
  }
}
