import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listUsers, isUserSuspended } from "@/lib/admin/queries";
import AdminAvatar from "@/components/admin/avatar";
import ExportCsvLink from "@/components/admin/export-csv-link";
import { canAccess } from "@/lib/admin/roles";
import { USER_EXPORT_ROLES } from "@/lib/admin/export";
import AdminPageHeader from "@/components/admin/page-header";
import AdminRowActions from "@/components/admin/controls/row-actions";
import { BulkProvider, BulkBar, SelectAll, SelectRow } from "@/components/admin/controls/bulk";
import { bulkBarProps, rowActionProps } from "@/lib/admin/controls";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; suspended?: string; page?: string }>;
}) {
  const { staff } = await requireStaff();
  const { q = "", suspended, page: pageParam } = await searchParams;
  const suspendedOnly = suspended === "1";
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);
  const { rows: users, total, pageSize } = await listUsers(q, suspendedOnly, page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Tighter than this page's own gate on purpose — the file contains every
  // member's email address. See src/lib/admin/export.ts. Staff without the
  // role simply don't see the control; the route enforces it independently.
  const canExport = canAccess(staff, USER_EXPORT_ROLES);
  const exportParams = new URLSearchParams();
  if (q) exportParams.set("q", q);
  if (suspendedOnly) exportParams.set("suspended", "1");
  const exportQs = exportParams.toString();
  const exportHref = exportQs ? `/admin/users/export?${exportQs}` : "/admin/users/export";

  function pageHref(targetPage: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (suspendedOnly) params.set("suspended", "1");
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return qs ? `/admin/users?${qs}` : "/admin/users";
  }

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description={
          <>
            {total} {total === 1 ? "member" : "members"}
            {suspendedOnly && " · suspended"}
            {q && <> matching &ldquo;{q}&rdquo;</>}.
          </>
        }
        actions={
          canExport && (
            <ExportCsvLink
              href={exportHref}
              title={`Downloads ${total} ${total === 1 ? "member" : "members"}, including email addresses`}
            />
          )
        }
      />

      <form className="flex flex-wrap gap-3 mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name, email, club or county…"
          className="flex-1 min-w-[240px] px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
        <select
          name="suspended"
          defaultValue={suspendedOnly ? "1" : ""}
          className="px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        >
          <option value="">All members</option>
          <option value="1">Suspended only</option>
        </select>
        <button
          type="submit"
          className="px-5 py-2.5 rounded-full font-bold text-sm bg-navy-900 text-cream-50 hover:bg-navy-800 transition"
        >
          Filter
        </button>
      </form>

      <BulkProvider>
        <div className="bg-surface border border-line rounded-2xl overflow-x-auto shadow-sm">
          {users.length === 0 ? (
            <div className="text-center py-16 text-ink-500">No members match that search.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                  <th className="w-10 pl-4 pr-1 py-3">
                    <SelectAll ids={users.map((u) => u.id)} />
                  </th>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Club</th>
                  <th className="px-4 py-3 font-semibold">County</th>
                  <th className="px-4 py-3 font-semibold text-right">Listings</th>
                  <th className="px-4 py-3 font-semibold text-right">Tee times</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="w-12 px-2 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const name = `${u.first_name} ${u.last_name}`;
                  const suspended = isUserSuspended(u);
                  return (
                    <tr key={u.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                      <td className="w-10 pl-4 pr-1 py-3">
                        <SelectRow id={u.id} label={`Select ${name}`} />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3">
                          <AdminAvatar name={name} color={u.avatar_color} />
                          <span className="font-semibold text-ink-900">{name}</span>
                          {suspended && (
                            <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">Suspended</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-ink-500">{u.email ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-500">{u.home_club ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-500">{u.county ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-ink-900">{u.listing_count}</td>
                      <td className="px-4 py-3 text-right text-ink-900">{u.invite_count}</td>
                      <td className="px-4 py-3 text-ink-500 whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString("en-IE", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="w-12 px-2 py-3 text-right">
                        <AdminRowActions {...rowActionProps(staff, "user", u.id, { hidden: suspended }, name)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <BulkBar {...bulkBarProps(staff, "user")} />
      </BulkProvider>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 text-sm text-ink-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="px-4 py-2 rounded-full border-[1.5px] border-line hover:bg-cream-100 transition"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
