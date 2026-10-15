import type { Metadata } from "next";
import Link from "next/link";

import { listMySocieties, requireMember } from "@/lib/society-console/access";
import { roleLabel } from "@/lib/society-console/rules";

export const metadata: Metadata = { title: "Society admin · PinPals", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * /society — the societies you help run. Owners and anyone holding an office
 * (captain, secretary, vice-captain, treasurer, handicap secretary, event
 * organiser) see theirs here; everyone else is told where societies live.
 */
export default async function MySocietiesPage() {
  const { supabase, user } = await requireMember("/society");
  const societies = await listMySocieties(supabase, user.id);

  return (
    <div className="bg-cream-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-600">
          <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Society admin
        </span>
        <h1 className="font-display font-bold text-3xl sm:text-4xl mt-3 text-ink-900">Run your society</h1>
        <p className="text-ink-500 mt-2 max-w-2xl">
          Events and entries, the waiting list, payments, membership, handicaps, the noticeboard and the committee — on a big screen, with your
          PinPals login.
        </p>

        {societies.length === 0 ? (
          <div className="mt-10 bg-surface rounded-2xl border border-line p-8 text-center">
            <h2 className="font-display font-bold text-xl">You&apos;re not running a society yet</h2>
            <p className="text-ink-500 mt-2 max-w-md mx-auto">
              Society admin is for the owner and committee of a society. Start one in the PinPals app (Groups → New → Society), or ask your
              society&apos;s owner to appoint you to an office.
            </p>
            <Link href="/dashboard" className="inline-block mt-6 px-6 py-3 rounded-full font-bold bg-green-700 text-cream-50 hover:bg-green-600 transition">
              Back to your dashboard
            </Link>
          </div>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {societies.map((s) => (
              <li key={s.id}>
                <Link href={`/society/${s.id}`} className="group block rounded-2xl overflow-hidden border border-line bg-surface shadow-sm hover:shadow-lg transition">
                  <div className="relative h-28 bg-navy-900">
                    {s.coverUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-85 transition" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-navy-900/80 to-transparent" />
                    <span className="absolute left-4 bottom-3 rounded-full bg-gold-500 text-navy-900 text-[11px] font-bold uppercase tracking-wide px-2.5 py-0.5">
                      {roleLabel(s.role, s.office)}
                    </span>
                  </div>
                  <div className="p-5">
                    <h2 className="font-display font-bold text-xl text-ink-900">{s.name}</h2>
                    <p className="text-sm text-ink-500 mt-1">
                      {s.memberCount} member{s.memberCount === 1 ? "" : "s"}
                      {s.clubName ? ` · ${s.clubName}` : ""}
                    </p>
                    <span className="inline-block mt-4 text-sm font-semibold text-green-700 group-hover:text-green-600">Open society admin →</span>
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
