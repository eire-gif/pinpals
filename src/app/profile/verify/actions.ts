"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitVerification, VerificationError, type VerificationView } from "@/lib/verification/server";

export type VerifyState = { error?: string; result?: VerificationView };

/** The website's way into the same check the app uses (0188). */
export async function verifyCard(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Add a photo of your membership card." };

  const clubIdRaw = Number(formData.get("club_id"));
  try {
    const result = await submitVerification({
      admin: createAdminClient(),
      userId: user.id,
      file,
      number: String(formData.get("number") ?? ""),
      clubName: String(formData.get("club_name") ?? ""),
      clubId: Number.isInteger(clubIdRaw) && clubIdRaw > 0 ? clubIdRaw : null,
    });
    revalidatePath("/profile");
    revalidatePath("/profile/verify");
    return { result };
  } catch (err) {
    return { error: err instanceof VerificationError ? err.message : "Something went wrong. Please try again." };
  }
}
