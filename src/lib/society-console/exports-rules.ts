/**
 * A society's CSV exports (0144/0145): which files there are and who is
 * offered each — the app's EXPORTS list and its allowed() check, copied
 * from mobile/src/lib/society.ts and mobile/src/app/group/[id]/exports.tsx.
 * buildExport (src/lib/society-exports.ts) and the database decide for
 * real; this only decides which cards to draw.
 *
 * Pure: tested in exports-rules.test.ts.
 */

import type { SocietyArea } from "./rules";

export type ExportFile = "members" | "booking" | "attendance" | "payments" | "results";

export type ExportDef = { file: ExportFile; title: string; detail: string; area: SocietyArea | "any"; who: string; needsEvent?: boolean };

export const EXPORTS: ExportDef[] = [
  { file: "members", title: "Members list", detail: "Name, role, joined, membership, handicaps and mobiles you can see", area: "people", who: "Captain, secretary & treasurer" },
  { file: "booking", title: "Course booking sheet", detail: "One event: groups, tee times, names, handicaps, guests and meals — for the club", area: "events", who: "Whoever runs events", needsEvent: true },
  { file: "attendance", title: "Attendance", detail: "Who entered, withdrew or came as a guest, event by event, this season", area: "events", who: "Whoever runs events" },
  { file: "payments", title: "Payments & accounts", detail: "Every payment and refund this season, and membership", area: "money", who: "Treasurer, captain & secretary" },
  { file: "results", title: "Results", detail: "This season's published results and prizes", area: "any", who: "The committee" },
];

export const isExportFile = (v: unknown): v is ExportFile => typeof v === "string" && EXPORTS.some((e) => e.file === v);

export const exportTitle = (file: string): string => EXPORTS.find((e) => e.file === file)?.title ?? file;

/** May someone with these areas download this file? Mirrors the app. */
export function exportAllowed(e: Pick<ExportDef, "area">, areas: readonly SocietyArea[]): boolean {
  if (e.area === "any") return areas.length > 0;
  if (e.area === "people") return areas.includes("people") || areas.includes("money");
  return areas.includes(e.area);
}
