import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin/authorization";
import { LIVE_PANEL_ROLES, activityHref, cardSummary, formatLabel, toParText } from "@/lib/admin/live-panel";
import { getScorecardDetail } from "@/lib/admin/activity-lists";
import AdminPageHeader from "@/components/admin/page-header";
import { Pill } from "@/components/admin/table";

export const dynamic = "force-dynamic";

/** One member's scorecard, hole by hole (super admin, from Activity). */
export default async function AdminScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff({ roles: LIVE_PANEL_ROLES });
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isInteger(cardId) || cardId <= 0) notFound();
  const detail = await getScorecardDetail(cardId);
  if (!detail) notFound();

  const { card, holes, certifications, playingPartners } = detail;
  const s = cardSummary(holes, card.holes);
  const front = holes.filter((h) => h.hole <= 9);
  const back = holes.filter((h) => h.hole > 9);
  const certified = certifications.find((c) => c.status === "certified");
  const playedOn = new Date(`${card.played_on}T12:00:00Z`).toLocaleDateString("en-IE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <AdminPageHeader
        eyebrow={
          <Link href={activityHref("scorecards")} className="hover:underline">
            ← Scorecards completed
          </Link>
        }
        title={
          <>
            {card.member ? (
              <Link href={`/admin/users/${card.member.id}`} className="hover:underline">
                {card.member.name}
              </Link>
            ) : (
              "Former member"
            )}{" "}
            <span className="text-ink-500 font-normal">at</span> {card.course_name}
          </>
        }
        description={[
          playedOn,
          card.tee_name ? `${card.tee_name} tees` : null,
          card.team_card ? formatLabel(card.team_card) : null,
          card.source === "live" ? "From live scoring" : "Entered by hand",
          card.visibility === "private" ? "Private card" : card.visibility === "members" ? "Visible to all members" : "Visible to PinPals",
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <Stat label="Gross" value={s.played ? String(s.gross) : "—"} />
        <Stat label="To par" value={s.played ? toParText(s.toPar) : "—"} />
        <Stat label="Holes played" value={`${s.played} / ${card.holes}`} />
        <Stat label="Putts" value={s.putts == null ? "—" : String(s.putts)} />
        <Stat
          label="Handicap"
          value={card.playing_handicap != null ? String(card.playing_handicap) : card.handicap_index != null ? String(card.handicap_index) : "—"}
          sub={card.handicap_index != null ? `Index ${card.handicap_index}` : undefined}
        />
      </div>

      <div className="bg-surface border border-line rounded-2xl shadow-sm overflow-x-auto mb-5">
        <table className="w-full text-sm min-w-[640px] tabular-nums">
          <thead>
            <tr className="text-ink-500 text-xs uppercase tracking-wide border-b border-line">
              <th className="px-3 py-2.5 text-left font-semibold">Hole</th>
              <th className="px-3 py-2.5 text-right font-semibold">Yards</th>
              <th className="px-3 py-2.5 text-right font-semibold">SI</th>
              <th className="px-3 py-2.5 text-right font-semibold">Par</th>
              <th className="px-3 py-2.5 text-center font-semibold">Score</th>
              <th className="px-3 py-2.5 text-right font-semibold">Putts</th>
            </tr>
          </thead>
          <tbody>
            {front.map((h) => (
              <HoleRow key={h.hole} h={h} />
            ))}
            {front.length > 0 && <SubtotalRow label="Out" holes={front} />}
            {back.map((h) => (
              <HoleRow key={h.hole} h={h} />
            ))}
            {back.length > 0 && <SubtotalRow label="In" holes={back} />}
            <SubtotalRow label="Total" holes={holes} strong />
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ink-900 mb-2">Certification</h2>
          {certifications.length === 0 ? (
            <p className="text-sm text-ink-500">Not sent for certification.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {certifications.map((c, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <Pill tone={c.status === "certified" ? "good" : c.status === "queried" || c.status === "pending" ? "warn" : "neutral"}>
                    {c.status}
                  </Pill>
                  <span className="text-ink-900">{c.certifier_name}</span>
                  {c.method && <span className="text-ink-500 text-xs">{c.method.replace("_", " ")}</span>}
                  {c.query_hole && (
                    <span className="text-ink-500 text-xs">
                      Queried hole {c.query_hole}
                      {c.query_note ? ` — “${c.query_note}”` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {certified && <p className="text-xs text-ink-500 mt-2">Certified by {certified.certifier_name}.</p>}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ink-900 mb-2">The round</h2>
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-ink-500">Played with</dt>
            <dd className="text-ink-900">{playingPartners.length ? playingPartners.join(", ") : "—"}</dd>
            <dt className="text-ink-500">Par</dt>
            <dd className="text-ink-900">{card.par_total ?? "—"}</dd>
            <dt className="text-ink-500">Rating / slope</dt>
            <dd className="text-ink-900">
              {card.course_rating ?? "—"} / {card.slope ?? "—"}
            </dd>
            <dt className="text-ink-500">Saved</dt>
            <dd className="text-ink-900">
              {new Date(card.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Dublin" })}
            </dd>
            {card.updated_at !== card.created_at && (
              <>
                <dt className="text-ink-500">Last changed</dt>
                <dd className="text-ink-900">
                  {new Date(card.updated_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Dublin" })}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-sm">
      <div className="text-xs font-semibold text-ink-500">{label}</div>
      <div className="font-display font-bold text-2xl mt-1 text-ink-900 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-500">{sub}</div>}
    </div>
  );
}

type Hole = { hole: number; par: number; stroke_index: number | null; yards: number | null; strokes: number | null; putts: number | null };

/** Birdie or better circled in green, bogey boxed, double or worse boxed darker — how a card reads. */
function scoreStyle(strokes: number | null, par: number): { cls: string; label: string } {
  if (strokes == null) return { cls: "text-ink-500", label: "" };
  const d = strokes - par;
  if (d <= -2) return { cls: "bg-gold-500 text-navy-900 rounded-full", label: "Eagle or better" };
  if (d === -1) return { cls: "bg-green-700 text-cream-50 rounded-full", label: "Birdie" };
  if (d === 0) return { cls: "text-ink-900", label: "Par" };
  if (d === 1) return { cls: "border border-ink-500 text-ink-900 rounded-[4px]", label: "Bogey" };
  return { cls: "bg-navy-900 text-cream-50 rounded-[4px]", label: "Double bogey or worse" };
}

function HoleRow({ h }: { h: Hole }) {
  const st = scoreStyle(h.strokes, h.par);
  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-2 font-semibold text-ink-900">{h.hole}</td>
      <td className="px-3 py-2 text-right text-ink-500">{h.yards ?? ""}</td>
      <td className="px-3 py-2 text-right text-ink-500">{h.stroke_index ?? ""}</td>
      <td className="px-3 py-2 text-right">{h.par}</td>
      <td className="px-3 py-1.5 text-center">
        <span title={st.label} className={`inline-flex h-7 w-7 items-center justify-center font-bold ${st.cls}`}>
          {h.strokes ?? "–"}
        </span>
      </td>
      <td className="px-3 py-2 text-right">{h.putts ?? ""}</td>
    </tr>
  );
}

function SubtotalRow({ label, holes, strong }: { label: string; holes: Hole[]; strong?: boolean }) {
  const sum = (f: (h: Hole) => number | null) => {
    const vals = holes.map(f).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  return (
    <tr className={`border-b border-line ${strong ? "bg-navy-900 text-cream-50" : "bg-cream-100"}`}>
      <td className="px-3 py-2 font-bold">{label}</td>
      <td className="px-3 py-2 text-right">{sum((h) => h.yards) ?? ""}</td>
      <td className="px-3 py-2" />
      <td className="px-3 py-2 text-right font-semibold">{sum((h) => h.par) ?? ""}</td>
      <td className="px-3 py-2 text-center font-bold">{sum((h) => h.strokes) ?? "–"}</td>
      <td className="px-3 py-2 text-right">{sum((h) => h.putts) ?? ""}</td>
    </tr>
  );
}
