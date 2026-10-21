import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ActionButton, ConsoleForm, Field, SubmitButton } from "@/components/society-console/forms";
import { buttonClass, inputClass } from "@/components/society-console/styles";
import ListSearch from "@/components/society-console/list-search";
import { Avatar, Card, Empty, PageHeader, Pill, Stat, Table, Td } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadEvent, type Guest, type QueueEntry } from "@/lib/society-console/data";
import { loadRoster } from "@/lib/society-console/events-data";
import { eventTotals } from "@/lib/society-console/events-totals";
import { countdownLabel, tripLengthLabel } from "@/lib/society-console/events-trips";
import { CLAIM_LABELS, formatIban } from "@/lib/society-console/outing-payments";
import { closesText, entriesStillOpen } from "@/lib/society-console/events-form";
import { clock, feeLabel, irishToday, isOutingDay, outingPast, PAID_LABELS } from "@/lib/society-console/outing-rules";
import { consoleHref, euros, indexLabel, positiveInt, timeLeft, whenLabel } from "@/lib/society-console/rules";
import { DateBlock, Fact, KindBadge, whenText } from "../bits";
import {
  addGuest,
  cancelEvent,
  clearClaim,
  markGuestPaid,
  markPaid,
  markRefunded,
  promoteWaiting,
  removeGuest,
  reviewRequest,
  setEntry,
  updateGuest,
} from "./actions";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });

/**
 * One event's control room — what the app's outing screen gives the
 * committee: the facts, requests, the waiting list and offers, who's in
 * with their payments, guests, withdrawals and totals.
 *
 * Opened by the events area (run the event) or the money area (the
 * treasurer marking payments, 0144); each sees only their own buttons, and
 * the database decides every click.
 */
