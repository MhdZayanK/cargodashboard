import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

function getAuthUser(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

function parseExcelDate(value: unknown): Date | null {
  if (!value || value === ".") return null;
  if (typeof value === "number") {
    // Excel serial date
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
  }
  const str = String(value).trim();
  if (!str || str === ".") return null;
  // Format seen: "09/01/2026 22:15:00" -> MM/DD/YYYY HH:mm:ss
  const match = str.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;
  const [, mm, dd, yyyy, hh = "0", min = "0", ss = "0"] = match;
  return new Date(
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss))
  );
}

function cleanString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str || str === ".") return null;
  return str.replace(/^'/, ""); // strip Excel's leading text-quote apostrophe
}

function deriveCargoCategory(row: Record<string, unknown>): string {
  const dgr = cleanString(row["DGR"]) ?? "";
  const perishables = cleanString(row["PERISHABLES"]) ?? "";
  const express = cleanString(row["EXPRESS(COU & RAC)"]) ?? "";
  if (dgr && !dgr.toLowerCase().startsWith("non-")) return "Dangerous Goods";
  if (perishables && !perishables.toLowerCase().startsWith("non-")) return "Perishable";
  if (express && !express.toLowerCase().startsWith("non-")) return "Express";
  return "General";
}

function deriveFlightType(row: Record<string, unknown>): string | null {
  const raw = cleanString(row["Pax/Frt/Trk"]);
  if (!raw) return null;
  const map: Record<string, string> = { PAX: "Passenger", FRT: "Freighter", TRK: "Trucking" };
  return map[raw.toUpperCase()] ?? raw;
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const station = formData.get("station") as string | null;
  const flowType = formData.get("flowType") as string | null;

  if (!file || !station || !flowType) {
    return NextResponse.json(
      { error: "file, station and flowType are all required" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // The sample file has a title row, a blank row, and a From/To date row
  // before the real header — range: 4 skips down to row 5 (0-indexed 4),
  // which is where "Freight Arrival Date/Time(ATA)" actually starts.
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
    range: 4,
    defval: null,
  });

  if (rows.length === 0) {
    return NextResponse.json({ error: "No data rows found in file" }, { status: 400 });
  }

  const batch = await prisma.uploadBatch.create({
    data: {
      fileName: file.name,
      uploadedBy: user.userId ?? user.email ?? "unknown",
      flowType,
      station,
      recordCount: rows.length,
    },
  });

  const records = rows.map((row) => {
    const ata = parseExcelDate(row["Freight Arrival Date/Time(ATA)"]);
    const std = parseExcelDate(row["STD"]);
    const atd = parseExcelDate(row["ATD"]);

    const movementDate =
      flowType === "Import" ? ata ?? atd ?? std : atd ?? std ?? ata;

    return {
      batchId: batch.id,
      ata,
      carrierName: cleanString(row["CarrierShortName"]),
      carrierCode: cleanString(row["CarrierCode"]),
      flightNumber: cleanString(row["FlightNumber"]),
      std,
      atd,
      aircraftType: cleanString(row["A/C Type"]),
      awbPrefix: cleanString(row["AWBPrefix"]),
      awbNumber: cleanString(row["AWBNumber"]),
      origin: cleanString(row["Origin"]),
      destination: cleanString(row["Destination"]),
      boardingPoint: cleanString(row["Boarding Point"]),
      pieces: row["Pieces"] ? Number(row["Pieces"]) : null,
      weight: row["Weight"] ? Number(row["Weight"]) : null,
      station,
      flowType,
      flightType: deriveFlightType(row),
      cargoCategory: deriveCargoCategory(row),
      movementDate,
    };
  });

  await prisma.cargoRecord.createMany({ data: records });

  return NextResponse.json({
    success: true,
    batchId: batch.id,
    recordsImported: records.length,
  });
}