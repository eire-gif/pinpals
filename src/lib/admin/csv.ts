/**
 * CSV serialization for the /admin export routes. Pure and dependency-free
 * (no Response, no Supabase, no Next) so the escaping rules below are
 * directly unit-testable — same split as roles.ts vs authorization.ts, and
 * as sanitizeMetadata() in audit.ts.
 *
 * RFC 4180 with two deliberate departures, both for Excel's benefit:
 *   * CRLF line endings, which RFC 4180 actually specifies anyway and which
 *     Excel on Windows expects.
 *   * The formula guard below, which RFC 4180 says nothing about.
 *
 * The UTF-8 BOM is NOT added here — it belongs to the HTTP response, not to
 * the CSV text itself, so csvResponse() (export.ts) adds it. Keeping it out
 * means a test can assert on exact cell content without stripping a prefix.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

/**
 * Leading characters Excel, LibreOffice and Google Sheets treat as the start
 * of a formula rather than as text. A member whose display name is
 * `=cmd|'/c calc'!A1` would otherwise become an executable cell the moment
 * an admin opens the export — the classic CSV injection. Prefixing a single
 * quote makes the cell render as literal text in all three, and the quote is
 * not part of the stored value.
 *
 * `-` is included even though a negative number is a legitimate value: every
 * numeric column this app exports (prices, fees, totals) is non-negative, so
 * the false-positive cost is nil and the rule stays simple. If a genuinely
 * negative figure is ever exported, pass it pre-formatted rather than
 * loosening this.
 */
const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Characters that force the whole field to be quoted (RFC 4180 §2.6). */
const MUST_QUOTE = /[",\r\n]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === "boolean") {
    text = value ? "true" : "false";
  } else {
    text = String(value);
  }

  if (text.length > 0 && FORMULA_LEADERS.has(text[0])) {
    text = `'${text}`;
  }

  // Leading/trailing whitespace is quoted too — not required by RFC 4180,
  // but several importers strip it otherwise, silently changing the value.
  if (MUST_QUOTE.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function csvRow(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(",");
}

/**
 * `headers` and every row are expected to be the same length; a short row is
 * serialized as-is rather than padded, since a length mismatch is a caller
 * bug worth seeing in the output instead of silently papering over.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}
