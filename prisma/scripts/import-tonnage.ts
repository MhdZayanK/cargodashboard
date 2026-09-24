/**
 * Import a tonnage manifest (.xlsx) into UploadBatch + CargoRecord.
 *
 * Run (from the project root, PowerShell):
 *   npx tsx prisma/scripts/import-tonnage.ts "C:\path\Import_Sample_Tonnage.xlsx" Import your-name
 *
 * Load into a different database (e.g. the online one) for one run only:
 *   $env:DATABASE_URL="postgresql://...your direct connection string..."
 *   npx tsx prisma/scripts/import-tonnage.ts "C:\path\file.xlsx" Import your-name
 *   Remove-Item Env:DATABASE_URL
 *
 * Args:
 *   1) path to the .xlsx file
 *   2) flow type for the whole file: "Import" | "Export" | "Transit"
 *   3) optional: who's running the import (defaults to "cli-import")
 *   --force  import even if a batch with the same file name + flow type exists
 *
 * NOTE on file format: some exports from this source system are saved as
 * "strict" OOXML, which trips up several xlsx readers. If this script fails
 * to find the header row, open the file in Excel or LibreOffice and re-save
 * it once (same .xlsx) — that rewrites it in standard OOXML.
 */

// Must be first so DATABASE_URL is loaded before the Prisma client is created.
import "dotenv/config";

import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";
// Reuse the app's Prisma client. Prisma 7 needs a driver adapter, which
// lib/prisma.ts already sets up, so a bare `new PrismaClient()` would fail.
import { prisma } from "../../lib/prisma";

type FlowType = "Import" | "Export" | "Transit";

const CHUNK_SIZE = 500;

// The header isn't always on the same row (title/date-range banner rows can
// vary in count), so find it by looking for a known column name instead of
// a fixed row index.
const HEADER_ANCHOR = "Freight Arrival Date/Time(ATA)";

function excelDateToJs(value: unknown): Date | null {
  if (value === null || value === undefined || value === "" || value === ".") {
    return null;
  }
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)));
  }
  const asDate = new Date(String(value));
  return isNaN(asDate.getTime()) ? null : asDate;
}

function cleanString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "" || s === ".") return null;
  return s;
}

function deriveStation(flowType: FlowType, origin: string | null, destination: string | null): string {
  // Import: cargo lands at the destination station.
  // Export: cargo departs from the origin station.
  if (flowType === "Export") return origin ?? destination ?? "UNKNOWN";
  return destination ?? origin ?? "UNKNOWN";
}

/**
 * The single date the dashboard filters and groups on.
 * Import -> ata. Export/Transit -> atd, falling back to std, then ata.
 */
function deriveMovementDate(
  flowType: FlowType,
  ata: Date | null,
  atd: Date | null,
  std: Date | null
): Date | null {
  if (flowType === "Import") return ata ?? atd ?? std;
  return atd ?? std ?? ata;
}

function deriveFlightType(paxFrtTrk: string | null): string {
  if (!paxFrtTrk) return "Scheduled";
  const v = paxFrtTrk.toUpperCase();
  if (v === "PAX") return "Scheduled"; // belly cargo on a scheduled passenger flight
  if (v === "FRT") return "Freighter";
  // "TRK" (trucked / road feeder) and anything else: no reliable Charter
  // signal exists in this manifest today. Defaulting to Freighter — confirm
  // with ops whether a separate charter indicator exists elsewhere.
  return "Freighter";
}

