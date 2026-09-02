import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { listListings, listTeeTimeInvites, listUsers } from "@/lib/admin/queries";

export default async function AdminOverviewPage() {
  // Deliberately re-checked here rather than trusting the layout alone — see
  // the comment on requireStaff() in src/lib/admin/authorization.ts.
  const { user, staff } = await requireStaff();

  const [users, listings, invites] = await Promise.all([
    listUsers(),
    listListings(),
    listTeeTimeInvites(),
  ]);

  const activeListings = listings.filter((l) => l.status === "active").length;
  const openInvites = invites.filter((i) => i.status === "open").length;

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-2">Overview</h1>
      <p className="text-ink-500 mb-6">
        Signed in as <strong className="text-ink-900">{user.email}</strong> — role:{" "}
        <strong className="text-ink-900">{ROLE_LABELS[staff.role]}</strong>.
      </p>

      <div className="grid sm:grid-cols-3 gap-5 mb-8">
        <StatCard href="/admin/users" label="Members" value={users.length} />
        <StatCard href="/admin/listings" label="Active listings" value={activeListings} sub={`${listings.length} total`} />
        <StatCard href="/admin/tee-times" label="Open tee-times" value={openInvites} sub={`${invites.length} total`} />
      </div>

      <div className="bg-surface border border-line rounded-2xl p-6">
        <h2 className="font-display font-bold text-lg mb-2">Read-only operational views — Phase 2</h2>
        <p className="text-sm text-ink-500">
          Users, listings, and tee-times are browsable and searchable from the nav on the left, with
          detail pages for each. Nothing here can be edited yet — moderation actions (suspend a
          user, remove a listing, cancel an invite) land in Phase 3, with every action written to an
          audit log. Orders, payouts, clubs management, reports, and settings are still further out
          — see <code>admin-architecture-review.md</code> for the full sequence.
        </p>
      </div>
    </div>
  );
}

function StatCard({
  href,
  label,
  value,
  sub,
}: {
  href: string;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      className="block bg-surface border border-line rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
    >
      <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">{label}</div>
      <div className="font-display font-bold text-3xl mt-1 text-ink-900">{value}</div>
      {sub && <div className="text-xs text-ink-500 mt-1">{sub}</div>}
    </Link>
  );
}
