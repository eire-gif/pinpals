"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import ClubCombobox from "@/components/club-combobox";
import { shrinkForUpload } from "@/lib/images/shrink-for-upload";
import MemberAvatar from "@/components/member-avatar";
import {
  MAX_POST_BODY,
  MAX_POST_PHOTOS,
  POST_VISIBILITY_LABELS,
  type PostVisibility,
} from "@/lib/feed";
import { createPostAction } from "./actions";

type Photo = {
  key: string;
  preview: string;
  /** Set once the server has staged it. */
  path: string | null;
  error: string | null;
};

export default function Composer({
  me,
}: {
  me: { name: string; avatarUrl: string | null; avatarColor: string | null; country: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("members");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped on reset so the course picker, which keeps its own state, starts
  // empty again too.
  const [round, setRound] = useState(0);
  const [posting, startPosting] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const uploading = photos.some((p) => p.path === null && p.error === null);

  async function stage(photo: Photo, file: File) {
    const form = new FormData();
    form.append("file", await shrinkForUpload(file));
    let next: Partial<Photo>;
    try {
      const response = await fetch("/feed/photo", { method: "POST", body: form });
      const payload = (await response.json().catch(() => null)) as { path?: string; error?: string } | null;
      next = response.ok && payload?.path
        ? { path: payload.path }
        : { error: payload?.error ?? "Couldn't upload that photo." };
    } catch {
      next = { error: "No connection — that photo didn't upload." };
    }
    setPhotos((prev) => prev.map((p) => (p.key === photo.key ? { ...p, ...next } : p)));
  }

  function pick(files: FileList | null) {
    if (!files) return;
    setError(null);
    const room = MAX_POST_PHOTOS - photos.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setError(`You can add up to ${MAX_POST_PHOTOS} photos to a post.`);
    const added = chosen.map((file) => ({
      key: crypto.randomUUID(),
      preview: URL.createObjectURL(file),
      path: null,
      error: null,
    }));
    setPhotos((prev) => [...prev, ...added]);
    setOpen(true);
    added.forEach((photo, i) => void stage(photo, chosen[i]));
    if (fileInput.current) fileInput.current.value = "";
  }

  function remove(photo: Photo) {
    URL.revokeObjectURL(photo.preview);
    setPhotos((prev) => prev.filter((p) => p.key !== photo.key));
    if (photo.path) {
      void fetch("/feed/photo", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: photo.path }),
      });
    }
  }

  function reset() {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setBody("");
    setVisibility("members");
    setOpen(false);
    setRound((n) => n + 1);
    formRef.current?.reset();
  }

  function submit(formData: FormData) {
    setError(null);
    if (photos.some((p) => p.error)) {
      setError("Remove the photos that didn't upload, then post.");
      return;
    }
    const rawClub = formData.get("club");
    const clubId = rawClub ? Number(rawClub) : null;
    startPosting(async () => {
      const result = await createPostAction({
        body,
        visibility,
        clubId: clubId && Number.isFinite(clubId) ? clubId : null,
        photoPaths: photos.map((p) => p.path).filter((p): p is string => p !== null),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  const canPost = !posting && !uploading && (body.trim().length > 0 || photos.length > 0);

  return (
    <form
      ref={formRef}
      action={submit}
      className="bg-surface border border-line rounded-2xl shadow-sm p-4 sm:p-5"
      aria-label="Share a post"
    >
      <div className="flex gap-3">
        <MemberAvatar name={me.name} avatarUrl={me.avatarUrl} color={me.avatarColor} size="md" />
        <div className="flex-1 min-w-0">
          <label htmlFor="post-body" className="sr-only">
            What happened on the course?
          </label>
          <textarea
            id="post-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onFocus={() => setOpen(true)}
            maxLength={MAX_POST_BODY}
            rows={open ? 3 : 1}
            placeholder="How did the round go?"
            className="w-full resize-none rounded-xl border-[1.5px] border-line bg-surface-tint px-4 py-3 text-base focus:outline-none focus:border-green-700 transition-[height]"
          />
        </div>
      </div>

      {photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2" aria-label="Photos to post">
          {photos.map((photo) => (
            <li key={photo.key} className="relative aspect-square rounded-xl overflow-hidden bg-cream-100">
              {/* A local preview (blob: URL) — next/image cannot optimise it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.preview} alt="" className="w-full h-full object-cover" />
              {photo.path === null && photo.error === null && (
                <span className="absolute inset-0 bg-navy-900/45 flex items-center justify-center text-[11px] font-bold text-white">
                  Uploading…
                </span>
              )}
              {photo.error && (
                <span className="absolute inset-0 bg-red-600/85 flex items-center justify-center p-1.5 text-center text-[11px] font-bold text-white">
                  {photo.error}
                </span>
              )}
              <button
                type="button"
                onClick={() => remove(photo)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-navy-900/80 text-white text-sm leading-none flex items-center justify-center hover:bg-navy-900"
                aria-label="Remove this photo"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <div className="grid gap-1.5 min-w-0">
            <span className="text-[13.5px] font-bold">Course (optional)</span>
            <ClubCombobox key={round} name="club" country={me.country} />
          </div>
          <div className="grid gap-1.5 min-w-0">
            <label htmlFor="post-visibility" className="text-[13.5px] font-bold">
              Who can see this
            </label>
            <select
              id="post-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PostVisibility)}
              className="rounded-xl border-[1.5px] border-line bg-surface px-3 py-2.5 text-base"
            >
              {(Object.keys(POST_VISIBILITY_LABELS) as PostVisibility[]).map((v) => (
                <option key={v} value={v}>
                  {POST_VISIBILITY_LABELS[v]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <div>
          <input
            ref={fileInput}
            id="post-photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => pick(e.target.files)}
            className="sr-only"
            disabled={photos.length >= MAX_POST_PHOTOS}
          />
          <label
            htmlFor="post-photos"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold border-[1.5px] border-line transition ${
              photos.length >= MAX_POST_PHOTOS ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-cream-100"
            }`}
          >
            <svg className="w-4 h-4 text-green-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" />
              <path d="M21 16l-5-5-8 8" />
            </svg>
            Photos {photos.length > 0 && <span className="text-ink-500">{photos.length}/{MAX_POST_PHOTOS}</span>}
          </label>
        </div>
        <div className="flex items-center gap-2">
          {open && (
            <button type="button" onClick={reset} className="px-4 py-2 rounded-full text-sm font-bold text-ink-500 hover:text-ink-900">
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!canPost}
            className="px-6 py-2.5 rounded-full font-bold text-sm bg-green-700 text-cream-50 hover:bg-green-600 transition disabled:opacity-50"
          >
            {posting ? "Posting…" : uploading ? "Uploading…" : "Post"}
          </button>
        </div>
      </div>
    </form>
  );
}
