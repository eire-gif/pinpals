import { SITE_URL } from "./config";

/**
 * Joining from the app.
 *
 * Both calls go to the website rather than to Supabase directly. The consent
 * record — which documents, which versions, the hash of the text shown — is
 * built on the server from the document registry; an app that called
 * supabase.auth.signUp() itself would either skip it or have to be trusted
 * about it. See src/lib/signup.ts on the website.
 *
 * Unlike everything in api.ts these carry no token: there is no member yet.
 */

const TIMEOUT_MS = 15_000;

export type JoinDetails = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  agreeTerms: boolean;
  confirmAge: boolean;
  marketingEmail: boolean;
};

async function post(path: string, body: unknown): Promise<{ error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SITE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.ok) return { error: null };
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { error: data?.error ?? "Something went wrong. Please try again." };
  } catch {
    return { error: "Couldn't reach PinPals. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }
}

export const createAccount = (d: JoinDetails) =>
  post("/api/app/signup", {
    first_name: d.firstName,
    last_name: d.lastName,
    email: d.email,
    password: d.password,
    // The one tick names the Terms, Marketplace Rules, Community Guidelines,
    // the Privacy Policy and the age declaration; the server records each.
    agree_terms: d.agreeTerms,
    confirm_age: d.confirmAge,
    marketing_email: d.marketingEmail,
  });

export const resendCode = (email: string) => post("/api/app/signup/resend", { email });

/** Mirrors src/lib/passwords.ts on the website. The server re-checks; this only saves a round trip. */
export const PASSWORD_MIN = 10;

/** The legal pages, opened in the in-app web view from the sign-up tick. */
export const LEGAL = {
  terms: "/legal/terms",
  marketplace: "/legal/marketplace-rules",
  community: "/legal/community-guidelines",
  privacy: "/legal/privacy",
} as const;
