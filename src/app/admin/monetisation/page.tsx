import AdminPageHeader from "@/components/admin/page-header";
import StatCard from "@/components/admin/stat-card";
import UnavailableCard from "@/components/admin/unavailable-card";
import FieldsActionForm from "@/components/admin/fields-action-form";
import SimpleActionForm from "@/components/admin/simple-action-form";
import { requireStaff } from "@/lib/admin/authorization";
import { MembershipsNotInstalledError, canEditMemberships, getMembershipOverview, type MembershipOverview } from "@/lib/admin/memberships";
import { FEATURE_GROUPS, GROUP_INFO, membershipStatusLine, type MembershipSettings } from "@/lib/memberships";
import { saveMembershipSettings, setPaidPlansEnabled } from "./actions";
import FeatureRow from "./feature-row";

// /admin/monetisation — Basic / Premium / Pro (0156, claude/memberships.md).
// Any active staff member may look; only a super admin changes anything
// (re-checked inside every action).

export default async function MonetisationPage() {
  const { staff } = await requireStaff();
  const canEdit = canEditMemberships(staff.role);

  let data: MembershipOverview;
  try {
    data = await getMembershipOverview();
  } catch (err) {
    if (err instanceof MembershipsNotInstalledError) {
      return (
        <div>
          <AdminPageHeader title="Monetisation" />
          <UnavailableCard
            label="Memberships"
            reason="The membership tables aren't in the database yet. Apply supabase/migrations/0156_memberships.sql, then reload this page."
          />
        </div>
      );
    }
    throw err;
  }

  const { settings, features, counts } = data;

  return (
    <div>
      <AdminPageHeader
        title="Monetisation"
        description="Choose which features are free and which need Premium or Pro. Changes reach the app within a minute — no app release needed."
      />

      <MasterSwitch settings={settings} canEdit={canEdit} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard label="Premium members" value={String(counts.premium)} hint="Active subscriptions and grants" />
        <StatCard label="Pro members" value={String(counts.pro)} hint="Organisers and secretaries" />
        <StatCard label="In a free trial" value={String(counts.trials)} hint="Counted from the store webhook" />
        <StatCard label="Staff grants" value={String(counts.staffGrants)} hint="Given free by PinPals" />
      </div>

      <section className="bg-surface border border-line rounded-2xl p-5 mb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="font-display font-bold text-lg text-ink-900">Plans &amp; prices</h2>
          <p className="text-xs text-ink-500 max-w-xl">
            Apple and Google charge the real price — set it in App Store Connect and Play Console. These are the prices the app shows, so keep them the same.
          </p>
        </div>
        <SettingsForm settings={settings} canEdit={canEdit} />
      </section>

      <section className="bg-surface border border-line rounded-2xl px-5 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-5">
          <div>
            <h2 className="font-display font-bold text-lg text-ink-900">Feature access</h2>
            <p className="text-xs text-ink-500 mt-1 max-w-2xl">
              Tap a level to save it. <strong className="text-ink-900">Keep for existing members</strong> lets members who joined before a feature went paid keep it free.
              {settings.paid_plans_enabled ? "" : " Paid plans are off, so for now every feature that isn't Off is free for everyone."}
            </p>
          </div>
        </div>

        {features.length === 0 ? (
          <p className="text-sm text-ink-500 py-6">No features in the list — 0156 seeds them; re-run it to add them back.</p>
        ) : (
          FEATURE_GROUPS.map((g) => {
            const rows = features.filter((f) => f.group_key === g);
            if (rows.length === 0) return null;
            return (
              <div key={g} className="mt-6">
                <div className="flex items-baseline gap-3 pb-2 border-b-2 border-navy-900">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-navy-900">{GROUP_INFO[g].title}</h3>
                  <span className="text-xs text-ink-500">{GROUP_INFO[g].note}</span>
                </div>
                {rows.map((f) => (
                  <FeatureRow key={`${f.key}:${f.access}:${f.when_locked}:${f.keep_for_existing}`} feature={f} canEdit={canEdit} />
                ))}
              </div>
            );
          })
        )}

        <div className="mt-6 rounded-xl bg-cream-100 px-4 py-3 text-xs text-ink-500 flex flex-wrap gap-x-3 gap-y-1">
          <span className="font-bold text-ink-900">Always free — not on this list on purpose:</span>
          <span>joining societies &amp; events</span>·<span>offering and booking tee times</span>·
          <span>marketplace listings (we earn the commission instead)</span>·<span>Rules of Golf</span>·<span>guides</span>
        </div>
      </section>
    </div>
  );
}

