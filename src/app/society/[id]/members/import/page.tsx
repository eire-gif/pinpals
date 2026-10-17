import Link from "next/link";

import { ActionButton } from "@/components/society-console/forms";
import { Card, Empty, PageHeader, Pill, Table, Td, type PillTone } from "@/components/society-console/ui";
import { requireConsole } from "@/lib/society-console/access";
import { consoleHref, whenLabel } from "@/lib/society-console/rules";
import { cancelInvite, resendInvites } from "./actions";
import ImportForm from "./import-form";

type Status = "pending" | "joined" | "cancelled";
type Row = {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  status: Status;
  failure: string | null;
  created_at: string;
  emailed_at: string | null;
  email_count: number;
  joined_at: string | null;
};

const FILTERS: { key: Status; label: string }[] = [
  { key: "pending", label: "Waiting" },
  { key: "joined", label: "Joined" },
  { key: "cancelled", label: "Cancelled" },
];
const isStatus = (v: unknown): v is Status => v === "pending" || v === "joined" || v === "cancelled";

/**
 * Import from spreadsheet (0170): upload the society's member list, everyone
 * gets an email, and each person joins the moment they sign in to PinPals
 * with that address (or opens their email's link signed in). Below, every
 * emailed invitation and where it's got to.
 */
export default async function ImportMembersPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireConsole(id, { area: "people" });
  const { supabase: db, society } = ctx;
  const g = society.id;
  const status: Status = isStatus(sp.status) ? sp.status : "pending";

  const [{ data: list }, counts] = await Promise.all([
    db
      .from("group_email_invites")
      .select("id, email, first_name, last_name, status, failure, created_at, emailed_at, email_count, joined_at")
      .eq("group_id", g)
      .eq("status", status)
      .order(status === "joined" ? "joined_at" : "created_at", { ascending: false })
      .limit(500)
      .overrideTypes<Row[]>(),
    Promise.all(
      FILTERS.map(async (f) => {
        const { count } = await db.from("group_email_invites").select("id", { count: "exact", head: true }).eq("group_id", g).eq("status", f.key);
        return [f.key, count ?? 0] as const;
      })
    ).then((pairs) => new Map(pairs)),
  ]);
  const rows = list ?? [];
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const base = consoleHref(g, "members/import");
  const name = (r: Row) => [r.first_name, r.last_name].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import from spreadsheet"
        back={{ href: consoleHref(g, "members"), label: "Members & requests" }}
        description="Upload the society's member list. Everyone gets an email, and joins the society as soon as they sign in to PinPals with that address."
      />

      <Card title="1. Your member list" subtitle="CSV from Excel, Google Sheets or Numbers — or paste the addresses.">
        <ImportForm g={g} societyName={society.name} />
      </Card>

      <Card title="How joining works">
        <ol className="grid gap-4 sm:grid-cols-3 text-sm text-ink-900">
          <li className="rounded-xl bg-cream-50 border border-line p-4">
            <div className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600 mb-1">New to PinPals</div>
            They get an email from PinPals with a Join button. When they sign up — on the website or in the app — with that email, they&apos;re in.
          </li>
          <li className="rounded-xl bg-cream-50 border border-line p-4">
            <div className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600 mb-1">Already on PinPals</div>
            Added straight away, and emailed to say so. They can leave from the society&apos;s page if they want.
          </li>
          <li className="rounded-xl bg-cream-50 border border-line p-4">
            <div className="text-xs font-bold uppercase tracking-[0.06em] text-gold-600 mb-1">Different email?</div>
            Their email&apos;s button still works: opened while signed in to any PinPals account, it adds that account.
          </li>
        </ol>
      </Card>

      <Card
        title={`2. Invitations sent (${total})`}
        subtitle="Who's joined and who hasn't yet. Resend reaches anyone not emailed in the last hour."
        actions={
          (counts.get("pending") ?? 0) > 0 ? (
            <ActionButton action={resendInvites} fields={{ g, all: "1" }} confirm={`Email everyone who hasn't joined yet (${counts.get("pending")}) again?`}>
              Resend to all waiting
            </ActionButton>
          ) : undefined
        }
      >
        <div className="flex flex-wrap gap-2 mb-4">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "pending" ? base : `${base}?status=${f.key}`}
              aria-current={status === f.key ? "true" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${status === f.key ? "bg-navy-900 text-cream-50" : "bg-surface border border-line text-ink-900 hover:bg-cream-100"}`}
            >
              {f.label} {counts.get(f.key) ?? 0}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? (
          <Empty>{status === "pending" ? "No one waiting — upload a list above." : status === "joined" ? "Nobody has joined from an invitation yet." : "No cancelled invitations."}</Empty>
        ) : (
          <Table head={["Name", "Email", status === "joined" ? "Joined" : "Emailed", ""]}>
            {rows.map((r) => {
              const tone: PillTone = r.failure ? "red" : r.emailed_at ? "grey" : "gold";
              return (
                <tr key={r.id}>
                  <Td>
                    <div className="font-semibold">{name(r) || <span className="text-ink-500 font-normal">—</span>}</div>
                    {r.failure && <div className="text-xs text-red-600 max-w-xs">{r.failure}</div>}
                  </Td>
                  <Td className="font-mono text-xs">{r.email}</Td>
                  <Td className="whitespace-nowrap">
                    {status === "joined" ? (
                      r.joined_at ? whenLabel(r.joined_at) : "—"
                    ) : r.emailed_at ? (
                      <span>
                        {whenLabel(r.emailed_at)}
                        {r.email_count > 1 && <span className="text-ink-500"> · ×{r.email_count}</span>}
                      </span>
                    ) : (
                      <Pill tone={tone}>Not sent</Pill>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {status === "pending" && (
                      <div className="inline-flex gap-2">
                        <ActionButton action={resendInvites} fields={{ g, i: r.id }}>
                          Resend
                        </ActionButton>
                        <ActionButton action={cancelInvite} fields={{ g, i: r.id }} tone="danger" confirm={`Cancel ${r.email}'s invitation? Their link stops working.`}>
                          Cancel
                        </ActionButton>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
