import { requireStaff } from "@/lib/admin/authorization";
import { listStaffMembers } from "@/lib/admin/queries";
import { formatDateTime, personName } from "@/lib/admin/format";
import { ROLE_LABELS } from "@/lib/admin/roles";
import AdminAvatar from "@/components/admin/avatar";
import ModerationForm from "@/components/admin/moderation-form";
import GrantStaffForm from "./grant-form";
import ChangeRoleForm from "./role-form";
import { disableStaffMember, reinstateStaffMember } from "./actions";

// Restricted to super_admin — see claude/admin-architecture-review.md §6
// ("super_admin — ... plus manage other admin accounts/roles"). Every other
// staff role gets the same 404 a non-staff user would get hitting this URL,
// same as /admin/audit-log.
export default async function AdminStaffPage() {
  const { user } = await requireStaff({ roles: ["super_admin"] });
  const staffMembers = await listStaffMembers();

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">Staff</h1>
      <p className="text-ink-500 mb-6">
        {staffMembers.length} {staffMembers.length === 1 ? "staff account" : "staff accounts"}. Granting, changing, or
        disabling a staff account is restricted to super admins and is always recorded in the{" "}
        <a href="/admin/audit-log" className="underline">
          audit log
        </a>
        . You can&rsquo;t change your own role or status here — ask another super admin.
      </p>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm mb-8">
        {staffMembers.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No staff accounts exist yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                <th className="px-5 py-3 font-semibold">Member</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Granted</th>
                <th className="px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staffMembers.map((row) => {
                const isSelf = row.user_id === user.id;
                const name = personName(row.member);
                return (
                  <tr key={row.id} className="border-b border-line last:border-0 align-top">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <AdminAvatar name={name} color={row.member?.avatar_color ?? null} />
                        <div>
                          <div className="font-semibold text-ink-900">
                            {name}
                            {isSelf && <span className="text-ink-500 font-normal"> (you)</span>}
                          </div>
                          <div className="text-xs text-ink-500">{row.member?.email ?? "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-ink-900">{ROLE_LABELS[row.role]}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          row.status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-600"
                        }`}
                      >
                        {row.status === "active" ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-ink-500 whitespace-nowrap">
                      {formatDateTime(row.created_at)}
                      {row.grantedBy && <div className="text-xs">by {personName(row.grantedBy)}</div>}
                    </td>
                    <td className="px-5 py-4">
                      {isSelf ? (
                        <span className="text-xs text-ink-500">
                          Ask another super admin to change your role or status.
                        </span>
                      ) : (
                        <div className="flex flex-col gap-3 max-w-[220px]">
                          <ChangeRoleForm userId={row.user_id} currentRole={row.role} />
                          {row.status === "active" ? (
                            <ModerationForm
                              action={disableStaffMember}
                              idField="userId"
                              id={row.user_id}
                              submitLabel="Disable"
                              pendingLabel="Disabling…"
                              tone="danger"
                            />
                          ) : (
                            <ModerationForm
                              action={reinstateStaffMember}
                              idField="userId"
                              id={row.user_id}
                              submitLabel="Reinstate"
                              pendingLabel="Reinstating…"
                            />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-surface border border-line rounded-2xl p-6 shadow-sm">
        <h2 className="font-display font-bold text-lg mb-4">Grant staff access</h2>
        <GrantStaffForm />
      </div>
    </div>
  );
}
