"use client";

import { useActionState, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import DateOfBirthFields from "@/components/date-of-birth-fields";
import { JUNIOR_CAN, JUNIOR_CANNOT } from "@/lib/junior";
import { saveParentDateOfBirth, type ParentActionState } from "./actions";

/**
 * /parent#<secret> — a parent answering a 13–15 year old's request (0159).
 *
 * The secret is after the #, so it never reaches a server in a URL: this
 * component reads it and sends it to /api/parent/* as a header, where only
 * its SHA-256 is used (the same arrangement as /follow).
 *
 * Signing in or joining leaves the page, and the # with it. So before going
 * the secret is kept in this tab's sessionStorage and put back on return —
 * on the way back from /login, and from Stripe's card check if it's
 * cancelled. A new account is confirmed from an email that may open in a
 * different tab, so for that case the page also says to open our email's
 * link again.
 *
 * With no secret at all, this shows `dashboard` — the server-rendered parent
 * dashboard.
 */

const STORE_KEY = "pp_parent_token";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type Preview = { status: "pending" | "approved" | "declined" | "revoked" | "expired"; childFirstName: string; awaitingCardCheck: boolean; cardCheckRequired: boolean };

type View =
  | { kind: "loading" }
  | { kind: "dashboard" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; preview: Preview; signedIn: boolean };

/** The secret from the address, else from this tab's storage (after a sign-in round trip). */
function readToken(): string | null {
  const fromHash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (TOKEN_RE.test(fromHash)) return fromHash;
  try {
    const stored = window.sessionStorage.getItem(STORE_KEY);
    if (stored && TOKEN_RE.test(stored)) return stored;
  } catch {
    // Storage off (private mode): the link from the email still works.
  }
  return null;
}

// The address's # as an external store: undefined while server-rendering
// (and hydrating), then the secret or null. A hash change (someone pastes
// the link into a tab already on /parent) re-reads it.
const subscribeHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const serverToken = () => undefined;

function remember(token: string) {
  try {
    window.sessionStorage.setItem(STORE_KEY, token);
  } catch {}
}

/** Done with this request: drop the stored copy (the address keeps the #, so a reload shows the answer). */
function forget() {
  try {
    window.sessionStorage.removeItem(STORE_KEY);
  } catch {}
}

/** Leave the request for the dashboard. */
function toDashboard() {
  forget();
  window.location.replace("/parent");
}

async function call(path: string, token: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Parent ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

type Loaded = { token: string; view: Exclude<View, { kind: "loading" } | { kind: "dashboard" }> };

export default function ParentApproval({ dashboard }: { dashboard: ReactNode }) {
  const token = useSyncExternalStore<string | null | undefined>(subscribeHash, readToken, serverToken);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!token) return;
    // Back in the address (from storage), so a reload still works.
    if (!window.location.hash) window.history.replaceState(null, "", `/parent#${token}`);
    let live = true;
    call("/api/parent/preview", token).then(({ ok, json }) => {
      if (!live) return;
      if (!ok || !json.preview) {
        forget();
        setLoaded({ token, view: { kind: "invalid", message: typeof json.error === "string" ? json.error : "This link isn't valid." } });
        return;
      }
      setLoaded({ token, view: { kind: "ready", preview: json.preview as Preview, signedIn: json.signedIn === true } });
    });
    return () => {
      live = false;
    };
  }, [token]);

  const view: View =
    token === undefined ? { kind: "loading" } : token === null ? { kind: "dashboard" } : loaded?.token === token ? loaded.view : { kind: "loading" };

  if (view.kind === "loading") return <Shell><p className="text-ink-500">Loading…</p></Shell>;
  if (view.kind === "dashboard") return <>{dashboard}</>;
  if (view.kind === "invalid") {
    return (
      <Shell>
        <h1 className="font-display font-bold text-2xl mb-2">This link isn&rsquo;t working</h1>
        <p className="text-ink-500">{view.message} Ask your child to send a new one from PinPals.</p>
      </Shell>
    );
  }
  return <Answer token={token!} preview={view.preview} signedIn={view.signedIn} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> For parents
      </span>
      <div className="bg-surface rounded-2xl shadow-lg p-8 mt-3 grid gap-4">{children}</div>
    </div>
  );
}

