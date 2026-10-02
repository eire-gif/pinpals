"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Signed URLs for the photos in a thread, kept current as messages arrive.
 *
 * `message-images` is a private bucket (0086). A message stores the storage
 * PATH, not a link, because a signed link expires and a column full of
 * expired links is a thread whose photos all stop working on a timer.
 *
 * SIGNED IN THE BROWSER, NOT ON THE SERVER, and that is the interesting
 * decision. It would be easy to sign in listLatestMessages() and pass a map
 * down — but messages also arrive over Realtime, and those would then have
 * no URL until the next server render. Signing here covers the first page,
 * "load older", and a live arrival with one piece of code, so a photo can
 * never appear as a blank bubble because it came in by the third route.
 *
 * It is not a weaker boundary. The bucket's own SELECT policy is what grants
 * the signature — it checks the caller is a participant of the conversation
 * whose id names the folder — so the database decides, exactly as it would
 * on the server. The browser simply asks.
 *
 * Never throws. A photo that will not sign renders as a placeholder; a
 * thread that throws while someone is reading it is worse than a missing
 * picture.
 */

/** Long enough to read a thread and scroll back through it, short enough
 *  that a URL which escapes the page stops working. */
const TTL_SECONDS = 60 * 60;

export function useMessageImageUrls(
  messages: { image_path: string | null }[]
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());

  // Joined into a primitive so the effect re-runs when the SET of paths
  // changes and not on every render that rebuilds the array — `messages` is
  // a fresh array each time the thread re-renders.
  const key = messages
    .map((m) => m.image_path)
    .filter(Boolean)
    .join("|");

  useEffect(() => {
    const paths = key.split("|").filter(Boolean);
    if (paths.length === 0) return;

    let cancelled = false;

    void (async () => {
      // Only what we have not signed already. Re-signing on every new
      // message would be a round trip per arrival and would swap every
      // <img> src in the thread, which browsers treat as a reload.
      const missing = paths.filter((path) => !urls.has(path));
      if (missing.length === 0) return;

      try {
        const { data } = await createClient()
          .storage.from("message-images")
          .createSignedUrls(missing, TTL_SECONDS);

        if (cancelled || !data) return;

        setUrls((prev) => {
          const next = new Map(prev);
          for (const row of data) {
            if (row.signedUrl && row.path) next.set(row.path, row.signedUrl);
          }
          return next;
        });
      } catch {
        // Best effort — the placeholder covers it.
      }
    })();

    return () => {
      cancelled = true;
    };
    // `urls` is read inside but deliberately not a dependency: it is written
    // by this effect, and depending on it would re-run the effect with every
    // batch it signs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}
