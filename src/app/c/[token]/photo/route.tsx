import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

import { SHARE_PHOTOS } from "@/lib/share-card";
import { holeResult, playedLabel, scorecardTotals, shotsOnCard, vsParText, type NineTotals, type ScorecardHole } from "@/lib/scorecard-math";
import { scorecardPhotoFilename } from "@/lib/scorecard-links";
import { loadSharedScorecard } from "@/lib/scorecard-share-server";

/**
 * GET /c/<token>/photo   → the whole scorecard as a picture (PNG, 1080×1350)
 *
 * "Save as photo" on a scorecard (Oct 2026). The app saves this to the
 * phone's Photos, or hands it to Instagram / WhatsApp as an image; the public
 * card page links to it too. Portrait 4:5, the size Instagram and a phone
 * screen both show without cropping.
 *
 * Drawn like the card in the app: a course photograph across the top with
 * the course, date and score; then Out and In hole by hole — par, and the
 * score ringed for a birdie (twice for an eagle), boxed for a bogey (twice
 * for a double or worse), a dot for each shot received; then the counts and
 * who certified it.
 *
 * Same rules as the card page (scorecard-share-server.ts): the signed token,
 * and only while the card exists and the sharer owns it. Anything else is a
 * 404. ?download=1 makes it a download for the website button.
 */

const W = 1080;
const H = 1350;
const PAD = 48;
const INNER = W - PAD * 2;

const asset = (...p: string[]) => join(process.cwd(), "assets", ...p);
const [playfair, sans, sansSemi, ...photos] = await Promise.all([
  readFile(asset("fonts", "PlayfairDisplay_700Bold.ttf")),
  readFile(asset("fonts", "PublicSans_400Regular.ttf")),
  readFile(asset("fonts", "PublicSans_600SemiBold.ttf")),
  ...Array.from({ length: SHARE_PHOTOS }, (_, i) => readFile(asset("share", `course-${i + 1}.jpg`), "base64")),
]);

const CREAM = "#f7f3ea";
const CREAM_100 = "#efe8d8";
const GOLD = "#e8c46b";
const NAVY = "#0c2038";
const NAVY_RGB = "12,32,56";
const GREEN = "#1f6b45";
const RED = "#c0392b";
const INK = "#1d2430";
const INK_500 = "#6b7280";
const LINE = "#e3dccb";

