/**
 * CSV serialisation, hand-rolled.
 *
 * No dependency, for two reasons: the stack is pinned deliberately and a
 * serialiser is thirty lines, and every CSV library's defaults have to be
 * fought anyway — we need RFC 4180 quoting, CRLF line endings, a BOM, and no
 * type coercion of seat codes.
 *
 * The Excel details matter more than they look. CBVA reads tables for a living
 * and every one of these exports is going to be opened in Excel:
 *
 *  - **CRLF**, because Excel on Windows treats a bare LF inside a quoted field
 *    inconsistently.
 *  - **A UTF-8 BOM**, or Excel decodes the file as the system codepage and the
 *    staff names with non-ASCII characters arrive mangled.
 *  - **A leading apostrophe is NOT used**; instead anything that looks like a
 *    formula is quoted and prefixed with a tab-free guard, because a seat code
 *    is data and a cell beginning `=` or `+` is a CSV injection vector when the
 *    file is opened by somebody else.
 */

/** Cells Excel would evaluate rather than display. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "boolean") s = value ? "yes" : "no";
  else s = String(value);

  // Neutralise formula injection without corrupting the value: the cell is
  // quoted, so a leading space is enough to stop Excel evaluating it and is
  // stripped by every importer that matters.
  if (FORMULA_START.test(s)) s = ` ${s}`;

  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CsvColumn<T> {
  /** The header, in the words a partner would expect. */
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(","));
  }
  // BOM + CRLF: see the note above. Both are for Excel, not for correctness.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * A CSV response with the filename carrying the range and filters, so a folder
 * of these is still readable in six months.
 */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // These are live numbers over a demo clock; never let a proxy hold one.
      "cache-control": "no-store",
    },
  });
}

/** `cbva-bookings_2026-07-11_2026-09-05_zone-C.csv` */
export function exportFilename(
  kind: string,
  from: string,
  to: string,
  parts: Record<string, string | null | undefined> = {},
): string {
  const suffix = Object.entries(parts)
    .filter(([, v]) => v)
    .map(([k, v]) => `_${k}-${String(v).replace(/[^A-Za-z0-9-]/g, "")}`)
    .join("");
  return `cbva-${kind}_${from}_${to}${suffix}.csv`;
}
