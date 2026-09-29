#!/usr/bin/env node
/**
 * Re-encode every existing profile photo so its EXIF — and therefore its GPS
 * coordinates — is gone, and delete the originals.
 *
 *     node tools/backfill-avatar-exif.mjs              # report only, changes nothing
 *     node tools/backfill-avatar-exif.mjs --apply      # actually do it
 *
 * WHY THIS EXISTS. Until 29 Sep 2026 updateProfile() uploaded the chosen file
 * straight to `member-avatars`, which is a PUBLIC bucket. A photo taken on a
 * phone carries EXIF, EXIF carries GPSLatitude/GPSLongitude, so a member who
 * set a profile picture taken at home published their home's coordinates to
 * anyone who opened the image URL. The upload path is fixed; the photos
 * already up there are not. See claude/incident-avatar-exif-gps.md.
 *
 * It also deletes ORPHANS — objects no profile points at any more. Changing
 * your photo never deleted the old one (a deliberate earlier call: an
 * orphaned 2MB object is cheap next to deleting a file a page is mid-render
 * on). That reasoning does not survive the photo being the leak: an old
 * geotagged avatar stays reachable at its original URL forever. Orphans are
 * the worst case here, not the harmless one.
 *
 * SAFETY, in the order it matters:
 *
 *   * Reports by default. Nothing is written or deleted without --apply.
 *   * Upload the clean copy, update the profile row, THEN delete the old
 *     object — in that order, per member. A crash anywhere leaves a member
 *     with a working photo, never a broken one.
 *   * Orphan deletion is abandoned entirely if ANY profile's avatar_url
 *     can't be parsed into a storage path. An unparsed URL means the "is
 *     anything pointing at this?" question has no reliable answer, and the
 *     wrong answer deletes somebody's photo.
 *   * A photo with no EXIF is left alone. Re-encoding it would churn every
 *     avatar URL in the product for nothing.
 *
 * Re-runnable. A second run finds nothing to do.
 *
 * The sharp pipeline below is deliberately the same shape as
 * processAvatarImage() in src/lib/images/upload.ts. It is duplicated rather
 * than imported because that module is TypeScript and marked "server-only",
 * and this is a one-off script run with plain node. If you change one,
 * glance at the other — though after this has run once, this file's job is
 * done.
 */

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "member-avatars";
const MAX_DIMENSION = 512; // AVATAR_MAX_DIMENSION in src/lib/images/upload.ts
const APPLY = process.argv.includes("--apply");

// ---------------------------------------------------------------------------

/** Reads .env.local into process.env without clobbering anything already set,
 *  so `SUPABASE_SERVICE_ROLE_KEY=... node tools/...` still wins. dotenv isn't
 *  a dependency of this project and isn't worth becoming one for this. */
function loadEnvFile(path = ".env.local") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^['"]|['"]$/g, "");
  }
}

/** Assigned by main(). Module-level so the helpers below can use it, but not
 *  created at import time — storagePathFrom() is unit-tested, and a test
 *  should not need credentials to import this file. */
let supabase;

function connect() {
  loadEnvFile();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error(
      "Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — set them in\n" +
        ".env.local or in the environment. The service-role key is required: this\n" +
        "reads and rewrites every member's photo, not just your own."
    );
    process.exit(2);
  }

  supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
}

// ---------------------------------------------------------------------------

/** "<user-id>/avatar-123.jpg" out of a public URL, or null if it isn't one of
 *  this bucket's own. Never guessed at — a wrong answer here deletes a photo
 *  that is still in use. */
export function storagePathFrom(publicUrl) {
  if (typeof publicUrl !== "string") return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = publicUrl.indexOf(marker);
  if (at === -1) return null;
  const path = publicUrl.slice(at + marker.length).split("?")[0];
  return path.length > 0 ? decodeURIComponent(path) : null;
}

/** Every object in the bucket. Storage lists one "folder" at a time, and this
 *  bucket is one folder per member, so this walks them. */
async function listAllObjects() {
  const objects = [];
  let offset = 0;

  for (;;) {
    const { data: folders, error } = await supabase.storage
      .from(BUCKET)
      .list("", { limit: 100, offset });
    if (error) throw new Error(`Listing the bucket failed: ${error.message}`);
    if (!folders || folders.length === 0) break;

    for (const folder of folders) {
      // A real file at the root (there shouldn't be any) has metadata; a
      // folder placeholder does not.
      if (folder.metadata) {
        objects.push({ path: folder.name, size: folder.metadata.size ?? 0 });
        continue;
      }
      let inner = 0;
      for (;;) {
        const { data: files, error: innerError } = await supabase.storage
          .from(BUCKET)
          .list(folder.name, { limit: 100, offset: inner });
        if (innerError) throw new Error(`Listing ${folder.name} failed: ${innerError.message}`);
        if (!files || files.length === 0) break;
        for (const file of files) {
          if (!file.metadata) continue;
          objects.push({ path: `${folder.name}/${file.name}`, size: file.metadata.size ?? 0 });
        }
        if (files.length < 100) break;
        inner += files.length;
      }
    }

    if (folders.length < 100) break;
    offset += folders.length;
  }

  return objects;
}

function extensionFor(contentType) {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

async function reencode(buffer, contentType) {
  let pipeline = sharp(buffer, { failOn: "truncated" }).rotate().resize({
    width: MAX_DIMENSION,
    height: MAX_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });

  if (contentType === "image/png") pipeline = pipeline.png({ quality: 85, compressionLevel: 8 });
  else if (contentType === "image/webp") pipeline = pipeline.webp({ quality: 85 });
  else pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });

  return pipeline.toBuffer();
}

