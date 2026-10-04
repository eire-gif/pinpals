import { describe, expect, it, vi } from "vitest";

vi.mock("expo-image-picker", () => ({ UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" } }));

const { MAX_UPLOAD_BYTES, PHOTO_PICKER_OPTIONS, photoProblem } = await import("./photo-picking");

describe("photo picking", () => {
  it("asks for smaller JPEGs", () => {
    expect(PHOTO_PICKER_OPTIONS.quality).toBeLessThanOrEqual(0.5);
    expect(PHOTO_PICKER_OPTIONS.preferredAssetRepresentationMode).toBe("compatible");
  });

  it("says why a photo can't be sent before trying", () => {
    expect(photoProblem({ fileSize: 2_000_000, mimeType: "image/jpeg" })).toBeNull();
    expect(photoProblem({ fileSize: null, mimeType: null })).toBeNull();
    expect(photoProblem({ fileSize: MAX_UPLOAD_BYTES + 1, mimeType: "image/jpeg" })).toMatch(/too large/);
    expect(photoProblem({ fileSize: 1_000_000, mimeType: "image/heic" })).toMatch(/format/);
  });
});
