"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { TvHighlight, TvPayload, TvRow } from "@/lib/tv-board";

import TvShell from "./tv-shell";

/**
 * The live leaderboard on a clubhouse TV (mock-ups 1–3). Polls the board
 * every few seconds — a TV has no PinPals session to receive the app's
 * private realtime pings, and a short poll of one small JSON is simpler and
 * survives patchy clubhouse Wi-Fi. Long fields page every 15 seconds.
 *
 * Worked out here, between polls, because it's about what the TV has shown:
 *  - movement arrows (▲2) when a row's place changes, for a few minutes
 *  - the flash: a birdie or better that wasn't there last time takes over
 *    the screen for six seconds; several queue up and show in turn. What was
 *    already on the cards when the TV was switched on isn't flashed.
 */

const POLL_MS = 5000;
const ROWS_PER_PAGE = 12;
const MATCHES_PER_PAGE = 7;
const PAGE_MS = 15000;
const FLASH_MS = 6000;
const MOVE_MS = 5 * 60 * 1000;
const BADGE_MS = 10 * 60 * 1000;
const STALE_MS = 30 * 1000;

type Move = { delta: number; at: number };

const posNumber = (pos: string) => {
  const n = Number(pos.replace(/^T/, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
}

/** "8th", "T3" as a place is said. */
function place(pos: string) {
  const n = Number(pos);
  return Number.isInteger(n) && n > 0 ? ordinal(n) : pos;
}

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"} ago`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? "" : "s"} ago`;
}

const clockFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hour12: false });

