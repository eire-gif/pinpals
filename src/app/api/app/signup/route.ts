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
 * Body: { firstName, lastName, email, password }
 * 200 { ok: true }  ·  400 { error }
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
  });

  return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: 400 });
}
