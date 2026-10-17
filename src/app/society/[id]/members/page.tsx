import Link from "next/link";

import { ActionButton, ConsoleForm, SubmitButton } from "@/components/society-console/forms";
import { buttonClass, inputClass } from "@/components/society-console/styles";
import { Avatar, Card, Empty, PageHeader, Pill, Table, Td, type PillTone } from "@/components/society-console/ui";
import { groupInvitePath } from "@/lib/groups";
import { formatPhone, smsUrl, telUrl, whatsappUrl } from "@/lib/phone";
import { getSiteUrl } from "@/lib/site-url";
import { requireConsole } from "@/lib/society-console/access";
import { MEMBERSHIP_LABELS, loadJoinRequests, loadMembers, loadMembershipSettings, loadPendingInvites, searchGolfers, type MembershipStatus } from "@/lib/society-console/data";
import { loadContacts, loadInviteCode } from "@/lib/society-console/people-data";
import { MEMBERSHIP_FILTERS, canRemove, inviteMessage, isMembershipFilter, matchesSearch } from "@/lib/society-console/people-rules";
import { consoleHref, dayLabel, indexLabel, roleLabel, whenLabel } from "@/lib/society-console/rules";
import CopyButton from "./copy-button";
import { inviteGolfers, removeMember, resetInviteLink, reviewRequest } from "./actions";

const MEMBERSHIP_TONE: Record<MembershipStatus, PillTone> = { paid: "green", honorary: "navy", lapsed: "grey", claimed: "gold", unpaid: "red" };

type Search = { q?: string; status?: string; find?: string; contacts?: string };

/**
 * Members & requests — the app's group page (Asking to join, Members), its
 * Invite screen (the link, Find PinPals) and Phone numbers, for whoever has
 * the people area (the owner, captain and secretary).
 */
