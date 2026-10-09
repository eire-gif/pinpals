import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { SHARE_PHOTOS } from "@/lib/share-card";
import { playedLabel, scorecardTotals, vsParText } from "@/lib/scorecard-math";
import { loadSharedScorecard } from "@/lib/scorecard-share-server";

/**
 * The preview a scorecard link unfurls into in WhatsApp and Messages
 * (0110): the same look as a post's share card (s/[token]/opengraph-image),
 * with the score large and the two nines underneath.
 */

export const alt = "A scorecard shared from PinPals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const asset = (...p: string[]) => join(process.cwd(), "assets", ...p);
const [playfair, sans, sansSemi, ...photos] = await Promise.all([
  readFile(asset("fonts", "PlayfairDisplay_700Bold.ttf")),
  readFile(asset("fonts", "PublicSans_400Regular.ttf")),
  readFile(asset("fonts", "PublicSans_600SemiBold.ttf")),
  ...Array.from({ length: SHARE_PHOTOS }, (_, i) => readFile(asset("share", `course-${i + 1}.jpg`), "base64")),
]);

const CREAM = "#f7f3ea";
const GOLD = "#e8c46b";
const NAVY = "12,32,56";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await loadSharedScorecard(token);
  const t = card ? scorecardTotals(card.holeList, card.playingHandicap) : null;
  const photo = `data:image/jpeg;base64,${photos[(card?.id ?? 0) % photos.length]}`;

  const big = t ? (t.complete && t.total.strokes != null ? String(t.total.strokes) : `${vsParText(t.vsPar)}`) : "";
  const small = t ? (t.complete ? vsParText(t.vsPar) : `thru ${t.played}`) : "";
  const tiles: { label: string; value: string }[] = t
    ? [
        { label: card!.holes === 9 ? "NINE" : "OUT", value: t.out.strokes != null ? String(t.out.strokes) : "–" },
        ...(t.in ? [{ label: "IN", value: t.in.strokes != null ? String(t.in.strokes) : "–" }] : []),
        ...(t.points != null ? [{ label: "POINTS", value: String(t.points) }] : []),
        { label: "BIRDIES", value: String(t.counts.birdie + t.counts.eagle + t.counts.albatross) },
      ]
    : [];

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", position: "relative", fontFamily: "Public Sans", color: CREAM }}>
        <img src={photo} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} alt="" />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            backgroundImage: `linear-gradient(90deg, rgba(${NAVY},0.95) 0%, rgba(${NAVY},0.85) 48%, rgba(${NAVY},0.3) 85%, rgba(${NAVY},0.1) 100%)`,
          }}
        />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 64px", width: 1200, height: 630 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: 1072 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontFamily: "Playfair", fontSize: 40, lineHeight: 1 }}>PinPals</div>
              <div style={{ width: 56, height: 4, background: GOLD, marginTop: 10, borderRadius: 2 }} />
            </div>
            <div style={{ display: "flex", fontWeight: 600, fontSize: 18, letterSpacing: 3, color: GOLD, border: `1.5px solid ${GOLD}`, borderRadius: 999, padding: "8px 18px", background: `rgba(${NAVY},0.72)` }}>
              SCORECARD
            </div>
          </div>
          {card && t ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", marginTop: 30, maxWidth: 760 }}>
                <div style={{ fontFamily: "Playfair", fontSize: card.courseName.length > 26 ? 48 : 58, lineHeight: 1.08 }}>{card.courseName}</div>
                <div style={{ fontSize: 26, marginTop: 10, color: "rgba(247,243,234,0.82)" }}>
                  {[card.firstName, playedLabel(card.playedOn), card.teeName ? `${card.teeName} tees` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", marginTop: 10 }}>
                <div style={{ fontFamily: "Playfair", fontSize: 150, lineHeight: 1 }}>{big}</div>
                <div style={{ fontFamily: "Playfair", fontSize: 52, color: GOLD, marginLeft: 20, marginBottom: 16 }}>{small}</div>
              </div>
              <div style={{ display: "flex", marginTop: "auto", gap: 14 }}>
                {tiles.map((x) => (
                  <div key={x.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 22px", borderRadius: 16, background: "rgba(247,243,234,0.1)", minWidth: 130 }}>
                    <div style={{ fontFamily: "Playfair", fontSize: 40 }}>{x.value}</div>
                    <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: 2, color: GOLD }}>{x.label}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 60, marginTop: 160 }}>A scorecard on PinPals</div>
          )}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Playfair", data: playfair, weight: 700, style: "normal" },
        { name: "Public Sans", data: sans, weight: 400, style: "normal" },
        { name: "Public Sans", data: sansSemi, weight: 600, style: "normal" },
      ],
      headers: { "cache-control": "public, max-age=600, s-maxage=600" },
    }
  );
}
