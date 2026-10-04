import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Post videos (0102): one clip of up to 30 seconds on a post.
 *
 * The file never passes through this server: a phone video is tens of
 * megabytes and a Vercel function takes about 4.5 MB in a request body. So:
 *
 *   1. createPostVideoUpload() mints a signed upload URL for
 *      `pending/<member id>/<uuid>.<ext>` in the private `post-videos`
 *      bucket, and the phone uploads straight to Storage with it.
 *   2. createPost() calls attachPendingPostVideo() to move the file under
 *      the new post's id and returns where it landed; the post_videos row
 *      is written there too.
 *
 * Both steps use the ADMIN client: members have no insert policy on the
 * bucket, which is what makes the signed URL the only way in.
 */

export const POST_VIDEO_BUCKET = "post-videos";
/** The bucket's own limit (0102); the phone checks it before uploading. */
export const MAX_POST_VIDEO_BYTES = 50 * 1024 * 1024;
/** 30 seconds, with the slack phones need when rounding. */
export const MAX_POST_VIDEO_MS = 31_000;

const EXTENSIONS: Record<string, "mp4" | "mov"> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export function isPostVideoType(type: unknown): type is keyof typeof EXTENSIONS {
  return typeof type === "string" && type in EXTENSIONS;
}

const PENDING_NAME = /^([0-9a-f-]{36})\.(mp4|mov)$/;

/** The member's own staged video, or null. This is the authorization check:
 *  anyone else's path, or a path into a post's folder, parses to null. */
export function parsePendingPostVideoPath(userId: string, path: unknown): { fileName: string; extension: "mp4" | "mov" } | null {
  const prefix = `pending/${userId}/`;
  if (typeof path !== "string" || !path.startsWith(prefix)) return null;
  const fileName = path.slice(prefix.length);
  const match = PENDING_NAME.exec(fileName);
  return match ? { fileName, extension: match[2] as "mp4" | "mov" } : null;
}

export type PostVideoUpload = { path: string; token: string; signedUrl: string };

export async function createPostVideoUpload(
  admin: SupabaseClient,
  userId: string,
  contentType: keyof typeof EXTENSIONS,
): Promise<PostVideoUpload | null> {
  const path = `pending/${userId}/${crypto.randomUUID()}.${EXTENSIONS[contentType]}`;
  const { data, error } = await admin.storage.from(POST_VIDEO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return null;
  return { path, token: data.token, signedUrl: data.signedUrl };
}

export class VideoAttachError extends Error {}

/** Moves a staged video under the post's id. Throws VideoAttachError if it
 *  isn't the member's own staged video or no longer exists. */
export async function attachPendingPostVideo(
  admin: SupabaseClient,
  userId: string,
  postId: number,
  pendingPath: string,
): Promise<string> {
  const parsed = parsePendingPostVideoPath(userId, pendingPath);
  if (!parsed) throw new VideoAttachError("That video couldn't be found — please add it again.");
  const target = `${postId}/${crypto.randomUUID()}.${parsed.extension}`;
  const { error } = await admin.storage.from(POST_VIDEO_BUCKET).move(pendingPath, target);
  if (error) throw new VideoAttachError("That video didn't finish uploading — please add it again.");
  return target;
}

/** Best-effort, like deletePostImages(): an orphaned file is tidiness. */
export async function deletePostVideos(admin: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await admin.storage.from(POST_VIDEO_BUCKET).remove(paths);
}

/** A staged video removed before posting. Only the member's own. */
export async function discardPendingPostVideo(admin: SupabaseClient, userId: string, path: unknown): Promise<boolean> {
  if (!parsePendingPostVideoPath(userId, path)) return false;
  await deletePostVideos(admin, [path as string]);
  return true;
}

export type PostVideoMeta = { path: string; durationMs: number | null; width: number | null; height: number | null };

const posInt = (v: unknown, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max ? v : null;

/** The `video` field of a create-post request, checked; null if absent.
 *  A string means it was there but wrong. */
export function readPostVideoInput(userId: string, input: unknown): PostVideoMeta | null | string {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object") return "That video couldn't be read — please add it again.";
  const v = input as Record<string, unknown>;
  if (!parsePendingPostVideoPath(userId, v.path)) return "That video couldn't be found — please add it again.";
  if (v.duration_ms !== undefined && v.duration_ms !== null) {
    if (typeof v.duration_ms !== "number" || !Number.isFinite(v.duration_ms) || v.duration_ms <= 0) {
      return "That video couldn't be read — please add it again.";
    }
    if (v.duration_ms > MAX_POST_VIDEO_MS) return "Videos can be up to 30 seconds — please trim it and try again.";
  }
  return {
    path: v.path as string,
    durationMs: typeof v.duration_ms === "number" ? Math.round(v.duration_ms) : null,
    width: posInt(v.width, 10_000),
    height: posInt(v.height, 10_000),
  };
}
