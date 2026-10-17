"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { newHighlight, type FollowCard, type FollowHole, type FollowTone } from "@/lib/follow-card";

/**
 * A shared live scorecard (Follow my round, 0158), for someone who isn't
 * playing — a parent at home, a friend at work — with no PinPals account.
 *
 * Polls one small JSON every 15 seconds while the page is on screen, and at
 * once when it comes back to the front (a phone that was locked). A birdie
 * or better that wasn't there on the last poll gets a toast and the hole
 * flashes; what was already on the card when the page opened doesn't.
 */

const POLL_MS = 15_000;
const TOAST_MS = 5_000;
const TIP_KEY = "pp_follow_tip_hidden";

const TONE_WORD: Partial<Record<FollowTone, string>> = { ace: "Hole in one", albatross: "Albatross", eagle: "Eagle", birdie: "Birdie" };

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return `${m} minute${m === 1 ? "" : "s"} ago`;
}

const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;

function valueClass(card: FollowCard, h: FollowHole) {
  if (!h.value) return "";
  if (card.valueHeading === "PTS") return Number(h.value) >= 3 ? "good" : Number(h.value) === 0 ? "bad" : "";
  if (card.valueHeading === "MATCH") return h.value === "W" ? "good" : h.value === "L" ? "bad" : "";
  return h.value.startsWith("-") ? "good" : h.value.startsWith("+") ? "bad" : "";
}

function HoleRow({ card, h, flash }: { card: FollowCard; h: FollowHole; flash: boolean }) {
  const now = card.nowPlaying === h.hole;
  const shown = h.strokes === undefined ? (now ? "•" : "") : h.strokes === null ? "NR" : String(h.strokes);
  return (
    <div className={`fl-row${now ? " now" : ""}${flash ? " flash" : ""}`}>
      <span className="fl-hole">{h.hole}</span>
      <span className="fl-par">
        Par {h.par}
        {h.shots > 0 && <span className="fl-shots" aria-label={`${h.shots} shot${h.shots === 1 ? "" : "s"}`}>{"•".repeat(Math.min(h.shots, 3))}</span>}
      </span>
      <span className="fl-si">{h.strokeIndex ?? "–"}</span>
      <span className="fl-score">
        <span className={`fl-mark ${h.tone}`}>{shown}</span>
      </span>
      <span className={`fl-val ${valueClass(card, h)}`}>{h.value}</span>
    </div>
  );
}

function Scorecard({ card, flashHole }: { card: FollowCard; flashHole: number | null }) {
  const out = card.halves.find((x) => x.label === "Out");
  const inn = card.halves.find((x) => x.label === "In");
  const holesOut = card.holes.filter((h) => h.hole <= 9);
  const holesIn = card.holes.filter((h) => h.hole > 9);
  const total = (label: string, half: { par: number; strokes: string; value: string } | undefined) =>
    half ? (
      <div className="fl-row total">
        <span className="fl-hole">{label}</span>
        <span className="fl-par">Par {half.par}</span>
        <span />
        <span className="fl-score">
          <span className="fl-mark">{half.strokes}</span>
        </span>
        <span className="fl-val">{half.value}</span>
      </div>
    ) : null;
  return (
    <div className="fl-card" role="table" aria-label="Scorecard">
      <div className="fl-row fl-head">
        <span>HOLE</span>
        <span>PAR</span>
        <span style={{ textAlign: "center" }}>SI</span>
        <span style={{ textAlign: "center" }}>SCORE</span>
        <span style={{ textAlign: "right" }}>{card.valueHeading}</span>
      </div>
      {holesOut.map((h) => (
        <HoleRow key={h.hole} card={card} h={h} flash={flashHole === h.hole} />
      ))}
      {total("Out", out)}
      {holesIn.map((h) => (
        <HoleRow key={h.hole} card={card} h={h} flash={flashHole === h.hole} />
      ))}
      {total("In", inn)}
    </div>
  );
}

/**
 * Where the card comes from:
 *   - a shared link (default): the secret after the # in the address
 *   - followId: a card a PinPal shared with the signed-in member, read with
 *     their website session (/live/follow/<id>: an older app, or a computer)
 */
