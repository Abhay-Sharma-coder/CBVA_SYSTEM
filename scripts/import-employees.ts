/**
 * Imports the supplied Employee List for Booking System.xlsx into users.
 *
 * This deliberately uses only Node built-ins: the workbook stays the source of
 * truth without adding a browser-facing Excel dependency. Existing password
 * hashes and admin flags are never changed by an HR roster refresh.
 */
import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { v5 as uuidv5 } from "uuid";
import * as schema from "../src/lib/db/schema";

const NS = "6f0a1c2e-8b3d-4e5a-9f10-2b7c4d5e6a8b";
const WORKBOOK = process.env.EMPLOYEE_WORKBOOK ?? "Employee List for Booking System.xlsx";

function entry(zip: Buffer, name: string): Buffer {
  const end = zip.lastIndexOf(Buffer.from("PK\x05\x06"));
  if (end < 0) throw new Error("Workbook is not a valid zip archive.");
  const centralOffset = zip.readUInt32LE(end + 16);
  let at = centralOffset;
  while (zip.readUInt32LE(at) === 0x02014b50) {
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const fileNameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    const fileName = zip.subarray(at + 46, at + 46 + fileNameLength).toString("utf8");
    if (fileName === name) {
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const data = zip.subarray(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
      return method === 0 ? data : method === 8 ? inflateRawSync(data) : (() => { throw new Error(`Unsupported compression method ${method}.`); })();
    }
    at += 46 + fileNameLength + extraLength + commentLength;
  }
  throw new Error(`Workbook entry not found: ${name}`);
}

function decode(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();
}

function workbookRows(file: string) {
  const zip = readFileSync(file);
  const strings = [...entry(zip, "xl/sharedStrings.xml").toString("utf8").matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((m) => decode(m[1]));
  const sheet = entry(zip, "xl/worksheets/sheet1.xml").toString("utf8");
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const values: Record<string, string> = {};
    for (const cell of row[1].matchAll(/<c\s+[^>]*r="([A-Z]+)\d+"[^>]*?(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)) {
      const raw = cell[3].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      values[cell[1]] = cell[2] === "s" ? (strings[Number(raw)] ?? "") : decode(raw);
    }
    return values;
  });
}

function mapGrade(value: string): schema.Grade {
  if (value === "Leader") return "partner";
  if (value === "M/SM") return "manager";
  if (value === "Article") return "article";
  return "assistant_manager"; // "AM & Below" in the HR workbook
}

async function main() {
  const rows = workbookRows(WORKBOOK).slice(1);
  const employees = rows.map((row) => ({
    displayName: row.A,
    email: row.B.toLowerCase(),
    team: row.C || null,
    grade: mapGrade(row.D),
    seatMode: row.E === "Yes" ? "fixed" as const : "bookable" as const,
  })).filter((employee) => employee.displayName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email));

  if (!employees.length) throw new Error("No employee records found in the workbook.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  for (const employee of employees) {
    await db.insert(schema.users).values({
      id: uuidv5(`user|${employee.email}`, NS),
      ...employee,
      isActive: true,
      isAdmin: false,
    }).onConflictDoUpdate({
      target: schema.users.email,
      set: {
        displayName: sql`excluded.display_name`, team: sql`excluded.team`, grade: sql`excluded.grade`,
        seatMode: sql`excluded.seat_mode`, isActive: true,
      },
    });
  }
  await pool.end();
  console.log(`Imported ${employees.length} employees from ${WORKBOOK}. Passwords were not changed.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
