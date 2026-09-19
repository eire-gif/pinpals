import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret authentication for routes pg_cron calls.
 *
 * Lifted out of src/app/api/news/collect/route.ts, which was the first
 * scheduled job in the codebase and worked out the sharp edges below. The
 * news route still has its own copy; it should adopt this one, but changing a
 * working security check and adding a second caller in the same commit is how
 * you end up unable to tell which change broke it.
 */
export function isCronAuthorised(request: Request, expectedRaw: string | undefined, label: string): boolean {
  // Trimmed because this value is set by hand in a dashboard, and a secret
  // pasted out of a table cell or a terminal very often carries a trailing
  // newline or space. That is not a different secret, it is the same secret
  // with invisible punctuation.
  const expected = expectedRaw?.trim();

  // An unset secret disables the route rather than opening it. A
  // misconfigured deployment should do nothing, never do it for anyone who
  // asks.
  if (!expected) {
    console.warn(`[${label}] auth rejected: no secret configured`);
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = (header.startsWith("Bearer ") ? header.slice(7) : header).trim();

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on a length mismatch, so lengths are compared
  // first — to the server log only, never to the caller. That is the
  // difference between "the variable is missing", "it has stray whitespace"
  // and "it is genuinely a different string", none of which a bare 401
  // distinguishes.
  if (a.length !== b.length) {
    console.warn(
      `[${label}] auth rejected: presented ${a.length} chars, configured ${b.length} chars`
    );
    return false;
  }

  const ok = timingSafeEqual(a, b);
  if (!ok) {
    console.warn(`[${label}] auth rejected: same length, different value`);
  }
  return ok;
}
