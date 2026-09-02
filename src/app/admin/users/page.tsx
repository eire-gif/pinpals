import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { listUsers } from "@/lib/admin/queries";
import AdminAvatar from "@/components/admin/avatar";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireStaff();
  const { q = "" } = await searchParams;
  const users = await listUsers(q);

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Users</h1>
      <p className="text-ink-500 mb-6">
        {users.length} {users.length === 1 ? "member" : "members"}
        {q && (
          <>
            {" "}
            matching &ldquo;{q}&rdquo;
          </>
        )}
        .
      </p>

      <form className="mb-6">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name, email, club or county…"
          className="w-full max-w-md px-4 py-2.5 rounded-full border-[1.5px] border-line bg-surface text-sm"
        />
      </form>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {users.length === 0 ? (
          <div className="text-center py-16 text-ink-500">
            No members match that search.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Member</th>
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Club</th>
                <th className="px-5 py-3 font-semibold">County</th>
                <th className="px-5 py-3 font-semibold text-right">Listings</th>
                <th className="px-5 py-3 font-semibold text-right">Invites</th>
                <th className="px-5 py-3 font-semibold">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const name = `${u.first_name} ${u.last_name}`;
                return (
                  <tr key={u.id} className="border-b border-line last:border-0 hover:bg-surface-tint">
                    <td className="px-5 py-3">
                      <Link href={`/admin/users/${u.id}`} className="flex items-center gap-3">
                        <AdminAvatar name={name} color={u.avatar_color} />
                        <span className="font-semibold text-ink-900">{name}</span>
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-500">{u.email ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-500">{u.home_club ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-500">{u.county ?? "—"}</td>
                    <td className="px-5 py-3 text-right text-ink-900">{u.listing_count}</td>
                    <td className="px-5 py-3 text-right text-ink-900">{u.invite_count}</td>
                    <td className="px-5 py-3 text-ink-500">
                      {new Date(u.created_at).toLocaleDateString("en-IE", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
