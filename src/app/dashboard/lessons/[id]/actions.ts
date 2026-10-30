"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLessonPaymentIntent } from "@/lib/lessons-server";

export type LessonCheckoutState = { error?: string; clientSecret?: string };

/**
 * The golfer starts paying for a held lesson (0204). Only the booking id
 * comes from the form; the amount and the pro come from the booking row
 * (createLessonPaymentIntent re-checks the caller is the golfer).
 */
export async function startLessonPayment(_prev: LessonCheckoutState, formData: FormData): Promise<LessonCheckoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const bookingId = Number(formData.get("bookingId"));
  if (!Number.isInteger(bookingId) || bookingId <= 0) return { error: "Missing booking." };
  const result = await createLessonPaymentIntent(createAdminClient(), user.id, bookingId);
  return "error" in result ? { error: result.error } : { clientSecret: result.clientSecret };
}
