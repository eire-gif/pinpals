import Link from "next/link";
import AdminPageHeader from "@/components/admin/page-header";
import SimpleActionForm from "@/components/admin/simple-action-form";
import ModerationForm from "@/components/admin/moderation-form";
import { requireStaff } from "@/lib/admin/authorization";
import { formatDateTime } from "@/lib/admin/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardPhotoUrl } from "@/lib/verification/server";
import { approveCard, overturnNoShow, rejectCard, upholdNoShow } from "./actions";

// /admin/trust — what the automatic trust checks hand to a person (0188,
// claude/trust-and-safety.md). Most Verified golfer checks are decided by the
// AI on its own; this lists only the ones it wasn't sure about, with the
// card photo (deleted as soon as you decide). Below them, tee-time no-shows a
// golfer has disputed — those stop counting while they wait, so leaving
// them is always the generous outcome.

type CardRow = {
  member_id: string;
  golf_ireland_number: string;
  club_name: string;
  reason: string | null;
  submitted_at: string;
  photo_path: string | null;
  ai_result: { name_on_card?: string | null; club_on_card?: string | null; number_on_card?: string | null; notes?: string } | null;
  member: { first_name: string | null; last_name: string | null; home_club: string | null } | null;
};

type DisputeRow = {
  id: number;
  invite_id: number;
  member_id: string;
  dispute_note: string | null;
  disputed_at: string;
  recorded_at: string;
  member: { first_name: string | null; last_name: string | null } | null;
  invite: { play_date: string; club_name: string | null; host: { first_name: string | null; last_name: string | null } | null } | null;
};

const full = (p: { first_name: string | null; last_name: string | null } | null | undefined) =>
  [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "A member";

export default async function TrustPage() {
  await requireStaff();
  const admin = createAdminClient();

  const [cards, disputes, verifiedCount] = await Promise.all([
    admin
      .from("member_verifications")
      .select(
        "member_id, golf_ireland_number, club_name, reason, submitted_at, photo_path, ai_result, member:profiles!member_verifications_member_id_fkey (first_name, last_name, home_club)"
      )
      .eq("status", "needs_review")
      .order("submitted_at", { ascending: true })
      .limit(50)
      .overrideTypes<CardRow[]>(),
    admin
      .from("tee_time_attendance")
      .select(
        "id, invite_id, member_id, dispute_note, disputed_at, recorded_at, member:profiles!tee_time_attendance_member_id_fkey (first_name, last_name), invite:tee_time_invites!tee_time_attendance_invite_id_fkey (play_date, club_name, host:profiles!tee_time_invites_member_id_fkey (first_name, last_name))"
      )
      .not("disputed_at", "is", null)
      .is("resolution", null)
      .order("disputed_at", { ascending: true })
      .limit(50)
      .overrideTypes<DisputeRow[]>(),
    admin.from("verified_members").select("member_id", { count: "exact", head: true }),
  ]);

  const cardRows = cards.data ?? [];
  const photos = await Promise.all(cardRows.map((c) => (c.photo_path ? cardPhotoUrl(admin, c.photo_path) : Promise.resolve(null))));
  const disputeRows = disputes.data ?? [];

  return (
    <div>
      <AdminPageHeader
        title="Trust checks"
        description={`Verified golfer cards the automatic check wasn't sure about, and disputed tee-time no-shows. ${verifiedCount.count ?? 0} members are verified.`}
      />

      <h2 className="font-display font-bold text-xl mt-6 mb-3">Cards to check · {cardRows.length}</h2>
      {cardRows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-5">Nothing waiting. The automatic check is handling them.</p>
      ) : (
        <div className="space-y-4">
          {cardRows.map((c, i) => (
            <div key={c.member_id} className="bg-surface border border-line rounded-2xl p-5 grid gap-5 md:grid-cols-[260px_1fr]">
              <div>
                {photos[i] ? (
                  <a href={photos[i] ?? undefined} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photos[i] ?? undefined} alt="Membership card" className="rounded-xl border border-line w-full object-contain max-h-64" />
                  </a>
                ) : (
                  <div className="rounded-xl bg-cream-100 h-40 flex items-center justify-center text-sm text-ink-500">No photo</div>
                )}
              </div>
              <div className="text-sm">
                <Link href={`/admin/users/${c.member_id}`} className="font-bold text-lg text-green-700 hover:text-green-600">
                  {full(c.member)}
                </Link>
                <dl className="grid grid-cols-[120px_1fr] gap-y-1 mt-3">
                  <dt className="text-ink-500">Says</dt>
                  <dd>
                    {c.club_name} · #{c.golf_ireland_number}
                    {c.member?.home_club && c.member.home_club !== c.club_name ? ` (profile club: ${c.member.home_club})` : ""}
                  </dd>
                  <dt className="text-ink-500">Card reads</dt>
                  <dd>
                    {[c.ai_result?.name_on_card, c.ai_result?.club_on_card, c.ai_result?.number_on_card && `#${c.ai_result.number_on_card}`]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </dd>
                  <dt className="text-ink-500">Why it&apos;s here</dt>
                  <dd>{c.ai_result?.notes || c.reason || "—"}</dd>
                  <dt className="text-ink-500">Sent</dt>
                  <dd>{formatDateTime(c.submitted_at)}</dd>
                </dl>
                <div className="flex flex-wrap items-start gap-4 mt-4">
                  <SimpleActionForm action={approveCard} idField="member_id" id={c.member_id} submitLabel="Approve" pendingLabel="Approving…" />
                  <div className="min-w-[260px] flex-1">
                    <ModerationForm
                      action={rejectCard}
                      idField="member_id"
                      id={c.member_id}
                      submitLabel="Reject"
                      pendingLabel="Rejecting…"
                      tone="danger"
                      placeholder="What to tell them (e.g. the name doesn't match your profile)"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="font-display font-bold text-xl mt-10 mb-3">Disputed no-shows · {disputeRows.length}</h2>
      {disputeRows.length === 0 ? (
        <p className="text-sm text-ink-500 bg-surface border border-line rounded-2xl p-5">No disputes.</p>
      ) : (
        <div className="space-y-3">
          {disputeRows.map((d) => (
            <div key={d.id} className="bg-surface border border-line rounded-2xl p-5 text-sm flex flex-wrap gap-4 justify-between">
              <div className="max-w-xl">
                <p className="font-bold">
                  <Link href={`/admin/users/${d.member_id}`} className="text-green-700 hover:text-green-600">
                    {full(d.member)}
                  </Link>{" "}
                  was marked as not turning up by {full(d.invite?.host)}
                </p>
                <p className="text-ink-500 mt-1">
                  {d.invite?.club_name ?? "Tee time"} · {d.invite?.play_date} ·{" "}
                  <Link href={`/admin/tee-times/${d.invite_id}`} className="underline">
                    round #{d.invite_id}
                  </Link>
                </p>
                <p className="mt-2">&ldquo;{d.dispute_note || "No note"}&rdquo;</p>
                <p className="text-ink-500 mt-1">Disputed {formatDateTime(d.disputed_at)}</p>
              </div>
              <div className="flex gap-3 items-start">
                <SimpleActionForm action={overturnNoShow} idField="attendance_id" id={d.id} submitLabel="Remove the no-show" pendingLabel="Saving…" />
                <SimpleActionForm action={upholdNoShow} idField="attendance_id" id={d.id} submitLabel="It stands" pendingLabel="Saving…" tone="danger" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
