import "server-only";

import { after } from "next/server";
import { revalidatePath } from "next/cache";

import { sendSocietyAlerts } from "@/lib/society-alerts";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionState } from "./action-state";
import { loadConsole, type ConsoleContext } from "./access";
import { positiveInt, type SocietyArea } from "./rules";

/**
 * The one way a society-console Server Action runs.
 *
 *  1. Signed in, and on this society's committee (loadConsole) — checked on
 *     every call, never trusted from the page that drew the button.
 *  2. Optionally narrowed to one area or to whoever runs the society, so a
 *     refused click says why in plain words instead of a database error.
 *  3. The change itself goes through the SAME database function the app
 *     calls, with the member's own client, so the database stays the judge.
 *  4. The society's pages are revalidated, and any alerts the database just
 *     queued (new event, offer, approval, message) are sent once the reply
 *     has gone — the same outbox the app flushes, which only the database's
 *     own functions write, so this can only make alerts go out sooner.
 */

type Opts = { area?: SocietyArea; run?: boolean; alerts?: boolean };

export async function consoleAction(
  rawGroupId: unknown,
  opts: Opts,
  run: (ctx: ConsoleContext) => Promise<string | void>
): Promise<ActionState> {
  const groupId = positiveInt(rawGroupId);
  if (!groupId) return { error: "That society wasn't found.", at: Date.now() };
  const ctx = await loadConsole(groupId);
  if (!ctx) return { error: "You need to be signed in and on this society's committee.", at: Date.now() };
  if (opts.run && !ctx.runs) return { error: "Only the owner, captain or secretary can do that.", at: Date.now() };
  if (opts.area && !ctx.areas.includes(opts.area)) return { error: "That isn't one of your areas on the committee.", at: Date.now() };

  let message: string | void;
  try {
    message = await run(ctx);
  } catch (err) {
    return { error: err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.", at: Date.now() };
  }

  revalidatePath(`/society/${groupId}`, "layout");
  if (opts.alerts !== false) {
    after(async () => {
      try {
        await sendSocietyAlerts(createAdminClient(), 200);
      } catch (err) {
        console.error("[society-console] alert flush failed", err);
      }
    });
  }
  return { ok: true, message: message || "Saved.", at: Date.now() };
}

/**
 * Throws the database's own message when it is one written for members — the
 * functions' `raise exception` (P0001) and their permission refusals (42501)
 * — and the fallback for anything else, so a constraint name or a type error
 * never reaches the page.
 */
export function check(error: { message: string; code?: string } | null, fallback: string): void {
  if (!error) return;
  const forMembers = error.code === "P0001" || error.code === "42501";
  throw new Error(forMembers && error.message ? error.message : fallback);
}
