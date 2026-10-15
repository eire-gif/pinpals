import { ActionButton, ConsoleForm, Field, SubmitButton } from "@/components/society-console/forms";
import { inputClass } from "@/components/society-console/styles";
import { Avatar, Card, PageHeader, Pill } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { loadMembers } from "@/lib/society-console/data";
import { appointConfirm, committeeByOffice } from "@/lib/society-console/people-rules";
import { SINGLE_OFFICES } from "@/lib/society-console/rules";
import { handOver, setOffice } from "./actions";

/**
 * The committee — each office, who holds it and what it opens. The owner
 * appoints and stands down (0144's set_group_office allows nobody else), and
 * can hand the society to another member, as on the app's member menu.
 */
export default async function CommitteePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireConsole(id, { run: true });
  const { supabase: db, society, user } = ctx;
  const g = society.id;
  const members = await loadMembers(db, g);
  const owner = members.find((m) => m.role === "owner");
  const isOwner = ctx.role === "owner";
  const offices = committeeByOffice(members);
  const byName = [...members].sort((a, b) => a.name.localeCompare(b.name, "en-IE"));
  const nameOf = (m: { id: string; name: string }) => (m.id === user.id ? `${m.name} (you)` : m.name);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Committee"
        description={
          isOwner
            ? "Each role opens part of the society to whoever holds it. You're the owner: you can do everything and you give the roles."
            : "Each role opens part of the society to whoever holds it. Only the owner gives the roles."
        }
      />

      <Card title="Owner">
        <div className="flex items-center gap-3">
          {owner && <Avatar name={owner.name} url={owner.avatarUrl} size={36} />}
          <div className="min-w-0">
            <div className="font-semibold text-ink-900">{owner ? nameOf(owner) : "—"}</div>
            <div className="text-xs text-ink-500">Can do everything, appoints the committee, and is the only one who can delete the society.</div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {offices.map((o) => (
          <Card key={o.office} title={o.label} subtitle={o.duties}>
            {o.holders.length === 0 ? (
              <p className="text-sm text-ink-500 mb-3">No one yet.</p>
            ) : (
              <ul className="space-y-2 mb-3">
                {o.holders.map((h) => (
                  <li key={h.id} className="flex items-center gap-3">
                    <Avatar name={h.name} url={h.avatarUrl} size={30} />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-ink-900 truncate">{nameOf(h)}</span>
                    {isOwner && (
                      <ActionButton action={setOffice} fields={{ g, m: h.id, office: "none" }} confirm={`Stand ${h.id === user.id ? "yourself" : h.name} down as ${o.label.toLowerCase()}?`}>
                        Stand down
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isOwner && (
              <ConsoleForm action={setOffice} quiet confirm={appointConfirm(o.office, o.holders[0] ?? null, user.id)} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="g" value={g} />
                <input type="hidden" name="office" value={o.office} />
                <div className="flex-1 min-w-[180px]">
                  <Field label={o.single && o.holders.length > 0 ? "Appoint someone else" : SINGLE_OFFICES.includes(o.office) ? "Appoint" : "Add an organiser"}>
                    <select name="m" required defaultValue="" className={inputClass}>
                      <option value="" disabled>
                        Choose a member
                      </option>
                      {byName
                        .filter((m) => m.office !== o.office)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {nameOf(m)}
                            {m.office ? ` — now ${offices.find((x) => x.office === m.office)?.label.toLowerCase()}` : ""}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>
                <SubmitButton size="sm" pendingLabel="Appointing…">
                  Appoint
                </SubmitButton>
              </ConsoleForm>
            )}
            {isOwner && o.single && o.holders.length > 0 && <p className="text-xs text-ink-500 mt-2">One {o.label.toLowerCase()} at a time: appointing someone new stands {o.holders[0].id === user.id ? "you" : o.holders[0].name} down.</p>}
          </Card>
        ))}
      </div>

      <p className="text-xs text-ink-500">
        A member holds one role at a time — giving them a new one replaces their old one. The captain and secretary run the society with the owner; the others open only their own area.
      </p>

      {isOwner && byName.length > 1 && (
        <Card title="Hand the society over" subtitle="They'll become the owner and you'll stay on as an admin. Only the new owner can give it back.">
          <ConsoleForm action={handOver} confirm={`Hand ${society.name} to them? They'll become the owner and you'll become an admin.`} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="g" value={g} />
            <div className="flex-1 min-w-[200px]">
              <Field label="New owner">
                <select name="m" required defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose a member
                  </option>
                  {byName
                    .filter((m) => m.id !== user.id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <SubmitButton tone="danger" size="sm" pendingLabel="Handing over…">
              Hand over
            </SubmitButton>
          </ConsoleForm>
        </Card>
      )}

      {!isOwner && (
        <p className="text-sm text-ink-500">
          <Pill>Owner only</Pill> <span className="ml-2">Ask {owner?.name ?? "the owner"} to change the committee.</span>
        </p>
      )}
    </div>
  );
}
