import { checkRateLimit, rateLimitMessage, resolveClientIp } from "@/lib/rate-limit";
import { signUpMember } from "@/lib/signup";

/**
 * Sign-up from the app.
 *
 * POST /api/app/signup
 *   { first_name, last_name, email, password, agree_terms, confirm_age, marketing_email }
 *
 * Unauthenticated by definition — there is no member yet — which is why it
 * shares the website's "signup" rate-limit bucket rather than having one of
 * its own: a script cannot double its allowance by alternating doors.
 *
 * It goes through the server rather than calling supabase.auth.signUp() from
 * the phone because the consent record is built here, from the document
 * registry, with versions and hashes the client never gets to name. An app
 * that called Supabase directly would either skip consent or have to be
 * trusted about it.
 *
 * On success the member is NOT signed in: email confirmation is on. Supabase
 * emails a 6-digit code, the app asks for it and calls verifyOtp() itself,
 * which returns the session.
 */

const SIGNUP_MAX_ATTEMPTS = 5;
const SIGNUP_WINDOW_SECONDS = 60 * 60;

type Body = {
  first_name?: unknown;
  last_name?: unknown;
  email?: unknown;
  password?: unknown;
  agree_terms?: unknown;
  confirm_age?: unknown;
  marketing_email?: unknown;
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(request: Request) {
  const rateLimit = await checkRateLimit({
    action: "signup",
    maxHits: SIGNUP_MAX_ATTEMPTS,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
  });
  if (!rateLimit.allowed) {
    return Response.json({ error: rateLimitMessage(rateLimit.retryAfterSeconds) }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "That request couldn't be read." }, { status: 400 });
  }

  // The app shows one tick whose wording names the Terms, Marketplace Rules,
  // Community Guidelines AND the Privacy Policy, so one flag sets both. Only
  // a literal `true` counts — not "yes", not 1.
  const agreed = body.agree_terms === true;

  const result = await signUpMember(
    {
      firstName: text(body.first_name),
      lastName: text(body.last_name),
      email: text(body.email),
      password: text(body.password),
      agreedToDocuments: agreed,
      readPrivacy: agreed,
      confirmedAge: body.confirm_age === true,
      marketingEmail: body.marketing_email === true,
    },
    {
      ip: await resolveClientIp(),
      // Prefixed so the consent record says which door a member came in by.
      userAgent: `PinPals app; ${request.headers.get("user-agent") || ""}`,
    }
  );

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true }, { status: 200 });
}
