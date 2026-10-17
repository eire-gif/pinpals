"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";

import {
  OFFER_STATUS_LABELS,
  OFFER_STATUS_TONE,
  euros,
  offerLine,
  shortAgo,
  type ThreadEntry,
  type ThreadReply,
  type ThreadSummary,
} from "@/lib/listing-thread";
import {
  answerOfferAction,
  postToThreadAction,
  replyInThreadAction,
  withdrawOrRemoveAction,
  type ThreadActionState,
} from "./thread-actions";

/**
 * Questions & offers — the public thread under a listing (0162, approved
 * mock-up Web 3). Asking price, highest offer and every offer with how it
 * went, the seller's answers in the open, and a box to ask or offer.
 * Nothing here moves money; the private side is Messages.
 */

const START: ThreadActionState = { error: null, done: 0 };

const TONE: Record<"good" | "bad" | "wait" | "muted", string> = {
  good: "bg-green-100 text-green-800",
  bad: "bg-red-100 text-red-600",
  wait: "bg-[#f6ead0] text-[#6b4a10]",
  muted: "bg-cream-100 text-ink-500",
};

export default function QuestionsOffers({
  listingId,
  askingCents,
  thread,
  isSeller,
  signedIn,
  browseOnly,
  onSale,
  sellerFirstName,
}: {
  listingId: number;
  askingCents: number | null;
  thread: ThreadSummary;
  isSeller: boolean;
  signedIn: boolean;
  browseOnly: boolean;
  onSale: boolean;
  sellerFirstName: string;
}) {
  return (
    <section id="questions" aria-labelledby="questions-heading" className="scroll-mt-24 grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="questions-heading" className="font-display text-2xl font-bold text-navy-900">
            Questions &amp; offers
          </h2>
          <p className="text-sm text-ink-500 mt-1">Everything here is public, so every buyer sees the same thing.</p>
        </div>
        <dl className="flex rounded-2xl bg-navy-900 overflow-hidden">
          <Stat label="Asking" value={askingCents != null ? euros(askingCents) : "—"} />
          <Stat label="Highest offer" value={thread.highestOpenCents != null ? euros(thread.highestOpenCents) : "None yet"} gold />
          <Stat label="Offers" value={String(thread.offers)} last />
        </dl>
      </div>

      <div className="flex flex-wrap gap-6 items-start">
        <div className="flex-[999_1_520px] min-w-0 bg-surface border border-line rounded-2xl overflow-hidden">
          {thread.entries.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-bold">No questions or offers yet</p>
              <p className="text-sm text-ink-500 mt-1">
                {isSeller ? "When someone asks or offers, it shows here and you get an alert." : "Ask something every buyer would want to know, or make an offer."}
              </p>
            </div>
          ) : (
            <ul>
              {thread.entries.map((entry) => (
                <Entry key={entry.id} entry={entry} listingId={listingId} isSeller={isSeller} onSale={onSale} signedIn={signedIn} />
              ))}
            </ul>
          )}
        </div>

        <div className="flex-[1_1_300px] min-w-0">
          {!onSale ? (
            <Notice>This item isn&rsquo;t for sale any more, so the thread is closed.</Notice>
          ) : isSeller ? (
            <Notice>Answer questions and accept, counter or decline offers right in the thread — everyone sees your answer.</Notice>
          ) : !signedIn ? (
            <div className="bg-surface border border-line rounded-2xl p-5 grid gap-3">
              <p className="text-sm text-ink-500">Sign in to ask {sellerFirstName} a question or make an offer.</p>
              <Link href={`/login?next=/marketplace/${listingId}%23questions`} className="py-3 rounded-xl font-bold text-center bg-green-700 text-cream-50 hover:bg-green-800 transition">
                Sign in
              </Link>
            </div>
          ) : browseOnly ? (
            <Notice>Under 18s can read questions and offers; a parent can ask or offer for you.</Notice>
          ) : (
            <Composer listingId={listingId} askingCents={askingCents} sellerFirstName={sellerFirstName} />
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, gold, last }: { label: string; value: string; gold?: boolean; last?: boolean }) {
  return (
    <div className={`px-5 py-3 ${last ? "" : "border-r border-cream-50/15"}`}>
      <dt className="text-xs text-[#d9d2c3]">{label}</dt>
      <dd className={`font-display text-xl font-bold ${gold ? "text-gold-400" : "text-cream-50"}`}>{value}</dd>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="bg-cream-100 rounded-2xl p-5 text-sm text-ink-700">{children}</p>;
}

function Composer({ listingId, askingCents, sellerFirstName }: { listingId: number; askingCents: number | null; sellerFirstName: string }) {
  const [kind, setKind] = useState<"question" | "offer">("question");
  const [state, action, pending] = useActionState(postToThreadAction, START);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.done > 0) form.current?.reset();
  }, [state.done]);

  // Make an offer elsewhere on the page links to #offer.
  useEffect(() => {
    const pick = () => {
      if (window.location.hash === "#offer") setKind("offer");
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
  }, []);

  const suggestion = askingCents ? String(Math.round((askingCents * 0.9) / 500) * 5) : "";

  return (
    <form ref={form} action={action} id="offer" className="bg-surface border border-line rounded-2xl p-5 grid gap-3 scroll-mt-24">
      <input type="hidden" name="listing_id" value={listingId} />
      <input type="hidden" name="kind" value={kind} />
      <div role="tablist" aria-label="Ask or offer" className="flex bg-cream-100 rounded-xl p-1">
        {(["question", "offer"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => setKind(k)}
            className={`flex-1 py-2 rounded-lg text-sm transition ${kind === k ? "bg-surface font-bold text-navy-900 shadow-sm" : "font-semibold text-ink-700"}`}
          >
            {k === "question" ? "Ask a question" : "Make an offer"}
          </button>
        ))}
      </div>

      {kind === "offer" ? (
        <label className="flex items-center gap-1 h-14 px-4 rounded-xl border-2 border-gold-500">
          <span className="sr-only">Your offer in euro</span>
          <span className="font-display text-2xl font-bold text-navy-900" aria-hidden>
            €
          </span>
          <input name="text" inputMode="decimal" autoComplete="off" placeholder={suggestion} className="flex-1 min-w-0 font-display text-2xl font-bold text-navy-900 outline-none bg-transparent" />
        </label>
      ) : (
        <label className="grid">
          <span className="sr-only">Your question</span>
          <textarea name="text" rows={3} maxLength={500} placeholder={`Ask ${sellerFirstName} something`} className="rounded-xl border border-line bg-cream-50 px-4 py-3 outline-none focus:border-green-700" />
        </label>
      )}

      <button type="submit" disabled={pending} className="h-12 rounded-xl font-bold bg-green-700 text-cream-50 hover:bg-green-800 transition disabled:opacity-60">
        {pending ? "Posting…" : kind === "offer" ? "Post offer publicly" : "Ask publicly"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm font-semibold text-red-600">
          {state.error}
        </p>
      ) : null}
      <p className="text-xs text-ink-500 leading-relaxed">
        {kind === "offer"
          ? `Offers aren't binding. ${sellerFirstName} can accept, decline or counter, and everyone sees the outcome.`
          : "Questions and answers are public. Phone numbers and collection go in Messages."}
      </p>
    </form>
  );
}