const CERTIFY_METHOD: Record<string, string> = { face_id: "Face ID", touch_id: "Touch ID", biometric: "fingerprint", in_app: "in the app" };

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const card = await loadSharedScorecard(token);
  if (!card) return new Response("This scorecard isn't available.", { status: 404, headers: { "cache-control": "no-store" } });

  const t = scorecardTotals(card.holeList, card.playingHandicap);
  const shots = shotsOnCard(card.holeList, card.playingHandicap);
  const front = card.holeList.filter((h) => h.hole <= 9);
  const back = card.holeList.filter((h) => h.hole > 9);
  const photo = `data:image/jpeg;base64,${photos[card.id % photos.length]}`;
  const nineOnly = back.length === 0;

  const big = t.complete && t.total.strokes != null ? String(t.total.strokes) : t.played > 0 ? vsParText(t.vsPar) : "–";
  const small = t.complete ? vsParText(t.vsPar) : t.played > 0 ? `thru ${t.played}` : "";
  const tiles: { label: string; value: string }[] = [
    ...(t.points != null ? [{ label: "POINTS", value: String(t.points) }] : []),
    ...(t.net != null ? [{ label: "NET", value: String(t.net) }] : []),
    ...(t.total.putts != null ? [{ label: "PUTTS", value: String(t.total.putts) }] : []),
  ];
  const counts = [
    { label: "Eagles+", value: t.counts.eagle + t.counts.albatross },
    { label: "Birdies", value: t.counts.birdie },
    { label: "Pars", value: t.counts.par },
    { label: "Bogeys", value: t.counts.bogey },
    { label: "Doubles+", value: t.counts.double + t.counts.worse },
  ];
  const sub = [
    card.firstName,
    card.teeName ? `${card.teeName} tees` : null,
    card.playingHandicap != null ? `plays off ${card.playingHandicap}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // A 9-hole card has room to breathe; an 18 fits both nines.
  const heroH = nineOnly ? 600 : 500;
  const hasYards = card.holeList.every((h) => h.yards != null);

  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers: Record<string, string> = { "cache-control": "private, max-age=300", "x-robots-tag": "noindex" };
  if (download) headers["content-disposition"] = `attachment; filename="${scorecardPhotoFilename(card.courseName, card.playedOn)}"`;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: CREAM, fontFamily: "Public Sans", color: INK }}>
        {/* The photograph, with the course and the score */}
        <div style={{ width: W, height: heroH, display: "flex", position: "relative", color: CREAM }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page */}
          <img src={photo} width={W} height={heroH} style={{ position: "absolute", top: 0, left: 0, objectFit: "cover" }} alt="" />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: W,
              height: heroH,
              display: "flex",
              backgroundImage: `linear-gradient(180deg, rgba(${NAVY_RGB},0.55) 0%, rgba(${NAVY_RGB},0.78) 45%, rgba(${NAVY_RGB},0.97) 100%)`,
            }}
          />
          <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: `44px ${PAD}px 36px`, width: W, height: heroH }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: INNER }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontFamily: "Playfair", fontSize: 40, lineHeight: 1 }}>PinPals</div>
                <div style={{ width: 52, height: 4, background: GOLD, marginTop: 10, borderRadius: 2 }} />
              </div>
              <div style={{ display: "flex", fontWeight: 600, fontSize: 18, letterSpacing: 3, color: GOLD, border: `1.5px solid ${GOLD}`, borderRadius: 999, padding: "8px 18px", background: `rgba(${NAVY_RGB},0.6)` }}>
                SCORECARD
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
              <div style={{ display: "flex", fontWeight: 600, fontSize: 20, letterSpacing: 2.5, color: GOLD }}>{playedLabel(card.playedOn).toUpperCase()}</div>
              <div style={{ display: "flex", fontFamily: "Playfair", fontSize: card.courseName.length > 30 ? 44 : card.courseName.length > 22 ? 52 : 60, lineHeight: 1.08, marginTop: 8 }}>
                {card.courseName}
              </div>
              {sub ? <div style={{ display: "flex", fontSize: 26, marginTop: 10, color: "rgba(247,243,234,0.85)" }}>{sub}</div> : null}
              <div style={{ display: "flex", alignItems: "flex-end", marginTop: 18 }}>
                <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 128, lineHeight: 0.95 }}>{big}</div>
                {small ? <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 46, color: GOLD, marginLeft: 18, marginBottom: 8 }}>{small}</div> : null}
                <div style={{ display: "flex", marginLeft: "auto", gap: 12 }}>
                  {tiles.map((x) => (
                    <div key={x.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 18px", borderRadius: 16, background: "rgba(247,243,234,0.12)", minWidth: 112 }}>
                      <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 38, lineHeight: 1.1 }}>{x.value}</div>
                      <div style={{ display: "flex", fontWeight: 600, fontSize: 15, letterSpacing: 2, color: GOLD }}>{x.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The card */}
        <div style={{ display: "flex", flexDirection: "column", padding: `${nineOnly ? 44 : 32}px ${PAD}px 0`, gap: nineOnly ? 32 : 22 }}>
          <Nine title={nineOnly ? "TOT" : "OUT"} holes={front} total={t.out} shots={shots} yards={hasYards} big={nineOnly} />
          {!nineOnly && t.in ? <Nine title="IN" holes={back} total={t.in} shots={shots} yards={hasYards} big={false} /> : null}

          <div style={{ display: "flex", width: INNER, background: "#ffffff", border: `1.5px solid ${LINE}`, borderRadius: 18, padding: "14px 0" }}>
            {counts.map((c) => (
              <div key={c.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 34, lineHeight: 1.1 }}>{c.value}</div>
                <div style={{ display: "flex", fontWeight: 600, fontSize: 16, color: INK_500 }}>{c.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Certified, and where it came from */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", padding: `0 ${PAD}px 40px` }}>
          {card.certified ? (
            <div style={{ display: "flex", alignItems: "center", fontWeight: 600, fontSize: 22, color: GREEN, background: "#dcefe3", borderRadius: 999, padding: "10px 20px" }}>
              {/* Drawn, not a ✓: the fonts here don't have one, and next/og would fetch a font for it. */}
              <svg width="22" height="22" viewBox="0 0 24 24" style={{ marginRight: 10 }}>
                <path d="M4 12.5l5 5L20 6.5" fill="none" stroke={GREEN} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Certified by {card.certified.by} · {CERTIFY_METHOD[card.certified.method] ?? "in the app"}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ display: "flex", fontFamily: "Playfair", fontSize: 24, color: NAVY }}>Golf is better on PinPals</div>
            <div style={{ display: "flex", fontSize: 18, color: INK_500, marginTop: 2 }}>pinpals.ie</div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Playfair", data: playfair, weight: 700, style: "normal" },
        { name: "Public Sans", data: sans, weight: 400, style: "normal" },
        { name: "Public Sans", data: sansSemi, weight: 600, style: "normal" },
      ],
      headers,
    }
  );
}

/** One nine: hole numbers, par, the score marked, and the nine's total. */
function Nine({ title, holes, total, shots, yards, big }: { title: string; holes: ScorecardHole[]; total: NineTotals; shots: Map<number, number>; yards: boolean; big: boolean }) {
  const HEAD = big ? 56 : 48;
  const PAR = big ? 50 : 42;
  const SCORE = big ? 100 : 84;
  const LABEL = 96;
  const col = Math.floor((INNER - LABEL - 2) / (holes.length + 1));
  const row = (h: number, bg?: string) => ({ display: "flex", height: h, alignItems: "center", ...(bg ? { background: bg } : {}) }) as const;
  const cell = { display: "flex", width: col, justifyContent: "center", alignItems: "center" } as const;
  const label = { display: "flex", width: LABEL, paddingLeft: 18, fontWeight: 600, fontSize: 17, letterSpacing: 1.5 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", width: INNER, background: "#ffffff", border: `1.5px solid ${LINE}`, borderRadius: 18, overflow: "hidden" }}>
      <div style={{ ...row(HEAD, NAVY), color: CREAM, fontWeight: 600, fontSize: big ? 22 : 20 }}>
        <div style={{ ...label, color: GOLD }}>HOLE</div>
        {holes.map((h) => (
          <div key={h.hole} style={cell}>{h.hole}</div>
        ))}
        <div style={{ ...cell, color: GOLD, fontSize: 17, letterSpacing: 1.5 }}>{title}</div>
      </div>
      {yards ? (
        <div style={{ ...row(34), color: INK_500, fontSize: 15, borderBottom: `1px solid ${LINE}` }}>
          <div style={{ ...label, color: INK_500, fontSize: 14 }}>YDS</div>
          {holes.map((h) => (
            <div key={h.hole} style={cell}>{h.yards ?? "–"}</div>
          ))}
          <div style={{ ...cell, height: 34, background: CREAM_100 }}>{total.yards ?? "–"}</div>
        </div>
      ) : null}
      <div style={{ ...row(PAR), color: INK_500, fontSize: big ? 22 : 20, borderBottom: `1px solid ${LINE}` }}>
        <div style={{ ...label, color: INK_500 }}>PAR</div>
        {holes.map((h) => (
          <div key={h.hole} style={cell}>{h.par}</div>
        ))}
        <div style={{ ...cell, height: PAR, background: CREAM_100, color: INK }}>{total.par}</div>
      </div>
      <div style={{ ...row(SCORE), fontSize: big ? 34 : 30, fontWeight: 600 }}>
        <div style={{ ...label, color: NAVY }}>SCORE</div>
        {holes.map((h) => (
          <div key={h.hole} style={{ ...cell, flexDirection: "column", height: SCORE }}>
            <Mark hole={h} size={big ? 60 : 52} />
            <div style={{ display: "flex", gap: 4, height: 8, marginTop: 3 }}>
              {Array.from({ length: Math.min(shots.get(h.hole) ?? 0, 3) }, (_, i) => (
                <div key={i} style={{ width: 7, height: 7, borderRadius: 4, background: GOLD }} />
              ))}
            </div>
          </div>
        ))}
        <div style={{ ...cell, height: SCORE, background: CREAM_100, fontFamily: "Playfair", fontSize: big ? 40 : 34, color: NAVY }}>{total.strokes ?? "–"}</div>
      </div>
    </div>
  );
}

/** The score: ringed under par, boxed over — twice for two or more. */
function Mark({ hole, size }: { hole: ScorecardHole; size: number }) {
  const box = { display: "flex", width: size, height: size, alignItems: "center", justifyContent: "center" } as const;
  const innerSize = size - 12;
  if (hole.strokes == null) return <div style={{ ...box, color: INK_500 }}>–</div>;
  const r = holeResult(hole.strokes, hole.par);
  const under = r === "birdie" || r === "eagle" || r === "albatross";
  const over = r === "bogey" || r === "double" || r === "worse";
  const twice = r === "eagle" || r === "albatross" || r === "double" || r === "worse";
  const colour = under ? GREEN : over ? RED : INK;
  if (!under && !over) return <div style={box}>{hole.strokes}</div>;
  const radius = under ? size / 2 : 6;
  return (
    <div style={{ ...box, border: `2.5px solid ${colour}`, borderRadius: radius }}>
      {twice ? (
        <div style={{ display: "flex", width: innerSize, height: innerSize, alignItems: "center", justifyContent: "center", border: `2.5px solid ${colour}`, borderRadius: under ? innerSize / 2 : 4, color: colour }}>
          {hole.strokes}
        </div>
      ) : (
        <div style={{ display: "flex", color: colour }}>{hole.strokes}</div>
      )}
    </div>
  );
}
