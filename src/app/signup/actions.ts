"use server";

import { signUpMember } from "@/lib/signup";

export type SignUpState = { error?: string; success?: boolean };

/** The website's sign-up form. The work is in src/lib/signup.ts, shared with the app. */
export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const result = await signUpMember({
    firstName: formData.get("first"),
    lastName: formData.get("last"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  return result.ok ? { success: true } : { error: result.error };
}