export default async function MembersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireConsole(id, { area: "people" });
  const { supabase: db, society, user } = ctx;
  const g = society.id;
  const q = (sp.q ?? "").slice(0, 80);
  const status = isMembershipFilter(sp.status) ? sp.status : "all";
  const find = (sp.find ?? "").slice(0, 80);
  const showContacts = sp.contacts === "1";

  const [members, requests, invites, settings, code, found, contacts] = await Promise.all([
    loadMembers(db, g),
    loadJoinRequests(db, g),
    loadPendingInvites(db, g),
    loadMembershipSettings(db, g),
    ctx.runs ? loadInviteCode(db, g) : Promise.resolve(null),
    find.trim().length >= 2 ? searchGolfers(db, find) : Promise.resolve([]),
    showContacts ? loadContacts(db, g) : Promise.resolve(null),
  ]);

  const me = members.find((m) => m.id === user.id);
  const myRole = me?.role ?? ctx.role;
  const membershipOn = settings.enabled;
  const counts = new Map<string, number>([["all", members.length]]);
  for (const m of members) if (m.membership) counts.set(m.membership, (counts.get(m.membership) ?? 0) + 1);
  const shown = members.filter((m) => (status === "all" || m.membership === status) && matchesSearch(q, m.name, m.homeClub));

  const inSociety = new Set(members.map((m) => m.id));
  const invited = new Set(invites.map((i) => i.memberId));
  const asked = new Set(requests.map((r) => r.memberId));
  const candidates = found.filter((p) => !inSociety.has(p.id));

  const base = consoleHref(g, "members");
  const href = (over: Partial<Search>) => {
    const next = { q: q || undefined, status: status === "all" ? undefined : status, find: find || undefined, contacts: showContacts ? "1" : undefined, ...over };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) usp.set(k, v);
    const s = usp.toString();
    return s ? `${base}?${s}` : base;
  };
  const link = code ? `${getSiteUrl()}${groupInvitePath(code)}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members & requests"
        description={`${members.length} ${members.length === 1 ? "member" : "members"}. Approve who asks to join, invite golfers, and share the society's link.`}
        actions={
          <Link href={href({ contacts: showContacts ? undefined : "1" })} className={buttonClass("quiet", "sm")}>
            {showContacts ? "Hide phone numbers" : "Phone numbers"}
          </Link>
        }
      />

      {requests.length > 0 && (
        <Card title={`Asking to join (${requests.length})`} subtitle="They get a notification when you approve them.">
          <ul className="divide-y divide-line -my-2">
            {requests.map((r) => (
              <li key={r.memberId} className="py-3 flex flex-wrap items-center gap-3">
                <Avatar name={r.name} url={r.avatarUrl} size={40} />
                <div className="min-w-0 flex-1">
                  <Link href={`/members/${r.memberId}`} className="font-semibold text-ink-900 hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-xs text-ink-500">{[r.homeClub, `asked ${whenLabel(r.askedAt)}`].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex gap-2">
                  <ActionButton action={reviewRequest} fields={{ g, m: r.memberId, approve: "1" }} tone="primary">
                    Approve
                  </ActionButton>
                  <ActionButton action={reviewRequest} fields={{ g, m: r.memberId, approve: "0" }} confirm={`Decline ${r.name}'s request?`}>
                    Decline
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {showContacts && (
        <Card title="Phone numbers" subtitle="Numbers members chose to share with this society. The people who run it see members' numbers; members see theirs.">
          {contacts === null ? (
            <Empty>Couldn&apos;t load the numbers.</Empty>
          ) : contacts.length === 0 ? (
            <Empty>No numbers shared yet. Each member chooses, in Privacy &amp; security, whether to share their mobile with this society.</Empty>
          ) : (
            <Table head={["Name", "Mobile", ""]}>
              {contacts.map((c) => (
                <tr key={c.memberId}>
                  <Td>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-ink-500">{roleLabel(c.role, c.office)}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{formatPhone(c.phone)}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <a href={telUrl(c.phone)} className={buttonClass("quiet", "sm")}>
                        Call
                      </a>
                      <a href={smsUrl(c.phone)} className={buttonClass("quiet", "sm")}>
                        Text
                      </a>
                      <a href={whatsappUrl(c.phone)} target="_blank" rel="noopener noreferrer" className={buttonClass("quiet", "sm")}>
                        WhatsApp
                      </a>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Card title={`Members (${members.length})`}>
        <form action={base} method="get" className="flex flex-wrap gap-2 mb-3">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          {showContacts && <input type="hidden" name="contacts" value="1" />}
          <input type="search" name="q" defaultValue={q} placeholder="Search members" aria-label="Search members" className={`${inputClass} max-w-xs`} />
          <button type="submit" className={buttonClass("quiet", "sm")}>
            Search
          </button>
          {q && (
            <Link href={href({ q: undefined })} className="self-center text-sm text-ink-500 hover:text-ink-900">
              Clear
            </Link>
          )}
        </form>
        {membershipOn && (
          <div className="flex flex-wrap gap-2 mb-4">
            {MEMBERSHIP_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={href({ status: f.key === "all" ? undefined : f.key })}
                aria-current={status === f.key ? "true" : undefined}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${status === f.key ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
              >
                {f.label} {counts.get(f.key) ?? 0}
              </Link>
            ))}
          </div>
        )}
        {shown.length === 0 ? (
          <Empty>{q ? "No one matches that search." : "No one here."}</Empty>
        ) : (
          <Table head={["Member", "Role", "Joined", "Own index", "Society index", ...(membershipOn ? ["Membership"] : []), ""]}>
            {shown.map((m) => (
              <tr key={m.id}>
                <Td>
                  <div className="flex items-center gap-3 min-w-[180px]">
                    <Avatar name={m.name} url={m.avatarUrl} size={34} />
                    <div className="min-w-0">
                      <Link href={`/members/${m.id}`} className="font-semibold text-ink-900 hover:underline">
                        {m.id === user.id ? `${m.name} (you)` : m.name}
                      </Link>
                      {m.homeClub && <div className="text-xs text-ink-500 truncate">{m.homeClub}</div>}
                    </div>
                  </div>
                </Td>
                <Td className="whitespace-nowrap">{m.role === "member" && !m.office ? <span className="text-ink-500">Member</span> : <Pill tone="navy">{roleLabel(m.role, m.office)}</Pill>}</Td>
                <Td className="whitespace-nowrap">{dayLabel(m.joinedAt)}</Td>
                <Td className="whitespace-nowrap tabular-nums">{indexLabel(m.ownIndex)}</Td>
                <Td className="whitespace-nowrap tabular-nums">{indexLabel(m.societyIndex)}</Td>
                {membershipOn && <Td>{m.membership ? <Pill tone={MEMBERSHIP_TONE[m.membership]}>{MEMBERSHIP_LABELS[m.membership]}</Pill> : "—"}</Td>}
                <Td className="text-right">
                  {canRemove({ id: user.id, role: myRole }, m) && (
                    <ActionButton action={removeMember} fields={{ g, m: m.id }} tone="danger" confirm={`Remove ${m.name}? They'll be taken out of ${society.name}.`}>
                      Remove
                    </ActionButton>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="text-xs text-ink-500 mt-4">
          The society&apos;s owner, captain, secretary and handicap secretary can see each member&apos;s handicap and unofficial PinPals handicap indicator, to set the handicaps the society plays off. The treasurer sees who has paid.
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {ctx.runs && (
          <Card title="Share the society's link" subtitle="Anyone who taps it joins straight away — they don't need to be connected with you.">
            {link ? (
              <div className="space-y-3">
                <input readOnly value={link} aria-label="Invite link" className={`${inputClass} font-mono text-xs`} />
                <div className="flex flex-wrap gap-2">
                  <CopyButton value={link} label="Copy link" />
                  <CopyButton value={inviteMessage(society.name, link)} label="Copy message" tone="quiet" />
                  <a href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(society.name, link))}`} target="_blank" rel="noopener noreferrer" className={buttonClass("quiet", "sm")}>
                    WhatsApp
                  </a>
                </div>
                <ActionButton action={resetInviteLink} fields={{ g }} tone="danger" confirm="Reset the invite link? The old link stops working. Anyone who already joined stays in.">
                  Reset link
                </ActionButton>
              </div>
            ) : (
              <Empty>Couldn&apos;t get the invite link.</Empty>
            )}
          </Card>
        )}

        <Card title="Find PinPals" subtitle="Search every PinPals member by name. They get an invitation to accept.">
          <form action={base} method="get" className="flex flex-wrap gap-2 mb-3">
            {q && <input type="hidden" name="q" value={q} />}
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            {showContacts && <input type="hidden" name="contacts" value="1" />}
            <input type="search" name="find" defaultValue={find} placeholder="Search all members" aria-label="Search all members" className={`${inputClass} flex-1 min-w-[160px]`} />
            <button type="submit" className={buttonClass("quiet", "sm")}>
              Search
            </button>
          </form>
          {find.trim().length >= 2 &&
            (candidates.length === 0 ? (
              <Empty>Nobody by that name — or they&apos;re already in.</Empty>
            ) : (
              <ConsoleForm action={inviteGolfers} reset>
                <input type="hidden" name="g" value={g} />
                <ul className="divide-y divide-line mb-3">
                  {candidates.map((p) => {
                    const pending = invited.has(p.id);
                    return (
                      <li key={p.id}>
                        <label className={`flex items-center gap-3 py-2 ${pending ? "opacity-60" : "cursor-pointer"}`}>
                          <input type="checkbox" name="m" value={p.id} disabled={pending} className="h-4 w-4 accent-green-700" />
                          <Avatar name={p.name} url={p.avatarUrl} size={30} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink-900">{p.name}</span>
                            {p.homeClub && <span className="block text-xs text-ink-500 truncate">{p.homeClub}</span>}
                          </span>
                          {pending ? <Pill>Invited</Pill> : asked.has(p.id) ? <Pill tone="gold">Asked to join</Pill> : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <SubmitButton pendingLabel="Inviting…">Invite</SubmitButton>
              </ConsoleForm>
            ))}

          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mt-6 mb-2">Invitations waiting ({invites.length})</h3>
          {invites.length === 0 ? (
            <p className="text-sm text-ink-500">No invitations waiting on an answer.</p>
          ) : (
            <ul className="text-sm divide-y divide-line">
              {invites.map((i) => (
                <li key={i.memberId} className="py-2 flex justify-between gap-3">
                  <span className="font-semibold text-ink-900">{i.name}</span>
                  <span className="text-ink-500 text-xs whitespace-nowrap">invited {whenLabel(i.invitedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
