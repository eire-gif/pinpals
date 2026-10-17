import AdminPageHeader from "@/components/admin/page-header";
import SimpleActionForm from "@/components/admin/simple-action-form";
import UnavailableCard from "@/components/admin/unavailable-card";
import { requireStaff } from "@/lib/admin/authorization";
import { canAccess } from "@/lib/admin/roles";
import { formatDateTime } from "@/lib/admin/format";
import { AGE_SETTINGS_ROLES, loadAgeSettings } from "@/lib/admin/age";
import { setParentCardCheck } from "./actions";

// /admin/age — junior members' settings (0159, claude/junior-members.md).
// Any staff member may look; only admins change anything (re-checked in the
// action). Individual members' ages are on their own page (/admin/users/[id]).

export default async function AgeSettingsPage() {
  const { staff } = await requireStaff();
  const canEdit = canAccess(staff, AGE_SETTINGS_ROLES);
  const settings = await loadAgeSettings();

  if (!settings) {
    return (
      <div>
        <AdminPageHeader title="Junior members" />
        <UnavailableCard label="Age settings" reason="The junior members tables aren't in the database yet. Apply supabase/migrations/0159_junior_members.sql, then reload this page." />
      </div>
    );
  }

  const on = settings.requireParentCardCheck;
  return (
    <div>
      <AdminPageHeader
        title="Junior members"
        description="Golfers aged 13–15 join with a parent's approval. Reports of a member who may be under 18 are handled on that member's page (Age)."
      />
      <div className={`rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 border ${on ? "bg-navy-900 border-navy-900 text-cream-50" : "bg-surface border-line"}`}>
        <div className="max-w-xl">
          <div className={`text-xs uppercase tracking-wide font-bold ${on ? "text-gold-400" : "text-ink-500"}`}>Parent approval</div>
          <div className={`font-display font-bold text-xl ${on ? "text-cream-50" : "text-ink-900"}`}>€0 card check is {on ? "on" : "off"}</div>
          <p className={`text-xs mt-1 ${on ? "text-cream-100" : "text-ink-500"}`}>
            When on, a parent approving a 13–15 year old also enters a bank card in Stripe (nothing is charged; the card is removed straight after) before the account switches on. Off, their own 18+ PinPals account and email are the check.
            {settings.updatedAt ? ` Last changed ${formatDateTime(settings.updatedAt)}.` : ""}
          </p>
        </div>
        {canEdit && (
          <SimpleActionForm
            key={String(on)}
            action={setParentCardCheck}
            idField="enabled"
            id={on ? "off" : "on"}
            submitLabel={on ? "Turn the card check off" : "Turn the card check on"}
            pendingLabel="Saving…"
            tone={on ? "danger" : "default"}
          />
        )}
      </div>
    </div>
  );
}
