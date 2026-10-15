import Link from "next/link";

import { ActionButton, ConsoleForm, Field, SubmitButton, Toggle } from "@/components/society-console/forms";
import { inputClass } from "@/components/society-console/styles";
import { Avatar, Card, Empty, PageHeader, Pill, Table, Td, type PillTone } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { billingSeason, loadMembers, loadMembershipSettings, MEMBERSHIP_LABELS, seasonLabel, type MembershipSettings, type MembershipStatus } from "@/lib/society-console/data";
import { DUE_DAYS, UNPAID_POLICIES, dueSentence, feeInput } from "@/lib/society-console/membership-form";
import { formatIban } from "@/lib/society-console/outing-payments";
import { consoleHref, euros, monthName, roleLabel } from "@/lib/society-console/rules";
import { markMembership, remindMembership, saveMembershipSettings } from "./actions";

/**
 * Annual membership (0144), the app's membership-settings screen and the
 * membership half of its members list on one page: whether the society
 * charges a yearly fee, how much, when, what happens to someone who hasn't
 * paid and how members pay the treasurer; then every member's standing for
 * the billing season, to mark paid, honorary or lapsed, or remind.
 *
 * Anyone with the "money" area sees it; only the owner, captain or
 * secretary may change the settings (save_membership_settings).
 */

const FILTERS: { key: "all" | MembershipStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: MEMBERSHIP_LABELS.paid },
  { key: "unpaid", label: MEMBERSHIP_LABELS.unpaid },
  { key: "claimed", label: MEMBERSHIP_LABELS.claimed },
  { key: "honorary", label: MEMBERSHIP_LABELS.honorary },
  { key: "lapsed", label: MEMBERSHIP_LABELS.lapsed },
];

const TONE: Record<MembershipStatus, PillTone> = { paid: "green", honorary: "navy", lapsed: "grey", claimed: "gold", unpaid: "red" };