function deriveCargoCategory(
  dgr: string | null,
  perishables: string | null,
  specialHandling: string | null
): string {
  if (dgr && !dgr.toUpperCase().startsWith("NON-")) return "Dangerous Goods";
  if (perishables && !perishables.toUpperCase().startsWith("NON-")) return "Perishable";
  const sh = (specialHandling ?? "").toUpperCase();
  if (sh.includes("AVI")) return "Live Animals";
  if (sh.includes("AOG")) return "AOG";
  return "General";
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "UNKNOWN";
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

async function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const force = flags.includes("--force");

  const filePath = args[0];
  const flowTypeArg = (args[1] as FlowType) || "Import";
  const uploadedBy = args[2] || "cli-import";

  if (!filePath) {
    console.error("Usage: tsx prisma/scripts/import-tonnage.ts <file.xlsx> [Import|Export|Transit] [uploadedBy] [--force]");
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  if (!["Import", "Export", "Transit"].includes(flowTypeArg)) {
    console.error(`Flow type must be Import, Export or Transit (got "${flowTypeArg}").`);
    process.exit(1);
  }

  const fileName = path.basename(filePath);

  // Importing the same file twice would double every tonnage figure.
  if (!force) {
    const existing = await prisma.uploadBatch.findFirst({
      where: { fileName, flowType: flowTypeArg },
    });
    if (existing) {
      console.error(
        `"${fileName}" was already imported as ${flowTypeArg} (batch ${existing.id}). ` +
          `Re-run with --force if you really want to import it again.`
      );
      process.exit(1);
    }
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });

  const headerRowIndex = rows.findIndex((row) => row[0] === HEADER_ANCHOR);
  if (headerRowIndex === -1) {
    console.error(
      `Could not find header row (looked for "${HEADER_ANCHOR}"). ` +
        `The file's layout may have changed, or it needs re-saving (see file-format note at top of script).`
    );
    process.exit(1);
  }

  const headers = rows[headerRowIndex].map((h) => String(h ?? "").trim());
  const dataRows = rows
    .slice(headerRowIndex + 1)
    .filter((r) => r.length > 0 && r[0] !== undefined && r[0] !== "");

  const col = (row: unknown[], name: string) => row[headers.indexOf(name)];

  console.log(`Found ${dataRows.length} data row(s) in "${fileName}" (sheet: ${sheetName}).`);

  // Pre-compute each row's derived station so the batch can store the
  // majority station (a batch needs a single station value; individual
  // records keep their own derived station too, in case a file mixes stations).
  const stations = dataRows.map((row) =>
    deriveStation(flowTypeArg, cleanString(col(row, "Origin")), cleanString(col(row, "Destination")))
  );
  const batchStation = mostCommon(stations);

  const batch = await prisma.uploadBatch.create({
    data: {
      fileName,
      uploadedBy,
      flowType: flowTypeArg,
      station: batchStation,
      recordCount: 0, // updated below once we know how many actually inserted
    },
  });

  // ---- Build every record first --------------------------------------
  const records: {
    sourceRowNumber: number;
    data: ReturnType<typeof buildRecord>;
  }[] = [];
  let noDate = 0;

  function buildRecord(row: unknown[]) {
    const weightRaw = col(row, "Weight");
    const weight =
      weightRaw === undefined || weightRaw === null || weightRaw === ""
        ? null
        : typeof weightRaw === "number"
        ? weightRaw
        : parseFloat(String(weightRaw));

    const origin = cleanString(col(row, "Origin"));
    const destination = cleanString(col(row, "Destination"));
    const dgr = cleanString(col(row, "DGR"));
    const perishables = cleanString(col(row, "PERISHABLES"));
    const specialHandling = cleanString(col(row, "SpecialhandlingCode"));
    const paxFrtTrk = cleanString(col(row, "Pax/Frt/Trk"));

    const piecesRaw = col(row, "Pieces");
    const pieces =
      piecesRaw === undefined || piecesRaw === null || piecesRaw === ""
        ? null
        : parseInt(String(piecesRaw), 10);

    const ata = excelDateToJs(col(row, "Freight Arrival Date/Time(ATA)"));
    const std = excelDateToJs(col(row, "STD"));
    const atd = excelDateToJs(col(row, "ATD"));

    return {
      batchId: batch.id,

      ata,
      carrierName: cleanString(col(row, "CarrierShortName")),
      carrierCode: cleanString(col(row, "CarrierCode")),
      flightNumber: cleanString(col(row, "FlightNumber")),
      std,
      atd,
      aircraftType: cleanString(col(row, "A/C Type")),
      awbPrefix: cleanString(col(row, "AWBPrefix")),
      awbNumber: cleanString(col(row, "AWBNumber")),
      origin,
      destination,
      boardingPoint: cleanString(col(row, "Boarding Point")),
      pieces: pieces !== null && !isNaN(pieces) ? pieces : null,
      weight: weight !== null && !isNaN(weight) ? weight : null,

      station: deriveStation(flowTypeArg, origin, destination),
      flowType: flowTypeArg,
      flightType: deriveFlightType(paxFrtTrk),
      cargoCategory: deriveCargoCategory(dgr, perishables, specialHandling),

      // The dashboard filters on this. Without it a row never shows up.
      movementDate: deriveMovementDate(flowTypeArg, ata, atd, std),
    };
  }

  for (let i = 0; i < dataRows.length; i++) {
    const sourceRowNumber = headerRowIndex + 2 + i; // 1-indexed, matches Excel row numbers
    const data = buildRecord(dataRows[i]);

    if (!data.movementDate) {
      noDate++;
      console.warn(`Row ${sourceRowNumber}: no ATA/ATD/STD date, skipped (it would never show on the dashboard).`);
      continue;
    }
    records.push({ sourceRowNumber, data });
  }

  // ---- Insert in chunks (far faster than one round trip per row) -----
  let created = 0;
  let failed = 0;

  for (let start = 0; start < records.length; start += CHUNK_SIZE) {
    const chunk = records.slice(start, start + CHUNK_SIZE);
    try {
      const result = await prisma.cargoRecord.createMany({ data: chunk.map((r) => r.data) });
      created += result.count;
    } catch {
      // One bad row fails the whole chunk, so retry it row by row to find it.
      for (const r of chunk) {
        try {
          await prisma.cargoRecord.create({ data: r.data });
          created++;
        } catch (err) {
          failed++;
          console.error(`Row ${r.sourceRowNumber}: failed to insert —`, err);
        }
      }
    }
    console.log(`  ${Math.min(start + CHUNK_SIZE, records.length)} / ${records.length} processed`);
  }

  await prisma.uploadBatch.update({
    where: { id: batch.id },
    data: { recordCount: created },
  });

  console.log(
    `Done. Batch ${batch.id}: inserted ${created} record(s), ${noDate} without a date, ${failed} failed.`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});