import Link from "next/link";
import { requireStaff } from "@/lib/admin/authorization";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface Row {
  id: number;
  headline: string;
  standfirst: string;
  source_organisation: string;
  status: string;
  publish_mode: string;
  irish_angle: string | null;
  quotes: { text: string; speaker: string }[];
  validation_errors: string[] | null;
  created_at: string;
  published_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-cream-100 text-gold-600",
  approved: "bg-green-100 text-green-800",
  published: "bg-green-100 text-green-800",
  rejected: "bg-cream-100 text-ink-500",
  retracted: "bg-red-100 text-red-600",
  error: "bg-red-100 text-red-600",
};

const TABS = [
  { key: "draft", label: "Awaiting review" },
  { key: "published", label: "Published" },
  { key: "error", label: "Failed validation" },
  { key: "rejected", label: "Rejected" },
  { key: "retracted", label: "Retracted" },
] as const;

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Dublin",
  }).format(new Date(iso));
}

export default async function AdminNewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireStaff();
  const { status = "draft" } = await searchParams;
  const active = TABS.some((t) => t.key === status) ? status : "draft";

  const supabase = createAdminClient();

  const [{ data: rows }, { data: counts }] = await Promise.all([
    supabase
      .from("articles")
      .select(
        "id, headline, standfirst, source_organisation, status, publish_mode, irish_angle, quotes, validation_errors, created_at, published_at",
      )
      .eq("status", active)
      .order("created_at", { ascending: active === "draft" })
      .limit(100)
      .returns<Row[]>(),
    supabase.from("articles").select("status").returns<{ status: string }[]>(),
  ]);

  const countFor = (key: string) =>
    (counts ?? []).filter((c) => c.status === key).length;

  const articles = rows ?? [];

  return (
    <div>
      <h1 className="font-display font-bold text-2xl mb-1">News review</h1>
      <p className="text-ink-500 text-sm mb-6">
        Drafts are written from a single press release and every quote is checked
        word-for-word against it before it reaches this page. What the checks cannot
        catch is a fact added from outside the release — that is what reading the
        draft against the source is for.
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/news?status=${tab.key}`}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
              active === tab.key
                ? "bg-navy-900 text-cream-50"
                : "bg-surface border border-line text-ink-500 hover:text-ink-900"
            }`}
          >
            {tab.label}
            <span className="ml-2 opacity-70">{countFor(tab.key)}</span>
          </Link>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-sm">
        {articles.length === 0 ? (
          <div className="text-center py-16 text-ink-500">
            {active === "draft"
              ? "Nothing awaiting review. Drafts appear here after the pipeline runs."
              : "Nothing here."}
          </div>
        ) : (
          <ul>
            {articles.map((a) => (
              <li key={a.id} className="border-b border-line last:border-0">
                <Link
                  href={`/admin/news/${a.id}`}
                  className="block px-5 py-4 hover:bg-surface-tint transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-display font-bold text-lg text-ink-900 text-balance">
                        {a.headline}
                      </div>
                      <div className="text-sm text-ink-500 mt-1">{a.standfirst}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-ink-500">
                        <span>{a.source_organisation}</span>
                        <span>·</span>
                        <span>{when(a.created_at)}</span>
                        <span>·</span>
                        <span>
                          {a.quotes?.length ?? 0}{" "}
                          {(a.quotes?.length ?? 0) === 1 ? "quote" : "quotes"} verified
                        </span>
                        {!a.irish_angle && (
                          <>
                            <span>·</span>
                            <span className="text-gold-600 font-semibold">
                              no Irish angle
                            </span>
                          </>
                        )}
                        {a.publish_mode === "auto" && (
                          <>
                            <span>·</span>
                            <span className="text-gold-600 font-semibold">
                              auto-publish
                            </span>
                          </>
                        )}
                      </div>
                      {a.validation_errors && a.validation_errors.length > 0 && (
                        <ul className="mt-2 text-xs text-red-600 list-disc pl-4">
                          {a.validation_errors.slice(0, 3).map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <span
                      className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        STATUS_STYLES[a.status] ?? "bg-cream-100 text-ink-500"
                      }`}
                    >
                      {a.status}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
