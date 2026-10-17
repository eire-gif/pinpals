"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MemberAvatar from "@/components/member-avatar";
import StartConversationButton from "@/components/start-conversation-button";
import {
  firstName,
  forFilter,
  listNames,
  shortDate,
  type MyRound,
  type MyRoundsView,
  type Need,
  type PlayedRound,
  type Slot,
  type Tone,
} from "@/lib/my-rounds-rules";
import {
  answerOffer,
  answerRequest,
  calendarLink,
  deleteRound,
  setRoundStatus,
  shareRoundLink,
  withdrawMyRequest,
  type ActionResult,
} from "./actions";

/**
 * The interactive half of /tee-times/mine. Same sections, wording and
 * order as the app's My rounds screen (mobile/src/app/my-rounds.tsx).
 */
export type BoardFilter = "all" | "hosting" | "playing" | "requested";

const FILTERS: { key: BoardFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "hosting", label: "Hosting" },
  { key: "playing", label: "Playing" },
  { key: "requested", label: "Requested" },
];

const GUIDE_KEY = "pinpals:my-rounds-guide-hidden";

// "How a round comes together", hidden once, stays hidden in this browser.
// Read through useSyncExternalStore so the server render (and the first
// client one) treat it as hidden: it never flashes up for someone who
// dismissed it, and appears a beat later for someone who hasn't.
const guideListeners = new Set<() => void>();
function subscribeGuide(listener: () => void) {
  guideListeners.add(listener);
  return () => {
    guideListeners.delete(listener);
  };
}
function guideHidden(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}
function hideGuide() {
  try {
    window.localStorage.setItem(GUIDE_KEY, "1");
  } catch {
    // Not stored; it shows again next visit.
  }
  guideListeners.forEach((l) => l());
}

