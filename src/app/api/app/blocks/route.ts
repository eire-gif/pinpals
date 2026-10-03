import { authenticateAppRequest, badRequest, readJson, unauthenticated } from "@/lib/app-api";
import { blockMember, statusForBlockFailure } from "@/lib/blocking";

/**
 * GET  /api/app/blocks              → { blocked: [{ id, name, avatarUrl, avatarColor, blockedAt }] }
 * POST /api/app/blocks  { member_id } → { ok: true }
 *
 * The app's way to block a member — from a post, a comment or their page.
 * A route rather than a direct insert so the website's rate limit applies to
 * the app too; see src/lib/blocking.ts for what a block does.
 */
export async function GET(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  // Own blocks only — blocked_users' SELECT policy (0049) returns nothing else.
  const { data, error } = await auth.supabase
    .from("blocked_users")
    .select("blocked_id, created_at, member:profiles!blocked_users_blocked_id_fkey ( first_name, last_name, avatar_url, avatar_color )")
    .eq("blocker_id", auth.user.id)
    .order("created_at", { ascending: false })
    .returns<
      {
        blocked_id: string;
        created_at: string;
        member: { first_name: string | null; last_name: string | null; avatar_url: string | null; avatar_color: string | null } | null;
      }[]
    >();
  if (error) return Response.json({ error: "Couldn't load your blocked members." }, { status: 500 });

  return Response.json({
    blocked: (data ?? []).map((row) => ({
      id: row.blocked_id,
      name: [row.member?.first_name, row.member?.last_name].filter(Boolean).join(" ") || "A member",
      avatarUrl: row.member?.avatar_url ?? null,
      avatarColor: row.member?.avatar_color ?? null,
      blockedAt: row.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateAppRequest(request);
  if (!auth) return unauthenticated();

  const input = await readJson<{ member_id?: unknown }>(request);
  if (!input || typeof input.member_id !== "string") return badRequest("Expected { member_id }.");

  const result = await blockMember(auth.supabase, auth.user.id, input.member_id);
  if (!result.ok) {
    return Response.json({ error: result.message, reason: result.reason }, { status: statusForBlockFailure(result.reason) });
  }
  return Response.json({ ok: true }, { status: 201 });
}
