"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import TvShell from "./tv-shell";

/**
 * The TV's starting screen (mock-up 4): a code and its QR. It asks the
 * website for a code, keeps the secret that goes with it in memory only,
 * and checks every few seconds whether the organiser has paired it. When
 * they have, it moves to the leaderboard. Codes last ten minutes; a fresh
 * one is fetched before then.
 */

type Code = { code: string; secret: string; expiresAt: string };

const POLL_MS = 3000;

function remaining(expiresAt: string, now: number) {
  const s = Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function PairScreen() {
  const router = useRouter();
  const [code, setCode] = useState<Code | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const fresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tv/pair", { method: "POST" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't get a code.");
      setCode((await res.json()) as Code);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get a code.");
      setFailures((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // A code straight away; a new one a little before it runs out; another
  // try 15 seconds after an error.
  useEffect(() => {
    const ms = error ? 15_000 : code ? Math.max(0, new Date(code.expiresAt).getTime() - Date.now() - 20_000) : 0;
    const t = setTimeout(() => void fresh(), ms);
    return () => clearTimeout(t);
  }, [code, error, failures, fresh]);

  useEffect(() => {
    if (!code) return;
    let stop = false;
    const check = async () => {
      try {
        const res = await fetch("/api/tv/pair/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: code.code, secret: code.secret }),
        });
        const out = (await res.json()) as { state: string; path?: string };
        if (stop) return;
        if (out.state === "linked" && out.path) {
          router.replace(out.path);
        } else if (out.state === "expired" || out.state === "unknown") {
          void fresh();
        }
      } catch {
        // Wi-Fi blip: try again on the next tick.
      }
    };
    const t = setInterval(check, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [code, fresh, router]);

  const shown = code ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : "··· ···";

  return (
    <TvShell className="tv-pair">
      <div className="tv-eyebrow" style={{ fontSize: 26, letterSpacing: "0.28em" }}>
        PinPals · Clubhouse screen
      </div>
      <div className="tv-pair-main">
        <div style={{ flex: "1 1 0" }}>
          <h1 className="tv-display">Put your leaderboard on this screen</h1>
          <ol>
            <li>Open your round or society day in the PinPals app</li>
            <li>Tap Show on TV</li>
            <li>Scan the code, or type the code shown here</li>
          </ol>
        </div>
        <div className="tv-code-card">
          <div className="tv-qr">
            {code ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/tv/qr/${code.code}`} alt={`QR code for TV code ${code.code}`} />
            ) : null}
          </div>
          <div className="tv-small" style={{ fontWeight: 700, letterSpacing: "0.22em" }}>
            OR ENTER CODE
          </div>
          <div className="tv-code" aria-live="polite">
            {shown}
          </div>
          <div className="tv-small">{error ? error : code ? `New code in ${remaining(code.expiresAt, now)}` : "Getting a code…"}</div>
        </div>
      </div>
      <div className="tv-bottom">
        <span>No sign-in needed on this TV · it only shows what the organiser shares</span>
        <span>pinpals.ie/tv</span>
      </div>
    </TvShell>
  );
}
