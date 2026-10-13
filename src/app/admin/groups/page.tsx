import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { GROUP_KIND_LABELS, GROUP_PRIVACY_LABELS, GROUPS_PAGE_SIZE, listGroups } from "@/lib/admin/admin-lists";
import { bulkBarProps, rowActionProps } from "@/lib/admin/controls";
import AdminPageHeader from "@/components/admin/page-header";
import AdminPagination from "@/components/admin/pagination";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { BulkProvider, BulkBar, SelectAll, SelectRow } from "@/components/admin/controls/bulk";
import { FilterBar, Pill, ShowHiddenToggle, filterButton, filterInput } from "@/components/admin/table";
import GroupsTabs, { nameOf, shortDate } from "./tabs";

export const dynamic = "force-dynamic";

/** Crews, golf trips and societies (0120+), from the staff side. */
export default async function AdminGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; hidden?: string; page?: string }>;
}) {
  const { staff } = await requireStaff();
  const { q = "", kind = "", hidden = "", page: pageParam } = await searchParams;
  const showHidden = hidden === "1";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { rows, total } = await listGroups({ q, kind, showHidden }, page);

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (kind) params.set("kind", kind);
    if (showHidden) params.set("hidden", "1");
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/admin/groups?${qs}` : "/admin/groups";
  };

  return (
    <div>
      <AdminPageHeader
        title="Groups & societies"
        description={`${total.toLocaleString("en-IE")} ${total === 1 ? "group" : "groups"}${showHidden ? ", including hidden" : ""}. Crews, golf trips and societies.`}
      />
      <GroupsTabs current="groups" />

      <FilterBar>
        <input type="search" name="q" defaultValue={q} placeholder="Search by name…" className={`${filterInput} flex-1 min-w-[200px]`} />
        <select name="kind" defaultValue={kind} className={filterInput} aria-label="Kind">
          <option value="">All kinds</option>
          {Object.entries(GROUP_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
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
              <div className="font-semibold text-ink-900">No groups match that search.</div>
              {!showHidden && <div className="text-sm text-ink-500 mt-1">Tick &ldquo;Show hidden&rdquo; to include hidden groups.</div>}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                  <th className="w-10 pl-4 pr-1 py-3">
                    <SelectAll ids={rows.map((g) => g.id)} />
                  </th>
                  <th className="px-4 py-3 font-semibold">Group</th>
                  <th className="px-4 py-3 font-semibold">Kind</th>
                  <th className="px-4 py-3 font-semibold">Owner</th>
                  <th className="px-4 py-3 font-semibold text-right">Members</th>
                  <th className="px-4 py-3 font-semibold">Joining</th>
                  <th className="px-4 py-3 font-semibold">Started</th>
                  <th className="w-12 px-2 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="w-10 pl-4 pr-1 py-3">
                      <SelectRow id={g.id} label={`Select ${g.name}`} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/admin/groups/${g.id}`} className="font-semibold text-ink-900 hover:underline">
                        {g.name}
                      </Link>
                      {g.hidden_at && (
                        <span className="ml-2">
                          <Pill tone="bad">Hidden</Pill>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={g.kind === "society" ? "info" : "neutral"}>{GROUP_KIND_LABELS[g.kind] ?? g.kind}</Pill>
                    </td>
                    <td className="px-4 py-3">
                      {g.owner ? (
                        <Link href={`/admin/users/${g.owner.id}`} className="text-ink-900 hover:underline">
                          {nameOf(g.owner)}
                        </Link>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{g.member_count}</td>
                    <td className="px-4 py-3 text-ink-500 whitespace-nowrap">{GROUP_PRIVACY_LABELS[g.privacy] ?? g.privacy}</td>
                    <td className="px-4 py-3 text-ink-500 whitespace-nowrap">{shortDate(g.created_at)}</td>
                    <td className="w-12 px-2 py-3 text-right">
                      <AdminRowActions {...rowActionProps(staff, "group", g.id, { hidden: !!g.hidden_at }, g.name)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <BulkBar {...bulkBarProps(staff, "group")} />
      </BulkProvider>

      <AdminPagination page={page} pageSize={GROUPS_PAGE_SIZE} total={total} hrefForPage={hrefFor} />
    </div>
  );
}
