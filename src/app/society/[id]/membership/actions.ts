"use server";

import type { ActionState } from "@/lib/society-console/action-state";
import { parseMembershipDraft } from "@/lib/society-console/membership-form";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { checked, positiveInt, text } from "@/lib/society-console/rules";

/**
 * Annual membership (0144): the settings (owner, captain or secretary —
 * save_membership_settings decides) and marking each member for the
 * billing season (treasurer, captain or secretary — mark_membership and
 * remind_membership decide), as the app's membership-settings and members
 * screens do.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveMembershipSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { run: true, alerts: false }, async ({ supabase, society }) => {
    const s = parseMembershipDraft({
      enabled: checked(form, "enabled"),
      fee: text(form, "fee", 20) ?? "",
      startMonth: text(form, "startMonth", 4) ?? "",
      dueAfter: text(form, "dueAfter", 4) ?? "",
      policy: text(form, "policy", 10) ?? "",
      revtag: text(form, "revtag", 60) ?? "",
      iban: text(form, "iban", 60) ?? "",
      accountName: text(form, "accountName", 200) ?? "",
      cash: checked(form, "cash"),
      note: text(form, "note", 400) ?? "",
    });
    if ("error" in s) throw new Error(s.error);
    const { error } = await supabase.rpc("save_membership_settings", {
      p_group_id: society.id,
      p: {
        enabled: s.enabled,
        fee_cents: s.feeCents,
        season_start_month: s.seasonStartMonth,
        due_after_days: s.dueAfterDays,
        unpaid_policy: s.unpaidPolicy,
        pay_revtag: s.payRevtag,
        pay_iban: s.payIban,
        pay_account_name: s.payAccountName,
        pay_cash: s.payCash,
        pay_note: s.payNote,
      },
    });
    check(error, "Couldn't save membership.");
    return s.enabled ? "Membership saved." : "Annual membership is off.";
  });
}

const MARKS = ["paid_cash", "paid_transfer", "honorary", "lapsed", "clear"] as const;

export async function markMembership(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money", alerts: false }, async ({ supabase, society }) => {
    const member = text(form, "member", 64);
    const season = positiveInt(form.get("season"));
    const mark = text(form, "mark", 20);
    if (!member || !UUID.test(member)) throw new Error("That member wasn't found.");
    if (!season || season < 2000 || season > 2100) throw new Error("Choose the season.");
    if (!mark || !(MARKS as readonly string[]).includes(mark)) throw new Error("Mark them paid, honorary or lapsed.");
    const status = mark === "paid_cash" || mark === "paid_transfer" ? "paid" : mark === "clear" ? null : mark;
    const method = mark === "paid_cash" ? "cash" : mark === "paid_transfer" ? "transfer" : null;
    const { error } = await supabase.rpc("mark_membership", { p_group_id: society.id, p_member: member, p_season: season, p_status: status, p_method: method });
    check(error, "Couldn't mark that.");
    return status === "paid" ? "Marked paid." : status === "honorary" ? "Marked honorary." : status === "lapsed" ? "Marked lapsed." : "Cleared.";
  });
}

export async function remindMembership(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "money" }, async ({ supabase, society }) => {
    const member = text(form, "member", 64);
    if (!member || !UUID.test(member)) throw new Error("That member wasn't found.");
    const { error } = await supabase.rpc("remind_membership", { p_group_id: society.id, p_member: member });
    check(error, "Couldn't send the reminder.");
    return "Reminder sent.";
  });
}
