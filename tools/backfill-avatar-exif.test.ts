// storagePathFrom() decides which Storage objects the backfill DELETES, so
// it gets a test even though the script around it is a one-off.
//
// A false positive here — reading a path out of a URL that isn't one of this
// bucket's — would mark a live photo as an orphan and delete it. A false
// negative is safe by construction: the script abandons orphan deletion
// entirely the moment any avatar_url fails to parse, precisely so an
// unrecognised shape can never be mistaken for "nothing points at this".
import { describe, expect, it } from "vitest";
import { storagePathFrom } from "./backfill-avatar-exif.mjs";

const BASE = "https://abcdefgh.supabase.co/storage/v1/object/public";

describe("storagePathFrom", () => {
  it("reads the path out of a member-avatars public URL", () => {
    expect(storagePathFrom(`${BASE}/member-avatars/user-1/avatar-1700000000000.jpg`)).toBe(
      "user-1/avatar-1700000000000.jpg"
    );
  });

  it("drops a cache-busting query string", () => {
    expect(storagePathFrom(`${BASE}/member-avatars/user-1/avatar-1.jpg?v=2`)).toBe(
      "user-1/avatar-1.jpg"
    );
  });

  it("decodes an escaped path", () => {
    expect(storagePathFrom(`${BASE}/member-avatars/user-1/avatar%20copy.jpg`)).toBe(
      "user-1/avatar copy.jpg"
    );
  });

  it("refuses a URL from a different bucket", () => {
    // The dangerous case: listing-images lives in the same project, and
    // returning a path here would queue somebody's listing photo for deletion.
    expect(storagePathFrom(`${BASE}/listing-images/user-1/abc.jpg`)).toBeNull();
  });

  it("refuses an entirely external URL", () => {
    expect(storagePathFrom("https://example.com/photo.jpg")).toBeNull();
  });

  it("refuses a URL that points at the bucket but names no object", () => {
    expect(storagePathFrom(`${BASE}/member-avatars/`)).toBeNull();
  });

  it("refuses anything that isn't a string", () => {
    expect(storagePathFrom(null)).toBeNull();
    expect(storagePathFrom(undefined)).toBeNull();
    expect(storagePathFrom(42)).toBeNull();
  });

  it("does not match a bucket whose name merely starts the same way", () => {
    expect(storagePathFrom(`${BASE}/member-avatars-archive/user-1/a.jpg`)).toBeNull();
  });
});