export default async function EventPage({ params }: { params: Promise<{ id: string; outingId: string }> }) {
  const { id, outingId: rawOuting } = await params;
  const ctx = await requireConsole(id, { path: `/society/${id}/events/${rawOuting}` });
  const officer = ctx.areas.includes("events");
  const money = ctx.areas.includes("money");
  if (!officer && !money) notFound();
  const outingId = positiveInt(rawOuting);
  if (!outingId) notFound();
  const g = ctx.society.id;

  const [page, roster] = await Promise.all([loadEvent(ctx.supabase, g, outingId), loadRoster(ctx.supabase, g)]);
  if (!page) notFound();
  const { outing: o, entries, guests, payments, claims, guestPayments, queue, choices, withdrawals } = page;

  const today = irishToday();
  const trip = o.kind !== "day" && !!o.endsOn;
  const cancelled = o.status === "cancelled";
  const started = o.matchDayId != null;
  const past = outingPast(o.endsOn ?? o.playsOn);
  const open = !cancelled && !started && entriesStillOpen(o.playsOn, o.entriesCloseAt);
  const fee = (o.entryFeeCents ?? 0) > 0 || (o.guestFeeCents ?? 0) > 0;
  const live = !cancelled && !started;
  const inCount = entries.length + guests.length;
  const full = o.maxEntries != null && inCount >= o.maxEntries;
  const requests = queue.filter((q) => q.status === "requested");
  const waiting = queue.filter((q) => q.status !== "requested");
  const nameOf = new Map(roster.map((r) => [r.id, r.name]));
  const notIn = roster.filter((r) => !entries.some((e) => e.memberId === r.id) && !queue.some((q) => q.memberId === r.id));
  const totals = eventTotals({
    entryFeeCents: o.entryFeeCents,
    guestFeeCents: o.guestFeeCents,
    mealOptions: o.mealOptions,
    entrants: entries.map((e) => e.memberId),
    guests: guests.map((x) => x.id),
    payments,
    guestPayments,
    claims,
    choices,
  });
  const base = { g, outing: o.id };

  const asked = (memberId: string, extra?: { guestName: string | null; guestIndex: number | null }) => {
    const c = choices.get(memberId);
    return [
      extra?.guestName ? `With a guest: ${extra.guestName}${extra.guestIndex != null ? ` (${indexLabel(extra.guestIndex)})` : ""}` : null,
      c?.meal ? `Meal: ${c.meal}` : null,
      c?.guestMeal ? `Guest's meal: ${c.guestMeal}` : null,
      c?.playWith ? `Play with: ${nameOf.get(c.playWith) ?? "a member"}` : null,
      c?.teePref ? `${c.teePref === "early" ? "Early" : "Late"} tee time` : null,
    ].filter(Boolean) as string[];
  };

  const status = cancelled
    ? "This event was cancelled"
    : started
      ? "The round is under way"
      : past
        ? "Played"
        : open
          ? closesText(o.playsOn, o.entriesCloseAt)
          : "Entries closed";

  const sections: { id: string; label: string; count?: number; show: boolean }[] = [
    { id: "requests", label: "Requests", count: requests.length, show: officer && !cancelled && requests.length > 0 },
    { id: "waiting", label: "Waiting list", count: waiting.length, show: officer && !cancelled && waiting.length > 0 },
    { id: "entrants", label: "Who's in", count: entries.length, show: true },
    { id: "guests", label: "Guests", count: guests.length, show: guests.length > 0 || (officer && live) },
    { id: "withdrawals", label: "Withdrew", count: withdrawals.length, show: withdrawals.length > 0 },
    { id: "totals", label: "Totals", show: true },
  ];

  return (
    <div>
      <PageHeader
        title={<span className={cancelled ? "line-through text-ink-500" : undefined}>{o.title}</span>}
        back={{ href: consoleHref(g, "events"), label: "Events" }}
        actions={
          officer && live ? (
            <>
              {!trip && !past && (
                <Link href={consoleHref(g, `live/${o.id}`)} className={buttonClass(isOutingDay(o.playsOn) ? "gold" : "quiet")}>
                  {isOutingDay(o.playsOn) ? "Live day · start the round" : "Live day"}
                </Link>
              )}
              {!trip && !past && (
                <Link href={consoleHref(g, `events/${o.id}/draw`)} className={buttonClass("navy")}>
                  {o.drawPublishedAt ? "Change the draw" : "Make the draw"}
                </Link>
              )}
              {trip && (
                <Link href={consoleHref(g, `events/${o.id}/itinerary`)} className={buttonClass("navy")}>
                  Itinerary · build and edit
                </Link>
              )}
              <Link href={consoleHref(g, `events/${o.id}/edit`)} className={buttonClass("quiet")}>
                Edit
              </Link>
              <ActionButton action={cancelEvent} fields={base} tone="danger" size="md" confirm={`Cancel ${o.title}? It stays in the list marked as cancelled, and nobody can join it.`}>
                Cancel event
              </ActionButton>
            </>
          ) : trip ? (
            <Link href={consoleHref(g, `events/${o.id}/itinerary`)} className={buttonClass("quiet")}>
              Itinerary
            </Link>
          ) : officer && started ? (
            <Link href={consoleHref(g, `live/${o.id}`)} className={buttonClass("gold")}>
              Live control room
            </Link>
          ) : undefined
        }
      />

      {/* The facts */}
      <Card className="mb-5">
        <div className="flex gap-4 items-start">
          <DateBlock date={o.playsOn} trip={trip} cancelled={cancelled} />
          <div className="min-w-0 flex-1 grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={o.kind} playsOn={o.playsOn} endsOn={o.endsOn} />
              <Pill tone={o.entryMode === "request" ? "gold" : "grey"}>{o.entryMode === "request" ? "Request a place" : "Join straight away"}</Pill>
              {cancelled && <Pill tone="red">Cancelled</Pill>}
              {!trip && o.drawPublishedAt && <Pill tone="green">Draw out</Pill>}
              {full && !cancelled && <Pill tone="grey">Full</Pill>}
              <span className="text-sm text-ink-500">{status}</span>
            </div>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              <Fact label="When">{whenText(o.kind, o.playsOn, o.endsOn)}</Fact>
              {trip ? <Fact label="Where">{o.location || "—"}</Fact> : <Fact label="Course">{o.courseName || "—"}</Fact>}
              {trip && o.endsOn ? <Fact label="Length">{`${tripLengthLabel(o.playsOn, o.endsOn)}${!cancelled && !past ? ` · ${countdownLabel(o.playsOn, o.endsOn, today)}` : ""}`}</Fact> : null}
              {!trip && <Fact label="First tee">{clock(o.firstTee) ?? "—"}</Fact>}
              {!trip && o.arriveBy && <Fact label="Arrive by">{clock(o.arriveBy)}</Fact>}
              <Fact label={trip ? "Cost" : "Entry"}>{feeLabel(o.entryFeeCents) ?? "—"}</Fact>
              <Fact label="Places">{`${inCount}${o.maxEntries ? ` of ${o.maxEntries}` : ""} ${trip ? "going" : "in"}`}</Fact>
              <Fact label="Waiting list">{o.waitingList ? (o.autoOffer ? "On · offered automatically" : "On · you offer places") : "Off"}</Fact>
              <Fact label="Guests">{o.guestsAllowed ? (o.guestFeeCents != null ? `Allowed · ${feeLabel(o.guestFeeCents)}` : "Allowed") : "Not allowed"}</Fact>
              {o.formatLabel && <Fact label="Format">{o.formatLabel}</Fact>}
              {o.dressCode && <Fact label="Dress">{o.dressCode}</Fact>}
              {o.mealOptions.length > 0 && <Fact label="Meals">{o.mealOptions.join(", ")}</Fact>}
            </div>
            {o.details && <p className="text-sm text-ink-900 whitespace-pre-line">{o.details}</p>}
            {money && (o.payRevtag || o.payIban || o.payNote) && (
              <div className="rounded-xl bg-cream-100 px-4 py-3 text-sm text-ink-900 grid gap-0.5">
                <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">How members pay</div>
                {o.payRevtag && <div>Revolut @{o.payRevtag}</div>}
                {o.payIban && <div>{`IBAN ${formatIban(o.payIban)}${o.payAccountName ? ` · ${o.payAccountName}` : ""}`}</div>}
                <div>{o.payCash ? "Cash is fine" : "No cash"}</div>
                {o.payNote && <div className="text-ink-500">{o.payNote}</div>}
              </div>
            )}
            {officer && started && (
              <p className="text-sm text-ink-500">
                The round has started — scores, entries and the draw are now in the round.{" "}
                <Link href={consoleHref(g, `live/${o.id}`)} className="font-semibold text-green-700">
                  Open the control room
                </Link>
              </p>
            )}
          </div>
        </div>
      </Card>

      <nav className="flex flex-wrap gap-2 mb-5" aria-label="On this page">
        {sections
          .filter((s) => s.show)
          .map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full px-4 py-1.5 text-sm font-semibold bg-surface border border-line text-ink-900 hover:bg-cream-100">
              {s.label}
              {s.count ? <span className="ml-1.5 rounded-full bg-gold-500 text-navy-900 px-1.5 text-[11px]">{s.count}</span> : null}
            </a>
          ))}
      </nav>

      <div className="grid gap-5">
        {/* Requests (0142) */}
        {officer && !cancelled && requests.length > 0 && (
          <Section id="requests" title={`Asking for a place (${requests.length})`} subtitle={full ? `The event is full${o.maxEntries ? ` (${inCount} of ${o.maxEntries})` : ""}. Put people on the waiting list, or add places in Edit.` : undefined}>
            <ul className="divide-y divide-line -my-3">
              {requests.map((q) => (
                <QueueRow key={q.id} q={q} lines={asked(q.memberId, q)} note={choices.get(q.memberId)?.note ?? null}>
                  <ActionButton action={reviewRequest} fields={{ ...base, member: q.memberId, decision: "approve" }} tone="primary">
                    {q.guestName ? "Approve both" : "Approve"}
                  </ActionButton>
                  {q.guestName && (
                    <ActionButton action={reviewRequest} fields={{ ...base, member: q.memberId, decision: "member_only" }}>
                      Member only
                    </ActionButton>
                  )}
                  <ActionButton action={reviewRequest} fields={{ ...base, member: q.memberId, decision: "waiting" }} tone="gold">
                    Waiting list
                  </ActionButton>
                  <ActionButton action={reviewRequest} fields={{ ...base, member: q.memberId, decision: "decline" }} tone="danger" confirm={`Decline ${q.name}'s request?`}>
                    Decline
                  </ActionButton>
                </QueueRow>
              ))}
            </ul>
          </Section>
        )}

        {/* Waiting list and offers */}
        {officer && !cancelled && waiting.length > 0 && (
          <Section
            id="waiting"
            title={`Waiting list (${waiting.length})`}
            subtitle={o.autoOffer ? "When someone withdraws, the place is offered to the first in line, who has 24 hours to take it." : "Places aren't offered automatically on this event — give someone a place here."}
          >
            <ul className="divide-y divide-line -my-3">
              {waiting.map((q, i) => (
                <QueueRow
                  key={q.id}
                  q={q}
                  line={i + 1}
                  lines={asked(q.memberId, q)}
                  note={choices.get(q.memberId)?.note ?? null}
                  badge={q.status === "offered" ? <Pill tone="gold">{`Offered · ${timeLeft(q.offerExpiresAt) ?? "24 hours"}`}</Pill> : <Pill tone="grey">Waiting</Pill>}
                >
                  {live && (
                    <ActionButton action={promoteWaiting} fields={{ ...base, member: q.memberId }} tone="gold">
                      Give them a place
                    </ActionButton>
                  )}
                  {live && q.guestName && (
                    <ActionButton action={reviewRequest} fields={{ ...base, member: q.memberId, decision: "member_only" }}>
                      Place for them, not the guest
                    </ActionButton>
                  )}
                  <ActionButton action={reviewRequest} fields={{ ...base, member: q.memberId, decision: "decline" }} tone="danger" confirm={`Take ${q.name} off the waiting list?`}>
                    Take off the list
                  </ActionButton>
                </QueueRow>
              ))}
            </ul>
          </Section>
        )}

        {/* Who's in */}
        <Section
          id="entrants"
          title={`Who's in (${entries.length}${guests.length ? ` + ${guests.length} guest${guests.length === 1 ? "" : "s"}` : ""})`}
          subtitle={money && fee ? `${totals.paid + totals.waived} of ${inCount} paid or waived${totals.claims ? ` · ${totals.claims} say they've paid` : ""}` : undefined}
        >
          {entries.length === 0 ? (
            <Empty>Nobody yet.</Empty>
          ) : (
            <div id="entrants-list">
              {entries.length > 8 && <ListSearch target="entrants-list" placeholder={money && fee ? "Search by name, club, group or unpaid" : "Search by name, club or group"} />}
              <Table head={["Member", "Entered", trip ? null : "Tee", officer ? "Asked for" : null, money && fee ? "Payment" : null, ""].filter((h) => h !== null)}>
              {entries.map((e) => {
                const paid = payments.get(e.memberId);
                const claim = paid ? undefined : claims.get(e.memberId);
                const lines = asked(e.memberId);
                const note = choices.get(e.memberId)?.note;
                const search = [
                  e.name,
                  e.homeClub,
                  e.teeGroup ? `group ${e.teeGroup}` : "no group",
                  clock(e.teeTime),
                  money && fee ? (paid ? `paid ${PAID_LABELS[paid]}` : claim ? "says paid" : "unpaid") : null,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={e.memberId} data-search={search}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={e.name} url={e.avatarUrl} />
                        <div className="min-w-0">
                          <div className="font-semibold text-ink-900">{e.name}</div>
                          {e.homeClub && <div className="text-xs text-ink-500">{e.homeClub}</div>}
                        </div>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-500">{whenLabel(e.enteredAt)}</Td>
                    {!trip && <Td className="whitespace-nowrap">{e.teeGroup ? `Group ${e.teeGroup}${e.teeTime ? ` · ${clock(e.teeTime)}` : ""}` : <span className="text-ink-500">—</span>}</Td>}
                    {officer && (
                      <Td className="text-xs text-ink-500 min-w-[10rem]">
                        {lines.length || note ? (
                          <>
                            {lines.map((l) => (
                              <div key={l}>{l}</div>
                            ))}
                            {note && <div className="italic">“{note}”</div>}
                          </>
                        ) : (
                          "—"
                        )}
                      </Td>
                    )}
                    {money && fee && (
                      <Td className="min-w-[13rem]">
                        <div className="mb-1.5">
                          {paid ? (
                            <Pill tone={paid === "waived" ? "grey" : "green"}>{PAID_LABELS[paid]}</Pill>
                          ) : claim ? (
                            <Pill tone="navy">{`Says paid by ${CLAIM_LABELS[claim]}`}</Pill>
                          ) : (
                            <Pill tone="red">{`Unpaid · ${feeLabel(o.entryFeeCents)}`}</Pill>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {claim ? (
                            <>
                              <ActionButton action={markPaid} fields={{ ...base, member: e.memberId, status: claim === "cash" ? "cash" : "transfer" }} tone="primary">
                                Confirm received
                              </ActionButton>
                              <ActionButton action={clearClaim} fields={{ ...base, member: e.memberId }} confirm={`Clear ${e.name}'s "I've paid"? They'll show as unpaid again.`}>
                                Not received
                              </ActionButton>
                            </>
                          ) : paid === "card" ? null : (
                            <>
                              {paid !== "cash" && (
                                <ActionButton action={markPaid} fields={{ ...base, member: e.memberId, status: "cash" }}>
                                  Cash
                                </ActionButton>
                              )}
                              {paid !== "transfer" && (
                                <ActionButton action={markPaid} fields={{ ...base, member: e.memberId, status: "transfer" }}>
                                  Transfer
                                </ActionButton>
                              )}
                              {paid !== "waived" && (
                                <ActionButton action={markPaid} fields={{ ...base, member: e.memberId, status: "waived" }}>
                                  Waive
                                </ActionButton>
                              )}
                              {paid && (
                                <ActionButton action={markPaid} fields={{ ...base, member: e.memberId, status: "none" }} tone="danger">
                                  Not paid
                                </ActionButton>
                              )}
                            </>
                          )}
                        </div>
                      </Td>
                    )}
                    <Td className="text-right">
                      {officer && live && (
                        <ActionButton action={setEntry} fields={{ ...base, member: e.memberId, in: "0" }} tone="danger" confirm={`Take ${e.name} off ${o.title}? Their place goes to the next person on the waiting list, if there is one.`}>
                          Take off
                        </ActionButton>
                      )}
                    </Td>
                  </tr>
                );
              })}
              </Table>
            </div>
          )}
          {officer && live && (
            <div className="mt-5 pt-5 border-t border-line">
              {notIn.length === 0 ? (
                <p className="text-sm text-ink-500">Everyone in the society is in (or asking).</p>
              ) : (
                <ConsoleForm action={setEntry} reset className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="g" value={g} />
                  <input type="hidden" name="outing" value={o.id} />
                  <input type="hidden" name="in" value="1" />
                  <div className="flex-1 min-w-[14rem]">
                    <Field label="Add a member">
                      <select name="member" required className={inputClass} defaultValue="">
                        <option value="" disabled>
                          Choose a member…
                        </option>
                        {notIn.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <SubmitButton pendingLabel="Adding…">Add to the event</SubmitButton>
                </ConsoleForm>
              )}
              <p className="text-xs text-ink-500 mt-2">Officers can add people any time before the round starts, even when entries have closed or it&apos;s full.</p>
            </div>
          )}
        </Section>

        {/* Guests (0131) */}
        {(guests.length > 0 || (officer && live)) && (
          <Section id="guests" title={`Guests (${guests.length})`} subtitle="People who aren't on PinPals. They take a place and go in the draw like anyone else.">
            {guests.length === 0 ? (
              <Empty>No guests.</Empty>
            ) : (
              <ul className="divide-y divide-line -my-3">
                {guests.map((x) => (
                  <GuestRow key={x.id} guest={x} paid={guestPayments.get(x.id)} base={base} officer={officer && live} money={money && fee} feeText={feeLabel(o.guestFeeCents ?? o.entryFeeCents)} trip={trip} />
                ))}
              </ul>
            )}
            {officer && live && (
              <div className="mt-5 pt-5 border-t border-line">
                <ConsoleForm action={addGuest} reset className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="g" value={g} />
                  <input type="hidden" name="outing" value={o.id} />
                  <div className="flex-1 min-w-[12rem]">
                    <Field label="Add a guest">
                      <input name="name" required maxLength={60} placeholder="Guest's name" className={inputClass} />
                    </Field>
                  </div>
                  <div className="w-28">
                    <Field label="Index">
                      <input name="index" maxLength={5} placeholder="e.g. 14.2" className={inputClass} />
                    </Field>
                  </div>
                  <SubmitButton pendingLabel="Adding…">Add guest</SubmitButton>
                </ConsoleForm>
              </div>
            )}
          </Section>
        )}

        {/* Withdrawals */}
        {withdrawals.length > 0 && (
          <Section id="withdrawals" title={`Withdrew (${withdrawals.length})`}>
            <ul className="divide-y divide-line -my-3">
              {withdrawals.map((w) => {
                const p = payments.get(w.memberId);
                const back = entries.some((e) => e.memberId === w.memberId);
                return (
                  <li key={w.id} className="py-3 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-ink-900">{w.name}</div>
                      <div className="text-xs text-ink-500">{`Withdrew ${shortDate(w.at)}${back ? " · back in since" : ""}`}</div>
                    </div>
                    {money && p && <Pill tone={p === "refunded" ? "grey" : "gold"}>{p === "refunded" ? "Refunded" : `${PAID_LABELS[p]} · not refunded`}</Pill>}
                    {money && !back && p && p !== "waived" && p !== "card" && (
                      <ActionButton action={markRefunded} fields={{ ...base, member: w.memberId, refunded: p === "refunded" ? "0" : "1" }}>
                        {p === "refunded" ? "Undo refund" : "Mark refunded"}
                      </ActionButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {/* Totals */}
        <Section id="totals" title="Totals">
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Entrants" value={totals.entrants} hint={o.maxEntries ? `${inCount} of ${o.maxEntries} places used` : undefined} />
            <Stat label="Guests" value={totals.guests} />
            {money && fee && <Stat label="Collected" value={euros(totals.collectedCents)} hint={`${totals.paid} paid · ${totals.waived} waived`} />}
            {money && fee && <Stat label="Outstanding" value={euros(totals.outstandingCents)} hint={`${totals.unpaid} unpaid${totals.claims ? ` · ${totals.claims} say paid` : ""}`} alert={totals.outstandingCents > 0} />}
            {officer && <Stat label="Requests" value={requests.length} hint={`${waiting.length} on the waiting list`} />}
          </div>
          {o.mealOptions.length > 0 && (
            <div className="mt-5">
              <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-2">Meals</h3>
              <div className="flex flex-wrap gap-2">
                {totals.meals.map((m) => (
                  <span key={m.meal} className="rounded-full bg-cream-100 px-3 py-1 text-sm text-ink-900">
                    {m.meal} <strong>{m.count}</strong>
                  </span>
                ))}
                {totals.noMeal > 0 && <span className="rounded-full bg-red-100 text-red-600 px-3 py-1 text-sm">{`${totals.noMeal} not chosen`}</span>}
              </div>
            </div>
          )}
          {!trip && !cancelled && isOutingDay(o.playsOn) && officer && !started && (
            <p className="text-sm text-ink-500 mt-4">
              It&apos;s the day: check the draw, then{" "}
              <Link href={consoleHref(g, `live/${o.id}`)} className="font-semibold text-green-700">
                start the round from the Live day
              </Link>{" "}
              (or from the app, From a group) to choose the tees and score live.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      <Card title={title} subtitle={subtitle}>
        {children}
      </Card>
    </div>
  );
}

function QueueRow({ q, line, lines, note, badge, children }: { q: QueueEntry; line?: number; lines: string[]; note: string | null; badge?: ReactNode; children: ReactNode }) {
  return (
    <li className="py-3 flex flex-wrap items-start gap-3">
      <Avatar name={q.name} url={q.avatarUrl} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-900">{line ? `${line}. ${q.name}` : q.name}</span>
          {badge}
          <span className="text-xs text-ink-500">Asked {shortDate(q.askedAt)}</span>
        </div>
        {lines.map((l) => (
          <div key={l} className="text-xs text-ink-500">
            {l}
          </div>
        ))}
        {note && <div className="text-xs text-ink-900 italic mt-0.5">“{note}”</div>}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </li>
  );
}

function GuestRow({
  guest,
  paid,
  base,
  officer,
  money,
  feeText,
  trip,
}: {
  guest: Guest;
  paid: "cash" | "transfer" | "waived" | "refunded" | undefined;
  base: { g: number; outing: number };
  officer: boolean;
  money: boolean;
  feeText: string | null;
  trip: boolean;
}) {
  const fields = { ...base, guest: guest.id };
  return (
    <li className="py-3 grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="h-9 w-9 rounded-full bg-cream-100 text-navy-900 inline-flex items-center justify-center text-xs font-bold shrink-0">G</span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink-900">{guest.name}</div>
          <div className="text-xs text-ink-500">
            {[guest.handicapIndex != null ? `Guest · index ${indexLabel(guest.handicapIndex)}` : "Guest", !trip && guest.teeGroup ? `Group ${guest.teeGroup}${guest.teeTime ? ` · ${clock(guest.teeTime)}` : ""}` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        {money && (paid ? <Pill tone={paid === "waived" ? "grey" : "green"}>{PAID_LABELS[paid]}</Pill> : <Pill tone="red">{`Unpaid${feeText ? ` · ${feeText}` : ""}`}</Pill>)}
        <div className="flex flex-wrap gap-1.5">
          {money && paid !== "cash" && (
            <ActionButton action={markGuestPaid} fields={{ ...fields, status: "cash" }}>
              Cash
            </ActionButton>
          )}
          {money && paid !== "transfer" && (
            <ActionButton action={markGuestPaid} fields={{ ...fields, status: "transfer" }}>
              Transfer
            </ActionButton>
          )}
          {money && paid !== "waived" && (
            <ActionButton action={markGuestPaid} fields={{ ...fields, status: "waived" }}>
              Waive
            </ActionButton>
          )}
          {money && paid && (
            <ActionButton action={markGuestPaid} fields={{ ...fields, status: "none" }} tone="danger">
              Not paid
            </ActionButton>
          )}
          {officer && (
            <ActionButton action={removeGuest} fields={fields} tone="danger" confirm={`Take ${guest.name} off the event?`}>
              Remove
            </ActionButton>
          )}
        </div>
      </div>
      {officer && (
        <details className="ml-12">
          <summary className="text-xs font-semibold text-green-700 cursor-pointer">Change name or index</summary>
          <ConsoleForm action={updateGuest} className="flex flex-wrap items-end gap-2 mt-2">
            <input type="hidden" name="g" value={base.g} />
            <input type="hidden" name="outing" value={base.outing} />
            <input type="hidden" name="guest" value={guest.id} />
            <div className="flex-1 min-w-[12rem]">
              <Field label="Name">
                <input name="name" required maxLength={60} defaultValue={guest.name} className={inputClass} />
              </Field>
            </div>
            <div className="w-28">
              <Field label="Index">
                <input name="index" maxLength={5} defaultValue={guest.handicapIndex != null ? indexLabel(guest.handicapIndex) : ""} className={inputClass} />
              </Field>
            </div>
            <SubmitButton size="sm">Save</SubmitButton>
          </ConsoleForm>
        </details>
      )}
    </li>
  );
}
