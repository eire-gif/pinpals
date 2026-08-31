import { initials } from "@/lib/format";
import type { ConnectionProfile } from "@/lib/types";

export default function ConnectionList({ people, compact = false }: { people: ConnectionProfile[]; compact?: boolean }) {
  if (people.length === 0) {
    return <p className="bg-surface border border-line rounded-2xl p-5 text-sm text-ink-500">No connections yet. Visit Find Golfers to meet other members.</p>;
  }

  return (
    <div className={`grid ${compact ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"} gap-4`}>
      {people.map((person) => {
        const name = `${person.first_name} ${person.last_name}`;
        return (
          <div key={person.id} className="bg-surface border border-line rounded-2xl p-5 flex items-center gap-3 shadow-sm">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-display font-bold text-sm shrink-0" style={{ background: person.avatar_color ?? "#1f5c2e" }}>
              {initials(name)}
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold truncate">{name}</h3>
              <p className="text-xs text-ink-500 truncate">{person.home_club ?? "No home club listed"}</p>
              {person.county && <span className="inline-block mt-1.5 bg-cream-100 text-[11px] font-bold px-2 py-0.5 rounded-full">{person.county}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

