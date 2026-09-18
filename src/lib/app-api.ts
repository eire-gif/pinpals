import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createBearerClient } from "@/lib/supabase/bearer";
import type { Failure } from "@/lib/tee-times-operations";

/**
 * Shared plumbing for the /api/app/* routes the mobile app calls.
 *
 * These live apart from /api/webhooks/* and /api/news/* deliberately: those
 * are machine callers with their own secrets, these are member-authenticated.
 * Keeping the namespaces visibly separate stops anyone extending the wrong
 * middleware across both later.
 *
 * No CORS headers anywhere. A native app sends no Origin and needs no
 * preflight; adding permissive CORS would only make these callable from any
 * web page that had got hold of a token.
 */

export type Authed = { supabase: SupabaseClient; user: User };

/**
 * Validate the bearer token and return a client scoped to that member.
 *
 * `getUser()` asks Supabase to verify the JWT rather than decoding it locally,
 * so an expired, forged or revoked token fails here rather than three queries
 * later against policies that would (correctly) return nothing and look like
 * an empty result instead of an auth problem.
 */
export async function authenticateAppRequest(
  request: Request
): Promise<Authed | null> {
  const header = request.headers.get("authorization");
  const token = header?.match(/^Bearer (.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const supabase = createBearerClient(token);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return { supabase, user };
}

/** What the app should see for each way an operation can decline. */
export function statusForFailure(reason: Failure): number {
  switch (reason) {
    case "not_found":
      return 404;
    case "forbidden":
      return 403;
    case "conflict":
      // Covers "already expressed interest", "already answered" and "no
      // longer open". The app treats 409 as "re-fetch and show the truth"
      // rather than as an error worth alarming anyone about.
      return 409;
    case "failed":
      return 500;
  }
}

export const unauthenticated = () =>
  Response.json({ error: "unauthenticated" }, { status: 401 });

export const badRequest = (message: string) =>
  Response.json({ error: message }, { status: 400 });

/** Body parsing that fails as 400 rather than as an unhandled exception. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Positive integers only — ids arrive over the wire from a client we don't
 *  control, and `Number("3 OR 1=1")` is NaN rather than an error. */
export function asId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
