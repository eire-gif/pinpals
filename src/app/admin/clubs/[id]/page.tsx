import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { createClient } from "@/lib/supabase/server";
import { countryName } from "@/lib/regions";
import type { Club } from "@/lib/types";
import EditClubForm from "./edit-club-form";

export const dynamic = "force-dynamic";

export default async function AdminClubPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();

  const { id } = await params;
  const clubId = Number.parseInt(id, 10);
  if (!Number.isFinite(clubId)) notFound();

  const supabase = await createClient();
  const { data: club } = await supabase.from("clubs").select("*").eq("id", clubId).maybeSingle<Club>();
  if (!club) notFound();

  // How many members would be affected by getting this row wrong. Shown
  // rather than hidden because it changes how carefully a staff member
  // should treat the edit: renaming a club with 40 members at it is a
  // different act from correcting a typo on one nobody has claimed.
  const { count: memberCount } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("home_club_id", club.id);

  return (
    <div className="max-w-2xl">
      <Link href="/admin/clubs" className="text-sm font-bold text-green-700">
        ← All courses
      </Link>

      <h1 className="font-display font-bold text-2xl mt-2 mb-1">{club.name}</h1>
      <p className="text-sm text-ink-500 mb-1">
        {countryName(club.country)}
        {club.region ? ` · ${club.region}` : ""} · {memberCount ?? 0}{" "}
        {memberCount === 1 ? "member" : "members"} play here
      </p>
      <p className="text-xs text-ink-500 mb-6">
        <Link href={`/courses/${club.country}/${club.slug}`} className="underline">
          /courses/{club.country}/{club.slug}
        </Link>
        {club.osm_id ? (
          <>
            {" · "}
            <a
              href={`https://www.openstreetmap.org/${club.osm_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {club.osm_id} on OpenStreetMap
            </a>
          </>
        ) : (
          " · no OpenStreetMap record matched"
        )}
      </p>

      <div className="bg-surface border border-line rounded-xl p-6">
        <EditClubForm club={club} />
      </div>

      {/* The slug is deliberately not editable. It is the course's public URL
          and members' bookmarks; changing it silently breaks every link that
          ever pointed here, and nothing about a wrong website or a missing
          county requires it. */}
      <p className="text-xs text-ink-500 mt-4">
        The web address (<code>{club.slug}</code>) can&rsquo;t be changed here — it&rsquo;s what
        existing links and bookmarks point at.
      </p>
    </div>
  );
}
