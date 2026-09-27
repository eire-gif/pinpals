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

/** Photos are megabytes, not kilobytes, and are often sent from a course
 *  rather than from a desk. */
const UPLOAD_TIMEOUT_MS = 60_000;

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
  body?: unknown,
  timeoutMs: number = TIMEOUT_MS
): Promise<T> {
  const token = await accessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // FormData carries its own multipart boundary, which React Native
  // generates when it serialises the body. Setting content-type by hand
  // here would overwrite it with one that has no boundary at all, and the
  // server would parse zero fields out of a perfectly good request.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(`${SITE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined || isForm
          ? {}
          : { "content-type": "application/json" }),
        authorization: `Bearer ${token}`,
      },
      body:
        body === undefined
          ? undefined
          : isForm
            ? (body as FormData)
            : JSON.stringify(body),
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

/** A photo, as multipart. `file` is what React Native's FormData wants for a
 *  local file: the asset's uri, a filename and a mime type. */
export type UploadFile = { uri: string; name: string; type: string };

/**
 /**
 * Uploads one file.
 *
 * XMLHttpRequest rather than fetch, deliberately. React Native 0.86's fetch
 * is the spec-compliant one, and a spec FormData part must be a Blob — the
 * `{ uri, name, type }` shape React Native has always used for a local file
 * is rejected with "Unsupported FormDataPart implementation". XHR still goes
 * through RCTNetworking, which understands that shape and streams the file
 * off disk rather than pulling megabytes of photo into JavaScript first.
 *
 * The long timeout is the other reason this isn't postToSite(). Ten seconds
 * is generous for a JSON round trip and nowhere near enough for a
 * four-megabyte photo leaving a phone on one bar at the back of a golf club
 * — and a photo that fails on a timeout looks to the member exactly like a
 * photo the server refused.
 */
export const postFileToSite = <T>(
  path: string,
  file: UploadFile,
  field = "file"
): Promise<T> =>
  accessToken().then(
    (token) =>
      new Promise<T>((resolve, reject) => {
        const form = new FormData();
        // The cast is unavoidable: React Native accepts this shape for a
        // local file, and the DOM lib's type for append() does not describe
        // it.
        form.append(field, file as unknown as Blob);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${SITE_URL}${path}`);
        xhr.timeout = UPLOAD_TIMEOUT_MS;
        xhr.setRequestHeader("authorization", `Bearer ${token}`);
        // content-type is left alone on purpose: React Native fills in
        // multipart/form-data with the boundary it generated, and setting it
        // by hand would overwrite that with one that has no boundary at all.

        const payload = (): { error?: string; reason?: string } | null => {
          try {
            return JSON.parse(xhr.responseText);
          } catch {
            return null;
          }
        };

        xhr.onload = () => {
          const body = payload();
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(body as T);
            return;
          }
          reject(
            new ApiError(
              xhr.status,
              messageFor(xhr.status, body?.error ?? null),
              body?.reason ?? null
            )
          );
        };

        xhr.onerror = () => {
          reject(new ApiError(0, "No connection. Check your signal and try again."));
        };

        xhr.ontimeout = () => {
          reject(
            new ApiError(0, "That photo took too long to send. Try again on a better signal.")
          );
        };

        xhr.send(form);
      })
  );
