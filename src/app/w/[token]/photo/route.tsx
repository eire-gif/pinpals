import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { handicapChange, monthName } from "@/lib/wrapped";
import { verifyWrappedToken } from "@/lib/wrapped-links";
import { loadWrappedFor } from "@/lib/wrapped-server";

/**
 * GET /w/<token>/photo   → a member's year in golf as a picture (PNG, 1080×1920)
 *
 * PinPals Wrapped (claude/wrapped.md): sized for an Instagram or WhatsApp
 * story. The app saves it to Photos or hands it to Instagram. Drawn from
 * the same numbers as the app's story cards (lib/wrapped.ts).
 *
 * The signed token (wrapped-links.ts) says whose year it is; anything else
 * is a 404. ?download=1 makes it a download (Android).
 */

const W = 1080;
const H = 1920;
const PAD = 72;

const asset = (...p: string[]) => join(process.cwd(), "assets", ...p);
const [playfair, sans, sansSemi, photo] = await Promise.all([
  readFile(asset("fonts", "PlayfairDisplay_700Bold.ttf")),
  readFile(asset("fonts", "PublicSans_400Regular.ttf")),
  readFile(asset("fonts", "PublicSans_600SemiBold.ttf")),
  readFile(asset("share", "course-1.jpg"), "base64"),
]);

