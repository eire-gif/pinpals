import type { ReactNode } from "react";
import { getAgeAccess } from "@/lib/age-access";
import { ageBlockFor, type AgeFeature } from "@/lib/junior";
import JuniorWaiting from "./junior-waiting";
import UnderEighteenNotice from "./under-eighteen-notice";

/**
 * The one check a page makes before showing something age-limited (0159):
 *
 *   const gate = await ageGate("teeTimes", "Tee times");
 *   if (gate) return gate;
 *
 * Returns the panel to show instead — "Waiting for your parent" for a
 * 13–15 year old not yet approved, otherwise the under-18 (or under-16)
 * notice — or null when the member may use it. Signed out, or before 0159
 * is applied, it's null: the page's own sign-in handling stands.
 */
export async function ageGate(feature: AgeFeature | null, label: string): Promise<ReactNode | null> {
  const access = await getAgeAccess();
  if (!access) return null;
  if (access.band === "junior_pending") return <JuniorWaiting access={access} />;
  if (!feature) return null;
  const block = ageBlockFor(access, feature);
  if (!block || block === "waiting_for_parent") return null;
  return <UnderEighteenNotice feature={label} block={block} />;
}