export default function FollowView({ followId }: { followId?: number } = {}) {
  // The secret is after the # (never sent to a server); read it here.
  const [token] = useState(() =>
    followId != null || typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.replace(/^#/, ""))
  );
  const [card, setCard] = useState<FollowCard | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<{ text: string; hole: number } | null>(null);
  // Read once in the browser; the tip only ever renders after the card has
  // loaded client-side, so the server's guess never shows.
  const [tipHidden, setTipHidden] = useState(() => {
    try {
      return typeof window === "undefined" || window.localStorage.getItem(TIP_KEY) === "1";
    } catch {
      return false;
    }
  });
  const prev = useRef<FollowCard | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (timer) clearTimeout(timer);
      if (followId == null && !token) {
        setGone("This link isn't complete. Ask for it to be sent again.");
        return;
      }
      try {
        const res =
          followId != null
            ? await fetch(`/api/follow/mine/${followId}`, { cache: "no-store", credentials: "same-origin" })
            : await fetch("/api/follow/card", { headers: { authorization: `Follow ${token}` }, cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { card?: FollowCard; error?: string } | null;
        if (stop) return;
        if (res.status === 401 || res.status === 404 || res.status === 410) {
          setGone(json?.error ?? "This link isn't working any more.");
          return; // nothing more to poll
        }
        if (res.ok && json?.card) {
          const hl = newHighlight(prev.current, json.card);
          if (hl) setToast({ text: `${TONE_WORD[hl.tone] ?? "Birdie"} for ${json.card.firstName} on the ${nth(hl.hole)}!`, hole: hl.hole });
          prev.current = json.card;
          setCard(json.card);
          setLastOk(Date.now());
          if (json.card.state === "final") return; // the card won't change again
        }
      } catch {
        // No signal: try again on the next tick.
      }
      if (!stop && document.visibilityState === "visible") timer = setTimeout(load, POLL_MS);
    };
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible" && prev.current?.state !== "final") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, followId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const hideTip = () => {
    setTipHidden(true);
    try {
      window.localStorage.setItem(TIP_KEY, "1");
    } catch {
      // Private browsing: it'll show again next time, that's fine.
    }
  };

  if (gone && !card) {
    return (
      <main className="fl-wrap">
        <div className="fl-empty">
          <div className="fl-eyebrow">PinPals · Follow the round</div>
          <h1>{gone}</h1>
          <p>Shared rounds stop by themselves after the golf, or when the golfer stops sharing.</p>
        </div>
        <Footer member={followId != null} />
      </main>
    );
  }

  if (!card) {
    return (
      <main className="fl-wrap">
        <div className="fl-empty">
          <div className="fl-eyebrow">PinPals · Follow the round</div>
          <p>Loading the card…</p>
        </div>
      </main>
    );
  }

  const s = card.summary;
  const wordy = !/^[-+\dE–]/.test(s.big) || s.big.length > 5;
  return (
    <main className="fl-wrap">
      {toast && (
        <div className="fl-toast" role="status">
          {toast.text}
        </div>
      )}
      <div className="fl-top">
        <span className="fl-eyebrow">PinPals · Following</span>
        {gone ? (
          <span className="fl-state final">SHARING ENDED</span>
        ) : card.state === "live" ? (
          <span className="fl-state live">
            <span className="fl-dot" aria-hidden />
            LIVE
          </span>
        ) : (
          <span className="fl-state final">FINAL</span>
        )}
      </div>

      <header>
        <h1 className="fl-name">{card.name}</h1>
        <div className="fl-meta">
          <span>{card.course}</span>
          <span>{card.formatLabel}</span>
          {card.dateLabel && <span>{card.dateLabel}</span>}
        </div>
        <div className="fl-meta">{card.handicapLine}</div>
      </header>

      <section className="fl-hero" aria-label="Score so far">
        <div className={`fl-big${wordy ? " word" : ""}`}>
          {s.big}
          {s.unit && <small>{s.unit}</small>}
        </div>
        <div className="fl-side">
          <span className="fl-progress">{s.progress}</span>
          {s.place && <span className="fl-chip">{s.place}</span>}
        </div>
        {s.extra && <div className="fl-extra">{s.extra}</div>}
      </section>

      {card.state === "live" && card.nowPlaying && (
        <div className="fl-now">
          <span className="fl-dot" aria-hidden />
          {s.progress === "Not started" ? `Starting on the ${nth(card.nowPlaying)}` : `Playing the ${nth(card.nowPlaying)}`}
        </div>
      )}

      <Scorecard card={card} flashHole={toast?.hole ?? null} />

      {card.cardIncomplete && <p className="fl-note">Some stroke indexes aren&apos;t on the card yet, so points and nets may move a little.</p>}

      <p className="fl-note">
        {lastOk ? `Updated ${ago(now - lastOk)}` : ""}
        {card.state === "live" ? " · refreshes by itself" : ""}
      </p>

      {!tipHidden && card.state === "live" && (
        <div className="fl-tip">
          <span>
            Keep this one tap away: on an iPhone tap <strong>Share</strong> then <strong>Add to Home Screen</strong>; on Android, the menu then{" "}
            <strong>Add to Home screen</strong>.
          </span>
          <button type="button" onClick={hideTip} aria-label="Hide tip">
            ×
          </button>
        </div>
      )}

      <Footer member={followId != null} />
    </main>
  );
}

function Footer({ member = false }: { member?: boolean }) {
  // A signed-in member already has PinPals: no sign-up pitch, just the brand.
  if (member) {
    return (
      <footer className="fl-foot">
        <span className="fl-brand">Golf is better on PinPals</span>
        <span className="fl-note">Update the PinPals app to follow rounds under Live scoring → Following.</span>
      </footer>
    );
  }
  return (
    <footer className="fl-foot">
      <span className="fl-brand">Golf is better on PinPals</span>
      <Link className="fl-cta" href="/" rel="noreferrer">
        Get PinPals
      </Link>
      <span className="fl-note">Live scoring, societies and golf trips, for golfers in Ireland and beyond.</span>
    </footer>
  );
}