const CREAM = "#f7f3ea";
const GOLD = "#e8c46b";
const NAVY_RGB = "12,32,56";
const GREEN = "#1f5c2e";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = verifyWrappedToken(token);
  const data = payload ? await loadWrappedFor(payload.m, payload.y) : null;
  if (!data) return new Response("This picture isn't available.", { status: 404, headers: { "cache-control": "no-store" } });
  const { wrapped: w, firstName } = data;

  const tiles: { k: string; v: string; d: string }[] = [
    { k: "ROUNDS", v: String(w.rounds), d: `about ${w.km} km walked` },
    w.best ? { k: "BEST ROUND", v: String(w.best.points), d: `pts · ${w.best.courseName}` } : { k: "COURSES", v: String(w.courses), d: "played this year" },
    { k: "BIRDIES", v: String(w.birdies), d: w.eagles ? `plus ${w.eagles} eagle${w.eagles === 1 ? "" : "s"}` : `${w.pars} pars` },
    { k: "NEW COURSES", v: String(w.newCourses), d: w.newestCourse ? `${w.newestCourse} the latest` : "old favourites" },
  ];
  const max = Math.max(1, ...w.byMonth);

  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = { "cache-control": "private, max-age=300", "x-robots-tag": "noindex" };
  if (download) headers["content-disposition"] = `attachment; filename="pinpals-wrapped-${w.year}.png"`;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", position: "relative", fontFamily: "Public Sans", color: CREAM, background: `rgb(${NAVY_RGB})` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page */}
        <img src={`data:image/jpeg;base64,${photo}`} width={W} height={H} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} alt="" />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: W,
            height: H,
            display: "flex",
            backgroundImage: `linear-gradient(180deg, rgba(${NAVY_RGB},0.55) 0%, rgba(${NAVY_RGB},0.85) 32%, rgba(${NAVY_RGB},0.97) 60%)`,
          }}
        />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: `${PAD}px`, width: W, height: H }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontFamily: "Playfair", fontSize: 48, lineHeight: 1 }}>PinPals</div>
              <div style={{ width: 60, height: 5, background: GOLD, marginTop: 12, borderRadius: 3 }} />
            </div>
            <div style={{ display: "flex", fontWeight: 600, fontSize: 22, letterSpacing: 4, color: GOLD, border: `2px solid ${GOLD}`, borderRadius: 999, padding: "10px 22px" }}>WRAPPED</div>
          </div>

          <div style={{ display: "flex", fontWeight: 600, fontSize: 30, letterSpacing: 5, color: GOLD, marginTop: 140 }}>
            {firstName ? `${firstName.toUpperCase()}'S` : "MY"}
          </div>
          <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 120, lineHeight: 1, marginTop: 12 }}>{`${w.year} in golf`}</div>
          <div style={{ display: "flex", fontWeight: 600, fontSize: 40, marginTop: 30, color: GOLD }}>{w.persona.title}</div>
          <div style={{ display: "flex", fontSize: 32, marginTop: 10, color: "rgba(247,243,234,0.85)" }}>{w.persona.line}</div>

          {w.handicap ? (
            <div style={{ display: "flex", alignItems: "center", marginTop: 56, padding: "28px 34px", borderRadius: 28, border: `2px solid ${GOLD}`, background: `rgba(${NAVY_RGB},0.8)` }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", fontWeight: 600, fontSize: 22, letterSpacing: 3, color: GOLD }}>HANDICAP INDEX</div>
                <div style={{ display: "flex", alignItems: "flex-end", marginTop: 8 }}>
                  <div style={{ display: "flex", fontSize: 40, color: "#9aa6ba", textDecoration: "line-through" }}>{w.handicap.from.toFixed(1)}</div>
                  <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 84, lineHeight: 1, marginLeft: 20 }}>{w.handicap.to.toFixed(1)}</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginLeft: "auto", background: GREEN, borderRadius: 22, padding: "18px 26px" }}>
                <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 54 }}>{handicapChange(w.handicap)}</div>
                <div style={{ display: "flex", fontWeight: 600, fontSize: 18, letterSpacing: 2, color: "#cfe0d4" }}>THIS YEAR</div>
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", marginTop: 32, gap: 24 }}>
            {tiles.map((t) => (
              <div key={t.k} style={{ display: "flex", flexDirection: "column", width: (W - PAD * 2 - 24) / 2, padding: "26px 28px", borderRadius: 26, background: "rgba(0,0,0,0.28)", border: "2px solid rgba(232,196,107,0.45)" }}>
                <div style={{ display: "flex", fontWeight: 600, fontSize: 20, letterSpacing: 3, color: GOLD }}>{t.k}</div>
                <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 86, lineHeight: 1.05, marginTop: 6 }}>{t.v}</div>
                <div style={{ display: "flex", fontSize: 24, color: "rgba(247,243,234,0.8)" }}>{t.d.length > 30 ? `${t.d.slice(0, 29)}…` : t.d}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 32, padding: "26px 28px", borderRadius: 26, background: "rgba(0,0,0,0.28)", border: "2px solid rgba(232,196,107,0.45)" }}>
            <div style={{ display: "flex", fontWeight: 600, fontSize: 20, letterSpacing: 3, color: GOLD }}>
              {w.busiestMonth != null ? `ROUNDS BY MONTH · BUSIEST ${monthName(w.busiestMonth).toUpperCase()}` : "ROUNDS BY MONTH"}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", height: 150, marginTop: 18, gap: 12 }}>
              {w.byMonth.map((n, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", flex: 1, height: 150 }}>
                  <div style={{ display: "flex", width: "100%", height: Math.max(n ? 12 : 4, Math.round((n / max) * 120)), background: GOLD, opacity: n ? 1 : 0.3, borderRadius: 6 }} />
                  <div style={{ display: "flex", fontWeight: 600, fontSize: 18, marginTop: 8, color: "#cfe0d4" }}>{"JFMAMJJASOND"[i]}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", alignItems: "center", fontSize: 26, color: "rgba(247,243,234,0.8)" }}>
            <div style={{ display: "flex" }}>{w.partner ? `Partner of the year: ${w.partner.name}` : w.topCourse ? `Home from home: ${w.topCourse.name}` : ""}</div>
            <div style={{ display: "flex", fontWeight: 600, color: GOLD }}>pinpals.ie</div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers,
      fonts: [
        { name: "Playfair", data: playfair, weight: 700, style: "normal" },
        { name: "Public Sans", data: sans, weight: 400, style: "normal" },
        { name: "Public Sans", data: sansSemi, weight: 600, style: "normal" },
      ],
    },
  );
}
