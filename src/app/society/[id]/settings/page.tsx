import { ActionButton, ConsoleForm, Field, SubmitButton, Toggle, inputClass } from "@/components/society-console/forms";
import { Card, PageHeader, Pill } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadClubWithCountry, loadMyAlerts } from "@/lib/society-console/people-data";
import { ALERT_PREFS, GROUP_ABOUT_MAX, GROUP_NAME_MAX, PRIVACY_LABELS } from "@/lib/society-console/people-rules";
import HomeClubPicker from "./home-club-picker";
import { deleteSociety, saveImage, saveMyAlerts, saveSettings } from "./actions";

/**
 * Settings — the app's settings screen (name, about, home club; delete for
 * the owner), the cover photo and logo from the society's page, and your own
 * mute switch and alert settings from its page and noticeboard.
 */
export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id, { run: true });
  const { supabase: db, society, user } = ctx;
  const g = society.id;
  const [club, alerts] = await Promise.all([loadClubWithCountry(db, society.clubId), loadMyAlerts(db, g, user.id)]);
  const canStyle = ctx.role === "owner" || ctx.office === "captain" || ctx.office === "secretary";
  const privacy = PRIVACY_LABELS[society.privacy];

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="The society's name, description, home club and look — and your own alerts." />

      <Card title="About the society">
        <ConsoleForm action={saveSettings} className="space-y-4">
          <input type="hidden" name="g" value={g} />
          <Field label="Name">
            <input name="name" required maxLength={GROUP_NAME_MAX} defaultValue={society.name} className={inputClass} />
          </Field>
          <Field label="About" hint={`Up to ${GROUP_ABOUT_MAX} characters.`}>
            <textarea name="about" rows={4} maxLength={GROUP_ABOUT_MAX} defaultValue={society.about ?? ""} placeholder="What the society is for" className={inputClass} />
          </Field>
          <div>
            <span className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-1">Home club</span>
            <HomeClubPicker clubId={club?.id ?? null} clubName={club?.name ?? society.clubName} country={club?.country ?? null} />
            <span className="block text-xs text-ink-500 mt-1">Leave it empty to clear the home club.</span>
          </div>
          <div className="rounded-xl bg-cream-100 px-4 py-3">
            <div className="text-sm font-semibold text-ink-900">Who brings people in</div>
            <p className="text-xs text-ink-500 mt-0.5">
              Only the owner, the captain and the secretary invite, share the link and approve requests. The owner appoints the committee on the Committee page.
            </p>
          </div>
          {privacy && (
            <div className="text-sm text-ink-900">
              <Pill>{privacy.label}</Pill> <span className="text-xs text-ink-500 ml-2">{privacy.hint} Set when the society was made.</span>
            </div>
          )}
          <SubmitButton>Save changes</SubmitButton>
        </ConsoleForm>
      </Card>

      {canStyle && (
        <div className="grid gap-6 md:grid-cols-2">
          {(["cover", "logo"] as const).map((which) => {
            const current = which === "cover" ? society.coverUrl : society.logoUrl;
            return (
              <Card key={which} title={which === "cover" ? "Cover photo" : "Logo"} subtitle={which === "cover" ? "Across the top of the society's page. Landscape works best." : "The society's badge, in place of the society icon. Square works best."}>
                {current ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current} alt="" className={which === "cover" ? "w-full aspect-[3/1] object-cover rounded-xl mb-3" : "h-24 w-24 object-cover rounded-2xl mb-3"} />
                ) : (
                  <p className="text-sm text-ink-500 mb-3">{which === "cover" ? "No cover photo yet." : "No logo yet."}</p>
                )}
                <ConsoleForm action={saveImage} reset className="space-y-2">
                  <input type="hidden" name="g" value={g} />
                  <input type="hidden" name="which" value={which} />
                  <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required className="block w-full text-sm text-ink-500 file:mr-3 file:rounded-full file:border-0 file:bg-cream-100 file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-ink-900" />
                  <SubmitButton size="sm" pendingLabel="Uploading…">
                    {current ? "Change" : "Upload"}
                  </SubmitButton>
                </ConsoleForm>
                {current && (
                  <div className="mt-2">
                    <ActionButton action={saveImage} fields={{ g, which, remove: "1" }} tone="danger" confirm={which === "cover" ? "Remove the cover?" : "Remove the logo?"}>
                      {which === "cover" ? "Remove the cover" : "Remove the logo"}
                    </ActionButton>
                  </div>
                )}
                <p className="text-xs text-ink-500 mt-3">JPEG, PNG or WebP. Location and camera details are removed before it&apos;s saved.</p>
              </Card>
            );
          })}
        </div>
      )}

      <Card title="Your alerts" subtitle="Just for you — the rest of the committee keeps their own.">
        <ConsoleForm action={saveMyAlerts} className="space-y-3">
          <input type="hidden" name="g" value={g} />
          <Toggle name="muted" label="Mute this society" hint="No alerts about join requests or activity here." defaultChecked={alerts.muted} />
          <div className="border-t border-line pt-3 space-y-3">
            <div className="text-xs font-bold uppercase tracking-[0.06em] text-ink-500">Alerts from this society</div>
            {ALERT_PREFS.map((p) => (
              <Toggle key={p.kind} name={`pref_${p.kind}`} label={p.label} hint={p.hint} defaultChecked={alerts.prefs[p.kind]} />
            ))}
            <p className="text-xs text-ink-500">Your place confirmed, a place opened, an event changed or cancelled, messages from the committee — always on.</p>
          </div>
          <SubmitButton size="sm">Save my alerts</SubmitButton>
        </ConsoleForm>
      </Card>

      {ctx.role === "owner" && (
        <Card title="Delete the society" className="border-red-600/30">
          <p className="text-sm text-ink-500 mb-3">The society and its member list are deleted for everyone. This can&apos;t be undone.</p>
          <ConsoleForm action={deleteSociety} confirm={`Delete ${society.name}? This can't be undone.`} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="g" value={g} />
            <div className="flex-1 min-w-[220px]">
              <Field label={`Type “${society.name}” to confirm`}>
                <input name="confirm" required autoComplete="off" className={inputClass} />
              </Field>
            </div>
            <SubmitButton tone="danger" pendingLabel="Deleting…">
              Delete society
            </SubmitButton>
          </ConsoleForm>
        </Card>
      )}
    </div>
  );
}
