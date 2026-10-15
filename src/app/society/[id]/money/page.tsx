import Link from "next/link";

import { ActionButton, buttonClass } from "@/components/society-console/forms";
import { Card, Empty, PageHeader, Pill, Stat, Table, Td } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { billingSeason, loadMembershipSettings, loadMoney, loadPaymentClaims, seasonLabel, type PaymentClaim } from "@/lib/society-console/data";
import { CLAIM_LABELS } from "@/lib/society-console/outing-payments";
import { irishToday, outingDateLabel } from "@/lib/society-console/outing-rules";
import { consoleHref, dayLabel, euros, positiveInt, whenLabel } from "@/lib/society-console/rules";
import { confirmClaim, rejectClaim } from "./actions";

/**
 * The treasurer's page (0144/0145), the app's Money screen on the web: a
 * season's money at a glance — what's come in, what's still owed, what went
 * back, and by which way — the payments members say they've made (confirm
 * or "not received"), membership and each event's fees. For anyone with
 * the society's "money" area; society_money() checks that too.
 */
export default async function MoneyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ season?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireConsole(id, { area: "money" });
  const { supabase: db, society } = ctx;
  const g = society.id;

  const wanted = positiveInt(sp.season);
  const asked = wanted && wanted >= 2000 && wanted <= 2100 ? wanted : null;
  const [settings, billing, money, claims] = await Promise.all([loadMembershipSettings(db, g), billingSeason(db, g), loadMoney(db, g, asked), loadPaymentClaims(db, g)]);

  // The seasons to pick from: this one (the billing season when there's
  // membership, else the one today falls in) and the three before.
  const start = settings.seasonStartMonth;
  const [y, m] = irishToday().split("-").map(Number);
  const current = settings.enabled && billing != null ? billing : m < start ? y - 1 : y;
  const seasons = [current, current - 1, current - 2, current - 3];
  if (!seasons.includes(money.season)) seasons.push(money.season);

  const ms = money.membership;
  const events = money.events ?? [];
  const methods = money.methods ?? { cash: 0, transfer: 0, card: 0 };
  const collected = (ms.enabled ? ms.collected_cents : 0) + events.reduce((s, e) => s + e.collected_cents, 0);
  const outstanding = (ms.enabled ? ms.outstanding_cents : 0) + events.reduce((s, e) => s + e.outstanding_cents, 0);
  const refunded = events.reduce((s, e) => s + (e.refunded_cents ?? 0), 0);
  const msTotal = ms.enabled ? ms.paid + ms.unpaid + ms.claimed : 0;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Payments"
        description="The season's money at a glance: what's come in, what's still owed and what went back."
        actions={
          <>
            <Link href={`${consoleHref(g, "messages")}?audience=fees_unpaid`} className={buttonClass("quiet")}>
              Remind everyone unpaid
            </Link>
            <Link href={consoleHref(g, "exports")} className={buttonClass("quiet")}>
              Accounts (CSV)
            </Link>
          </>
        }
      />

      <nav aria-label="Season" className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mr-1">Season</span>
        {seasons
          .sort((a, b) => b - a)
          .map((s) => {
            const on = s === money.season;
            return (
              <Link
                key={s}
                href={s === current ? consoleHref(g, "money") : `${consoleHref(g, "money")}?season=${s}`}
                aria-current={on ? "page" : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${on ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
              >
                {seasonLabel(s, start)}
              </Link>
            );
          })}
      </nav>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Collected" value={euros(collected)} hint={`Season ${money.season_label}`} />
        <Stat label="Outstanding" value={euros(outstanding)} hint="Still owed on open events and membership" alert={outstanding > 0} />
        <Stat label="Refunded" value={euros(refunded)} hint="Handed back to members who withdrew" />
        <Stat label="To confirm" value={claims.length} hint="Members say they've paid" alert={claims.length > 0} />
      </div>

      <Card title="By how they paid" subtitle="Revolut and bank transfers are counted together, as in the app.">
        <dl className="grid grid-cols-3 gap-3 text-center">
          {(
            [
              ["Revolut / transfer", methods.transfer],
              ["Cash", methods.cash],
              ["Card", methods.card],
            ] as const
          ).map(([label, cents]) => (
            <div key={label} className="rounded-xl bg-cream-100 px-3 py-3">
              <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">{label}</dt>
              <dd className="font-display font-bold text-xl text-ink-900 mt-0.5">{euros(cents)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-ink-500 mt-4">
          Card payments aren&apos;t switched on yet. For now members pay the society directly — by Revolut, bank transfer or cash — and the treasurer confirms it here. PinPals doesn&apos;t hold the society&apos;s money.
        </p>
      </Card>

      <Card title={`Say they've paid${claims.length ? ` · ${claims.length}` : ""}`} subtitle="Check your account or the cash tin, then confirm — or say it hasn't arrived and it shows as unpaid again.">
        {claims.length === 0 ? (
          <Empty>Nobody is waiting for a payment to be confirmed.</Empty>
        ) : (
          <ul className="divide-y divide-line -my-2">
            {claims.map((c) => (
              <ClaimRow key={`${c.kind}:${c.outingId ?? c.season ?? ""}:${c.memberId}`} claim={c} groupId={g} />
            ))}
          </ul>
        )}
      </Card>

      {ms.enabled && (
        <Card
          title="Membership"
          subtitle={`${euros(ms.fee_cents)} a year · due ${dayLabel(ms.due)}`}
          actions={
            <Link href={`${consoleHref(g, "membership")}?status=unpaid`} className="text-sm font-semibold text-green-700 hover:text-green-600">
              Who hasn&apos;t paid →
            </Link>
          }
        >
          <Bar share={msTotal > 0 ? ms.paid / msTotal : 0} label={`${ms.paid} of ${msTotal} paid`} />
          <div className="flex flex-wrap justify-between gap-2 mt-2 text-sm">
            <span className="font-semibold text-green-700">
              {ms.paid} paid · {euros(ms.collected_cents)}
            </span>
            <span className={ms.unpaid > 0 ? "font-semibold text-red-600" : "text-ink-500"}>
              {ms.unpaid} unpaid · {euros(ms.outstanding_cents)}
            </span>
          </div>
          {(ms.claimed > 0 || ms.honorary > 0 || ms.lapsed > 0) && (
            <p className="text-xs text-ink-500 mt-1">
              {[ms.claimed ? `${ms.claimed} say they've paid` : null, ms.honorary ? `${ms.honorary} honorary` : null, ms.lapsed ? `${ms.lapsed} lapsed` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </Card>
      )}

      <Card title="Events" subtitle="Each event with an entry fee this season. Guests count as entrants.">
        {events.length === 0 ? (
          <Empty>No events with a fee this season.</Empty>
        ) : (
          <Table head={["Event", "Fee", "Entrants", "Paid", "Waived", "Unpaid", "Says paid", "Collected", "Outstanding", "Refunded"]}>
            {events.map((e) => (
              <tr key={e.id}>
                <Td>
                  <Link href={consoleHref(g, `events/${e.id}`)} className="font-semibold text-ink-900 hover:text-green-700">
                    {e.title}
                  </Link>
                  <div className="text-xs text-ink-500 flex flex-wrap items-center gap-2 mt-0.5">
                    {outingDateLabel(e.plays_on)}
                    {e.status === "cancelled" ? <Pill tone="red">Cancelled</Pill> : e.played ? <Pill>Played</Pill> : <Pill tone="gold">Open</Pill>}
                  </div>
                </Td>
                <Td className="whitespace-nowrap">{euros(e.fee_cents)}</Td>
                <Td className="text-center">{e.entrants}</Td>
                <Td className="text-center">{e.paid}</Td>
                <Td className="text-center">{e.waived}</Td>
                <Td className={`text-center ${e.unpaid > 0 ? "text-red-600 font-semibold" : ""}`}>{e.unpaid}</Td>
                <Td className="text-center">{e.claimed}</Td>
                <Td className="whitespace-nowrap">{euros(e.collected_cents)}</Td>
                <Td className={`whitespace-nowrap ${e.outstanding_cents > 0 ? "text-red-600 font-semibold" : "text-green-700"}`}>{e.outstanding_cents > 0 ? euros(e.outstanding_cents) : "Settled"}</Td>
                <Td className="whitespace-nowrap">{euros(e.refunded_cents ?? 0)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function ClaimRow({ claim: c, groupId }: { claim: PaymentClaim; groupId: number }) {
  const fields = { g: groupId, kind: c.kind, member: c.memberId, method: c.method, outing: c.outingId, season: c.season };
  return (
    <li className="py-3 flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink-900">{c.name}</div>
        <div className="text-xs text-ink-500">
          {[c.kind === "membership" ? `Membership${c.season ? ` · ${c.season}` : ""}` : c.title, c.amountCents != null ? euros(c.amountCents) : null, `by ${CLAIM_LABELS[c.method]}`, whenLabel(c.claimedAt)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="flex gap-2">
        <ActionButton action={confirmClaim} fields={fields} tone="primary">
          Confirm
        </ActionButton>
        <ActionButton action={rejectClaim} fields={fields} tone="danger" confirm={`Not received? ${c.name}'s "I've paid" is taken away, and it shows as unpaid again.`}>
          Not received
        </ActionButton>
      </div>
    </li>
  );
}

function Bar({ share, label }: { share: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, share)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 rounded-full bg-red-100 overflow-hidden">
      <div className="h-2 rounded-full bg-green-600" style={{ width: `${pct}%` }} />
    </div>
  );
}
