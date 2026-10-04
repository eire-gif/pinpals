import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { SHARE_PHOTOS, type ShareCard } from "@/lib/share-card";
import { loadShareCard } from "@/lib/share-card-server";

/**
 * The share card: what WhatsApp, Messages, LinkedIn and the rest show when a
 * PinPals share link is pasted (phase 6), and what the app previews before
 * sharing. 1200×630, the size every link preview expects.
 *
 * A course photograph under a navy gradient, the site's own two faces, the
 * score set large, and up to four stat tiles. What it says comes from
 * buildShareCard() — details only when the author shared their own post.
 *
 * Satori draws a subset of CSS: flexbox only, every element with more than
 * one child needs display:flex, no grid. Fonts and photos are read once per
 * server instance from /assets (see assets/README.md).
 */

export const alt = "A post shared from PinPals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const asset = (...p: string[]) => join(process.cwd(), "assets", ...p);
const [playfair, sans, sansSemi, ...photos] = await Promise.all([
  readFile(asset("fonts", "PlayfairDisplay_700Bold.ttf")),
  readFile(asset("fonts", "PublicSans_400Regular.ttf")),
  readFile(asset("fonts", "PublicSans_600SemiBold.ttf")),
  ...Array.from({ length: SHARE_PHOTOS }, (_, i) => readFile(asset("share", `course-${i + 1}.jpg`), "base64")),
]);
const photoSrc = (i: number) => `data:image/jpeg;base64,${photos[i % photos.length]}`;

const CREAM = "#f7f3ea";
const GOLD = "#e8c46b";
const NAVY = "12,32,56";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { card } = await loadShareCard(token);

  return new ImageResponse(<Card card={card} />, {
    ...size,
    fonts: [
      { name: "Playfair", data: playfair, weight: 700, style: "normal" },
      { name: "Public Sans", data: sans, weight: 400, style: "normal" },
      { name: "Public Sans", data: sansSemi, weight: 600, style: "normal" },
    ],
    headers: {
      // A card can change (a post hidden, deleted, its course renamed); an
      // hour keeps previews cheap without pinning a stale one for a day.
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

function Card({ card }: { card: ShareCard }) {
  return (
    <div style={{ width: 1200, height: 630, display: "flex", position: "relative", fontFamily: "Public Sans", color: CREAM }}>
      <img src={photoSrc(card.photo)} width={1200} height={630} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} alt="" />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1200,
          height: 630,
          display: "flex",
          backgroundImage: `linear-gradient(90deg, rgba(${NAVY},0.94) 0%, rgba(${NAVY},0.82) 42%, rgba(${NAVY},0.25) 78%, rgba(${NAVY},0.05) 100%)`,
        }}
      />

      <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: "52px 64px", width: 1200, height: 630 }}>
        {/* Wordmark and what kind of post */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: 1072 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontFamily: "Playfair", fontSize: 40, lineHeight: 1 }}>PinPals</div>
            <div style={{ width: 56, height: 4, background: GOLD, marginTop: 10, borderRadius: 2 }} />
          </div>
          <div
            style={{
              display: "flex",
              fontWeight: 600,
              fontSize: 18,
              letterSpacing: 3,
              color: GOLD,
              border: `1.5px solid ${GOLD}`,
              borderRadius: 999,
              padding: "8px 18px",
              // Sits over the bright side of the photo (sky, sunset): give
              // it its own navy so the label reads on any picture.
              background: `rgba(${NAVY},0.72)`,
            }}
          >
            {card.kicker}
          </div>
        </div>

        {/* Course and who */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: card.hero ? 34 : 120, maxWidth: 720 }}>
          <div style={{ fontFamily: "Playfair", fontSize: card.title.length > 26 ? 50 : 60, lineHeight: 1.08 }}>{card.title}</div>
          {card.subtitle ? (
            <div style={{ fontSize: 26, marginTop: 12, color: "rgba(247,243,234,0.82)" }}>{card.subtitle}</div>
          ) : null}
        </div>

        {/* The number */}
        {card.hero ? (
          <div style={{ display: "flex", alignItems: "flex-end", marginTop: 14 }}>
            <div style={{ fontFamily: "Playfair", fontSize: card.hero.big.length > 6 ? 104 : 150, lineHeight: 1 }}>{card.hero.big}</div>
            {card.hero.small ? (
              <div style={{ fontFamily: "Playfair", fontSize: 52, color: GOLD, marginLeft: 20, marginBottom: 16 }}>{card.hero.small}</div>
            ) : null}
          </div>
        ) : null}

        {/* Stat tiles, pinned to the bottom */}
        <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between", width: 1072 }}>
          <div style={{ display: "flex", gap: 14 }}>
            {card.stats.map((s) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  padding: "14px 22px",
                  minWidth: 132,
                  borderRadius: 16,
                  background: "rgba(247,243,234,0.12)",
                  border: "1px solid rgba(247,243,234,0.28)",
                }}
              >
                <div style={{ fontFamily: "Playfair", fontSize: 40, lineHeight: 1.05 }}>{s.value}</div>
                <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: 2, color: GOLD, marginTop: 6 }}>{s.label.toUpperCase()}</div>
              </div>
            ))}
            {!card.rich ? (
              <div
                style={{
                  display: "flex",
                  fontWeight: 600,
                  fontSize: 24,
                  background: "#1f5c2e",
                  color: CREAM,
                  borderRadius: 999,
                  padding: "14px 30px",
                }}
              >
                Join free at pinpals.ie
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: "rgba(247,243,234,0.75)" }}>pinpals.ie</div>
        </div>
      </div>
    </div>
  );
}
