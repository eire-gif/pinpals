import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { loadPublishedResults, type PublishedResults } from "@/lib/competition-results-server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The results card (0137) — mock-up "Share image": what WhatsApp, Messages
 * and the rest show when an organiser or member shares the results link.
 * 1200×630, the size every link preview expects. Each division's top
 * three (up to three divisions), the side prizes, and the countback rule.
 *
 * Satori: flexbox only, every element with more than one child needs
 * display:flex. Fonts read once per server instance from /assets.
 */

export const alt = "Competition results on PinPals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const asset = (...p: string[]) => join(process.cwd(), "assets", ...p);
const [playfair, sans, sansSemi] = await Promise.all([
  readFile(asset("fonts", "PlayfairDisplay_700Bold.ttf")),
  readFile(asset("fonts", "PublicSans_400Regular.ttf")),
  readFile(asset("fonts", "PublicSans_600SemiBold.ttf")),
]);

const CREAM = "#f7f3ea";
const GOLD = "#e8c46b";
const NAVY = "#0c2038";
const MEDAL = [GOLD, "#d7dde5", "#d9a77c"];

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadPublishedResults(createAdminClient(), token);
  return new ImageResponse(data ? <Card data={data} /> : <Missing />, {
    ...size,
    fonts: [
      { name: "Playfair", data: playfair, weight: 700, style: "normal" },
      { name: "Public Sans", data: sans, weight: 400, style: "normal" },
      { name: "Public Sans", data: sansSemi, weight: 600, style: "normal" },
    ],
    headers: { "cache-control": "public, max-age=600, s-maxage=600" },
  });
}

function dateLine(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" });
}

function Card({ data }: { data: PublishedResults }) {
  const r = data.results;
  const divisions = r.prizes.filter((p) => r.divisions.some((d) => d.label === p.label)).slice(0, 3);
  const sides = r.prizes.filter((p) => !r.divisions.some((d) => d.label === p.label) && p.winners.length > 0).slice(0, 4);
  const format = r.team ? (r.basis === "stableford" ? "Stableford" : "Stroke play") : r.basis === "stableford" ? "Stableford" : "Stroke play (net)";
  return (
    <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", background: NAVY, color: CREAM, fontFamily: "Public Sans", padding: "48px 60px 36px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: 3, color: GOLD }}>{`RESULTS${data.version > 1 ? " · UPDATED" : ""}${(r.amendments?.length ?? 0) > 0 ? " · AMENDED" : ""}`}</div>
          <div style={{ fontFamily: "Playfair", fontSize: data.title.length > 26 ? 50 : 62, lineHeight: 1.05, marginTop: 8 }}>{data.title}</div>
          <div style={{ fontSize: 24, marginTop: 8, color: "rgba(247,243,234,0.82)" }}>{`${data.courseName} · ${dateLine(data.playedOn)} · ${format}`}</div>
        </div>
        <div style={{ fontFamily: "Playfair", fontSize: 36 }}>PinPals</div>
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: 34 }}>
        {divisions.map((p) => (
          <div
            key={p.label}
            style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: "20px 24px", borderRadius: 20, border: "1.5px solid rgba(232,196,107,0.45)", background: "rgba(247,243,234,0.06)" }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: 2, color: GOLD }}>{p.label.toUpperCase()}</div>
            {p.winners.slice(0, 3).map((w, i) => (
              <div key={`${w.name}${i}`} style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                <div style={{ fontFamily: "Playfair", fontSize: 34, color: MEDAL[i] ?? CREAM, width: 26 }}>{String(i + 1)}</div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 26, fontWeight: 600 }}>{w.name}</div>
                  <div style={{ fontSize: 18, color: "rgba(247,243,234,0.78)" }}>{`${w.score}${w.note?.startsWith("Won on countback") ? " · countback" : ""}`}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", marginTop: "auto", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12 }}>
          {sides.map((p) => (
            <div key={p.label} style={{ display: "flex", fontSize: 18, background: CREAM, color: NAVY, borderRadius: 999, padding: "8px 16px" }}>
              {`${p.label}: ${p.winners[0].name}`}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 16, color: "rgba(247,243,234,0.7)" }}>Ties: R&A countback</div>
      </div>
    </div>
  );
}

function Missing() {
  return (
    <div style={{ width: 1200, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: NAVY, color: CREAM, fontFamily: "Playfair", fontSize: 60 }}>
      PinPals results
    </div>
  );
}