export default function TvBoardView({ token }: { token: string }) {
  const [board, setBoard] = useState<TvPayload | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState(0);
  const [pageAt, setPageAt] = useState(() => Date.now());
  const [moves, setMoves] = useState<Map<string, Move>>(new Map());
  /** Flashes waiting; the first is on screen. */
  const [queue, setQueue] = useState<TvHighlight[]>([]);
  const flash = queue[0] ?? null;

  const seen = useRef<Set<string> | null>(null);
  const places = useRef<Map<string, number>>(new Map());

  // --- Poll -----------------------------------------------------------------
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const res = await fetch("/api/tv/board", { headers: { authorization: `TV ${token}` }, cache: "no-store" });
        if (res.status === 401 || res.status === 404) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (!stop) setGone(body.error ?? "This leaderboard is no longer available.");
          return; // nothing more to poll
        }
        if (res.ok) {
          const next = (await res.json()) as TvPayload;
          if (stop) return;
          absorb(next);
          setBoard(next);
          setLastOk(Date.now());
        }
      } catch {
        // Wi-Fi blip: keep the last board up and try again.
      }
      if (!stop) timer = setTimeout(load, POLL_MS);
    };

    const absorb = (next: TvPayload) => {
      const t = Date.now();
      // Places: arrows for rows that moved since the last board.
      const fresh = new Map<string, number>();
      const moved: [string, Move][] = [];
      for (const r of next.rows) {
        const n = posNumber(r.pos);
        if (n == null) continue;
        fresh.set(r.key, n);
        const before = places.current.get(r.key);
        if (before != null && before !== n) moved.push([r.key, { delta: before - n, at: t }]);
      }
      places.current = fresh;
      if (moved.length) setMoves((m) => new Map([...m, ...moved]));

      // Highlights: flash only what's new since the TV came on.
      if (!seen.current) {
        seen.current = new Set(next.highlights.map((h) => h.id));
        return;
      }
      const added = next.highlights.filter((h) => !seen.current!.has(h.id));
      for (const h of next.highlights) seen.current.add(h.id);
      // Keep the one showing and the latest few behind it.
      if (added.length) setQueue((q) => [...q.slice(0, 1), ...[...q.slice(1), ...added.sort((a, b) => a.at.localeCompare(b.at))].slice(-4)]);
    };

    void load();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // --- The flash queue ------------------------------------------------------
  const flashId = flash?.id ?? null;
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), FLASH_MS);
    return () => clearTimeout(t);
  }, [flashId]);

  // --- Paging ---------------------------------------------------------------
  const perPage = board?.kind === "matches" ? MATCHES_PER_PAGE : ROWS_PER_PAGE;
  const count = board ? (board.kind === "matches" ? board.matches.length : board.rows.length) : 0;
  const pages = Math.max(1, Math.ceil(count / perPage));
  useEffect(() => {
    if (pages <= 1) return;
    const t = setInterval(() => {
      setPage((p) => (p + 1) % pages);
      setPageAt(Date.now());
    }, PAGE_MS);
    return () => clearInterval(t);
  }, [pages]);
  const shownPage = Math.min(page, pages - 1);

  const hot = useMemo(() => {
    const m = new Map<string, TvHighlight>();
    for (const h of board?.highlights ?? []) {
      if (now - new Date(h.at).getTime() > BADGE_MS) continue;
      if (!m.has(h.rowKey)) m.set(h.rowKey, h);
    }
    return m;
  }, [board, now]);

  if (gone) {
    return (
      <TvShell className="tv-pair">
        <div className="tv-eyebrow">PinPals · Clubhouse screen</div>
        <div>
          <h1 className="tv-display">{gone}</h1>
          <p className="tv-sub" style={{ fontSize: 32, marginTop: 24 }}>
            Open pinpals.ie/tv to pair this screen with another game.
          </p>
        </div>
        <div className="tv-bottom">
          <span />
          <span>pinpals.ie/tv</span>
        </div>
      </TvShell>
    );
  }

  const stale = lastOk != null && now - lastOk > STALE_MS;
  const nextPageIn = Math.ceil((PAGE_MS - (now - pageAt)) / 1000);

  return (
    <TvShell>
      <header className="tv-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div className="tv-eyebrow" style={{ display: "flex", gap: 18 }}>
            <span>{board?.eyebrow ?? "PINPALS"}</span>
            {board && <span className={board.state === "live" ? "tv-live" : "tv-final"}>{board.state === "live" ? "LIVE" : "FINAL"}</span>}
          </div>
          <h1 className="tv-display">{board?.title ?? "Loading the leaderboard…"}</h1>
          {board && <div className="tv-sub">{board.subtitle}</div>}
        </div>
        <div>
          <div className="tv-clock">{clockFmt.format(now)}</div>
          {lastOk != null && (
            <div className={`tv-updated${stale ? " tv-stale" : ""}`}>{stale ? `Reconnecting… last update ${ago(now - lastOk)}` : `Updated ${ago(now - lastOk)}`}</div>
          )}
        </div>
      </header>

      {board?.kind === "matches" ? (
        <MatchBoard board={board} page={shownPage} />
      ) : (
        <div className="tv-body">
          <section className="tv-card tv-board" aria-label="Leaderboard">
            <div className="tv-grid tv-th">
              <span style={{ paddingLeft: 8 }}>POS</span>
              <span>{board?.kind === "teams" ? "TEAM" : "PLAYER · CLUB"}</span>
              <span className="tv-c">HCP</span>
              <span className="tv-c">ON</span>
              <span className="tv-c">OUT</span>
              <span className="tv-c">{board?.nineHoles ? "" : "IN"}</span>
              <span className="tv-r" style={{ paddingRight: 8 }}>{board?.scoreHeading ?? "PTS"}</span>
            </div>
            {board && board.rows.length === 0 && <div className="tv-empty">No scores yet. They&apos;ll appear here as the first cards go in.</div>}
            {board?.rows.slice(shownPage * ROWS_PER_PAGE, (shownPage + 1) * ROWS_PER_PAGE).map((r, i) => (
              <Row key={r.key} r={r} leader={shownPage === 0 && i === 0 && r.started} move={moves.get(r.key)} now={now} hot={hot.get(r.key)} />
            ))}
            <div className="tv-foot">
              <span>{pages > 1 ? `Page ${shownPage + 1} of ${pages} · next page in ${Math.max(1, nextPageIn)}s` : ""}</span>
              <span>ON = hole being played · F = finished{board ? ` · ${board.note}` : ""}</span>
            </div>
          </section>
          <aside className="tv-side">
            <Feed board={board} />
            {board && (
              <div className="tv-card tv-panel">
                <h2>THE DAY</h2>
                {board.stats.map((s) => (
                  <div key={s.label} className="tv-stat">
                    <span>{s.label}</span>
                    <b>{s.value}</b>
                  </div>
                ))}
              </div>
            )}
            <Follow />
          </aside>
        </div>
      )}

      {flash && <Flash h={flash} />}
    </TvShell>
  );
}

function Row({ r, leader, move, now, hot }: { r: TvRow; leader: boolean; move?: Move; now: number; hot?: TvHighlight }) {
  const showMove = move && now - move.at < MOVE_MS && move.delta !== 0;
  const onClass = r.on === "F" ? " tv-done" : !r.started ? " tv-wait" : "";
  return (
    <div className={`tv-grid tv-row${hot ? " tv-hot" : ""}`}>
      <span className="tv-pos">
        {r.pos || "–"}
        {showMove && <span className={`tv-move ${move.delta > 0 ? "tv-up" : "tv-down"}`}>{move.delta > 0 ? `▲${move.delta}` : `▼${-move.delta}`}</span>}
      </span>
      <span className="tv-name">
        <b>{r.name}</b>
        {hot && (
          <span className="tv-badge">
            {hot.headline.replace("!", "")} {ordinal(hot.hole)}
          </span>
        )}
        {r.sub && <span className="tv-club">{r.sub}</span>}
      </span>
      <span className="tv-c">{r.hcp}</span>
      <span className={`tv-on${onClass}`}>{r.on}</span>
      <span className="tv-c">{r.out}</span>
      <span className="tv-c">{r.inn}</span>
      <span className={`tv-score${leader ? " tv-leader" : ""}`}>{r.score}</span>
    </div>
  );
}

