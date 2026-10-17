import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadChildPanels, loadInvitableGroups, loadMyChildren, type ChildPanel, type InvitableGroup } from "@/lib/parent-dashboard";
import { GROUP_KIND_INFO, isGroupKind } from "@/lib/groups";
import { addToGroup, setContact, stopApproving } from "./actions";
import ParentActionForm from "./parent-action-form";
import ParentApproval from "./parent-approval";

export const dynamic = "force-dynamic";

/**
 * /parent — two pages at one address (0159, claude/junior-members.md):
 *
 *   /parent#<secret>   a parent answering a 13–15 year old's request. The
 *                      secret is after the #, which the server never sees,
 *                      so ParentApproval (client) reads it and takes over.
 *   /parent            the parent dashboard, rendered here and shown by
 *                      ParentApproval when there's no secret: each child,
 *                      who they may play with, their recent rounds, and the
 *                      parent's groups to add them to.
 *
 * The app's menu opens this page as a web page, so it's built for a phone.
 */
export default async function ParentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let dashboard: React.ReactNode;
  if (!user) {
    dashboard = <SignedOut />;
  } else {
    const children = await loadMyChildren(supabase);
    const groups = children.length ? await loadInvitableGroups(supabase, user.id) : [];
    const panels = await loadChildPanels(supabase, children, groups);
    dashboard = <Dashboard panels={panels} groups={groups} />;
  }

  return <ParentApproval dashboard={dashboard} />;
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 md:py-16">
      <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-green-700">
        <span className="w-5 h-0.5 bg-gold-500 inline-block" /> For parents
      </span>
      {children}
    </div>
  );
}

function SignedOut() {
  return (
    <Frame>
      <h1 className="font-display font-bold text-3xl mt-2 mb-4">Parent dashboard</h1>
      <div className="bg-surface rounded-2xl shadow-lg p-8">
        <p className="text-ink-500">
          Golfers aged 13 to 15 join PinPals with a parent&rsquo;s approval. Log in to see your
          children&rsquo;s accounts, their rounds, and who they play with.
        </p>
        <Link href="/login?next=/parent" className="inline-block mt-5 px-5 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition">
          Log in
        </Link>
      </div>
    </Frame>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)) : "");

function Dashboard({ panels, groups }: { panels: ChildPanel[]; groups: InvitableGroup[] }) {
  if (panels.length === 0) {
    return (
      <Frame>
        <h1 className="font-display font-bold text-3xl mt-2 mb-4">Parent dashboard</h1>
        <div className="bg-surface rounded-2xl shadow-lg p-8 grid gap-3">
          <p className="text-ink-700">No children linked to your account yet.</p>
          <p className="text-ink-500 text-sm">
            Golfers aged 13 to 15 join PinPals with a parent&rsquo;s approval. When your child signs up with
            your email address, we&rsquo;ll email you a link — approve it while logged in to this account and
            they&rsquo;ll appear here, with their rounds and the PinPals they&rsquo;re allowed to play with.
          </p>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="font-display font-bold text-3xl mt-2 mb-6">Parent dashboard</h1>
      <div className="grid gap-8">
        {panels.map((p) => (
          <ChildCard key={p.child.link_id} panel={p} groups={groups} />
        ))}
      </div>
    </Frame>
  );
}

function ChildCard({ panel, groups }: { panel: ChildPanel; groups: InvitableGroup[] }) {
  const { child, contacts, rounds, inGroups } = panel;
  const name = `${child.first_name} ${child.last_name}`.trim();
  const approved = child.status === "approved";
  const addable = groups.filter((g) => !inGroups.includes(g.id));

  return (
    <section className="bg-surface rounded-2xl shadow-lg p-6 md:p-8 grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl">{name}</h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {child.age != null ? `Age ${child.age} · ` : ""}
            {approved ? `Approved ${fmtDate(child.approved_at)}` : "Waiting for your €0 card check"}
          </p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${approved ? "bg-green-100 text-green-800" : "bg-gold-500/20 text-gold-700"}`}>
          {approved ? "Approved" : "Not finished"}
        </span>
      </header>

      {approved && (
        <>
          <div>
            <h3 className="font-display font-bold text-lg">Who they can play with</h3>
            <p className="text-sm text-ink-500 mt-1 mb-3">
              Along with you and people in your groups, {child.first_name} can play with the PinPals you approve here. You can choose from your own PinPals.
            </p>
            {contacts.length === 0 ? (
              <p className="text-sm text-ink-500 bg-cream-100 rounded-xl px-4 py-3">You don&rsquo;t have any PinPals to choose from yet.</p>
            ) : (
              <ul className="grid gap-2">
                {contacts.map((c) => (
                  <li key={c.contact_id} className="flex flex-wrap items-center justify-between gap-3 border border-line rounded-xl px-4 py-3">
                    <span className="font-semibold">
                      {c.first_name} {c.last_name}
                      {c.approved && <span className="ml-2 text-xs font-bold text-green-700">Approved</span>}
                    </span>
                    <ParentActionForm action={setContact} submitLabel={c.approved ? "Remove" : "Approve"} tone={c.approved ? "quiet" : "default"}>
                      <input type="hidden" name="child" value={child.junior_id} />
                      <input type="hidden" name="contact" value={c.contact_id} />
                      <input type="hidden" name="on" value={c.approved ? "0" : "1"} />
                    </ParentActionForm>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="font-display font-bold text-lg">Recent rounds</h3>
            {rounds.length === 0 ? (
              <p className="text-sm text-ink-500 mt-2">No rounds yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border border-line rounded-xl">
                {rounds.map((r) => (
                  <li key={r.key} className="px-4 py-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span>
                      <span className="font-semibold">{r.course}</span>
                      <span className="text-ink-500"> · {r.kind}</span>
                    </span>
                    <span className="text-ink-500">
                      {r.detail ? `${r.detail} · ` : ""}
                      {fmtDate(r.when)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="font-display font-bold text-lg">Add to one of your groups</h3>
            {addable.length === 0 ? (
              <p className="text-sm text-ink-500 mt-2">
                {groups.length === 0 ? "You're not in any groups you can invite people to." : `${child.first_name} is in all your groups already.`}
              </p>
            ) : (
              <ParentActionForm action={addToGroup} submitLabel="Send invitation" pendingLabel="Sending…" className="mt-3">
                <input type="hidden" name="child" value={child.junior_id} />
                <label className="sr-only" htmlFor={`group-${child.link_id}`}>Group</label>
                <select id={`group-${child.link_id}`} name="group" required className="w-full px-3 py-2.5 rounded-lg border-[1.5px] border-line bg-surface">
                  <option value="">Choose a group…</option>
                  {addable.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {isGroupKind(g.kind) ? ` (${GROUP_KIND_INFO[g.kind].label.toLowerCase()})` : ""}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-ink-500">{child.first_name} accepts the invitation in the app.</span>
              </ParentActionForm>
            )}
          </div>
        </>
      )}

      <details className="border-t border-line pt-4">
        <summary className="text-sm font-semibold text-ink-500 cursor-pointer hover:text-red-600">Stop approving {child.first_name}&rsquo;s account</summary>
        <ParentActionForm action={stopApproving} submitLabel="Stop approving" pendingLabel="Saving…" tone="danger" className="mt-3">
          <input type="hidden" name="link" value={child.link_id} />
          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input type="checkbox" name="confirm" className="mt-1 w-4 h-4 accent-red-600" />
            <span>
              I understand {child.first_name}&rsquo;s account will be paused — no live scoring or playing with others — until a parent approves it again.
            </span>
          </label>
        </ParentActionForm>
      </details>
    </section>
  );
}
