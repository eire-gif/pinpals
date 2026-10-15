import Link from "next/link";

import { ActionButton, ConsoleForm, Field, SubmitButton, Toggle } from "@/components/society-console/forms";
import { buttonClass, inputClass } from "@/components/society-console/styles";
import { Card, Empty, PageHeader, Pill, type PillTone } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { NOTICE_KINDS, listNotices, type Notice, type NoticeKind } from "@/lib/society-console/data";
import { consoleHref, positiveInt, whenLabel } from "@/lib/society-console/rules";
import { deleteNotice, saveNotice } from "./actions";

/**
 * The noticeboard (0143), the app's noticeboard screen for the committee:
 * post a notice (optionally pinned to the top, optionally sent as an alert
 * to everyone), edit one, or take it down. Pinned notices come first.
 * Members' own alert settings stay in the app — they're each member's.
 */

const KIND_TONE: Record<NoticeKind, PillTone> = { general: "grey", change: "red", reminder: "gold", result: "green" };
const kindLabel = (k: NoticeKind) => NOTICE_KINDS.find((n) => n.kind === k)?.label ?? "Notice";

export default async function NoticeboardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireConsole(id, { area: "messages" });
  const { supabase: db, society } = ctx;
  const g = society.id;

  const notices = await listNotices(db, g);
  const editId = positiveInt(sp.edit);
  const editing = editId ? (notices.find((n) => n.id === editId) ?? null) : null;

  return (
    <div className="grid gap-6">
      <PageHeader title="Noticeboard" description="What the committee has posted for every member to see in the app. Pinned notices stay at the top." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start">
        <NoticeForm groupId={g} notice={editing} />

        <Card title={`On the board${notices.length ? ` · ${notices.length}` : ""}`}>
          {notices.length === 0 ? (
            <Empty>Nothing posted yet.</Empty>
          ) : (
            <ul className="divide-y divide-line -my-2">
              {notices.map((n) => (
                <li key={n.id} className={`py-4 ${n.id === editId ? "bg-cream-100 -mx-5 px-5" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {n.pinned && <Pill tone="navy">Pinned</Pill>}
                    <Pill tone={KIND_TONE[n.kind]}>{kindLabel(n.kind)}</Pill>
                    <div className="ml-auto flex gap-2">
                      <Link href={`${consoleHref(g, "noticeboard")}?edit=${n.id}`} className={buttonClass("quiet", "sm")}>
                        Edit
                      </Link>
                      <ActionButton action={deleteNotice} fields={{ g, id: n.id }} tone="danger" confirm="Take this notice down? Members won't see it any more.">
                        Take down
                      </ActionButton>
                    </div>
                  </div>
                  <h3 className="font-semibold text-ink-900 mt-2">{n.title}</h3>
                  {n.body && <p className="text-sm text-ink-900 whitespace-pre-line mt-1">{n.body}</p>}
                  <p className="text-xs text-ink-500 mt-2">{[n.author, whenLabel(n.createdAt), n.editedAt ? "edited" : null].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function NoticeForm({ groupId, notice }: { groupId: number; notice: Notice | null }) {
  return (
    <Card
      title={notice ? "Edit notice" : "New notice"}
      actions={
        notice ? (
          <Link href={consoleHref(groupId, "noticeboard")} className="text-sm font-semibold text-ink-500 hover:text-ink-900">
            Cancel
          </Link>
        ) : undefined
      }
    >
      {/* key: a fresh form for each notice, so its values fill in. */}
      <ConsoleForm key={notice?.id ?? "new"} action={saveNotice} reset={!notice} className="grid gap-4">
        <input type="hidden" name="g" value={groupId} />
        {notice && <input type="hidden" name="id" value={notice.id} />}
        <fieldset>
          <legend className="block text-xs font-bold uppercase tracking-[0.06em] text-ink-500 mb-2">Kind</legend>
          <div className="flex flex-wrap gap-2">
            {NOTICE_KINDS.map((k) => (
              <label key={k.kind} className="cursor-pointer">
                <input type="radio" name="kind" value={k.kind} defaultChecked={(notice?.kind ?? "general") === k.kind} className="peer sr-only" />
                <span className="inline-block rounded-full border border-line px-3.5 py-1.5 text-sm font-semibold text-ink-900 peer-checked:bg-navy-900 peer-checked:text-cream-50 peer-checked:border-navy-900 peer-focus-visible:ring-2 peer-focus-visible:ring-green-600/40">
                  {k.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Title">
          <input name="title" required maxLength={80} defaultValue={notice?.title ?? ""} placeholder="e.g. Tee times are out for Lahinch" className={inputClass} />
        </Field>
        <Field label="Notice">
          <textarea name="body" maxLength={2000} rows={6} defaultValue={notice?.body ?? ""} placeholder="What members need to know" className={inputClass} />
        </Field>
        <Toggle name="pinned" label="Pin to the top" hint="Only one notice is pinned at a time." defaultChecked={notice?.pinned ?? false} />
        {!notice && <Toggle name="alert" label="Send as an alert to everyone" />}
        <div>
          <SubmitButton pendingLabel={notice ? "Saving…" : "Posting…"}>{notice ? "Save" : "Post"}</SubmitButton>
        </div>
      </ConsoleForm>
    </Card>
  );
}
