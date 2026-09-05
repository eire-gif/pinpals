import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { getOverviewMetrics } from "@/lib/admin/queries";
import { canSeeFinanceMetrics, UNAVAILABLE_METRICS } from "@/lib/admin/overview";
import UnavailableCard from "@/components/admin/unavailable-card";

// Bounded operational overview — every real number below comes from an
// indexed count query (see getOverviewMetrics() in queries.ts), never a full
// table scan, and none of it is historical/trend analytics (that's Phase 7
// per admin-architecture-review.md §8, deliberately out of scope here).
// totalMembers/totalListings are shown with a "~": getOverviewMetrics() now
// takes those two from planner statistics rather than a real COUNT(*), so
// this page never claims a precision it doesn't have.
export default async function AdminOverviewPage() {
  // Deliberately re-checked here rather than trusting the layout alone — see
  // the comment on requireStaff() in src/lib/admin/authorization.ts.
  const { user, staff } = await requireStaff();
  const metrics = await getOverviewMetrics();
  const showFinance = canSeeFinanceMetrics(staff);

  const attentionMetrics = UNAVAILABLE_METRICS.filter((m) => showFinance || !m.financeOnly);

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-2">Overview</h1>
      <p className="text-ink-500 mb-8">
        Signed in as <strong className="text-ink-900">{user.email}</strong> — role:{" "}
        <strong className="text-ink-900">{ROLE_LABELS[staff.role]}</strong>.
      </p>

      <Section title="Needs attention">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <StatCard
            href="/admin/users?suspended=1"
            label="Suspended members"
            value={metrics.suspendedMembers}
          />
          <StatCard
            href="/admin/support"
            label="Unresolved support cases"
            value={metrics.unresolvedSupportCases}
          />
          {attentionMetrics.map((m) => (
            <UnavailableCard key={m.key} label={m.label} reason={m.reason} />
          ))}
        </div>
        {!showFinance && (
          <p className="text-xs text-ink-500 mt-4">
            Finance-only metrics (orders, payments, seller onboarding) aren&rsquo;t shown for your role.
          </p>
        )}
      </Section>

      <Section title="Community snapshot">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <StatCard href="/admin/users" label="Members" value={metrics.totalMembers} approx />
          <StatCard
            href="/admin/listings?status=active"
            label="Active listings"
            value={metrics.activeListings}
            sub={`~${metrics.totalListings} total`}
          />
          <StatCard
            href="/admin/listings?status=removed"
            label="Removed by admin"
            value={metrics.removedListings}
          />
          <StatCard
            href="/admin/tee-times?status=open"
            label="Open tee-times"
            value={metrics.openInvites}
            sub={`${metrics.totalInvites} total`}
          />
        </div>
      </Section>

      <div className="bg-surface border border-line rounded-2xl p-6">
        <h2 className="font-display font-bold text-lg mb-2">Phase 4 — operational overview</h2>
        <p className="text-sm text-ink-500">
          Users, listings, and tee-times are searchable from the nav on the left, with moderation
          actions and an audit trail. Orders, payouts, clubs management, member-facing reports, and
          settings are still further out — see <code>admin-architecture-review.md</code> for the full
          sequence. Cards above marked &ldquo;data unavailable&rdquo; reflect subsystems that genuinely
          don&rsquo;t exist yet, not a bug in this page.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="font-display font-bold text-lg mb-3">{title}</h2>
      {children}
    </div>
  );
}

function StatCard({
  href,
  label,
  value,
  sub,
  approx,
}: {
  href: string;
  label: string;
  value: number;
  sub?: string;
  /** True for a count taken from planner statistics (`count: "estimated"`)
   * rather than a real COUNT(*) — see getOverviewMetrics()'s own comment.
   * Shown with a leading "~" so the dashboard never claims a precision it
   * doesn't have. */
  approx?: boolean;
}) {
  return (
    <Link
      href={href}
      className="block bg-surface border border-line rounded-2xl p-6 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition"
    >
      <div className="text-xs uppercase tracking-wide text-ink-500 font-semibold">{label}</div>
      <div className="font-display font-bold text-3xl mt-1 text-ink-900">
        {approx && "~"}
        {value}
      </div>
      {sub && <div className="text-xs text-ink-500 mt-1">{sub}</div>}
    </Link>
  );
}