function Avatar({ person, size = 38 }: { person: ThreadReply; size?: number }) {
  return (
    <span
      aria-hidden
      className="rounded-full shrink-0 flex items-center justify-center font-bold text-cream-50"
      style={{ width: size, height: size, fontSize: size * 0.36, backgroundColor: person.isSeller ? "#0c2038" : person.color }}
    >
      {person.initials}
    </span>
  );
}

function Byline({ person }: { person: ThreadReply }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-bold">{person.isMine ? "You" : person.authorName}</span>
      {person.isSeller ? <span className="text-[10px] font-extrabold tracking-wide uppercase bg-gold-400 text-navy-900 px-1.5 py-0.5 rounded">Seller</span> : null}
      <span className="text-ink-500">
        {[person.club, `${shortAgo(person.createdAt)} ago`].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

function Entry({ entry, listingId, isSeller, onSale, signedIn }: { entry: ThreadEntry; listingId: number; isSeller: boolean; onSale: boolean; signedIn: boolean }) {
  const [replyState, replyAction, replyPending] = useActionState(replyInThreadAction, START);
  const [answerState, answerAction, answerPending] = useActionState(answerOfferAction, START);
  const [otherState, otherAction] = useActionState(withdrawOrRemoveAction, START);
  // A box is open while no action has succeeded since it was opened: each
  // success bumps `done`, which closes it without an effect.
  const [replyOpenedAt, setReplyOpenedAt] = useState<number | null>(null);
  const [counterOpenedAt, setCounterOpenedAt] = useState<number | null>(null);
  const replying = replyOpenedAt === replyState.done;
  const countering = counterOpenedAt === answerState.done;
  const setReplying = (open: boolean) => setReplyOpenedAt(open ? replyState.done : null);
  const setCountering = (open: boolean) => setCounterOpenedAt(open ? answerState.done : null);

  const canReply = signedIn && onSale && (isSeller || (entry.isMine && entry.replies.length > 0));
  const sellerOnOpenOffer = isSeller && onSale && entry.kind === "offer" && entry.status === "open";
  const error = replyState.error ?? answerState.error ?? otherState.error;

  return (
    <li className="px-5 py-4 border-b border-cream-100 last:border-b-0 grid gap-3">
      <div className="flex gap-3">
        <Avatar person={entry} />
        <div className="flex-1 min-w-0 grid gap-1">
          <Byline person={entry} />
          {entry.kind === "offer" && entry.status ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-bold text-navy-900">{offerLine(entry)}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TONE[OFFER_STATUS_TONE[entry.status]]}`}>{OFFER_STATUS_LABELS[entry.status]}</span>
            </span>
          ) : null}
          {entry.body ? <p className="text-[15px] leading-relaxed text-ink-700 whitespace-pre-line break-words">{entry.body}</p> : null}
        </div>
      </div>

      {entry.replies.map((r) => (
        <div key={r.id} className="ml-12 pl-3 border-l-2 border-gold-400 flex gap-3">
          <Avatar person={r} size={30} />
          <div className="flex-1 min-w-0 grid gap-1">
            <Byline person={r} />
            <p className="text-[15px] leading-relaxed text-ink-700 whitespace-pre-line break-words">{r.body}</p>
            {r.isMine ? (
              <form action={otherAction}>
                <input type="hidden" name="listing_id" value={listingId} />
                <input type="hidden" name="post_id" value={r.id} />
                <input type="hidden" name="what" value="remove" />
                <button type="submit" className="text-xs font-semibold text-ink-500 hover:text-red-600">
                  Remove
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ))}

      <div className="ml-12 flex flex-wrap gap-2">
        {sellerOnOpenOffer ? (
          <>
            <form action={answerAction}>
              <input type="hidden" name="listing_id" value={listingId} />
              <input type="hidden" name="post_id" value={entry.id} />
              <button name="action" value="accept" disabled={answerPending} className="h-9 px-4 rounded-lg text-sm font-bold bg-green-700 text-cream-50 hover:bg-green-800 transition disabled:opacity-60">
                Accept {euros(entry.amountCents)}
              </button>
            </form>
            <button type="button" onClick={() => setCountering(!countering)} className="h-9 px-4 rounded-lg text-sm font-bold border border-line bg-surface hover:bg-cream-50">
              Counter
            </button>
            <form action={answerAction}>
              <input type="hidden" name="listing_id" value={listingId} />
              <input type="hidden" name="post_id" value={entry.id} />
              <button name="action" value="decline" disabled={answerPending} className="h-9 px-4 rounded-lg text-sm font-bold border border-line bg-surface hover:bg-cream-50 disabled:opacity-60">
                Decline
              </button>
            </form>
          </>
        ) : null}
        {canReply && !replying ? (
          <button type="button" onClick={() => setReplying(true)} className="h-9 px-4 rounded-lg text-sm font-bold border border-line bg-surface hover:bg-cream-50">
            {isSeller && entry.kind === "question" && !entry.replies.some((r) => r.isSeller) ? "Answer" : "Reply"}
          </button>
        ) : null}
        {entry.isMine && entry.kind === "offer" && (entry.status === "open" || entry.status === "countered") ? (
          <form action={otherAction}>
            <input type="hidden" name="listing_id" value={listingId} />
            <input type="hidden" name="post_id" value={entry.id} />
            <input type="hidden" name="what" value="withdraw" />
            <button type="submit" className="h-9 px-4 rounded-lg text-sm font-bold border border-line bg-surface hover:bg-cream-50">
              Withdraw
            </button>
          </form>
        ) : null}
        {entry.isMine && entry.kind === "question" ? (
          <form action={otherAction}>
            <input type="hidden" name="listing_id" value={listingId} />
            <input type="hidden" name="post_id" value={entry.id} />
            <input type="hidden" name="what" value="remove" />
            <button type="submit" className="h-9 px-3 rounded-lg text-sm font-semibold text-ink-500 hover:text-red-600">
              Remove
            </button>
          </form>
        ) : null}
      </div>

      {countering ? (
        <form action={answerAction} className="ml-12 flex flex-wrap gap-2 items-center">
          <input type="hidden" name="listing_id" value={listingId} />
          <input type="hidden" name="post_id" value={entry.id} />
          <input type="hidden" name="action" value="counter" />
          <label className="flex items-center gap-1 h-10 px-3 rounded-lg border-2 border-gold-500 bg-surface">
            <span className="sr-only">What you&rsquo;d take</span>
            <span aria-hidden className="font-display font-bold text-navy-900">€</span>
            <input name="counter" inputMode="decimal" autoFocus className="w-24 font-display font-bold text-navy-900 outline-none bg-transparent" />
          </label>
          <button disabled={answerPending} className="h-10 px-4 rounded-lg text-sm font-bold bg-navy-900 text-gold-400 disabled:opacity-60">
            Counter publicly
          </button>
        </form>
      ) : null}

      {replying ? (
        <form action={replyAction} className="ml-12 grid gap-2">
          <input type="hidden" name="listing_id" value={listingId} />
          <input type="hidden" name="post_id" value={entry.id} />
          <label className="grid">
            <span className="sr-only">Your reply</span>
            <textarea name="text" rows={2} maxLength={500} autoFocus className="rounded-xl border border-line bg-cream-50 px-3 py-2 outline-none focus:border-green-700" />
          </label>
          <div className="flex gap-2">
            <button disabled={replyPending} className="h-9 px-4 rounded-lg text-sm font-bold bg-green-700 text-cream-50 disabled:opacity-60">
              {replyPending ? "Posting…" : "Post reply"}
            </button>
            <button type="button" onClick={() => setReplying(false)} className="h-9 px-3 rounded-lg text-sm font-semibold text-ink-500">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="ml-12 text-sm font-semibold text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
