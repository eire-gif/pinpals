"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ConnectionActionState = { error?: string; success?: boolean };

function refreshConnections() {
  revalidatePath("/community");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/connections");
}

export async function sendConnectionRequest(
  recipientId: string,
  _previous: ConnectionActionState,
  _formData: FormData
): Promise<ConnectionActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (recipientId === user.id) return { error: "You can't connect with yourself." };

  const { data: existing } = await supabase
    .from("connections")
    .select("id, status")
    .or(`and(requester_id.eq.${user.id},recipient_id.eq.${recipientId}),and(requester_id.eq.${recipientId},recipient_id.eq.${user.id})`)
    .maybeSingle();

  if (existing?.status === "pending") return { error: "A connection request is already pending." };
  if (existing?.status === "accepted") return { error: "You are already connected." };
  if (existing?.status === "declined") {
    const { error: removeError } = await supabase.from("connections").delete().eq("id", existing.id);
    if (removeError) return { error: "Couldn't resend that request — please try again." };
  }

  const { error } = await supabase.from("connections").insert({
    requester_id: user.id,
    recipient_id: recipientId,
  });

  if (error) {
    if (error.code === "23505") return { error: "A connection request already exists." };
    return { error: "Couldn't send your connection request — please try again." };
  }

  refreshConnections();
  return { success: true };
}

export async function respondToConnection(connectionId: number, accept: boolean) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("connections")
    .update({ status: accept ? "accepted" : "declined" })
    .eq("id", connectionId)
    .eq("recipient_id", user.id)
    .eq("status", "pending");

  if (error) return { error: "Couldn't update that request — please try again." };
  refreshConnections();
  return {};
}

