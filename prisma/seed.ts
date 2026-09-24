import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. Test user for login
  const passwordHash = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.upsert({
    where: { email: "admin@sats.com" },
    update: {},
    create: {
      email: "admin@sats.com",
      name: "Admin User",
      passwordHash,
    },
  });
  console.log("User ready:", user.email, "(password: admin123)");

  // 2. Upload batch (from Import_Sample_Tonnage.xlsx)
  const batch = await prisma.uploadBatch.create({
    data: {
      fileName: "Import_Sample_Tonnage.xlsx",
      uploadedBy: user.email,
      flowType: "IMPORT",
      station: "DXB",
      recordCount: 3,
    },
  });
  console.log("UploadBatch created:", batch.id);

  // 3. Cargo records from the sheet's 3 sample rows
  const records = [
    {
      batchId: batch.id,
      ata: new Date("2026-09-01T22:15:00Z"),
      carrierName: "SKYLINE AIRWAYS",
      carrierCode: "SL",
      flightNumber: "SL101",
      aircraftType: "737",
      awbPrefix: "201",
      awbNumber: "12345678",
      origin: "DXB",
      destination: "RUH",
      boardingPoint: "DXB",
      pieces: 12,
      weight: 145,
      station: "DXB",
      flowType: "IMPORT",
      flightType: "PAX",
      cargoCategory: "GEN",
      movementDate: new Date("2026-09-01T22:15:00Z"),
    },
    {
      batchId: batch.id,
      ata: new Date("2026-09-01T23:05:00Z"),
      carrierName: "OCEANIC AIR CARGO",
      carrierCode: "OA",
      flightNumber: "OA245",
      aircraftType: "777",
      awbPrefix: "310",
      awbNumber: "87654321",
      origin: "SIN",
      destination: "DXB",
      boardingPoint: "SIN",
      pieces: 25,
      weight: 310,
      station: "DXB",
      flowType: "IMPORT",
      flightType: "PAX",
      cargoCategory: "GEN",
      movementDate: new Date("2026-09-01T23:05:00Z"),
    },
    {
      batchId: batch.id,
      ata: new Date("2026-09-02T01:40:00Z"),
      carrierName: "NORDIC WINGS",
      carrierCode: "NW",
      flightNumber: "NW078",
      aircraftType: "330",
      awbPrefix: "450",
      awbNumber: "55667788",
      origin: "ARN",
      destination: "RUH",
      boardingPoint: "ARN",
      pieces: 18,
      weight: 220,
      station: "DXB",
      flowType: "IMPORT",
      flightType: "PAX",
      cargoCategory: "GEN",
      movementDate: new Date("2026-09-02T01:40:00Z"),
    },
  ];

  for (const r of records) {
    const created = await prisma.cargoRecord.create({ data: r });
    console.log("CargoRecord created:", created.flightNumber, created.awbNumber);
  }

  console.log("\nSeed complete.");
  console.log("Login with: admin@sats.com / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });