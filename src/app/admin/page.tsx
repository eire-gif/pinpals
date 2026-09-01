import { requireStaff } from "@/lib/admin/authorization";
import { ROLE_LABELS } from "@/lib/admin/roles";

export default async function AdminOverviewPage() {
  // Deliberately re-checked here rather than trusting the layout alone — see
  // the comment on requireStaff() in src/lib/admin/authorization.ts.
  const { user, staff } = await requireStaff();

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-2">Overview</h1>
      <p className="text-ink-500 mb-6">
        Signed in as <strong className="text-ink-900">{user.email}</strong> — role:{" "}
        <strong className="text-ink-900">{ROLE_LABELS[staff.role]}</strong>.
      </p>

      <div className="bg-surface border border-line rounded-2xl p-6">
        <h2 className="font-display font-bold text-lg mb-2">Security foundation — Phase 1</h2>
        <p className="text-sm text-ink-500">
          This is the admin authorization foundation: staff identity, roles, and a server-side
          gate on every route under <code>/admin</code>. User, listing, tee-time, financial, and
          reporting tools are not built yet — the nav on the left shows what&apos;s coming and in
          what order.
        </p>
      </div>
    </div>
  );
}
