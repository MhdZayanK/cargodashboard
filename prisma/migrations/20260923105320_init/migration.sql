-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "flowType" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CargoRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ata" TIMESTAMP(3),
    "carrierName" TEXT,
    "carrierCode" TEXT,
    "flightNumber" TEXT,
    "std" TIMESTAMP(3),
    "atd" TIMESTAMP(3),
    "aircraftType" TEXT,
    "awbPrefix" TEXT,
    "awbNumber" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "boardingPoint" TEXT,
    "pieces" INTEGER,
    "weight" DOUBLE PRECISION,
    "station" TEXT NOT NULL,
    "flowType" TEXT NOT NULL,
    "flightType" TEXT,
    "cargoCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CargoRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "CargoRecord_station_flowType_createdAt_idx" ON "CargoRecord"("station", "flowType", "createdAt");

-- AddForeignKey
ALTER TABLE "CargoRecord" ADD CONSTRAINT "CargoRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
