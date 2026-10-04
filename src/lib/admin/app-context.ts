import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which identity the admin code is running as, when it is running for the app.
 *
 * The website's admin code finds the staff member from cookies — requireStaff()
 * → createClient() → the session cookie. The app has no cookies; it sends a
 * bearer token. Rather than copy sixty-odd Server Actions into API routes (and
 * then keep two copies of every role check, audit entry and Stripe call in
 * step), /api/app/admin/* runs the SAME functions inside this context, and
 * resolveSession() in authorization.ts reads the token from here instead of
 * from cookies.
 *
 * AsyncLocalStorage, not a module variable: concurrent requests on one
 * serverless instance must never see each other's token.
 */
export const appAdminContext = new AsyncLocalStorage<{ accessToken: string }>();

export function appAdminToken(): string | null {
  return appAdminContext.getStore()?.accessToken ?? null;
}