function MasterSwitch({ settings, canEdit }: { settings: MembershipSettings; canEdit: boolean }) {
  const on = settings.paid_plans_enabled;
  return (
    <div
      className={`mb-8 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4 border ${
        on ? "bg-navy-900 border-navy-900 text-cream-50" : "bg-surface border-line"
      }`}
    >
      <div>
        <div className={`text-xs uppercase tracking-wide font-bold ${on ? "text-gold-400" : "text-ink-500"}`}>Master switch</div>
        <div className={`font-display font-bold text-xl ${on ? "text-cream-50" : "text-ink-900"}`}>Paid plans are {on ? "on" : "off"}</div>
        <div className={`text-xs mt-0.5 ${on ? "text-cream-100" : "text-ink-500"}`}>{membershipStatusLine(settings)}</div>
      </div>
      {canEdit && (
        <SimpleActionForm
          key={String(on)}
          action={setPaidPlansEnabled}
          idField="enabled"
          id={on ? "off" : "on"}
          submitLabel={on ? "Turn paid plans off" : "Turn paid plans on"}
          pendingLabel="Saving…"
          tone={on ? "danger" : "default"}
        />
      )}
    </div>
  );
}

const input = "w-full text-sm px-3 py-2 border border-line rounded-lg bg-surface text-ink-900 disabled:opacity-60";

function SettingsForm({ settings, canEdit }: { settings: MembershipSettings; canEdit: boolean }) {
  const fields = (
    <>
      <div className="grid md:grid-cols-2 gap-4">
        <fieldset className="rounded-xl border-2 border-navy-800 p-4 grid grid-cols-2 gap-3" disabled={!canEdit}>
          <legend className="px-1 font-display font-bold text-navy-800">Premium · golfers</legend>
          <label className="text-xs font-semibold text-ink-500 grid gap-1">
            Monthly
            <input name="premium_monthly_price" defaultValue={settings.premium_monthly_price} className={input} />
          </label>
          <label className="text-xs font-semibold text-ink-500 grid gap-1">
            Annual
            <input name="premium_annual_price" defaultValue={settings.premium_annual_price} className={input} />
          </label>
          <label className="text-xs font-semibold text-ink-500 grid gap-1 col-span-2">
            Free trial (annual plan)
            <TrialSelect name="premium_trial_days" value={settings.premium_trial_days} />
          </label>
          <div className="col-span-2 font-mono text-[11px] text-ink-500">pinpals.premium.monthly · pinpals.premium.annual</div>
        </fieldset>
        <fieldset className="rounded-xl border-2 border-gold-500 p-4 grid grid-cols-2 gap-3" disabled={!canEdit}>
          <legend className="px-1 font-display font-bold text-gold-600">Pro · organisers</legend>
          <label className="text-xs font-semibold text-ink-500 grid gap-1">
            Monthly
            <input name="pro_monthly_price" defaultValue={settings.pro_monthly_price} className={input} />
          </label>
          <label className="text-xs font-semibold text-ink-500 grid gap-1">
            Annual
            <input name="pro_annual_price" defaultValue={settings.pro_annual_price} className={input} />
          </label>
          <label className="text-xs font-semibold text-ink-500 grid gap-1 col-span-2">
            Free trial (annual plan)
            <TrialSelect name="pro_trial_days" value={settings.pro_trial_days} />
          </label>
          <div className="col-span-2 font-mono text-[11px] text-ink-500">pinpals.pro.monthly · pinpals.pro.annual</div>
        </fieldset>
      </div>
      <label className="text-sm font-semibold text-ink-900 flex flex-wrap items-center gap-3">
        Launch offer: everything free until
        <input type="date" name="free_until" defaultValue={settings.free_until ?? ""} disabled={!canEdit} className={`${input} w-auto`} />
        <span className="text-xs font-normal text-ink-500">Leave empty for no offer. Ends at midnight Irish time.</span>
      </label>
    </>
  );

  if (!canEdit) return <div className="grid gap-4">{fields}</div>;
  return (
    <FieldsActionForm action={saveMembershipSettings} submitLabel="Save plans & prices" pendingLabel="Saving…" className="grid gap-4">
      {fields}
    </FieldsActionForm>
  );
}

function TrialSelect({ name, value }: { name: string; value: number }) {
  return (
    <select name={name} defaultValue={String(value)} className={input}>
      <option value="0">None</option>
      <option value="7">7 days</option>
      <option value="14">14 days</option>
    </select>
  );
}