// ---------------------------------------------------------------------------

async function main() {
  connect();
  console.log(APPLY ? "Applying changes.\n" : "Report only — nothing will be changed. Pass --apply to do it.\n");

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, avatar_url")
    .not("avatar_url", "is", null);

  if (error) throw new Error(`Reading profiles failed: ${error.message}`);

  // Which object each member is currently pointing at.
  const currentPathByUser = new Map();
  const unparsed = [];
  for (const profile of profiles ?? []) {
    const path = storagePathFrom(profile.avatar_url);
    if (path) currentPathByUser.set(profile.id, path);
    else unparsed.push(profile.avatar_url);
  }

  const inUse = new Set(currentPathByUser.values());
  const objects = await listAllObjects();

  console.log(`${objects.length} objects in the bucket, ${inUse.size} of them in use.`);
  if (unparsed.length > 0) {
    console.log(
      `\n${unparsed.length} profile(s) have an avatar_url this script can't turn into a\n` +
        `storage path — an external URL, or a shape that has changed. Orphan deletion\n` +
        `is SKIPPED because of it: "is anything pointing at this object?" has no\n` +
        `reliable answer while these exist. Cleaning is unaffected.\n` +
        unparsed.slice(0, 5).map((u) => `  ${u}`).join("\n")
    );
  }

  let cleaned = 0;
  let alreadyClean = 0;
  let failed = 0;

  for (const [userId, path] of currentPathByUser) {
    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
    if (downloadError || !blob) {
      console.log(`  ! ${path} — couldn't download (${downloadError?.message ?? "no body"})`);
      failed += 1;
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    let meta;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      console.log(`  ! ${path} — not decodable as an image, left alone`);
      failed += 1;
      continue;
    }

    // The only question that matters. No metadata, nothing to strip.
    if (!meta.exif && !meta.iptc && !meta.xmp) {
      alreadyClean += 1;
      continue;
    }

    const carriesGps = Boolean(meta.exif) && buffer.includes(Buffer.from("GPS", "latin1"));
    console.log(`  ${path} — has metadata${carriesGps ? " (looks like it includes GPS)" : ""}`);

    if (!APPLY) {
      cleaned += 1;
      continue;
    }

    const contentType = blob.type || "image/jpeg";
    let output;
    try {
      output = await reencode(buffer, contentType);
    } catch (err) {
      console.log(`  ! ${path} — re-encode failed (${err.message})`);
      failed += 1;
      continue;
    }

    const newPath = `${userId}/avatar-${Date.now()}.${extensionFor(contentType)}`;

    // Upload, point the profile at it, and only then delete the original.
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(newPath, output, { contentType, upsert: false });
    if (uploadError) {
      console.log(`  ! ${path} — upload failed (${uploadError.message})`);
      failed += 1;
      continue;
    }

    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(newPath).data.publicUrl;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", userId);

    if (updateError) {
      // The clean copy is uploaded but unreferenced. Remove it rather than
      // leaving a second orphan behind, and leave the member's photo as it
      // was — still leaky, but still working, and this run can be repeated.
      await supabase.storage.from(BUCKET).remove([newPath]);
      console.log(`  ! ${path} — profile update failed (${updateError.message})`);
      failed += 1;
      continue;
    }

    const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
    if (removeError) {
      console.log(
        `  ! ${path} — cleaned and re-pointed, but the ORIGINAL IS STILL THERE ` +
          `(${removeError.message}). It is now an orphan; re-run to remove it.`
      );
    }

    cleaned += 1;
  }

  // ---- Orphans -----------------------------------------------------------
  // Re-read what is in use: the loop above moved members onto new paths.
  const { data: after } = await supabase
    .from("profiles")
    .select("avatar_url")
    .not("avatar_url", "is", null);
  const stillInUse = new Set(
    (after ?? []).map((row) => storagePathFrom(row.avatar_url)).filter(Boolean)
  );

  const orphans = (await listAllObjects())
    .map((object) => object.path)
    .filter((path) => !stillInUse.has(path));

  if (unparsed.length > 0) {
    console.log(`\nOrphans: skipped, for the reason above.`);
  } else if (orphans.length === 0) {
    console.log(`\nOrphans: none.`);
  } else if (!APPLY) {
    console.log(`\nOrphans: ${orphans.length} object(s) nothing points at. --apply would delete them.`);
    for (const path of orphans.slice(0, 20)) console.log(`  ${path}`);
  } else {
    // In batches: remove() takes a list, and the list can be long.
    let removed = 0;
    for (let i = 0; i < orphans.length; i += 100) {
      const batch = orphans.slice(i, i + 100);
      const { error: removeError } = await supabase.storage.from(BUCKET).remove(batch);
      if (removeError) console.log(`  ! batch delete failed (${removeError.message})`);
      else removed += batch.length;
    }
    console.log(`\nOrphans: ${removed} of ${orphans.length} deleted.`);
  }

  console.log(
    `\n${APPLY ? "Cleaned" : "Would clean"}: ${cleaned}` +
      `   already clean: ${alreadyClean}` +
      `   failed: ${failed}`
  );

  if (!APPLY && (cleaned > 0 || orphans.length > 0)) {
    console.log(`\nRe-run with --apply to make these changes.`);
  }

  if (failed > 0) process.exitCode = 1;
}

// Only when run, not when imported by the test beside it.
if (process.argv[1] && process.argv[1].endsWith("backfill-avatar-exif.mjs")) {
  main().catch((err) => {
    console.error(`\nStopped: ${err.message}`);
    process.exit(1);
  });
}
