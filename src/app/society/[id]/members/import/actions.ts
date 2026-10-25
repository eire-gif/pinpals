"use server";

import { sendEmailBatch } from "@/lib/email";
import type { ActionState } from "@/lib/society-console/action-state";
import type { ConsoleContext } from "@/lib/society-console/access";
import { importSummary, sanitiseRows, type ImportOutcome } from "@/lib/society-console/member-import";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { buildSocietyInviteEmail } from "@/lib/society-invite-email";
import { getSiteUrl } from "@/lib/site-url";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Emails one account can send through imports and resends, per day, across
 * all its societies (security review, Oct 2026). Any member can start a
 * society, so without this the import was a free PinPals-branded mailer.
 * A big society's first import fits; a second big list waits until tomorrow.
 */
const IMPORT_EMAILS_PER_DAY = 500;

async function chargeEmails(userId: string, count: number): Promise<void> {
  const limit = await checkRateLimit({
    action: "society-invite-emails",
    identifier: userId,
    maxHits: IMPORT_EMAILS_PER_DAY,
    windowSeconds: 24 * 60 * 60,
    cost: count,
    failClosed: true,
  });
  if (!limit.allowed) {
    throw new Error(
      `That would go over today's limit of ${IMPORT_EMAILS_PER_DAY} invitation emails. Send a shorter list, or try again tomorrow.`
    );
  }
}

/**
 * Import from spreadsheet (0170). The browser reads the file and shows the
 * preview; the rows come back here, are checked again (sanitiseRows), and go
 * through import_group_email_invites as the secretary — the database decides
 * who's invited, who's added and who's already in. Emails go out through
 * Resend's batch endpoint; only the ones it accepted are stamped as sent.
 */

type Send = { id: number; email: string; firstName: string | null; token: string; kind: "invite" | "added" };

const emailInviteLink = (token: string) => `${getSiteUrl()}/join/s/${token}`;

async function inviterName(ctx: ConsoleContext): Promise<string | null> {
  const { data } = await ctx.supabase.from("profiles").select("first_name, last_name").eq("id", ctx.user.id).maybeSingle();
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

/** Sends, stamps what went, and answers how many didn't. */
async function sendAll(ctx: ConsoleContext, sends: Send[]): Promise<number> {
  if (sends.length === 0) return 0;
  const by = await inviterName(ctx);
  const ok = await sendEmailBatch(
    sends.map((s) =>
      buildSocietyInviteEmail({
        kind: s.kind,
        societyName: ctx.society.name,
        inviterName: by,
        firstName: s.firstName,
        email: s.email,
        link: emailInviteLink(s.token),
        logoUrl: ctx.society.logoUrl,
      })
    )
  );
  const sent = sends.filter((_, i) => ok[i]).map((s) => s.id);
  if (sent.length > 0) {
    const { error } = await ctx.supabase.rpc("mark_group_email_invites_sent", { p_group_id: ctx.society.id, p_ids: sent });
    if (error) console.error("[member-import] couldn't stamp sends", error.message);
  }
  return sends.length - sent.length;
}

export async function importMembers(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "people", alerts: false }, async (ctx) => {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(String(form.get("rows") ?? "[]"));
    } catch {
      parsed = null;
    }
    const rows = sanitiseRows(parsed);
    if (rows.length === 0) throw new Error("Choose a file or paste some email addresses first.");
    await chargeEmails(ctx.user.id, rows.length);

    const { data, error } = await ctx.supabase.rpc("import_group_email_invites", {
      p_group_id: ctx.society.id,
      p_rows: rows.map((r) => ({ email: r.email, first_name: r.firstName, last_name: r.lastName })),
    });
    check(error, "Couldn't import that list.");

    const results = (data ?? []) as { invite_id: number | null; email: string; first_name: string | null; outcome: ImportOutcome; token: string | null }[];
    const counts: Partial<Record<ImportOutcome, number>> = {};
    const sends: Send[] = [];
    for (const r of results) {
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
      if ((r.outcome === "invited" || r.outcome === "added") && r.token && r.invite_id) {
        sends.push({ id: r.invite_id, email: r.email, firstName: r.first_name, token: r.token, kind: r.outcome === "added" ? "added" : "invite" });
      }
    }
    const failed = await sendAll(ctx, sends);
    return importSummary(counts, failed);
  });
}

const ids = (form: FormData) =>
  [...new Set(form.getAll("i").map((v) => Number(v)).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 500);

export async function resendInvites(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "people", alerts: false }, async (ctx) => {
    let wanted = ids(form);
    if (form.get("all") === "1") {
      const { data } = await ctx.supabase.from("group_email_invites").select("id").eq("group_id", ctx.society.id).eq("status", "pending").limit(500);
      wanted = (data ?? []).map((r) => Number(r.id));
    }
    if (wanted.length === 0) throw new Error("Nobody waiting to resend to.");
    await chargeEmails(ctx.user.id, wanted.length);
    const { data, error } = await ctx.supabase.rpc("resend_group_email_invites", { p_group_id: ctx.society.id, p_ids: wanted });
    check(error, "Couldn't resend.");
    const rows = (data ?? []) as { invite_id: number; email: string; first_name: string | null; token: string }[];
    if (rows.length === 0) return "Already emailed within the last hour — try again later.";
    const failed = await sendAll(
      ctx,
      rows.map((r) => ({ id: r.invite_id, email: r.email, firstName: r.first_name, token: r.token, kind: "invite" as const }))
    );
    const sent = rows.length - failed;
    if (sent === 0) return "The emails didn't send — check the email set-up, then try again.";
    return `${sent === 1 ? "Invitation" : `${sent} invitations`} sent again.${failed ? ` ${failed} didn't send.` : ""}`;
  });
}

export async function cancelInvite(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "people", alerts: false }, async (ctx) => {
    const [id] = ids(form);
    if (!id) throw new Error("That invitation wasn't found.");
    const { error } = await ctx.supabase.rpc("cancel_group_email_invite", { p_group_id: ctx.society.id, p_invite_id: id });
    check(error, "Couldn't cancel it.");
    return "Invitation cancelled — the link no longer works.";
  });
}
