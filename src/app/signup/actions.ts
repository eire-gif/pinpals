"use server";

import { cookies } from "next/headers";
import { signUpMember } from "@/lib/signup";
import { dateFromParts, UNDER_13_MESSAGE } from "@/lib/junior";
import { AGE_BLOCK_COOKIE, AGE_BLOCK_SECONDS } from "./age-block";

export type SignUpState = { error?: string; success?: boolean; needsParent?: boolean; blocked?: boolean };

/** The website's sign-up form. The work is in src/lib/signup.ts, shared with the app. */
export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const jar = await cookies();
  // Turned away as under 13 on this device in the last day: the form stays
  // locked rather than inviting a second try with a different year. Checked
  // here as well as on the page, so a form left open in another tab gets
  // the same answer.
  if (jar.get(AGE_BLOCK_COOKIE)) return { blocked: true, error: UNDER_13_MESSAGE };

  const result = await signUpMember({
    firstName: formData.get("first"),
    lastName: formData.get("last"),
    email: formData.get("email"),
    password: formData.get("password"),
    dateOfBirth: dateFromParts(formData.get("dobDay"), formData.get("dobMonth"), formData.get("dobYear")),
    parentEmail: formData.get("parentEmail"),
  });

  if (!result.ok && result.code === "under_13") {
    jar.set(AGE_BLOCK_COOKIE, "1", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: AGE_BLOCK_SECONDS,
    });
    return { blocked: true, error: result.error };
  }
  return result.ok ? { success: true, needsParent: result.needsParent } : { error: result.error };
}
