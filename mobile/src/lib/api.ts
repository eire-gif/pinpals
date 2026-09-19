import { SITE_URL } from "./config";
import { supabase } from "./supabase";

/**
 * Calls to the website's /api/app/* routes.
 *
 * The app writes nothing to the database directly. Reads go straight to
 * Supabase (RLS decides what comes back), but every write that a member can
 * see the effect of goes through the website, because the notification that
 * follows the write lives in TypeScript on the server — notifyInterestReceived
 * and friends in src/lib/tee-times-server.ts. The RPCs move spaces around
 * atomically but tell nobody. Calling them from here would update the fourball
 * in silence, which is the failure that looks like the app working.
 *
 * See claude/mobile-app-api-build-spec.md §1.
 */

/** A request that failed in a way worth showing a member. */
export class ApiError extends Error {
  readonly status: number;
  readonly reason: string | null;

  constructor(status: number, message: string, reason: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.reason = reason;
  }
}

/**
 * Phones lose signal mid-request and fetch() will wait forever for a socket
 * that is never going to answer. Ten seconds is long enough for a slow 3G
 * round trip to a warm Vercel function and short enough that a member on the
 * first tee does not think the app has hung.
 */
const TIMEOUT_MS = 10_000;

async function accessToken(): Promise<string> {
  // getSession() refreshes an expired token if the refresh token is still
  // good, so this is also what keeps a member who last opened the app a week
  // ago from being bounced to the login screen.
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    throw new ApiError(401, "Please sign in again.");
  }
  return token;
}

/** What a member should read for each way the server can say no. */
function messageFor(status: number, serverMessage: string | null): string {
  // The server's own wording wins where it has some: the operations return
  // things like "That tee time is no longer open", which is more use than
  // anything generic.
  if (serverMessage) return serverMessage;

  switch (status) {
    case 401:
      return "Please sign in again.";
    case 403:
      return "That isn't yours to change.";
    case 404:
      return "That tee time is no longer available.";
    case 409:
      return "Something changed — pull down to refresh.";
    default:
      return "Something went wrong. Please try again.";
  }
}

async function requestSite<T>(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<T> {
  const token = await accessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${SITE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Abort and genuine network failure land here alike, and from a member's
    // point of view they are the same thing.
    throw new ApiError(0, "No connection. Check your signal and try again.");
  } finally {
    clearTimeout(timer);
  }

  // An error page from a proxy or a cold start is HTML, not JSON, so parsing
  // is allowed to fail without turning into an unhandled exception.
  type Payload = { error?: string; reason?: string } | null;
  let payload: Payload = null;
  try {
    payload = (await response.json()) as Payload;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFor(response.status, payload?.error ?? null),
      payload?.reason ?? null
    );
  }

  return payload as T;
}

export const postToSite = <T>(path: string, body: unknown): Promise<T> =>
  requestSite<T>(path, "POST", body);

export const getFromSite = <T>(path: string): Promise<T> =>
  requestSite<T>(path, "GET");
