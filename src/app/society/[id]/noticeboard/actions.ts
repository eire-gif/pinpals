"use server";

import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/society-console/action-state";
import { NOTICE_KINDS, type NoticeKind } from "@/lib/society-console/data";
import { check, consoleAction } from "@/lib/society-console/server-action";
import { checked, consoleHref, positiveInt, text } from "@/lib/society-console/rules";

/**
 * The noticeboard (0143), as the app's noticeboard screen: post, edit and
 * take down — whoever has the "messages" area; save_society_notice and
 * delete_society_notice decide.
 */

const isKind = (v: unknown): v is NoticeKind => NOTICE_KINDS.some((k) => k.kind === v);

export async function saveNotice(_prev: ActionState, form: FormData): Promise<ActionState> {
  const editing = positiveInt(form.get("id"));
  const result = await consoleAction(form.get("g"), { area: "messages" }, async ({ supabase, society }) => {
    const kind = form.get("kind");
    const title = text(form, "title", 200);
    const body = text(form, "body", 4000);
    if (!isKind(kind)) throw new Error("Choose what kind of notice it is.");
    if (!title) throw new Error("Give the notice a title.");
    if (title.length > 80) throw new Error("The title is 80 characters at most.");
    if (body && body.length > 2000) throw new Error("The notice is 2,000 characters at most.");
    // Only a new notice can go out as an alert, as in the app.
    const alert = editing == null && checked(form, "alert");
    const { error } = await supabase.rpc("save_society_notice", { p_group_id: society.id, p_id: editing, p: { kind, title, body, pinned: checked(form, "pinned"), alert } });
    check(error, "Couldn't post that.");
    return editing ? "Notice saved." : alert ? "Posted, and sent as an alert to everyone." : "Posted.";
  });
  // After an edit, back to the board.
  if (editing && result.ok) redirect(consoleHref(Number(form.get("g")), "noticeboard"));
  return result;
}

export async function deleteNotice(_prev: ActionState, form: FormData): Promise<ActionState> {
  return consoleAction(form.get("g"), { area: "messages", alerts: false }, async ({ supabase, society }) => {
    const id = positiveInt(form.get("id"));
    if (!id) throw new Error("That notice has gone.");
    const { data: n } = await supabase.from("society_notices").select("id").eq("id", id).eq("group_id", society.id).maybeSingle();
    if (!n) throw new Error("That notice has gone.");
    const { error } = await supabase.rpc("delete_society_notice", { p_id: id });
    check(error, "Couldn't take it down.");
    return "Taken down.";
  });
}