function Feed({ board }: { board: TvPayload | null }) {
  const items = (board?.highlights ?? []).slice(0, 4);
  return (
    <div className="tv-card tv-panel">
      <h2>LATEST ON THE COURSE</h2>
      {items.length === 0 && (
        <div className="tv-feed">
          <span className="tv-meta">No birdies yet. The first one flashes up here.</span>
        </div>
      )}
      {items.map((h) => (
        <div key={h.id} className="tv-feed">
          <span className={`tv-chip k-${h.kind}`}>{h.kind === "hole_in_one" ? "ACE" : h.kind}</span>
          <div style={{ minWidth: 0 }}>
            <b>{h.who}</b>
            <span className="tv-meta">
              {ordinal(h.hole)} · par {h.par}
              {h.points ? ` · ${h.points} pts` : ""}
              {h.now ? ` · now ${place(h.now)}` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Follow() {
  return (
    <div className="tv-follow">
      <div className="tv-display">Follow every card live</div>
      <p>Playing today? Open Live scoring in the PinPals app.</p>
    </div>
  );
}

function MatchBoard({ board, page }: { board: TvPayload; page: number }) {
  const shown = board.matches.slice(page * MATCHES_PER_PAGE, (page + 1) * MATCHES_PER_PAGE);
  const pages = Math.max(1, Math.ceil(board.matches.length / MATCHES_PER_PAGE));
  return (
    <>
      {board.teams.length === 2 && (
        <div className="tv-teams">
          <div className="tv-team s1">
            <span className="tv-tname">{board.teams[0].name}</span>
            <span className="tv-tpts">{board.teams[0].points}</span>
          </div>
          <div className="tv-proj">
            {board.toWin && <span className="a">{board.toWin}</span>}
            {board.projected && board.state === "live" && (
              <>
                <span className="b">If it ended now</span>
                <span className="c">
                  {board.projected.left} – {board.projected.right}
                </span>
              </>
            )}
          </div>
          <div className="tv-team s2">
            <span className="tv-tname">{board.teams[1].name}</span>
            <span className="tv-tpts">{board.teams[1].points}</span>
          </div>
        </div>
      )}
      <section className="tv-card tv-matches" aria-label="Matches">
        {shown.map((m) => (
          <div key={m.key} className="tv-match">
            <span className="n">{m.label}</span>
            <span className={`l ${m.side === 1 ? "lead" : m.side === 2 ? "trail" : ""}`}>{m.left}</span>
            <span className={`st${m.side ? ` s${m.side}` : ""}`}>{m.status}</span>
            <span className={m.side === 2 ? "lead" : m.side === 1 ? "trail" : ""}>{m.right}</span>
            <span className="t">{m.thru}</span>
          </div>
        ))}
        <div className="tv-foot">
          <span>{pages > 1 ? `Page ${page + 1} of ${pages}` : ""}</span>
          <span>{board.note}</span>
        </div>
      </section>
    </>
  );
}

const FLASH_COLOUR: Record<TvHighlight["kind"], string> = { birdie: "#e8c46b", eagle: "#6fd08c", albatross: "#9fd3ff", hole_in_one: "#f7f3ea" };

function Flash({ h }: { h: TvHighlight }) {
  return (
    <div className="tv-flash" role="status" aria-live="assertive">
      <div className="tv-flash-card" style={{ ["--k" as string]: FLASH_COLOUR[h.kind] }}>
        <div className="tv-live" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "0.24em" }}>
          JUST NOW · {ordinal(h.hole).toUpperCase()} · PAR {h.par}
        </div>
        <div className="tv-display big">{h.headline}</div>
        <div className="who">{h.who}</div>
        {h.sub && <div className="club">{h.sub}</div>}
        <div className="tiles">
          <div className="tile">
            <span className="k">SCORE</span>
            <span className="v">{h.strokes}</span>
          </div>
          {h.points && (
            <div className="tile">
              <span className="k">POINTS</span>
              <span className="v">{h.points}</span>
            </div>
          )}
          {h.now && (
            <div className="tile" style={{ background: "rgba(232,196,107,0.16)" }}>
              <span className="k" style={{ color: "#e8c46b" }}>
                NOW
              </span>
              <span className="v">{place(h.now)}</span>
            </div>
          )}
        </div>
        <div className="bar">
          <i style={{ animationDuration: `${FLASH_MS}ms` }} />
        </div>
      </div>
    </div>
  );
}
