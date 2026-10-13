import Link from "next/link";

/** Groups | Events — the two lists under Groups & societies. */
export default function GroupsTabs({ current }: { current: "groups" | "events" }) {
  const tabs = [
    { key: "groups", href: "/admin/groups", label: "Groups" },
    { key: "events", href: "/admin/groups/events", label: "Events" },
  ] as const;
  return (
    <nav aria-label="Groups sections" className="flex flex-wrap gap-1.5 mb-4">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition ${
            t.key === current ? "bg-navy-900 border-navy-900 text-cream-50" : "bg-surface border-line text-ink-900 hover:bg-cream-100"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function nameOf(p: { first_name: string | null; last_name: string | null } | null): string {
  return [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Former member";
}

export function shortDate(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
