import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

import { isAudience, type Audience } from "@/lib/guide";

/**
 * Which way the group guides are written for this member — friends, a golf
 * trip or a society (lib/guide.ts). Asked once on the guides page and kept
 * on the phone; nothing else depends on it.
 */
const KEY = "pp_guide_audience";

export async function loadGuideAudience(): Promise<Audience | null> {
  const v = await SecureStore.getItemAsync(KEY).catch(() => null);
  return isAudience(v) ? v : null;
}

export async function saveGuideAudience(a: Audience): Promise<void> {
  await SecureStore.setItemAsync(KEY, a).catch(() => undefined);
}

/** The saved choice; `null` while loading or never chosen. `ready` once read. */
export function useGuideAudience(): { audience: Audience | null; ready: boolean; choose: (a: Audience) => void } {
  const [audience, setAudience] = useState<Audience | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadGuideAudience().then((a) => {
      if (!live) return;
      setAudience(a);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const choose = (a: Audience) => {
    setAudience(a);
    void saveGuideAudience(a);
  };
  return { audience, ready, choose };
}
