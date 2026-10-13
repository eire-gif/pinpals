import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { GROUPS_PAGE_SIZE, GROUP_KIND_LABELS, OUTING_KIND_LABELS, listOutings } from "@/lib/admin/admin-lists";
import { bulkBarProps, rowActionProps } from "@/lib/admin/controls";
import AdminPageHeader from "@/components/admin/page-header";
import AdminPagination from "@/components/admin/pagination";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { BulkProvider, BulkBar, SelectAll, SelectRow } from "@/components/admin/controls/bulk";
import { FilterBar, Pill, ShowHiddenToggle, filterButton, filterInput } from "@/components/admin/table";
import GroupsTabs, { shortDate } from "../tabs";

export const dynamic = "force-dynamic";


/** Events (outings) run by societies, crews and trips (0125, 0129). */
export default async function AdminGroupEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; when?: string; group?: string; hidden?: string; page?: string }>;
}) {
  const { staff } = await requireStaff();
  const { q = "", status = "", when = "", group = "", hidden = "", page: pageParam } = await searchParams;
  const showHidden = hidden === "1";
  const groupId = Number.parseInt(group, 10);
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { rows, total } = await listOutings(
    { q, status, when, groupId: Number.isFinite(groupId) && groupId > 0 ? groupId : undefined, showHidden },
    page
  );

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (when) params.set("when", when);
    if (group) params.set("group", group);
    if (showHidden) params.set("hidden", "1");
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/groups/events?${qs}` : "/admin/groups/events";
  };

  return (
    <div>
      <AdminPageHeader
        title="Groups & societies"
        description={`${total.toLocaleString("en-IE")} ${total === 1 ? "event" : "events"}${showHidden ? ", including hidden" : ""}. Days out, overnights and trips.`}
      />
      <GroupsTabs current="events" />

      <FilterBar>
        {group && <input type="hidden" name="group" value={group} />}
        <input type="search" name="q" defaultValue={q} placeholder="Search by title…" className={`${filterInput} flex-1 min-w-[200px]`} />
        <select name="when" defaultValue={when} className={filterInput} aria-label="When">
          <option value="">Any date</option>
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
        <select name="status" defaultValue={status} className={filterInput} aria-label="Status">
          <option value="">Open and cancelled</option>
          <option value="open">Open</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <ShowHiddenToggle checked={showHidden} />
        <button type="submit" className={filterButton}>
          Filter
        </button>
      </FilterBar>

      <BulkProvider>
        <div className="bg-surface border border-line rounded-2xl overflow-x-auto shadow-sm">
          {rows.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="font-semibold text-ink-900">No events match that search.</div>
              {!showHidden && <div className="text-sm text-ink-500 mt-1">Tick &ldquo;Show hidden&rdquo; to include hidden events.</div>}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                  <th className="w-10 pl-4 pr-1 py-3">
                    <SelectAll ids={rows.map((o) => o.id)} />
                  </th>
                  <th className="px-4 py-3 font-semibold">Event</th>
                  <th className="px-4 py-3 font-semibold">Group</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold text-right">Entries</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="w-12 px-2 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="w-10 pl-4 pr-1 py-3">
                      <SelectRow id={o.id} label={`Select ${o.title}`} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/records/outing/${o.id}`} className="font-semibold text-ink-900 hover:underline">
                        {o.title}
                      </Link>
                      <div className="text-xs text-ink-500">
                        {OUTING_KIND_LABELS[o.kind ?? "day"] ?? "Event"}
                        {o.course_name ? ` · ${o.course_name}` : o.location ? ` · ${o.location}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {o.group ? (
                        <Link href={`/admin/groups/${o.group.id}`} className="text-ink-900 hover:underline">
                          {o.group.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {o.group && <div className="text-xs text-ink-500">{GROUP_KIND_LABELS[o.group.kind] ?? o.group.kind}</div>}
                    </td>
                    <td className="px-4 py-3 text-ink-500 whitespace-nowrap">{shortDate(o.plays_on)}</td>
                    <td className="px-4 py-3 text-right">{o.entries}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Pill tone={o.status === "cancelled" ? "warn" : "good"}>{o.status === "cancelled" ? "Cancelled" : "Open"}</Pill>
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
        </div>
        <BulkBar {...bulkBarProps(staff, "outing")} />
      </BulkProvider>

      <AdminPagination page={page} pageSize={GROUPS_PAGE_SIZE} total={total} hrefForPage={hrefFor} />
    </div>
  );
}
