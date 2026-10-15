import { describe, expect, it } from "vitest";

import { EXPORTS, exportAllowed, isExportFile } from "./exports-rules";
import { EXPORT_FILES } from "@/lib/society-exports";

const files = (areas: Parameters<typeof exportAllowed>[1]) => EXPORTS.filter((e) => exportAllowed(e, areas)).map((e) => e.file);

describe("exports", () => {
  it("lists the same files the website makes", () => {
    expect(EXPORTS.map((e) => e.file).sort()).toEqual([...EXPORT_FILES].sort());
    expect(isExportFile("members")).toBe(true);
    expect(isExportFile("passwords")).toBe(false);
  });
  it("offers each office its files, as the app does", () => {
    expect(files(["events", "people", "money", "handicaps", "messages"])).toEqual(["members", "booking", "attendance", "payments", "results"]);
    expect(files(["money", "messages"])).toEqual(["members", "payments", "results"]);
    expect(files(["events", "messages"])).toEqual(["booking", "attendance", "results"]);
    expect(files(["handicaps"])).toEqual(["results"]);
    expect(files([])).toEqual([]);
  });
});
