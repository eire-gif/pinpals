import { describe, expect, it } from "vitest";
import { csvCell, csvRow, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves an ordinary value untouched", () => {
    expect(csvCell("Portmarnock")).toBe("Portmarnock");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(true)).toBe("true");
  });

  it("renders null and undefined as an empty field", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and escapes commas, quotes and newlines", () => {
    expect(csvCell("Dublin, Ireland")).toBe('"Dublin, Ireland"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("quotes values with leading or trailing whitespace so importers can't strip them", () => {
    expect(csvCell("  padded  ")).toBe('"  padded  "');
  });

  it("neutralises spreadsheet formulas — the CSV injection guard", () => {
    // The classic payload: without the guard this is an executable cell the
    // moment an admin opens the export in Excel.
    // No comma, quote or newline in this payload, so the guard's apostrophe
    // is the only change — it needs no RFC 4180 quoting on top.
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("\tTabbed")).toBe("'\tTabbed");
  });

  it("does not treat a formula character mid-value as a leader", () => {
    expect(csvCell("Ping=Pong")).toBe("Ping=Pong");
  });

  it("serialises a Date as ISO 8601", () => {
    expect(csvCell(new Date("2026-09-09T10:30:00.000Z"))).toBe("2026-09-09T10:30:00.000Z");
  });
});

describe("csvRow", () => {
  it("joins fields with commas", () => {
    expect(csvRow(["a", 1, null, true])).toBe("a,1,,true");
  });
});

describe("toCsv", () => {
  it("emits a header row then one row per record, CRLF-terminated", () => {
    const csv = toCsv(["ID", "Name"], [
      [1, "Ann"],
      [2, "Bob, Jr"],
    ]);
    expect(csv).toBe('ID,Name\r\n1,Ann\r\n2,"Bob, Jr"\r\n');
  });

  it("emits just the header row for an empty result set", () => {
    expect(toCsv(["ID", "Name"], [])).toBe("ID,Name\r\n");
  });

  it("does not prepend a BOM — that belongs to the HTTP response", () => {
    expect(toCsv(["ID"], [[1]]).startsWith("﻿")).toBe(false);
  });
});
