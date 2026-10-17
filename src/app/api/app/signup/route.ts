import { signUpMember } from "@/lib/signup";

/**
 * POST /api/app/signup — creating an account from the app's own sign-up
 * screen (mobile/src/app/signup.tsx), instead of sending the member out to
 * the website for it. Apple's review guidelines expect sign-up to happen in
 * the app, and so do members.
 *
 * Unauthenticated by nature. Same function, same rate limit and same rules
 * as the website's form (src/lib/signup.ts).
 *
 * Body: { firstName, lastName, email, password, dateOfBirth: "YYYY-MM-DD", parentEmail? }
 *   parentEmail is required when dateOfBirth makes them 13–15 (0159).
 * 200 { ok: true, needsParent }  ·  400 { error, code? }
 *   code "under_13": turned away — the app locks its form for 24 hours.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Something went wrong — please try again." }, { status: 400 });
  }

  const result = await signUpMember({
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    password: body.password,
    dateOfBirth: body.dateOfBirth,
    parentEmail: body.parentEmail,
  });

  if (result.ok) return Response.json({ ok: true, needsParent: result.needsParent });
  return Response.json(result.code ? { error: result.error, code: result.code } : { error: result.error }, { status: 400 });
}
