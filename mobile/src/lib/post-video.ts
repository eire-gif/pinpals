import { deleteFromSiteWithBody, postToSite } from "./api";
import { SUPABASE_PUBLISHABLE_KEY } from "./config";
import { supabase } from "./supabase";

/**
 * Posting a video (0102): one clip of up to 30 seconds.
 *
 * The phone uploads the file straight to Storage with a signed URL the
 * website hands it (POST /api/app/posts/videos). A phone video is tens of
 * megabytes, more than a request to the website can carry. The file streams
 * from disk as a multipart part, so it's never held in memory, and progress
 * comes from the upload itself. Posting then names the staged path
 * (createPost's `video`), and the server moves it under the post.
 */

/** 30 seconds, with a little slack for how phones round. */
export const VIDEO_MAX_MS = 30_500;
/** The bucket's own limit (0102). */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

export type PickedVideo = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  /** Milliseconds, as expo-image-picker reports it. */
  duration?: number | null;
  width?: number;
  height?: number;
};

/** MP4 or QuickTime, from the picker's type or else the file's extension. */
export function videoContentType(v: PickedVideo): "video/mp4" | "video/quicktime" | null {
  const type = v.mimeType?.toLowerCase();
  if (type === "video/mp4" || type === "video/quicktime") return type;
  const name = (v.fileName ?? v.uri).toLowerCase();
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  if (name.endsWith(".mov")) return "video/quicktime";
  return null;
}

/** A member-facing reason this video can't be posted, or null. */
export function videoProblem(v: PickedVideo): string | null {
  if (v.duration && v.duration > VIDEO_MAX_MS) {
    return "Videos can be up to 30 seconds. Trim it in Photos (Edit, then drag the ends) and try again.";
  }
  if (v.fileSize && v.fileSize > VIDEO_MAX_BYTES) return "That video is too large to send. Try a shorter clip.";
  if (!videoContentType(v)) return "That video's format isn't supported. Try one recorded on your phone.";
  return null;
}

/** "0:24" */
export function durationLabel(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Upload = { path: string; token: string; signed_url: string };

/** Uploads the video; resolves with its staged path. */
export async function stageVideo(v: PickedVideo, onProgress?: (fraction: number) => void): Promise<string> {
  const type = videoContentType(v);
  if (!type) throw new Error("That video's format isn't supported.");
  const upload = await postToSite<Upload>("/api/app/posts/videos", { content_type: type, size: v.fileSize ?? undefined });
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload.signed_url);
    // The gateway wants the project's key; the signed URL's own token is
    // what authorises the write.
    xhr.setRequestHeader("apikey", SUPABASE_PUBLISHABLE_KEY);
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.timeout = 5 * 60_000;
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
      };
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(xhr.status === 413 ? "That video is too large to send." : "The video didn't upload. Try again on a better signal."));
    xhr.onerror = () => reject(new Error("No connection. Check your signal and try again."));
    xhr.ontimeout = () => reject(new Error("That took too long to send. Try again on wifi."));
    const form = new FormData();
    form.append("cacheControl", "3600");
    // React Native streams a { uri, name, type } part from disk.
    form.append("", { uri: v.uri, name: v.fileName ?? (type === "video/mp4" ? "video.mp4" : "video.mov"), type } as unknown as Blob);
    xhr.send(form);
  });

  return upload.path;
}

/** A staged video removed before posting. Best-effort. */
export async function discardVideo(path: string): Promise<void> {
  try {
    await deleteFromSiteWithBody("/api/app/posts/videos", { path });
  } catch {
    // An orphan in a folder nobody can read.
  }
}