export default async function MembershipPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireConsole(id, { area: "money" });
  const { supabase: db, society, runs } = ctx;
  const g = society.id;

  const [settings, season] = await Promise.all([loadMembershipSettings(db, g), billingSeason(db, g)]);
  const on = settings.enabled && season != null;
  const members = on ? await loadMembers(db, g) : [];

  const filter = FILTERS.find((f) => f.key === sp.status)?.key ?? "all";
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, f.key === "all" ? members.length : members.filter((m) => m.membership === f.key).length])) as Record<(typeof FILTERS)[number]["key"], number>;
  const shown = members.filter((m) => filter === "all" || m.membership === filter);
  const href = (k: string) => (k === "all" ? consoleHref(g, "membership") : `${consoleHref(g, "membership")}?status=${k}`);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Annual membership"
        description={
          on
            ? `Membership for ${seasonLabel(season, settings.seasonStartMonth)} · ${counts.paid + counts.honorary} of ${counts.all} paid up or honorary.`
            : "This society charges per event only. Turn annual membership on to charge a yearly fee."
        }
      />

      {on && (
        <Card title={`Members · ${seasonLabel(season, settings.seasonStartMonth)}`} subtitle={`${euros(settings.feeCents)} a year · ${dueSentence(settings.dueAfterDays, monthName(settings.seasonStartMonth))}`}>
          <nav aria-label="Filter by membership" className="flex flex-wrap gap-2 mb-4">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href(f.key)}
                aria-current={f.key === filter ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${f.key === filter ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
              >
                {f.label} {counts[f.key]}
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <Empty>Nobody here.</Empty>
          ) : (
            <Table head={["Member", "Status", "Mark"]}>
              {shown.map((m) => {
                const status = m.membership ?? "unpaid";
                const base = { g, member: m.id, season };
                return (
                  <tr key={m.id}>
                    <Td>
                      <div className="flex items-center gap-3 min-w-[12rem]">
                        <Avatar name={m.name} url={m.avatarUrl} />
                        <div className="min-w-0">
                          <div className="font-semibold text-ink-900">{m.name}</div>
                          <div className="text-xs text-ink-500">{roleLabel(m.role, m.office)}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Pill tone={TONE[status]}>{MEMBERSHIP_LABELS[status]}</Pill>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1.5 min-w-[22rem]">
                        {status !== "paid" && (
                          <>
                            <ActionButton action={markMembership} fields={{ ...base, mark: "paid_cash" }} tone="primary">
                              Paid — cash
                            </ActionButton>
                            <ActionButton action={markMembership} fields={{ ...base, mark: "paid_transfer" }} tone="primary">
                              Paid — transfer
                            </ActionButton>
                          </>
                        )}
                        {status !== "honorary" && (
                          <ActionButton action={markMembership} fields={{ ...base, mark: "honorary" }}>
                            Honorary
                          </ActionButton>
                        )}
                        {status !== "lapsed" && (
                          <ActionButton action={markMembership} fields={{ ...base, mark: "lapsed" }}>
                            Lapsed
                          </ActionButton>
                        )}
                        {(status === "paid" || status === "honorary" || status === "lapsed") && (
                          <ActionButton action={markMembership} fields={{ ...base, mark: "clear" }} tone="danger" confirm={`Clear ${m.name}'s membership for ${seasonLabel(season, settings.seasonStartMonth)}? They'll show as unpaid.`}>
                            Clear
                          </ActionButton>
                        )}
                        {status === "unpaid" && (
                          <ActionButton action={remindMembership} fields={{ g, member: m.id }} tone="gold">
                            Remind to pay
                          </ActionButton>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
          <p className="text-xs text-ink-500 mt-4">
            &ldquo;Says paid&rdquo; means the member pressed &ldquo;I&apos;ve paid&rdquo; in the app. Confirm it from{" "}
            <Link href={consoleHref(g, "money")} className="font-semibold text-green-700 hover:text-green-600">
              Payments
            </Link>{" "}
            once the money has arrived, or mark them paid here.
          </p>
        </Card>
      )}

      {runs ? <SettingsForm groupId={g} s={settings} /> : <SettingsSummary s={settings} />}
    </div>
  );
}

function SettingsForm({ groupId, s }: { groupId: number; s: MembershipSettings }) {
  return (
    <Card title="Membership settings" subtitle="The owner, captain and secretary can change these.">
      <ConsoleForm action={saveMembershipSettings} className="grid gap-6">
        <input type="hidden" name="g" value={groupId} />
        <Toggle name="enabled" label="Annual membership" hint="Turn off if members only pay per event" defaultChecked={s.enabled} />

        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="font-display font-bold text-ink-900 mb-2 sm:col-span-3">The fee</legend>
          <Field label="Annual fee (€)">
            <input name="fee" inputMode="decimal" defaultValue={feeInput(s.feeCents)} placeholder="80" maxLength={7} className={inputClass} />
          </Field>
          <Field label="Season starts">
            <select name="startMonth" defaultValue={String(s.seasonStartMonth)} className={inputClass}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  {monthName(i + 1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due after" hint="From 1st of the month the season starts.">
            <select name="dueAfter" defaultValue={String((DUE_DAYS as readonly number[]).includes(s.dueAfterDays) ? s.dueAfterDays : 30)} className={inputClass}>
              {DUE_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? "Straight away" : `${d} days`}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="font-display font-bold text-ink-900 mb-2">If someone hasn&apos;t paid</legend>
          {UNPAID_POLICIES.map((p) => (
            <label key={p.value} className="flex items-center gap-3 cursor-pointer text-sm text-ink-900">
              <input type="radio" name="policy" value={p.value} defaultChecked={s.unpaidPolicy === p.value} className="h-4 w-4 accent-green-700" />
              {p.label}
            </label>
          ))}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="font-display font-bold text-ink-900 mb-1 sm:col-span-2">How members pay</legend>
          <p className="text-xs text-ink-500 sm:col-span-2 -mt-2">PinPals never handles the money — members pay the treasurer directly.</p>
          <Field label="Revolut @name">
            <input name="revtag" defaultValue={s.payRevtag ?? ""} placeholder="@yoursociety" maxLength={41} autoCapitalize="none" autoCorrect="off" className={inputClass} />
          </Field>
          <Field label="IBAN">
            <input name="iban" defaultValue={s.payIban ? formatIban(s.payIban) : ""} placeholder="IE29 AIBK 9311 5212 3456 78" maxLength={42} autoCapitalize="characters" autoCorrect="off" className={inputClass} />
          </Field>
          <Field label="Account name" hint="Needed with an IBAN — members' banks check it.">
            <input name="accountName" defaultValue={s.payAccountName ?? ""} placeholder="Name on the account" maxLength={70} className={inputClass} />
          </Field>
          <div className="flex items-end pb-2">
            <Toggle name="cash" label="Cash is fine" defaultChecked={s.payCash} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Note to members">
              <textarea name="note" defaultValue={s.payNote ?? ""} placeholder="e.g. Pay by the AGM in January" maxLength={200} rows={2} className={inputClass} />
            </Field>
          </div>
        </fieldset>

        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ConsoleForm>
    </Card>
  );
}

function SettingsSummary({ s }: { s: MembershipSettings }) {
  return (
    <Card title="Membership settings" subtitle="Only the owner, captain or secretary can change these.">
      {!s.enabled ? (
        <Empty>Annual membership is off.</Empty>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <Row label="Annual fee" value={euros(s.feeCents)} />
          <Row label="Season starts" value={`1 ${monthName(s.seasonStartMonth)}`} />
          <Row label="Due" value={dueSentence(s.dueAfterDays, monthName(s.seasonStartMonth))} />
          <Row label="If someone hasn't paid" value={UNPAID_POLICIES.find((p) => p.value === s.unpaidPolicy)?.label ?? "—"} />
          <Row label="Revolut" value={s.payRevtag ? `@${s.payRevtag}` : "—"} />
          <Row label="Bank" value={s.payIban ? `${formatIban(s.payIban)}${s.payAccountName ? ` · ${s.payAccountName}` : ""}` : "—"} />
          <Row label="Cash" value={s.payCash ? "Cash is fine" : "No cash"} />
          {s.payNote && <Row label="Note to members" value={s.payNote} />}
        </dl>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">{label}</dt>
      <dd className="text-ink-900">{value}</dd>
    </div>
  );
}