export default function MyRoundsBoard({
  view,
  focusId,
  startFilter,
}: {
  view: MyRoundsView;
  focusId: number | null;
  startFilter: BoardFilter;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<BoardFilter>(startFilter);
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const showGuide = !useSyncExternalStore(subscribeGuide, guideHidden, () => true);
  const needsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focusId === null) return;
    const el = document.getElementById(`round-${focusId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);

  const shown = forFilter(view, filter);

  function act(key: string, work: () => Promise<ActionResult>, done?: string, after?: (r: ActionResult) => void) {
    setBusyKey(key);
    setError(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (result.error) {
          setError(result.error);
        } else {
          if (done) setToast(done);
          after?.(result);
          setMenuFor(null);
          router.refresh();
        }
      } catch {
        setError("That didn't go through. Check your connection and try again.");
      } finally {
        setBusyKey(null);
      }
    });
  }

  const confirmThen = (question: string, run: () => void) => {
    if (window.confirm(question)) run();
  };

  // ---- the one main button on a round ----------------------------------
  function primary(round: MyRound) {
    switch (round.next) {
      case "answer":
        if (filter === "playing" || filter === "requested") setFilter("all");
        needsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      case "confirm":
        if (round.myInterestId !== null) {
          const id = round.myInterestId;
          act(`need-${id}`, () => answerOffer(id, true), `You're in for ${shortDate(round.playDate)}. ${firstName(round.host.name)}'s been told.`);
        }
        return;
      case "share":
        act(`round-${round.inviteId}`, () => shareRoundLink(round.inviteId), undefined, (r) => void shareUrl(r.url, round));
        return;
      case "calendar":
        act(`round-${round.inviteId}`, () => calendarLink(round.inviteId), undefined, (r) => {
          if (r.url) window.location.href = r.url;
        });
        return;
      case "findAnother":
        router.push("/tee-times");
        return;
      default:
        return;
    }
  }

  async function shareUrl(url: string | undefined, round: MyRound) {
    if (!url) return;
    const text = `Fancy a game? ${round.club}, ${shortDate(round.playDate)} at ${round.when}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "A place in my round", text, url });
        return;
      }
    } catch {
      // Closed the share sheet — fall through to copying.
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setToast("Link copied. Send it on WhatsApp or by text to fill the place.");
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div role="tablist" aria-label="Filter rounds" className="grid grid-cols-4 gap-1 rounded-2xl border-[1.5px] border-line bg-surface p-1.5 shadow-sm">
        {FILTERS.map(({ key, label }) => {
          const on = key === filter;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={on}
              onClick={() => {
                setFilter(key);
                setMenuFor(null);
              }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2.5 text-sm font-bold transition ${
                on ? "bg-green-700 text-white" : "text-ink-900 hover:bg-cream-100"
              }`}
            >
              {label}
              <span className={`min-w-6 rounded-full px-2 text-xs ${on ? "bg-gold-400 text-ink-900" : "bg-cream-100 text-ink-500"}`}>
                {view.counts[key]}
              </span>
            </button>
          );
        })}
      </div>

      {showGuide && (
        <section aria-label="How a round comes together" className="rounded-2xl border-[1.5px] border-line bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-ink-500">How a round comes together</h2>
            <button
              onClick={hideGuide}
              aria-label="Hide this guide"
              className="rounded-full p-1 text-ink-500 hover:bg-cream-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <ol className="grid grid-cols-4 gap-2 text-center">
            {[
              ["1", "Ask to join a round", "bg-green-100 text-green-700 border-[#b9cdb4]"],
              ["2", "Host offers a place", "bg-[#f7edcf] text-[#6b5212] border-gold-400"],
              ["3", "You confirm", "bg-green-700 text-white border-green-700"],
              ["4", "Play & share", "bg-ink-900 text-gold-400 border-ink-900"],
            ].map(([n, label, tone]) => (
              <li key={n} className="flex flex-col items-center gap-1.5">
                <span className={`grid h-8 w-8 place-items-center rounded-full border-[1.5px] text-sm font-bold ${tone}`}>{n}</span>
                <span className="text-xs font-semibold leading-tight text-ink-900">{label}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {toast && (
        <button
          onClick={() => setToast(null)}
          role="status"
          className="flex w-full items-center gap-2.5 rounded-2xl border-[1.5px] border-[#b9cdb4] bg-green-100 px-4 py-3 text-left text-sm font-semibold text-green-800"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {toast}
        </button>
      )}
      {error && <p className="rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}

      {shown.needs.length > 0 && (
        <section ref={needsRef} aria-labelledby="needs-h" className="space-y-3 scroll-mt-24">
          <h2 id="needs-h" className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#6b5212]">
            <span className="h-2 w-2 rounded-full bg-gold-500" />
            Needs your answer · {shown.needs.length}
          </h2>
          {shown.needs.map((need) => (
            <NeedCard
              key={`${need.kind}-${need.interestId}`}
              need={need}
              busy={pending && busyKey === `need-${need.interestId}`}
              onYes={() =>
                need.kind === "request"
                  ? act(`need-${need.interestId}`, () => answerRequest(need.interestId, true), `Place offered to ${firstName(need.person.name)}. You'll be told when they confirm.`)
                  : act(`need-${need.interestId}`, () => answerOffer(need.interestId, true), `You're in for ${shortDate(need.playDate)}. ${firstName(need.host.name)}'s been told.`)
              }
              onNo={() =>
                need.kind === "request"
                  ? confirmThen(`Decline ${firstName(need.person.name)}? They'll be told this round can't fit them in.`, () =>
                      act(`need-${need.interestId}`, () => answerRequest(need.interestId, false), `${firstName(need.person.name)} has been let know.`)
                    )
                  : confirmThen(`Can't make it? ${firstName(need.host.name)} will be told so the place can go to someone else.`, () =>
                      act(`need-${need.interestId}`, () => answerOffer(need.interestId, false), `Done. ${firstName(need.host.name)}'s been told.`)
                    )
              }
            />
          ))}
        </section>
      )}

      <section aria-labelledby="up-h" className="space-y-3">
        <h2 id="up-h" className="text-xs font-bold uppercase tracking-widest text-ink-500">Coming up</h2>
        {shown.upcoming.length === 0 ? (
          <Empty filter={filter} />
        ) : (
          shown.upcoming.map((round) => (
            <RoundCard
              key={round.inviteId}
              round={round}
              focused={round.inviteId === focusId}
              busy={pending && (busyKey === `round-${round.inviteId}` || (round.myInterestId !== null && busyKey === `need-${round.myInterestId}`))}
              menuOpen={menuFor === round.inviteId}
              onToggleMenu={() => setMenuFor((m) => (m === round.inviteId ? null : round.inviteId))}
              onPrimary={() => primary(round)}
              onToggleFull={() =>
                act(`round-${round.inviteId}`, () => setRoundStatus(round.inviteId, round.isMarkedFull ? "open" : "full"))
              }
              onCancel={() =>
                confirmThen("Cancel this round? Everyone who asked to join, or has a place, will be told it's off.", () =>
                  act(`round-${round.inviteId}`, () => setRoundStatus(round.inviteId, "cancelled"), "Round cancelled.")
                )
              }
              onDelete={() =>
                confirmThen("Delete this round? Nobody has asked to join it.", () =>
                  act(`round-${round.inviteId}`, () => deleteRound(round.inviteId), "Round deleted.")
                )
              }
              onLeave={() => {
                const id = round.myInterestId;
                if (id === null) return;
                const host = firstName(round.host.name);
                if (round.role === "asked") {
                  confirmThen(`Withdraw your request? ${host} hasn't answered yet, so nothing changes for them. You can ask again later.`, () =>
                    act(`need-${id}`, () => withdrawMyRequest(id), "Request withdrawn.")
                  );
                } else {
                  confirmThen(`${round.role === "playing" ? "Cancel your place" : "Can't make it"}? ${host} will be told so the place can go to someone else.`, () =>
                    act(`need-${id}`, () => answerOffer(id, false), `Done. ${host}'s been told.`)
                  );
                }
              }}
            />
          ))
        )}
      </section>

      {shown.played.length > 0 && (
        <section aria-labelledby="played-h" className="space-y-3">
          <h2 id="played-h" className="text-xs font-bold uppercase tracking-widest text-ink-500">Played</h2>
          <ul className="overflow-hidden rounded-[20px] border-[1.5px] border-line bg-surface">
            {shown.played.map((p, i) => (
              <PlayedRow key={p.inviteId} round={p} first={i === 0} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NeedCard({ need, busy, onYes, onNo }: { need: Need; busy: boolean; onYes: () => void; onNo: () => void }) {
  const who = need.kind === "request" ? need.person : need.host;
  const sub = [who.handicap !== null ? `${who.handicap} hcp` : null, who.homeClub].filter(Boolean).join(" · ");
  const detail =
    need.kind === "request"
      ? `${shortDate(need.playDate)} · ${need.when} · ${need.spacesAvailable} ${need.spacesAvailable === 1 ? "place" : "places"} open`
      : `${shortDate(need.playDate)} · ${need.when}${need.withNames.length > 0 ? ` · with ${listNames([firstName(who.name), ...need.withNames])}` : ""}`;

  return (
    <article className="rounded-[20px] border-2 border-gold-400 bg-[#fffdf6] p-4 sm:p-5 shadow-[0_4px_14px_rgba(226,196,111,0.22)]">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-[#6b5212]">
        {need.kind === "request" ? "Someone wants to join your round" : "You've been offered a place"}
      </p>
      <div className="flex items-center gap-3">
        <MemberAvatar name={who.name} avatarUrl={who.avatarUrl} color={who.avatarColor} size="md" className="ring-2 ring-gold-400" />
        <div className="min-w-0">
          <p className="font-bold text-ink-900">{need.kind === "request" ? `${who.name} asked to join` : `${who.name} has a place for you`}</p>
          {sub && <p className="text-sm text-ink-500">{sub}</p>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2.5 rounded-xl border-[1.5px] border-[#efe5cc] bg-surface px-3 py-2.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-green-700" aria-hidden="true">
          <path d="M5 21V4" />
          <path d="M5 4l12 4-12 4" />
        </svg>
        <div className="min-w-0 text-sm">
          <p className="truncate font-bold text-ink-900">{need.club}</p>
          <p className="text-ink-500">{detail}</p>
        </div>
      </div>
      {busy ? (
        <p className="mt-4 text-center text-sm font-semibold text-ink-500">Sending…</p>
      ) : (
        <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
          <button onClick={onYes} className="min-h-12 rounded-xl bg-green-700 px-3 text-sm font-bold text-white transition hover:bg-green-600">
            {need.kind === "request" ? "Offer a place" : "Confirm my place"}
          </button>
          <button onClick={onNo} className="min-h-12 rounded-xl border-[1.5px] border-[#d6c7a6] bg-surface px-3 text-sm font-bold text-red-600 transition hover:bg-red-100">
            {need.kind === "request" ? "Decline" : "Can't make it"}
          </button>
          <StartConversationButton
            otherUserId={who.id}
            label="Message"
            className="min-h-12 rounded-xl border-[1.5px] border-[#d6c7a6] bg-surface px-3 text-sm font-bold text-green-700 transition hover:bg-green-100 disabled:opacity-50"
          />
        </div>
      )}
    </article>
  );
}

const BADGE: Record<MyRound["role"], { label: string; className: string }> = {
  hosting: { label: "You're hosting", className: "bg-[#f7edcf] text-[#6b5212] border-gold-400" },
  playing: { label: "You're playing", className: "bg-green-100 text-green-800 border-[#b9cdb4]" },
  offered: { label: "Place offered", className: "bg-gold-400 text-ink-900 border-gold-500" },
  asked: { label: "Requested", className: "bg-surface text-ink-500 border-dashed border-[#b9ae96]" },
  declined: { label: "Not this time", className: "bg-cream-100 text-ink-500 border-line" },
  cancelled: { label: "Cancelled", className: "bg-red-600 text-white border-red-600" },
};

/** The website has no page for one tee time, so "View round" has nowhere
 *  to go: the card already shows everything that page would. */
const NEXT_LABEL: Record<MyRound["next"], string | null> = {
  answer: "Answer request",
  confirm: "Confirm my place",
  share: "Share this round",
  view: null,
  calendar: "Add to calendar",
  findAnother: "Find another round",
  none: null,
};

function RoundCard({
  round,
  focused,
  busy,
  menuOpen,
  onToggleMenu,
  onPrimary,
  onToggleFull,
  onCancel,
  onDelete,
  onLeave,
}: {
  round: MyRound;
  focused: boolean;
  busy: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onPrimary: () => void;
  onToggleFull: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onLeave: () => void;
}) {
  const dead = round.role === "cancelled" || round.role === "declined";
  const isHost = round.role === "hosting" || (round.role === "cancelled" && round.myInterestId === null);
  const [dow, day, mon] = shortDate(round.playDate).split(" ");
  const label = NEXT_LABEL[round.next];
  const gold = round.next === "answer" || round.next === "confirm";
  const quiet = round.next === "share";
  const hasMenu = isHost ? round.canToggleFull || round.canCancel || round.canDelete : !dead;

  return (
    <article
      id={`round-${round.inviteId}`}
      className={`scroll-mt-24 space-y-3 rounded-[20px] p-4 sm:p-5 ${
        round.role === "cancelled" ? "border-[1.5px] border-[#e7c3b8] bg-[#fbf8f4]" : dead ? "border-[1.5px] border-line bg-[#fbf8f4]" : "border-[1.5px] border-line bg-surface shadow-sm"
      } ${focused ? "ring-[3px] ring-gold-500" : ""}`}
    >
      {round.cancelNote && (
        <p className="flex items-center gap-2 rounded-xl border-[1.5px] border-[#e7c3b8] bg-red-100 px-3 py-2 text-sm font-semibold text-[#7e2e1c]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <line x1="8" y1="8" x2="16" y2="16" />
          </svg>
          {round.cancelNote}
        </p>
      )}

      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 rounded-2xl border-[1.5px] border-line bg-surface-tint py-1.5 text-center">
          <p className="text-[11px] font-bold tracking-wider text-red-600">{dow?.toUpperCase()}</p>
          <p className="font-display text-2xl font-bold leading-tight text-ink-900">{day}</p>
          <p className="text-[11px] font-semibold text-ink-500">{mon?.toUpperCase()}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className={`font-display text-lg font-bold leading-snug ${dead ? "text-ink-500" : "text-ink-900"}`}>{round.club}</h3>
            <span className={`shrink-0 rounded-full border-[1.5px] px-2.5 py-1 text-xs font-bold ${BADGE[round.role].className}`}>{BADGE[round.role].label}</span>
          </div>
          <p className="mt-0.5 text-sm text-ink-500">
            {round.when}
            {isHost ? "" : ` · hosted by ${firstName(round.host.name)}`}
          </p>
        </div>
      </div>

      {round.slots.length > 0 && (
        <div className={`flex items-center justify-between rounded-2xl border border-[#efe7d5] bg-surface-tint px-3 py-2.5 ${dead ? "opacity-45 grayscale" : ""}`}>
          <div className="flex flex-wrap gap-1.5">
            {round.slots.map((slot) => (
              <SlotDot key={slot.key} slot={slot} />
            ))}
          </div>
          {round.slotText && <span className="ml-2 text-sm font-semibold text-ink-900">{round.slotText}</span>}
        </div>
      )}

      <div>
        <div className="grid grid-cols-4 gap-1" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full ${
                i < round.stage.filled ? "bg-green-700" : round.stage.waiting && i === round.stage.filled ? "bg-gold-400" : "bg-[#ede6d6]"
              }`}
            />
          ))}
        </div>
        <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-ink-900">
          <StatusDot tone={round.tone} />
          {round.status}
        </p>
      </div>

      {busy ? (
        <p className="text-center text-sm font-semibold text-ink-500">Sending…</p>
      ) : label || hasMenu ? (
        <div className="flex gap-2">
          {label ? (
            <button
              onClick={onPrimary}
              className={`min-h-12 flex-1 rounded-xl px-3 text-sm font-bold transition ${
                gold
                  ? "border-[1.5px] border-gold-500 bg-gold-400 text-ink-900 hover:bg-gold-500"
                  : quiet
                    ? "border-[1.5px] border-[#d6c7a6] bg-surface text-green-700 hover:bg-green-100"
                    : "bg-green-700 text-white hover:bg-green-600"
              }`}
            >
              {label}
            </button>
          ) : (
            <span className="flex-1" />
          )}
          {hasMenu && (
            <button
              onClick={onToggleMenu}
              aria-expanded={menuOpen}
              aria-label="More options for this round"
              className="grid min-h-12 w-12 place-items-center rounded-xl border-[1.5px] border-[#d6c7a6] bg-surface text-ink-900 hover:bg-cream-100"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
          )}
        </div>
      ) : null}

      {menuOpen && !busy && (
        <div className="flex flex-wrap gap-2 border-t-[1.5px] border-[#efe7d5] pt-3">
          {isHost && round.canToggleFull && <MenuButton onClick={onToggleFull}>{round.isMarkedFull ? "Re-open" : "Mark full"}</MenuButton>}
          {isHost && round.canCancel && (
            <MenuButton danger onClick={onCancel}>
              Cancel round
            </MenuButton>
          )}
          {isHost && round.canDelete && (
            <MenuButton danger onClick={onDelete}>
              Delete
            </MenuButton>
          )}
          {!isHost && (
            <StartConversationButton
              otherUserId={round.host.id}
              label={`Message ${firstName(round.host.name)}`}
              className="min-h-10 rounded-xl border-[1.5px] border-line bg-surface px-3 text-sm font-bold text-green-700 hover:bg-green-100 disabled:opacity-50"
            />
          )}
          {!isHost && round.leaveLabel && (
            <MenuButton danger onClick={onLeave}>
              {round.leaveLabel}
            </MenuButton>
          )}
        </div>
      )}
    </article>
  );
}

function MenuButton({ children, danger, onClick }: { children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-10 rounded-xl border-[1.5px] border-line bg-surface px-3 text-sm font-bold transition ${
        danger ? "text-red-600 hover:bg-red-100" : "text-green-700 hover:bg-green-100"
      }`}
    >
      {children}
    </button>
  );
}

function SlotDot({ slot }: { slot: Slot }) {
  const look =
    slot.state === "me"
      ? "bg-ink-900 text-gold-400 ring-2 ring-white text-[10px]"
      : slot.state === "in"
        ? "bg-green-700 text-white ring-2 ring-white"
        : slot.state === "offered"
          ? "border-2 border-dashed border-gold-500 bg-[#f7edcf] text-[#6b5212]"
          : "border-[1.5px] border-dashed border-[#c9b98f] bg-surface text-[#9a8c6b] text-base";
  const label =
    slot.state === "open" ? "Open place" : slot.state === "offered" ? `${slot.name}, place offered, not confirmed yet` : `${slot.name}, confirmed`;
  return (
    <span title={label} aria-label={label} role="img" className={`grid h-9 w-9 place-items-center rounded-full text-xs font-bold ${look}`}>
      {slot.initials}
    </span>
  );
}

function StatusDot({ tone }: { tone: Tone }) {
  const look: Record<Tone, string> = {
    gold: "bg-gold-500",
    goldRing: "border-2 border-gold-500",
    green: "bg-green-700",
    red: "bg-red-600",
    grey: "border-2 border-[#9aa3ad]",
  };
  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${look[tone]}`} aria-hidden="true" />;
}

function PlayedRow({ round, first }: { round: PlayedRound; first: boolean }) {
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${first ? "" : "border-t-[1.5px] border-[#efe7d5]"}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-gold-400" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 21h8" />
          <path d="M12 17v4" />
          <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
          <path d="M17 5h3v2a3 3 0 0 1-3 3" />
          <path d="M7 5H4v2a3 3 0 0 0 3 3" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-ink-900">{round.club}</p>
        <p className="truncate text-sm text-ink-500">
          {shortDate(round.playDate)}
          {round.withNames.length > 0 ? ` · with ${listNames(round.withNames.map(firstName))}` : ""}
        </p>
      </div>
    </li>
  );
}

function Empty({ filter }: { filter: BoardFilter }) {
  const copy: Record<BoardFilter, [string, string]> = {
    all: ["Nothing coming up", "Post a round, or find one and ask the host for a place."],
    hosting: ["Nothing posted", "Post a round and golfers can ask to join you. You choose who plays."],
    playing: ["No rounds to play yet", "When you confirm a place, the round lands here with everyone's names."],
    requested: ["You haven't asked to join anything", "Find a round that suits and ask the host for a place."],
  };
  const [title, body] = copy[filter];
  return (
    <div className="rounded-[20px] border-[1.5px] border-dashed border-[#d6c7a6] bg-surface px-6 py-8 text-center">
      <p className="font-display text-xl font-bold text-ink-900">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[42ch] text-sm text-ink-500">{body}</p>
      <Link
        href={filter === "hosting" ? "/dashboard/availability/new" : "/tee-times"}
        className="mt-4 inline-block rounded-full bg-green-700 px-6 py-3 text-sm font-bold text-white hover:bg-green-600"
      >
        {filter === "hosting" ? "Post a round" : "Browse tee times"}
      </Link>
    </div>
  );
}
