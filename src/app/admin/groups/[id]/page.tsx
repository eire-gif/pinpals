import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { GROUP_KIND_LABELS, GROUP_PRIVACY_LABELS, OUTING_KIND_LABELS, getGroupDetail } from "@/lib/admin/admin-lists";
import { formatDateTime } from "@/lib/admin/format";
import { rowActionProps } from "@/lib/admin/controls";
import AdminPageHeader from "@/components/admin/page-header";
import RecordPanel from "@/components/admin/controls/record-panel";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { Pill } from "@/components/admin/table";
import { nameOf, shortDate } from "../tabs";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Officer", member: "Member" };

export default async function AdminGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { staff } = await requireStaff();
  const { id } = await params;
  const groupId = Number.parseInt(id, 10);
  if (!Number.isFinite(groupId) || groupId <= 0) notFound();

  const group = await getGroupDetail(groupId);
  if (!group) notFound();

  return (
    <div>
      <AdminPageHeader
        eyebrow={<Link href="/admin/groups">← All groups</Link>}
        title={group.name}
        description={
          <>
            {GROUP_KIND_LABELS[group.kind] ?? group.kind} · {group.member_count} {group.member_count === 1 ? "member" : "members"} ·{" "}
            {GROUP_PRIVACY_LABELS[group.privacy] ?? group.privacy}
            {group.club_name ? ` · ${group.club_name}` : ""} · started {shortDate(group.created_at)}
          </>
        }
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div className="grid gap-6 min-w-0">
          {group.about && (
            <section className="bg-surface border border-line rounded-2xl p-5">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-2">About</h2>
              <p className="text-sm whitespace-pre-wrap">{group.about}</p>
            </section>
          )}

          <section className="bg-surface border border-line rounded-2xl overflow-x-auto">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 px-5 pt-5 pb-2">
              Events ({group.events.length})
            </h2>
            {group.events.length === 0 ? (
              <p className="text-sm text-ink-500 px-5 pb-5">No events yet.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {group.events.map((o) => (
                    <tr key={o.id} className="border-t border-line">
                      <td className="px-5 py-3">
                        <Link href={`/admin/records/outing/${o.id}`} className="font-semibold hover:underline">
                          {o.title}
                        </Link>
                        <div className="text-xs text-ink-500">
                          {OUTING_KIND_LABELS[o.kind ?? "day"] ?? "Event"} · {shortDate(o.plays_on)} · {o.entries} entered
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1 justify-end">
                          {o.status === "cancelled" && <Pill tone="warn">Cancelled</Pill>}
                          {o.hidden_at && <Pill tone="bad">Hidden</Pill>}
                        </div>
                      </td>
                      <td className="w-12 px-2 py-3 text-right">
                        <AdminRowActions
                          {...rowActionProps(staff, "outing", o.id, { hidden: !!o.hidden_at, removed: o.status === "cancelled" }, o.title)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="bg-surface border border-line rounded-2xl overflow-x-auto">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 px-5 pt-5 pb-2">
              Members ({group.members.length}
              {group.members.length < group.member_count ? ` of ${group.member_count}` : ""})
              {group.pendingRequests > 0 && ` · ${group.pendingRequests} waiting to join`}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {group.members.map((m) => (
                  <tr key={m.member_id} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <Link href={`/admin/users/${m.member_id}`} className="hover:underline">
                        {nameOf(m)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={m.role === "owner" ? "info" : "neutral"}>{ROLE_LABEL[m.role] ?? m.role}</Pill>
                    </td>
                    <td className="px-5 py-2.5 text-ink-500 text-right whitespace-nowrap">joined {shortDate(m.joined_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <RecordPanel
          staff={staff}
          entity="group"
          id={group.id}
          state={{ hidden: !!group.hidden_at }}
          title={group.name}
          values={{ name: group.name, about: group.about }}
          stateNote={
            group.hidden_at
              ? `Hidden ${formatDateTime(group.hidden_at)}${group.hidden_reason ? ` — “${group.hidden_reason}”` : ""}. Nobody can see it, members included.`
              : null
          }
          editIntro="Members aren't notified. Renaming also renames the group chat."
        />
      </div>
    </div>
  );
}
