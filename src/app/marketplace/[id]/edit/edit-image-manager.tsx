"use client";

import { useRef, useState } from "react";
import type { ListingImage } from "@/lib/types";
import { ALLOWED_IMAGE_TYPES, MAX_LISTING_IMAGES } from "@/lib/marketplace";
import { uploadListingImageAction, removeUploadedListingImageAction } from "../../new/actions";

type GalleryEntry = {
  localId: string;
  // Set for a photo that was already attached to this listing before the
  // page loaded (its listing_images.id) — absent for a freshly-added photo
  // in this editing session. The submitted `images` field keeps this
  // distinction (updateListing, ../actions.ts, treats "has an id" as "keep,
  // maybe reposition" and "no id" as "insert new"; an existing id that goes
  // missing from the submission is what tells that action to delete it).
  existingId?: number;
  previewUrl: string;
  status: "uploading" | "success" | "error";
  error?: string;
  file?: File;
  uploaded?: { url: string; path: string };
};

/**
 * The edit page's photo manager — edit-listing-form.tsx's counterpart to
 * ../../new/image-uploader.tsx, extended to start from the listing's
 * existing gallery rather than empty, and to let an existing photo be
 * removed/reordered alongside newly-added ones in one unified list. Newly
 * added photos go through the exact same upload/remove actions the create
 * form uses (uploading a photo doesn't care whether a listing already
 * exists) — only the final "what does the gallery look like now" sync
 * happens in updateListing.
 */
export default function EditImageManager({
  initialImages,
  locked = false,
}: {
  initialImages: ListingImage[];
  /** True once the listing's auction has had its first bid. The DB itself
   * doesn't restrict listing_images the way prevent_listing_edit_during_live_auction()
   * (0046) restricts the listings table's own columns — this is a
   * product-level choice to hold photos to the same "what a bidder already
   * bid on doesn't change" rule as title/description/category/condition,
   * enforced here (and by simply not rendering interactive controls) rather
   * than at the database layer. */
  locked?: boolean;
}) {
  const [images, setImages] = useState<GalleryEntry[]>(() =>
    initialImages.map((img) => ({
      localId: `existing-${img.id}`,
      existingId: img.id,
      previewUrl: img.image_url,
      status: "success" as const,
      uploaded: { url: img.image_url, path: "" },
    }))
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const activeCount = images.filter((img) => img.status !== "error").length;
  const atLimit = activeCount >= MAX_LISTING_IMAGES;

  async function uploadOne(entry: GalleryEntry) {
    if (!entry.file) return;
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
    const files = Array.from(fileList).slice(0, Math.max(0, MAX_LISTING_IMAGES - activeCount));

    const newEntries: GalleryEntry[] = files.map((file) => ({
      localId: crypto.randomUUID(),
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
      file,
    }));

    setImages((prev) => [...prev, ...newEntries]);
    newEntries.forEach((entry) => {
      void uploadOne(entry);
    });

    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleRetry(entry: GalleryEntry) {
    setImages((prev) =>
      prev.map((img) => (img.localId === entry.localId ? { ...img, status: "uploading", error: undefined } : img))
    );
    await uploadOne(entry);
  }

  async function handleRemove(entry: GalleryEntry) {
    setImages((prev) => prev.filter((img) => img.localId !== entry.localId));
    if (entry.file) URL.revokeObjectURL(entry.previewUrl);
    // Only a freshly-uploaded-this-session photo gets proactively deleted
    // from Storage here — an existing photo's removal is handled by
    // updateListing itself (it diffs the submitted list against the DB and
    // cleans up Storage for anything that dropped out), since that's the
    // point this "removal" actually becomes real rather than an in-progress
    // edit the seller might still cancel out of.
    if (entry.uploaded && !entry.existingId) {
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
      .filter((img): img is GalleryEntry & { uploaded: { url: string; path: string } } => !!img.uploaded)
      .map((img, position) => ({ id: img.existingId, url: img.uploaded.url, position }))
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

              {!locked && (
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
              )}
            </div>
          ))}
        </div>
      )}

      {!locked && (
        <>
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
        </>
      )}
    </div>
  );
}
