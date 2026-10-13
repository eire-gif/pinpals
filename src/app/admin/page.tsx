import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { ROLE_LABELS } from "@/lib/admin/roles";
import { getOverviewMetrics } from "@/lib/admin/queries";
import { canSeeFinanceMetrics } from "@/lib/admin/overview";
import { getAdminAttention, getCommunitySnapshot } from "@/lib/admin/admin-lists";
import AdminPageHeader from "@/components/admin/page-header";

// The Overview: what needs a person today, then a compact snapshot of the
// community. Every number is a bounded count (getOverviewMetrics() in
// queries.ts, getAdminAttention()/getCommunitySnapshot() in admin-lists.ts);
// members and listings totals come from planner statistics, hence the "~".
export default async function AdminOverviewPage() {
  // Re-checked here rather than trusting the layout alone — see
  // requireStaff() in src/lib/admin/authorization.ts.
  const { staff } = await requireStaff();
  const finance = canSeeFinanceMetrics(staff);
  const metrics = await getOverviewMetrics();
  const [attention, snapshot] = await Promise.all([
    getAdminAttention({
      finance,
      suspendedMembers: metrics.suspendedMembers,
      openSupportCases: metrics.unresolvedSupportCases,
    }),
    getCommunitySnapshot(),
  ]);

  return (
    <div>
      <AdminPageHeader title="Overview" description={`What needs attention today. Signed in as ${ROLE_LABELS[staff.role]}.`} />

      <Section title="Needs attention">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card href="/admin/reports" label="Open reports" value={attention.openReports} alert />
          <Card href="/admin/support" label="Open support cases" value={attention.openSupportCases} alert />
          {finance && (
            <>
              <Card href="/admin/orders?problem=1" label="Problem sales" value={attention.problemSales} alert />
              <Card href="/admin/marketplace?tab=orders" label="Orders awaiting payment" value={attention.ordersAwaitingPayment} />
              <Card
                href="/admin/webhook-events?status=failed"
                label="Webhook failures"
                sub="Last 7 days"
                value={attention.webhookFailures7d}
                alert
              />
              <Card href="/admin/payouts?attention=1" label="Sellers not set up" sub="Stripe onboarding incomplete" value={attention.sellersIncomplete} />
            </>
          )}
          <Card href="/admin/listings?status=pending_review" label="Listings to review" value={attention.listingsAwaitingReview} />
          <Card href="/admin/listings?status=removed" label="Hidden listings" value={attention.hiddenListings} />
          <Card href="/admin/feed?status=hidden" label="Hidden posts" value={attention.hiddenPosts} />
          <Card href="/admin/users?suspended=1" label="Suspended members" value={attention.suspendedMembers} />
          <Card href="/admin/advertising" label="Live ad campaigns" value={attention.liveAdCampaigns} />
        </div>
      </Section>

      <Section title="Community snapshot">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card href="/admin/users" label="Members" value={metrics.totalMembers} approx sub={snapshotSub(snapshot.newMembersThisWeek, "new this week")} />
          <Card href="/admin/listings?status=active" label="Active listings" value={metrics.activeListings} sub={`~${metrics.totalListings} in total`} />
          <Card href="/admin/tee-times?status=open" label="Open tee times" value={metrics.openInvites} sub={`${metrics.totalInvites} in total`} />
          <Card href="/admin/groups" label="Groups" value={snapshot.groups} sub={snapshotSub(snapshot.societies, "societies")} />
          <Card href="/admin/groups/events?when=upcoming" label="Upcoming events" value={snapshot.upcomingEvents} />
          <Card href="/admin/feed" label="Posts this week" value={snapshot.postsThisWeek} />
        </div>
      </Section>
    </div>
  );
}

function snapshotSub(n: number | null, text: string) {
  return n == null ? undefined : `${n} ${text}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-500 mb-3">{title}</h2>
      {children}
    </section>
  );
}

/** A count that links to its page. `alert` turns a non-zero number gold so
 * the things that need someone stand out; null (couldn't count) shows "—". */
function Card({
  href,
  label,
  value,
  sub,
  approx,
  alert,
}: {
  href: string;
  label: string;
  value: number | null;
  sub?: string;
  approx?: boolean;
  alert?: boolean;
}) {
  const hot = alert && (value ?? 0) > 0;
  return (
    <Link
      href={href}
      className={`block rounded-2xl border p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition ${
        hot ? "bg-navy-900 border-navy-900" : "bg-surface border-line"
      }`}
    >
      <div className={`text-xs font-semibold ${hot ? "text-gold-400" : "text-ink-500"}`}>{label}</div>
      <div className={`font-display font-bold text-2xl mt-1 ${hot ? "text-cream-50" : "text-ink-900"}`}>
        {value == null ? "—" : `${approx ? "~" : ""}${value.toLocaleString("en-IE")}`}
      </div>
      {sub && <div className={`text-xs mt-0.5 ${hot ? "text-cream-100" : "text-ink-500"}`}>{sub}</div>}
    </Link>
  );
}
