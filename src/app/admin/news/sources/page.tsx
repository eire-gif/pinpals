import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Source health for the news collector.
 *
 * Read-only. Turning a source on, or clearing a 'blocked' status, is a
 * decision with legal weight — it means someone has read that source's terms
 * and robots.txt and is asserting we may fetch it — so it is deliberately
 * not a button on a page. It is a SQL statement a person writes on purpose.
 */

export const dynamic = "force-dynamic";

interface SourceRow {
  id: number;
  name: string;
  organisation: string;
  feed_url: string;
  fetch_kind: string;
  enabled: boolean;
  status: string;
  robots_allows: boolean | null;
  robots_checked_at: string | null;
  image_rights_granted: boolean;
  poll_interval_minutes: number;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

const STATUS_STYLES: Record<string, string> = {
  healthy: "bg-green-100 text-green-800",
  degraded: "bg-cream-100 text-gold-600",
  blocked: "bg-red-100 text-red-600",
  disabled: "bg-cream-100 text-ink-500",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function AdminNewsSourcesPage() {
  await requireStaff();
  const supabase = createAdminClient();

  const [{ data: sources }, { count: itemCount }, { data: recent }] = await Promise.all([
    supabase
      .from("content_sources")
      .select(
        "id, name, organisation, feed_url, fetch_kind, enabled, status, robots_allows, robots_checked_at, image_rights_granted, poll_interval_minutes, last_success_at, last_error, consecutive_failures",
      )
      .order("name")
      .returns<SourceRow[]>(),
    supabase.from("content_items").select("id", { count: "exact", head: true }),
    supabase
      .from("content_items")
      .select("id, title, canonical_url, fetched_at, status")
      .order("fetched_at", { ascending: false })
      .limit(10)
      .returns<
        { id: number; title: string; canonical_url: string; fetched_at: string; status: string }[]
      >(),
  ]);

  const rows = sources ?? [];
  const enabled = rows.filter((s) => s.enabled).length;

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">News sources</h1>
      <p className="text-ink-500 text-sm mb-6">
        {enabled} of {rows.length} enabled · {itemCount ?? 0} items collected. The
        collector runs every six hours and only ever reads first-party press
        offices.
      </p>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm mb-8">
        {rows.length === 0 ? (
          <div className="text-center py-16 text-ink-500">No sources configured.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-500 text-xs uppercase tracking-wide border-b border-line">
                  <th className="px-5 py-3 font-semibold">Source</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">robots.txt</th>
                  <th className="px-5 py-3 font-semibold">Images</th>
                  <th className="px-5 py-3 font-semibold">Last success</th>
                  <th className="px-5 py-3 font-semibold">Every</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0 align-top">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-ink-900">{s.name}</div>
                      <a
                        href={s.feed_url}
                        rel="nofollow noopener"
                        className="text-xs text-ink-500 hover:underline break-all"
                      >
                        {s.feed_url}
                      </a>
                      {s.last_error && (
                        <div className="text-xs text-red-600 mt-1">
                          {s.last_error}
                          {s.consecutive_failures > 1 && ` (${s.consecutive_failures} in a row)`}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                          STATUS_STYLES[s.status] ?? "bg-cream-100 text-ink-500"
                        }`}
                      >
                        {s.enabled ? s.status : "off"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {s.robots_allows === null
                        ? "unchecked"
                        : s.robots_allows
                          ? "allowed"
                          : "disallowed"}
                      <div className="text-xs">{timeAgo(s.robots_checked_at)}</div>
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {s.image_rights_granted ? "rights held" : "no rights"}
                    </td>
                    <td className="px-5 py-3 text-ink-500">{timeAgo(s.last_success_at)}</td>
                    <td className="px-5 py-3 text-ink-500">
                      {s.poll_interval_minutes >= 60
                        ? `${Math.round(s.poll_interval_minutes / 60)}h`
                        : `${s.poll_interval_minutes}m`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h2 className="font-display font-bold text-lg mb-3">Recently collected</h2>
      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {!recent || recent.length === 0 ? (
          <div className="text-center py-12 text-ink-500">
            Nothing collected yet. Sources start disabled — enable one in the SQL
            editor once you have checked its terms.
          </div>
        ) : (
          <ul>
            {recent.map((item) => (
              <li
                key={item.id}
                className="px-5 py-3 border-b border-line last:border-0 flex items-baseline justify-between gap-4"
              >
                <a
                  href={item.canonical_url}
                  rel="nofollow noopener"
                  className="text-ink-900 hover:underline"
                >
                  {item.title}
                </a>
                <span className="text-xs text-ink-500 whitespace-nowrap">
                  {item.status} · {timeAgo(item.fetched_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