function CanTable() {
  return (
    <div className="grid sm:grid-cols-2 gap-4 text-sm">
      <div className="bg-green-100 rounded-xl p-4">
        <p className="font-bold text-green-800 mb-2">They can</p>
        <ul className="grid gap-1.5 list-disc pl-4 text-ink-900">
          {JUNIOR_CAN.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
      <div className="bg-cream-100 rounded-xl p-4">
        <p className="font-bold text-ink-900 mb-2">They can&rsquo;t</p>
        <ul className="grid gap-1.5 list-disc pl-4 text-ink-700">
          {JUNIOR_CANNOT.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>
    </div>
  );
}

function Answer({ token, preview, signedIn }: { token: string; preview: Preview; signedIn: boolean }) {
  const name = preview.childFirstName || "Your child";
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsDob, setNeedsDob] = useState(false);
  const [outcome, setOutcome] = useState<"approved" | "declined" | "card_check" | null>(
    preview.status === "pending" && preview.awaitingCardCheck ? "card_check" : null
  );

  if (outcome === "approved" || preview.status === "approved") {
    return (
      <Shell>
        <h1 className="font-display font-bold text-2xl">Thanks — {name}&rsquo;s account is approved</h1>
        <p className="text-ink-500">Live scoring and sharing their rounds are switched on. Your parent dashboard is where you choose who they play with.</p>
        <button type="button" onClick={toDashboard} className="justify-self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition">
          Open your parent dashboard
        </button>
      </Shell>
    );
  }
  if (outcome === "declined" || preview.status === "declined" || preview.status === "revoked") {
    return (
      <Shell>
        <h1 className="font-display font-bold text-2xl">This request has been answered</h1>
        <p className="text-ink-500">{name}&rsquo;s account won&rsquo;t be switched on. They can send a new request if anything changes.</p>
      </Shell>
    );
  }
  if (preview.status === "expired") {
    return (
      <Shell>
        <h1 className="font-display font-bold text-2xl">This link has expired</h1>
        <p className="text-ink-500">Links work for 30 days. Ask {name} to send a new one from PinPals.</p>
      </Shell>
    );
  }

  if (!signedIn) {
    const leave = (href: string) => {
      remember(token);
      window.location.href = href;
    };
    return (
      <Shell>
        <h1 className="font-display font-bold text-2xl">{name} has asked to join PinPals</h1>
        <p className="text-ink-500">
          To say yes you&rsquo;ll need your own PinPals account — it&rsquo;s free, for adults 18 and over, and it gives you a page to see {name}&rsquo;s rounds and choose who they play with.
        </p>
        <CanTable />
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => leave("/login?next=/parent")} className="px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition">
            Log in
          </button>
          <button type="button" onClick={() => leave("/signup")} className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition">
            Create an account
          </button>
        </div>
        <p className="text-xs text-ink-500">
          New to PinPals? Once you&rsquo;ve confirmed your email, open the link in our email about {name} again.
        </p>
        <DeclineButton token={token} onDone={() => { forget(); setOutcome("declined"); }} />
      </Shell>
    );
  }

  if (outcome === "card_check") return <CardCheck token={token} name={name} />;

  async function approve() {
    setBusy(true);
    setError(null);
    const { ok, json } = await call("/api/parent/answer", token, { answer: "approve", consent });
    setBusy(false);
    if (!ok) {
      if (json.code === "needs_dob") {
        setNeedsDob(true);
        return;
      }
      setError(typeof json.error === "string" ? json.error : "Couldn't save that — please try again.");
      return;
    }
    if (json.status === "card_check") {
      setOutcome("card_check");
      return;
    }
    forget();
    setOutcome("approved");
  }

  return (
    <Shell>
      <h1 className="font-display font-bold text-2xl">{name} has asked to join PinPals</h1>
      <p className="text-ink-500">PinPals is a golf app — live scoring, scorecards, course maps and a marketplace. Here&rsquo;s what a member aged 13 to 15 can do once you approve:</p>
      <CanTable />
      {needsDob ? (
        <ParentDob onSaved={() => { setNeedsDob(false); approve(); }} />
      ) : (
        <>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 w-4 h-4 accent-green-700" />
            <span>
              I&rsquo;m {name}&rsquo;s parent or legal guardian and I agree to PinPals processing their information as described in the privacy notice.
            </span>
          </label>
          {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={!consent || busy} onClick={approve} className="px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60">
              {busy ? "Saving…" : "Approve"}
            </button>
          </div>
          <DeclineButton token={token} onDone={() => { forget(); setOutcome("declined"); }} />
        </>
      )}
      {preview.cardCheckRequired && !needsDob && (
        <p className="text-xs text-ink-500">After you approve we&rsquo;ll ask for a quick €0 card check — nothing is charged and no card is kept.</p>
      )}
    </Shell>
  );
}

function DeclineButton({ token, onDone }: { token: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="pt-3 border-t border-line">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Decline this request? Their account won't be switched on.")) return;
          setBusy(true);
          const { ok, json } = await call("/api/parent/answer", token, { answer: "decline" });
          setBusy(false);
          if (ok) onDone();
          else setError(typeof json.error === "string" ? json.error : "Couldn't save that — please try again.");
        }}
        className="text-sm font-semibold text-ink-500 hover:text-red-600 transition"
      >
        {busy ? "Declining…" : "Decline"}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

const dobInitial: ParentActionState = {};

function ParentDob({ onSaved }: { onSaved: () => void }) {
  const [state, action, pending] = useActionState(saveParentDateOfBirth, dobInitial);
  useEffect(() => {
    if (state.done) onSaved();
  }, [state.done, onSaved]);
  return (
    <form action={action} className="grid gap-3 bg-cream-100 rounded-xl p-4">
      <p className="text-sm text-ink-900">
        Parents approving an account need to be 18 or over, so first add your own date of birth. It&rsquo;s never shown to anyone, and can only be entered once.
      </p>
      <DateOfBirthFields idPrefix="parent-dob" />
      {state.error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{state.error}</p>}
      <button type="submit" disabled={pending} className="justify-self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60">
        {pending ? "Saving…" : "Save and approve"}
      </button>
    </form>
  );
}

function CardCheck({ token, name }: { token: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Shell>
      <h1 className="font-display font-bold text-2xl">One last step: a €0 card check</h1>
      <p className="text-ink-500">
        To confirm an adult is approving {name}&rsquo;s account, we ask for a bank card. Stripe checks it — <strong className="text-ink-900">nothing is charged</strong>, and the card is removed straight after, so PinPals keeps nothing.
      </p>
      {error && <p className="text-sm text-red-600 bg-red-100 rounded-lg px-3.5 py-2.5">{error}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          remember(token);
          const { ok, json } = await call("/api/parent/card-check", token);
          if (ok && typeof json.url === "string") {
            window.location.href = json.url;
            return;
          }
          setBusy(false);
          setError(typeof json.error === "string" ? json.error : "Couldn't start the card check — please try again.");
        }}
        className="justify-self-start px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-60"
      >
        {busy ? "Opening…" : "Do the €0 card check"}
      </button>
      <button type="button" onClick={toDashboard} className="justify-self-start text-sm font-semibold text-ink-500 hover:text-ink-900">
        Not now
      </button>
    </Shell>
  );
}
