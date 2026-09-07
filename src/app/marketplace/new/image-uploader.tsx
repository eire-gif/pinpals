"use client";

import { useRef, useState } from "react";
import { ALLOWED_IMAGE_TYPES, MAX_LISTING_IMAGES } from "@/lib/marketplace";
import { uploadListingImageAction, removeUploadedListingImageAction } from "./actions";

type ImageEntry = {
  localId: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "success" | "error";
  error?: string;
  // Set once uploadListingImageAction succeeds — the {url, path} pair this
  // entry contributes to the form's `images` hidden field. Absent while
  // uploading or after a failure (readImages() on the server side only ever
  // sees entries that actually made it).
  uploaded?: { url: string; path: string };
};

/**
 * Multi-photo picker for the create-listing form. Every selected file is
 * uploaded immediately (via uploadListingImageAction, which runs it through
 * the sharp metadata-strip/resize pipeline server-side — see
 * src/lib/images/upload.ts) rather than waiting for the listing's own
 * "Save as draft" submit, which is what makes per-file status and "retry
 * just the one that failed" a natural client state instead of something
 * bolted onto one big all-or-nothing submission: a failed file simply never
 * gets an `uploaded` URL, and Retry re-runs only that file.
 *
 * Renders its own hidden `images` input (position-ordered, only the
 * successfully-uploaded entries) directly inside the parent <form> — no
 * lifting this component's state up to NewListingForm is needed for the
 * final submit to see it.
 */
export default function ImageUploader() {
  const [images, setImages] = useState<ImageEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadedCount = images.filter((img) => img.status !== "error").length;
  const atLimit = uploadedCount >= MAX_LISTING_IMAGES;

  async function uploadOne(entry: ImageEntry) {
    const formData = new FormData();
    formData.set("file", entry.file);
    const result = await uploadListingImageAction(formData);

    setImages((prev) =>
      prev.map((img) => {
        if (img.localId !== entry.localId) return img;
        if ("error" in result) {
          return { ...img, status: "error", error: result.error };
        }
        return { ...img, status: "success", uploaded: { url: result.url, path: result.path } };
      })
    );
  }

  function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).slice(0, Math.max(0, MAX_LISTING_IMAGES - uploadedCount));

    const newEntries: ImageEntry[] = files.map((file) => ({
      localId: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));

    setImages((prev) => [...prev, ...newEntries]);
    newEntries.forEach((entry) => {
      void uploadOne(entry);
    });

    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleRetry(entry: ImageEntry) {
    setImages((prev) =>
      prev.map((img) => (img.localId === entry.localId ? { ...img, status: "uploading", error: undefined } : img))
    );
    await uploadOne(entry);
  }

  async function handleRemove(entry: ImageEntry) {
    setImages((prev) => prev.filter((img) => img.localId !== entry.localId));
    URL.revokeObjectURL(entry.previewUrl);
    if (entry.uploaded) {
      // Best-effort cleanup — see removeUploadedListingImageAction's own
      // comment. Never blocks the UI from moving on.
      void removeUploadedListingImageAction(entry.uploaded.path);
    }
  }

  function move(index: number, direction: -1 | 1) {
    setImages((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const hiddenImagesValue = JSON.stringify(
    images
      .filter((img): img is ImageEntry & { uploaded: { url: string; path: string } } => !!img.uploaded)
      .map((img, position) => ({ url: img.uploaded.url, position }))
  );

  return (
    <div className="grid gap-2.5">
      <input type="hidden" name="images" value={hiddenImagesValue} />

      <label className="text-[13.5px] font-bold">
        Photos <span className="font-normal text-ink-500">(first photo is the cover — up to {MAX_LISTING_IMAGES})</span>
      </label>

      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {images.map((img, index) => (
            <div key={img.localId} className="relative rounded-lg overflow-hidden border-[1.5px] border-line bg-surface-tint">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.previewUrl} alt="" className="w-full h-24 object-cover" />

              {index === 0 && img.status === "success" && (
                <span className="absolute top-1 left-1 bg-navy-900/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                  Cover
                </span>
              )}

              {img.status === "uploading" && (
                <div className="absolute inset-0 bg-navy-900/50 flex items-center justify-center text-white text-[11px] font-bold">
                  Uploading…
                </div>
              )}

              {img.status === "error" && (
                <div className="absolute inset-0 bg-red-600/85 flex flex-col items-center justify-center gap-1.5 px-1.5 text-center">
                  <span className="text-white text-[10.5px] font-semibold leading-tight">{img.error || "Upload failed"}</span>
                  <button
                    type="button"
                    onClick={() => void handleRetry(img)}
                    className="bg-white text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full"
                  >
                    Retry
                  </button>
                </div>
              )}

              <div className="absolute bottom-1 right-1 flex gap-1">
                {index > 0 && img.status !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    aria-label="Move earlier"
                    className="bg-white/90 text-ink-900 text-[11px] font-bold w-5 h-5 rounded-full leading-none"
                  >
                    ‹
                  </button>
                )}
                {index < images.length - 1 && img.status !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    aria-label="Move later"
                    className="bg-white/90 text-ink-900 text-[11px] font-bold w-5 h-5 rounded-full leading-none"
                  >
                    ›
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleRemove(img)}
                  aria-label="Remove photo"
                  className="bg-white/90 text-red-600 text-[11px] font-bold w-5 h-5 rounded-full leading-none"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        multiple
        disabled={atLimit}
        onChange={(e) => handleFilesSelected(e.target.files)}
        className="text-sm file:mr-3 file:px-4 file:py-2.5 file:rounded-full file:border-0 file:font-bold file:bg-green-700 file:text-cream-50 hover:file:bg-green-600 disabled:opacity-50 disabled:file:bg-ink-500"
      />
      {atLimit && <p className="text-xs text-ink-500">You&apos;ve reached the {MAX_LISTING_IMAGES}-photo limit.</p>}
    </div>
  );
}
